package com.daylight.share

import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.Kind
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.Path
import com.daylight.share.inbox.ReaderApps
import com.daylight.share.inbox.Routes
import org.junit.Assert.assertEquals
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
        assertEquals(Path.SEND_FILE_GENERIC, routes[1].path)
        val multi = Routes.sendMultiple(ctx, "$main.experiment", listOf(item(Kind.FILE, mime = "application/pdf") to f, item(Kind.FILE, mime = "application/epub+zip") to f))
        assertEquals("application/*", multi!!.intent.type)
        assertEquals(2, multi.intent.clipData!!.itemCount)
    }
}
