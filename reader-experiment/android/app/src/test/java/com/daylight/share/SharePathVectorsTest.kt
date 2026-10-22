package com.daylight.share

import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Json
import com.daylight.share.core.Kind
import com.daylight.share.core.ShareException
import com.daylight.share.core.lab.Normalise
import com.daylight.share.sender.ShareActivity
import com.daylight.share.sender.ShareOptions
import com.daylight.share.sender.Shared
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * Smart intake and F11's rule on the phone's own share path (LAB-PLAN F16.1, F11.5 with 6.5 Q1 = b; card K4): every
 * case of `share/vectors/normalise.json` that a share sheet can hand over (text, with or without a subject) goes in as
 * an `ACTION_SEND` intent, through `ShareActivity.parseLab` and the sender's intake, and comes out as the vectors say:
 * headline + link shares as links with the headline as their title, tracking removed with the URL as shared in
 * `x-orig`; text without a link as a note; an excerpt only from "Send as excerpt" (`source: "selection"`).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SharePathVectorsTest {
    private val app: App = ApplicationProvider.getApplicationContext()
    private val relay = FakeRelay()

    @After
    fun tearDown() = PhoneKit.reset()

    @Suppress("UNCHECKED_CAST")
    private val cases: List<Map<String, Any?>> by lazy {
        val path = File(System.getProperty("dls.labVectors")!!).parentFile.resolve("normalise.json")
        (Json.parse(path.readText()) as Map<String, Any?>)["cases"] as List<Map<String, Any?>>
    }

    @Test
    fun everyShareSheetCaseComesOutAsTheVectorsSay() {
        PhoneKit.phone(app, relay)
        var n = 0
        for (c in cases) {
            @Suppress("UNCHECKED_CAST")
            val input = c["input"] as Map<String, Any?>
            @Suppress("UNCHECKED_CAST")
            val expect = c["expect"] as Map<String, Any?>
            // A share sheet hands over text and a subject: cases with a URL of their own are the core lane's.
            if (input.containsKey("url")) continue
            val text = input["text"] as? String ?: continue
            if (text.isBlank()) continue
            n++
            val name = c["name"] as String
            app.prefs.setLabUse("F16", input["clean"] != false)
            val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            (input["subject"] as? String)?.let { intent.putExtra(Intent.EXTRA_SUBJECT, it) }
            val shared = ShareActivity.parseLab(intent)
            if (text.trim().isEmpty()) {
                assertTrue(name, shared.isEmpty())
                continue
            }
            val s = shared.single() as Shared.Text
            val options = ShareOptions(asExcerpt = input["source"] == Normalise.SOURCE_SELECTION)
            val kind = expect["kind"] as String
            val intake = try {
                app.sender.intake(s, options)
            } catch (e: ShareException) {
                assertEquals("$name: refused", Normalise.Kinds.NONE, kind)
                continue
            }
            if (kind == Normalise.Kinds.NONE) fail("$name: expected nothing to send, got ${intake.kind}")
            assertEquals(name, kind, intake.kind)
            when (kind) {
                Normalise.Kinds.LINK -> {
                    assertEquals("$name: url", expect["url"], intake.item.url)
                    assertEquals("$name: title", expect["title"], intake.item.title)
                    assertEquals("$name: x-orig", expect["orig"], intake.item.extras[ItemHeader.X_ORIG])
                    assertEquals(Kind.URL, intake.item.kind)
                }
                Normalise.Kinds.EXCERPT -> {
                    assertEquals(Kind.FILE, intake.item.kind)
                    assertEquals("text/html", intake.item.mime)
                    assertEquals("excerpt", intake.item.extras[ItemHeader.X_CAP])
                    assertTrue("$name: ${intake.item.url}", intake.item.url!!.startsWith((expect["url"] as String).substringBefore("#")))
                }
                Normalise.Kinds.NOTE -> {
                    assertEquals(Kind.FILE, intake.item.kind)
                    assertEquals("text/markdown", intake.item.mime)
                    assertEquals("excerpt", intake.item.extras[ItemHeader.X_CAP])
                }
            }
        }
        app.prefs.setLabUse("F16", true)
        assertTrue("the vectors hold share-sheet cases ($n)", n >= 25)
    }

    /** With Lab off, the share path is v1.1's: the text's first link, and text without one as a .txt file. */
    @Test
    fun withLabOffTheShareIsV11s() {
        PhoneKit.phone(app, relay)
        app.setLab(false)
        val i = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "A read https://example.com/a?utm_source=x")
        assertEquals(listOf(Shared.Link("https://example.com/a?utm_source=x", "A read")), ShareActivity.parse(i))
        val row = kotlinx.coroutines.runBlocking { app.sender.add(ShareActivity.parse(i).single()) }
        assertEquals("https://example.com/a?utm_source=x", row.url)
        assertTrue("no Lab fields", row.header.extras.isEmpty())
        val note = kotlinx.coroutines.runBlocking { app.sender.add(Shared.Text("Notes from the meeting", "Notes")) }
        assertEquals("Notes.txt", note.name)
        assertEquals("text/plain", note.header.mime)
    }
}
