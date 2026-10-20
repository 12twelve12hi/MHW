package com.daylight.share

import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.Kind
import com.daylight.share.inbox.DocumentMode
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.Path
import com.daylight.share.inbox.ReaderApps
import com.daylight.share.inbox.Routes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File

/** Which hand-off goes to which Reader build (PROTOCOL 3.4 and the lead's resolution order). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class RoutesTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val main = ReaderApps.MAIN

    /** FileProvider caches its roots in a static map; every Robolectric test has a new files folder. */
    @Before
    fun clearFileProviderCache() {
        FileProvider::class.java.declaredFields
            .filter { java.lang.reflect.Modifier.isStatic(it.modifiers) && Map::class.java.isAssignableFrom(it.type) }
            .forEach { f ->
                f.isAccessible = true
                (f.get(null) as? MutableMap<*, *>)?.clear()
            }
    }

    private fun install(pkg: String, savePage: Boolean, send: Boolean) {
        val pm = shadowOf(ctx.packageManager)
        if (savePage) {
            val cn = ComponentName(pkg, "$pkg.SavePageActivity")
            pm.addActivityIfNotPresent(cn)
            pm.addIntentFilterForActivity(cn, IntentFilter(ReaderApps.ACTION_SAVE_PAGE).apply { addCategory(Intent.CATEGORY_DEFAULT) })
        }
        if (send) {
            val cn = ComponentName(pkg, "$pkg.ImportActivity")
            pm.addActivityIfNotPresent(cn)
            pm.addIntentFilterForActivity(cn, IntentFilter().apply {
                addAction(Intent.ACTION_SEND)
                addAction(Intent.ACTION_SEND_MULTIPLE)
                addCategory(Intent.CATEGORY_DEFAULT)
                for (t in listOf("text/plain", "text/html", "application/pdf", "application/epub+zip", "application/octet-stream")) addDataType(t)
            })
        }
    }

    private fun item(kind: String, file: String? = null, mime: String? = null) = InboxItem(
        id = "0123456789abcdef0123456789abcdef", kind = kind, url = if (kind == Kind.FILE) null else "https://example.com/a",
        title = "A title", name = if (kind == Kind.FILE) "paper.pdf" else null, mime = mime, file = file,
    )

    private fun stored(name: String, text: String): File =
        File(ctx.filesDir, "inbox/files/x/$name").apply { parentFile!!.mkdirs(); writeText(text) }

    @Test
    fun noReaderNoRoutes() {
        assertTrue(ReaderApps.installed(ctx).isEmpty())
        assertTrue(Routes.forItem(ctx, item(Kind.URL), null, emptyList()).isEmpty())
    }

    @Test
    fun linksGoToSavePageFirstThenAsSharedLinks() {
        install(main, savePage = true, send = true)
        install("$main.preview", savePage = false, send = true)
        install("com.example.other", savePage = true, send = true)
        val readers = ReaderApps.installed(ctx)
        assertEquals(listOf(main, "$main.preview"), readers)
        val routes = Routes.forItem(ctx, item(Kind.URL), null, readers)
        assertEquals(listOf(Path.SAVE_PAGE to main, Path.SEND_LINK to main, Path.SEND_LINK to "$main.preview"), routes.map { it.path to it.pkg })
        val save = routes[0].intent
        assertEquals(ReaderApps.ACTION_SAVE_PAGE, save.action)
        assertEquals(main, save.`package`)
        assertEquals("https://example.com/a", save.getStringExtra(Intent.EXTRA_TEXT))
        assertEquals("A title", save.getStringExtra(ReaderApps.EXTRA_TITLE))
        val link = routes[1].intent
        assertEquals("text/plain", link.type)
        assertEquals("https://example.com/a", link.getStringExtra(Intent.EXTRA_TEXT))
        assertEquals("A title", link.getStringExtra(Intent.EXTRA_SUBJECT))
        // A shared link goes to the Reader's ImportActivity, like a document: a fresh task (DEVICE-CHECKS.md, round 2).
        assertEquals(Routes.IMPORT_FLAGS, link.flags and Routes.IMPORT_FLAGS)
        // SAVE_PAGE answers to this activity: no new task.
        assertEquals(0, save.flags and Intent.FLAG_ACTIVITY_NEW_TASK)
        assertFalse(Path.SEND_LINK.expectsResult)
        assertTrue(Path.SAVE_PAGE.expectsResult)
    }

    @Test
    fun pagesCarryTheirHtml() {
        install(main, savePage = true, send = true)
        val f = stored("page.html", "<html><body>hi</body></html>")
        val r = Routes.forItem(ctx, item(Kind.PAGE, "x/page.html", "text/html"), f, listOf(main)).first()
        assertEquals(Path.SAVE_PAGE, r.path)
        assertNotNull(r.intent.clipData)
        val clip = r.intent.clipData!!
        assertEquals("content", clip.getItemAt(0).uri.scheme)
        assertEquals("text/html", clip.description.getMimeType(0))
        assertEquals("utf-8", r.intent.getStringExtra(ReaderApps.EXTRA_HTML_CHARSET))
        assertTrue(r.intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
    }

    @Test
    fun documentsAreSharedAsStreams() {
        install("$main.experiment", savePage = false, send = true)
        val f = stored("paper.pdf", "%PDF-1.4")
        val routes = Routes.forItem(ctx, item(Kind.FILE, "x/paper.pdf", "application/pdf"), f, ReaderApps.installed(ctx))
        val r = routes.first()
        assertEquals(Path.SEND_FILE to "$main.experiment", r.path to r.pkg)
        assertEquals("application/pdf", r.intent.type)
        assertTrue(r.intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertEquals(Routes.IMPORT_FLAGS, r.intent.flags and Routes.IMPORT_FLAGS)
        // "Open with…" too, in case the Reader is picked.
        val chooser = Routes.openWith(ctx, item(Kind.FILE, "x/paper.pdf", "application/pdf"), f)!!
        val view = chooser.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)!!
        assertEquals(Routes.IMPORT_FLAGS, view.flags and Routes.IMPORT_FLAGS)
        assertEquals(Path.SEND_FILE_GENERIC, routes[1].path)
        val multi = Routes.sendMultiple(ctx, "$main.experiment", listOf(item(Kind.FILE, mime = "application/pdf") to f, item(Kind.FILE, mime = "application/epub+zip") to f))
        assertEquals("application/*", multi!!.intent.type)
        assertEquals(2, multi.intent.clipData!!.itemCount)
    }

    @Test
    fun quietSendsEvenOneDocumentAsSendMultiple() {
        install(main, savePage = true, send = true)
        val f = stored("paper.pdf", "%PDF-1.4")
        val pdf = item(Kind.FILE, "x/paper.pdf", "application/pdf")
        val quiet = Routes.forDocuments(ctx, listOf(pdf to f), listOf(main), DocumentMode.QUIET)
        assertEquals(listOf(Path.SEND_MULTIPLE, Path.SEND_FILE, Path.SEND_FILE_GENERIC), quiet.map { it.path })
        val multi = quiet[0]
        assertEquals(main, multi.pkg)
        assertEquals(listOf(pdf.id), multi.ids)
        assertEquals(Intent.ACTION_SEND_MULTIPLE, multi.intent.action)
        assertEquals(main, multi.intent.`package`)
        assertEquals("application/pdf", multi.intent.type)
        assertEquals(1, multi.intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)!!.size)
        assertEquals(1, multi.intent.clipData!!.itemCount)
        assertTrue(multi.intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)

        // Asking or opening: one document goes as ACTION_SEND (the Reader imports and opens it).
        for (mode in listOf(DocumentMode.ASK, DocumentMode.OPEN)) {
            val r = Routes.forDocuments(ctx, listOf(pdf to f), listOf(main), mode)
            assertEquals(Path.SEND_FILE, r.first().path)
            assertEquals(Intent.ACTION_SEND, r.first().intent.action)
            assertEquals(listOf(pdf.id), r.first().ids)
        }

        // Several documents go together whatever the mode; then the first alone, for a Reader without SEND_MULTIPLE.
        val epub = pdf.copy(id = "1".repeat(32), name = "book.epub", mime = "application/epub+zip")
        for (mode in DocumentMode.entries) {
            val r = Routes.forDocuments(ctx, listOf(pdf to f, epub to f), listOf(main), mode)
            assertEquals(Path.SEND_MULTIPLE, r[0].path)
            assertEquals(listOf(pdf.id, epub.id), r[0].ids)
            assertEquals(Path.SEND_FILE, r[1].path)
            assertEquals(listOf(pdf.id), r[1].ids)
        }
        assertTrue(Routes.forDocuments(ctx, emptyList(), listOf(main), DocumentMode.QUIET).isEmpty())
    }

    @Test
    fun quietFallsBackToSendWhenTheReaderHasNoSendMultiple() {
        val pm = shadowOf(ctx.packageManager)
        val cn = ComponentName(main, "$main.ImportActivity")
        pm.addActivityIfNotPresent(cn)
        pm.addIntentFilterForActivity(cn, IntentFilter(Intent.ACTION_SEND).apply { addCategory(Intent.CATEGORY_DEFAULT); addDataType("application/pdf") })
        val f = stored("paper.pdf", "%PDF-1.4")
        val r = Routes.forDocuments(ctx, listOf(item(Kind.FILE, "x/paper.pdf", "application/pdf") to f), listOf(main), DocumentMode.QUIET)
        assertEquals(listOf(Path.SEND_FILE), r.map { it.path })
    }

    @Test
    fun deliverToListsEveryAppThatTakesPagesOrDocuments() {
        install(main, savePage = true, send = true)
        install(ReaderApps.EXPERIMENT, savePage = true, send = false)
        install("com.example.pdfs", savePage = false, send = true)
        install(ctx.packageName, savePage = false, send = true) // our own share target is never a choice
        val textOnly = ComponentName("com.example.notes", "com.example.notes.Share")
        shadowOf(ctx.packageManager).addActivityIfNotPresent(textOnly)
        shadowOf(ctx.packageManager).addIntentFilterForActivity(textOnly, IntentFilter(Intent.ACTION_SEND).apply { addCategory(Intent.CATEGORY_DEFAULT); addDataType("text/plain") })

        val apps = ReaderApps.candidates(ctx)
        assertEquals(main, apps.first().pkg)
        assertEquals(setOf(main, ReaderApps.EXPERIMENT, "com.example.pdfs"), apps.map { it.pkg }.toSet())
        val experiment = apps.first { it.pkg == ReaderApps.EXPERIMENT }
        assertTrue(experiment.savePage)
        assertFalse(experiment.documents)
        val pdfs = apps.first { it.pkg == "com.example.pdfs" }
        assertFalse(pdfs.savePage)
        assertTrue(pdfs.documents)

        // Automatic stays the Daylight Reader; the side-by-side copy and other apps only when chosen.
        assertEquals(listOf(main), ReaderApps.installed(ctx))
        assertEquals(listOf(main), ReaderApps.targets(ctx, ""))
        assertEquals(listOf(ReaderApps.EXPERIMENT), ReaderApps.targets(ctx, ReaderApps.EXPERIMENT))
        assertEquals(listOf("com.example.pdfs"), ReaderApps.targets(ctx, "com.example.pdfs"))
        assertEquals(listOf(main), ReaderApps.targets(ctx, "com.example.notes"))
        assertEquals(listOf(main), ReaderApps.targets(ctx, "com.example.uninstalled"))
        assertEquals(listOf(main), ReaderApps.targets(ctx, ctx.packageName))

        // Chosen, the side-by-side copy gets links through its SAVE_PAGE.
        val routes = Routes.forItem(ctx, item(Kind.URL), null, ReaderApps.targets(ctx, ReaderApps.EXPERIMENT))
        assertEquals(listOf(Path.SAVE_PAGE to ReaderApps.EXPERIMENT), routes.map { it.path to it.pkg })
        assertTrue(ReaderApps.label(ctx, ReaderApps.EXPERIMENT).contains(ReaderApps.EXPERIMENT))

        // What the chosen app does not take goes to Automatic: the copy takes no documents, the PDF app no links (a
        // shared link counts only for Reader builds).
        assertTrue(experiment.links)
        assertFalse(pdfs.links)
        assertEquals(listOf(ReaderApps.EXPERIMENT), ReaderApps.targetsFor(ctx, Kind.URL, ReaderApps.EXPERIMENT))
        assertEquals(listOf(ReaderApps.EXPERIMENT), ReaderApps.targetsFor(ctx, Kind.PAGE, ReaderApps.EXPERIMENT))
        assertEquals(listOf(main), ReaderApps.targetsFor(ctx, Kind.FILE, ReaderApps.EXPERIMENT))
        assertEquals(listOf("com.example.pdfs"), ReaderApps.targetsFor(ctx, Kind.FILE, "com.example.pdfs"))
        assertEquals(listOf(main), ReaderApps.targetsFor(ctx, Kind.URL, "com.example.pdfs"))
        assertEquals(listOf(main), ReaderApps.targetsFor(ctx, Kind.FILE, ""))
        assertEquals(listOf(main), ReaderApps.targetsFor(ctx, Kind.URL, "com.example.uninstalled"))
        val f = stored("paper.pdf", "%PDF-1.4")
        val doc = Routes.forItem(ctx, item(Kind.FILE, "x/paper.pdf", "application/pdf"), f, ReaderApps.targetsFor(ctx, Kind.FILE, ReaderApps.EXPERIMENT))
        assertEquals(Path.SEND_FILE to main, doc.first().path to doc.first().pkg)
    }
}
