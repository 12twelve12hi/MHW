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
import com.daylight.share.core.OutgoingItem
import com.daylight.share.core.Pairing
import com.daylight.share.core.Reassembler
import com.daylight.share.core.RelayException
import com.daylight.share.core.RelayProbe
import com.daylight.share.core.ShareException
import com.daylight.share.core.Status
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.InboxRepo
import com.daylight.share.inbox.InboxText
import com.daylight.share.inbox.SyncState
import com.daylight.share.sender.SenderRepo
import com.daylight.share.sender.Shared
import com.daylight.share.sender.ShareActivity
import com.daylight.share.ui.sizeText
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import kotlinx.coroutines.runBlocking
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
        assertEquals("Your Daylight is out of space, so new items can’t be saved. Free some space.", InboxText.OUT_OF_SPACE)
        // Relay failures are ShareExceptions; an IOException is this device failing to write (a full disk).
        assertEquals(InboxText.OUT_OF_SPACE, InboxText.forFailure(IOException("No space left on device")))
        assertEquals(InboxText.OFFLINE, InboxText.forFailure(IllegalStateException("x")))
        val s = SyncState()
        s.failed(IOException("No space left on device")).let {
            assertTrue(it.storeFull)
            assertNull(it.error)
        }
        assertEquals(InboxText.OFFLINE, s.failed(RelayException(ErrorCode.NETWORK, "x", 0)).error)
        // A limit stays visible once the live connection opens; a failure's sentence goes.
        assertEquals(InboxText.LIMITED, s.copy(error = InboxText.LIMITED).connected().error)
        assertNull(s.copy(error = InboxText.OFFLINE).connected().error)
        assertTrue(s.connected().live)
        assertEquals("The Reader doesn’t confirm documents. If it isn’t in its library, add it again.", InboxText.unconfirmedHint(Kind.FILE))
        assertEquals("The Reader hasn’t confirmed this one. If it isn’t in its library, add it again.", InboxText.unconfirmedHint(Kind.URL))
    }

    @Test
    fun aRelayThatFailsTheCheckIsNotSaved() = runBlocking {
        val before = app.prefs.inboxRelay
        assertEquals(RelayProbe.UNREACHABLE, app.inbox.saveRelay("http://127.0.0.1:9"))
        assertEquals(before, app.prefs.inboxRelay)
        val tooSmall = ShareException("relay", RelayProbe.TOO_SMALL, "status", status = 413)
        assertEquals(RelayProbe.TOO_SMALL, app.inbox.saveRelay("https://relay.example.org", probe = { tooSmall }))
        assertEquals("The relay must be an http(s) address.", app.inbox.saveRelay("ftp://relay.example.org"))
        assertEquals(before, app.prefs.inboxRelay)
        // A relay that passes is saved, and the pairing link carries it.
        assertNull(app.inbox.saveRelay("https://Relay.Example.org/ntfy/", probe = { null }))
        assertEquals("https://relay.example.org/ntfy", app.prefs.inboxRelay)
        assertEquals("https://relay.example.org/ntfy", app.inbox.ensurePairing().relay)
        assertNull(app.prefs.inboxRelayWarning)
        // ntfy.sh needs no check.
        assertNull(app.inbox.saveRelay("", probe = { fail("checked ntfy.sh"); null }))
        assertEquals("https://ntfy.sh", app.prefs.inboxRelay)
    }

    // --------------------------------------------------------------------------------------------- the sender

    /**
     * A row's size line uses the units of its sentences (CHANGES-v1.1 2.5, `formatMB`): decimal and rounded up, so
     * "PDF · 14.2 MB" sits above "…this one is 14.2 MB." and an 8,000,000-byte file is "8 MB" under "up to 9 MB".
     */
    @Test
    fun rowSizesMatchTheSentences() {
        assertEquals("", sizeText(0))
        assertEquals("999 B", sizeText(999))
        assertEquals("1 KB", sizeText(1_000))
        assertEquals("45 KB", sizeText(45_000))
        assertEquals("124 KB", sizeText(123_456))
        assertEquals("999 KB", sizeText(999_000))
        assertEquals("1 MB", sizeText(999_001))
        assertEquals("8 MB", sizeText(8_000_000))
        assertEquals("9 MB", sizeText(9_000_000))
        assertEquals("9.1 MB", sizeText(9_000_001))
        assertEquals("14.2 MB", sizeText(14_200_000))
        for (n in listOf(9_000_001L, 12_000_000L, 14_200_000L, 52_428_800L)) {
            val sentence = com.daylight.share.core.Text.tooBigMessage(n)
            assertTrue(sentence, sentence.endsWith("this one is ${sizeText(n)}."))
        }
    }

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
        fun stream(size: Long) = object : InputStream() {
            override fun read(): Int = if (read++ < size) 0 else -1
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (read >= size) return -1
                val n = minOf(len.toLong(), size - read).toInt()
                read += n
                return n
            }
        }
        val dest = File.createTempFile("dls-copy", ".bin")
        try {
            SenderRepo.copyCapped(stream(14_200_000), dest)
            fail("copied")
        } catch (e: ShareException) {
            assertEquals("too-large", e.code)
            // The rest is read (not stored) to tell its size: the shared sentence.
            assertEquals("Too big to send. Files can be up to 9 MB; this one is 14.2 MB.", e.message)
        }
        assertTrue("stopped storing at the limit: ${dest.length()}", dest.length() <= 9_000_000)
        assertEquals(14_200_000, read)
        // Longer than it measures: the sentence without the size.
        read = 0
        try {
            SenderRepo.copyCapped(stream(Long.MAX_VALUE), dest)
            fail("copied")
        } catch (e: ShareException) {
            assertEquals("Too big to send. Files can be up to 9 MB.", e.message)
        }
        assertTrue("read $read", read <= SenderRepo.MAX_MEASURED + 256 * 1024)
        val small = File.createTempFile("dls-copy", ".bin")
        SenderRepo.copyCapped(ByteArray(1234).inputStream(), small)
        assertEquals(1234, small.length())
    }

    @Test
    fun anotherCodeAfterUnpairDeletesTheOldOutboxAndTheSameCodeKeepsIt() = runBlocking {
        val nowhere = "http://127.0.0.1:9"
        val kitchen = Pairing(Pairing.generate().secret, nowhere, "Kitchen")
        app.sender.pair(kitchen)
        app.sender.add(Shared.Link("https://example.com/pending", "Pending"))
        val kitchenDir = File(app.filesDir, "outbox/${kitchen.keys.inboxTopic}")
        assertTrue(kitchenDir.isDirectory)

        // Unpair, then the same code again: the outbox is still there.
        app.sender.unpair()
        assertTrue(kitchenDir.isDirectory)
        app.sender.pair(kitchen)
        app.sender.refresh()
        assertEquals(1, app.sender.rows.value.size)

        // Unpair, then another code: everything of the first Daylight goes (CHANGES-v1.1 2.4 "different secret").
        app.sender.unpair()
        val office = Pairing(Pairing.generate().secret, nowhere, "Office")
        app.sender.pair(office)
        assertFalse(kitchenDir.exists())
        app.sender.refresh()
        assertTrue(app.sender.rows.value.isEmpty())
    }

    @Test
    fun aShareStillBeingPreparedWhenThePairingChangesIsRefused() {
        val nowhere = "http://127.0.0.1:9"
        val kitchen = Pairing(Pairing.generate().secret, nowhere, "Kitchen")
        app.sender.pair(kitchen)
        // A file was being copied for Kitchen when the user switched to Office.
        app.sender.pair(Pairing(Pairing.generate().secret, nowhere, "Office"))
        try {
            app.sender.addTo(kitchen.keys.inboxTopic, OutgoingItem(Kind.FILE, name = "a.pdf", mime = "application/pdf"), BytesBody(ByteArray(10)))
            fail("added")
        } catch (e: ShareException) {
            assertEquals("pairing", e.code)
            assertEquals(SenderRepo.PAIRING_CHANGED, e.message)
        }
        assertFalse("nothing written for Kitchen", File(app.filesDir, "outbox/${kitchen.keys.inboxTopic}").exists())
        assertTrue(app.sender.rows.value.isEmpty())
    }

    @Test
    fun saveRelayOnASenderNeedsAPairing() {
        assertEquals(SenderRepo.NOT_PAIRED_RELAY, app.sender.saveRelay("https://relay.example.org"))
        assertNull(app.sender.pairing())
        val p = Pairing(Pairing.generate().secret, "http://127.0.0.1:9", "Kitchen")
        app.sender.pair(p)
        assertEquals("The relay must be an http(s) address.", app.sender.saveRelay("ftp://relay.example.org"))
        assertNull(app.sender.saveRelay("https://Relay.Example.org/"))
        assertEquals("https://relay.example.org", app.sender.pairing()!!.relay)
        assertTrue(app.sender.pairing()!!.sameSecret(p))
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
