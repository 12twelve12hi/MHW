package com.daylight.share

import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.Bytes
import com.daylight.share.core.BytesBody
import com.daylight.share.core.ErrorCode
import com.daylight.share.core.FileBody
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Kind
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.Reassembler
import com.daylight.share.core.RelayException
import com.daylight.share.core.ShareException
import com.daylight.share.core.Status
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.InboxRepo
import com.daylight.share.inbox.InboxText
import com.daylight.share.sender.SenderRepo
import com.daylight.share.sender.ShareActivity
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile

/** The app's part of protocol 1.1 (CHANGES-v1.1 5.5): storing items, the Inbox's words, and the sender's size limit. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ProtocolRulesTest {
    private val app: App = ApplicationProvider.getApplicationContext()

    private fun completed(kind: String, name: String?, bytes: ByteArray, id: String = ItemHeader.newId()): Reassembler.Completed {
        val f = File.createTempFile("dls-content", ".bin").apply { writeBytes(bytes) }
        val h = ItemHeader(
            id, kind, url = if (kind == Kind.FILE) null else "https://example.com/p", title = "T", name = name,
            mime = if (kind == Kind.PAGE) "text/html" else "application/pdf", size = bytes.size.toLong(), sha256 = "0".repeat(64),
        )
        return Reassembler.Completed(h, if (kind == Kind.URL) BytesBody(ByteArray(0)) else FileBody(f))
    }

    // --------------------------------------------------------------------------------------------- the Inbox

    @Test
    fun aCjkNamedPdfIsStoredUnderItsSafeName() {
        val name = ItemHeader.check(mapOf("v" to 1.0, "id" to "0".repeat(32), "kind" to "file", "name" to "日本語のファイル名".repeat(12) + ".pdf", "size" to 3.0, "sha256" to "0".repeat(64), "sent" to "")).name!!
        assertTrue(name.toByteArray(Charsets.UTF_8).size <= 200)
        val bytes = Bytes.random(3000)
        val done = completed(Kind.FILE, name, bytes)
        app.inbox.accept(done)
        val item = app.inbox.get(done.header.id)!!
        assertEquals("${done.header.id}/$name", item.file)
        assertArrayEquals(bytes, app.inbox.fileOf(item)!!.readBytes())
        assertEquals(name, item.name)
        assertEquals(InboxItem.WAITING, item.state)
    }

    @Test
    fun aNameTheFileSystemRefusesIsStoredAsDocument() {
        val bytes = Bytes.random(100)
        val done = completed(Kind.FILE, "Quarterly report.pdf", bytes)
        val real = app.inbox.move
        app.inbox.move = { src, dest -> if (dest.name.startsWith("Quarterly")) throw IOException("name refused") else real(src, dest) }
        try {
            app.inbox.accept(done)
        } finally {
            app.inbox.move = real
        }
        val item = app.inbox.get(done.header.id)!!
        assertEquals("${done.header.id}/document.pdf", item.file)
        assertEquals("Quarterly report.pdf", item.name) // the item keeps its name
        assertArrayEquals(bytes, app.inbox.fileOf(item)!!.readBytes())
    }

    @Test
    fun theSameIdTwiceIsQueuedForTheReaderOnce() {
        val id = ItemHeader.newId()
        app.inbox.accept(completed(Kind.FILE, "a.pdf", Bytes.random(10), id))
        app.inbox.setItem(id) { it.copy(state = InboxItem.IN_READER, readerStatus = "sent") }
        val again = completed(Kind.FILE, "a.pdf", Bytes.random(10), id)
        app.inbox.accept(again)
        assertEquals(1, app.inbox.items.value.count { it.id == id })
        assertEquals(InboxItem.IN_READER, app.inbox.get(id)!!.state)
        assertTrue(app.inbox.waiting().none { it.id == id })
        assertFalse((again.content as FileBody).file.exists())
    }

    @Test
    fun pagesAreStoredAsUtf8() {
        fun stored(html: String): String {
            val done = completed(Kind.PAGE, null, html.toByteArray(Charsets.UTF_8))
            app.inbox.accept(done)
            return app.inbox.fileOf(app.inbox.get(done.header.id)!!)!!.readText(Charsets.UTF_8)
        }
        assertEquals("<!DOCTYPE html><meta charset=\"utf-8\"><html><p>ü</p></html>", stored("<!DOCTYPE html><html><p>ü</p></html>"))
        assertEquals("﻿ \n<!doctype html><meta charset=\"utf-8\">\n<html>", stored("﻿ \n<!doctype html>\n<html>"))
        assertEquals("<meta charset=\"utf-8\"><html><head><meta charset=\"iso-8859-1\"></head></html>", stored("<html><head><meta charset=\"iso-8859-1\"></head></html>"))
        assertEquals("<meta charset=\"utf-8\">", String(InboxRepo.withUtf8Meta(ByteArray(0)), Charsets.UTF_8))
        assertEquals("<meta charset=\"utf-8\"><!doctype html", String(InboxRepo.withUtf8Meta("<!doctype html".toByteArray()), Charsets.UTF_8))
    }

    @Test
    fun theReaderLabelSaysWhatTheReaderConfirmed() {
        val base = InboxItem(id = "0".repeat(32), kind = Kind.URL, url = "https://example.com/a")
        assertEquals("Waiting", base.readerLabel)
        assertEquals("In your Reader ✓", base.copy(state = InboxItem.IN_READER, readerStatus = "saved").readerLabel)
        assertEquals("In your Reader ✓", base.copy(state = InboxItem.IN_READER, readerStatus = "duplicate").readerLabel)
        for (s in listOf("queued", "started", "ok", "no_answer", "sent", null)) {
            assertEquals("$s", "Handed to the Reader", base.copy(state = InboxItem.IN_READER, readerStatus = s).readerLabel)
        }
        val doc = base.copy(kind = Kind.FILE, state = InboxItem.IN_READER, readerStatus = "sent", via = "send_file")
        assertFalse(doc.confirmedInReader)
        assertEquals("Handed to the Reader", doc.readerLabel)
        assertEquals("Open — not in the Reader", base.copy(state = InboxItem.OPEN).readerLabel)
    }

    @Test
    fun theInboxSaysWhyNothingArrives() {
        assertEquals("Too much has gone through this network for now. New items will arrive later.", InboxText.forFailure(RelayException("relay", "x", 429)))
        assertEquals(InboxText.LIMITED, InboxText.forFailure(RelayException("relay", "x", 413)))
        assertEquals("Offline. New items will arrive when this Daylight is back online.", InboxText.forFailure(RelayException(ErrorCode.NETWORK, "x", 0)))
        assertEquals("The relay isn’t working right now (error 502). It will keep trying.", InboxText.forFailure(RelayException("relay", "x", 502)))
        assertEquals(InboxText.OFFLINE, InboxText.forFailure(IOException("x")))
        assertEquals("Your Daylight is out of space, so new items can’t be saved. Free some space.", InboxText.OUT_OF_SPACE)
    }

    // --------------------------------------------------------------------------------------------- the sender

    @Test
    fun aFileOver9MBIsRefusedBeforeItIsCopied() {
        val big = File.createTempFile("dls-big", ".pdf").apply { RandomAccessFile(this, "rw").use { it.setLength(9_000_001) } }
        try {
            app.sender.copyIn(Uri.fromFile(big), "application/pdf")
            fail("copied")
        } catch (e: ShareException) {
            assertEquals("too-large", e.code)
            assertEquals("Too big to send. Files can be up to 9 MB; this one is 9.1 MB.", e.message)
        }
        assertTrue(File(app.filesDir, "outbox-incoming").listFiles().isNullOrEmpty())
        val ok = File.createTempFile("dls-ok", ".pdf").apply { RandomAccessFile(this, "rw").use { it.setLength(9_000_000) } }
        val copy = app.sender.copyIn(Uri.fromFile(ok), "application/pdf")
        assertEquals(9_000_000, copy.file.length())
        copy.file.delete()
    }

    @Test
    fun aStreamOfUnknownSizeStopsAt9MB() {
        var read = 0L
        val endless = object : InputStream() {
            override fun read(): Int = if (read++ < 20_000_000) 0 else -1
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (read >= 20_000_000) return -1
                read += len
                return len
            }
        }
        val dest = File.createTempFile("dls-copy", ".bin")
        try {
            SenderRepo.copyCapped(endless, dest)
            fail("copied")
        } catch (e: ShareException) {
            assertEquals("too-large", e.code)
            assertEquals("Too big to send. Files can be up to 9 MB.", e.message)
        }
        assertTrue("stopped at the limit, read $read", read < 9_000_000 + 256 * 1024 + 1)
        val small = File.createTempFile("dls-copy", ".bin")
        SenderRepo.copyCapped(ByteArray(1234).inputStream(), small)
        assertEquals(1234, small.length())
    }

    @Test
    fun theShareCardUsesTheRowsWords() {
        val h = ItemHeader(ItemHeader.newId(), Kind.URL, url = "https://example.com/a")
        val now = System.currentTimeMillis()
        val sent = OutboxRow(h, created = now, status = Status.SENT)
        val failed = OutboxRow(h, created = now, status = Status.FAILED, errorCode = ErrorCode.NETWORK)
        assertEquals("Sent · waiting for your Daylight", ShareActivity.resultText(listOf(sent), 1, "Kitchen"))
        assertEquals("Waiting to send. Couldn’t send right now. It will try again by itself.", ShareActivity.resultText(listOf(failed), 1, "Kitchen"))
        assertEquals("2 items. Waiting to send. Couldn’t send right now. It will try again by itself.", ShareActivity.resultText(listOf(sent, failed), 2, "Kitchen"))
        assertEquals("Still sending 2 items to Kitchen in the background.", ShareActivity.resultText(null, 2, "Kitchen"))
        assertEquals("Nothing was sent.", ShareActivity.resultText(listOf(null), 1, "Kitchen"))
    }
}
