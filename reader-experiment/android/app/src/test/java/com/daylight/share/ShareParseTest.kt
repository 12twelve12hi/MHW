package com.daylight.share

import android.app.Application
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import com.daylight.share.sender.ShareActivity
import com.daylight.share.sender.Shared
import com.daylight.share.sender.SenderRepo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What the share sheet hands us, reduced to what we send. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ShareParseTest {
    private fun send(type: String) = Intent(Intent.ACTION_SEND).setType(type)

    @Test
    fun linkWithSubjectFromABrowser() {
        val i = send("text/plain").putExtra(Intent.EXTRA_TEXT, "https://example.com/a?b=1").putExtra(Intent.EXTRA_SUBJECT, "Example page")
        assertEquals(listOf(Shared.Link("https://example.com/a?b=1", "Example page")), ShareActivity.parse(i))
    }

    @Test
    fun titleAndLinkInTheText() {
        val i = send("text/plain").putExtra(Intent.EXTRA_TEXT, "A great read https://example.com/story.")
        assertEquals(listOf(Shared.Link("https://example.com/story", "A great read")), ShareActivity.parse(i))
    }

    @Test
    fun textWithoutALinkGoesAsText() {
        val i = send("text/plain").putExtra(Intent.EXTRA_TEXT, "Notes from the meeting").putExtra(Intent.EXTRA_SUBJECT, "Notes")
        assertEquals(listOf(Shared.Text("Notes from the meeting", "Notes")), ShareActivity.parse(i))
    }

    @Test
    fun streamsWin() {
        val pdf = Uri.parse("content://docs/1")
        val i = send("application/pdf").putExtra(Intent.EXTRA_STREAM, pdf).putExtra(Intent.EXTRA_TEXT, "https://example.com")
        assertEquals(listOf(Shared.Stream(pdf, "application/pdf")), ShareActivity.parse(i))
    }

    @Test
    fun severalStreams() {
        val a = Uri.parse("content://docs/a")
        val b = Uri.parse("content://docs/b")
        val i = Intent(Intent.ACTION_SEND_MULTIPLE).setType("*/*").putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(a, b))
        assertEquals(listOf(Shared.Stream(a, "*/*"), Shared.Stream(b, "*/*")), ShareActivity.parse(i))
        val c = Intent(Intent.ACTION_SEND).setType("text/markdown")
        c.clipData = ClipData.newRawUri("x", a)
        assertEquals(listOf(Shared.Stream(a, "text/markdown")), ShareActivity.parse(c))
    }

    @Test
    fun nothingUsable() {
        assertTrue(ShareActivity.parse(send("text/plain")).isEmpty())
        assertTrue(ShareActivity.parse(null).isEmpty())
    }

    @Test
    fun mimeTypes() {
        assertEquals("application/pdf", SenderRepo.pickMime("*/*", null, "paper.pdf"))
        assertEquals("text/markdown", SenderRepo.pickMime("application/octet-stream", null, "notes.md"))
        assertEquals("application/epub+zip", SenderRepo.pickMime(null, "application/epub+zip", "book"))
        assertEquals("application/octet-stream", SenderRepo.pickMime(null, null, "mystery"))
    }
}
