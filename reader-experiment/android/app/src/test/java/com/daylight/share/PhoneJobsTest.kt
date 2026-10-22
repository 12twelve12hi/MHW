package com.daylight.share

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.daylight.share.core.ErrorCode
import com.daylight.share.core.Outbox
import com.daylight.share.core.Status
import com.daylight.share.core.lab.LabText
import com.daylight.share.sender.FlushWorker
import com.daylight.share.sender.Notices
import com.daylight.share.sender.SendWorker
import com.daylight.share.sender.Shared
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The phone's Lab jobs (card K4): the share-in-place job `send-<id>` and its "Send results" notices (F04.6), and the
 * offline flush (F07: `defer`, `flushNetwork` from the `CONNECTED` job, passes 3 minutes apart, nothing with Lab off).
 * The jobs' work runs here without WorkManager ([SendWorker.run], [FlushWorker.run]) and once through
 * `TestListenableWorkerBuilder`; the relay is in memory.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PhoneJobsTest {
    private val app: App = ApplicationProvider.getApplicationContext()
    private val relay = FakeRelay()
    private val name = "Kitchen Daylight"

    @After
    fun tearDown() = PhoneKit.reset()

    /** A share in place, stored and remembered for its notice, as the card does it. */
    private fun shareInPlace(url: String, title: String) = runBlocking {
        val row = app.sender.add(Shared.Link(url, title))
        app.sender.noteInPlace(listOf(row.id))
        row
    }

    private fun failedTitle(title: String) = LabText.fill(LabText["shareInPlace.failedTitle"], mapOf("title" to title, "name" to name))

    /** F04.6: the relay answers 413 after the card closed; the job's end posts "Couldn’t send ‘{title}’ to {name}". */
    @Test
    fun a413AfterTheCardClosedPostsTheFailureNotice() {
        PhoneKit.phone(app, relay)
        PhoneKit.grantNotifications(app)
        val row = shareInPlace("https://example.com/full", "A full relay")
        relay.publishStatus = 413
        val after = runBlocking { SendWorker.run(app, row.id) }!!
        assertEquals(Status.FAILED, after.status)
        assertEquals(ErrorCode.FULL, after.errorCode)
        val n = PhoneKit.notifications(app).single()
        assertEquals(failedTitle("A full relay"), PhoneKit.titleOf(n))
        assertEquals(LabText["shareInPlace.failedText"], n.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString())
        assertEquals(Notices.CHANNEL, n.channelId)
        assertTrue("told once", app.prefs.labInPlaceIds().isEmpty())
        runBlocking { app.sender.tick() }
        assertEquals(1, PhoneKit.notifications(app).size)
    }

    /** "Tell me when a send fails" off: nothing is posted. Without notification permission: nothing either. */
    @Test
    fun noNoticeWhenTurnedOffOrNotAllowed() {
        PhoneKit.phone(app, relay)
        PhoneKit.grantNotifications(app)
        app.prefs.labTellFails = false
        val a = shareInPlace("https://example.com/quiet", "Quiet")
        relay.publishStatus = 413
        runBlocking { SendWorker.run(app, a.id) }
        assertTrue(PhoneKit.notifications(app).isEmpty())

        app.prefs.labTellFails = true
        PhoneKit.denyNotifications(app)
        val b = shareInPlace("https://example.com/denied", "Denied")
        runBlocking { SendWorker.run(app, b.id) }
        assertTrue(PhoneKit.notifications(app).isEmpty())
    }

    /** A network failure is not a failure to tell: the item waits for a connection (F07), and the flush job is asked for. */
    @Test
    fun aNetworkFailureWaitsForAConnection() {
        PhoneKit.phone(app, relay)
        PhoneKit.grantNotifications(app)
        val row = shareInPlace("https://example.com/later", "Later")
        relay.offline = true
        val after = runBlocking { SendWorker.run(app, row.id) }!!
        assertEquals(ErrorCode.NETWORK, after.errorCode)
        assertTrue(PhoneKit.notifications(app).isEmpty())
        assertTrue(PhoneKit.jobs().contains(FlushWorker.NAME))
    }

    /** "Tell me when it’s in my Reader": a quiet "In your Reader ✓: {title}" once the ledger says `reader`. */
    @Test
    fun theReaderNoticeIsOptIn() {
        PhoneKit.phone(app, relay)
        PhoneKit.grantNotifications(app)
        val row = shareInPlace("https://example.com/read", "Read me")
        runBlocking { SendWorker.run(app, row.id) }
        PhoneKit.ack(relay, listOf(row.id))
        PhoneKit.hello(relay, mapOf(row.id to "reader"))
        runBlocking { app.sender.tick() }
        assertTrue("off by default", PhoneKit.notifications(app).isEmpty())

        app.prefs.labTellReader = true
        val second = shareInPlace("https://example.com/read-2", "Read me too")
        runBlocking { SendWorker.run(app, second.id) }
        PhoneKit.ack(relay, listOf(second.id))
        PhoneKit.hello(relay, mapOf(second.id to "reader"))
        runBlocking { app.sender.tick() }
        val n = PhoneKit.notifications(app).single()
        assertEquals(LabText.fill(LabText["shareInPlace.inReader"], mapOf("title" to "Read me too")), PhoneKit.titleOf(n))
    }

    /** With Lab off nothing of F04's is posted (Lab's notifications go with it, 1.3). */
    @Test
    fun labOffPostsNothing() {
        PhoneKit.phone(app, relay)
        PhoneKit.grantNotifications(app)
        val row = shareInPlace("https://example.com/off", "Off")
        app.setLab(false)
        relay.publishStatus = 413
        runBlocking {
            app.sender.publish(row.id)
            app.sender.tick()
        }
        assertTrue(PhoneKit.notifications(app).isEmpty())
    }

    /** The job itself, through WorkManager's test builder: one publish of the item it names. */
    @Test
    fun theSendJobPublishesItsItem() {
        PhoneKit.phone(app, relay)
        val row = shareInPlace("https://example.com/job", "A job")
        val worker = TestListenableWorkerBuilder<SendWorker>(app as Application).setInputData(workDataOf(SendWorker.KEY_ID to row.id)).build()
        val result = runBlocking { worker.doWork() }
        assertEquals(ListenableWorker.Result.success(), result)
        assertEquals(Status.SENT, PhoneKit.store(app).load().first.single().status)
        assertEquals(1, relay.messages(LabKit.vectorPairing.keys.inboxTopic).size)
    }

    // ------------------------------------------------------------------------------------------------------- F07

    /** F07.1: shared offline, the row waits for a connection (not "Not delivered"), and goes when the flush runs. */
    @Test
    fun aShareOfflineWaitsAndGoesWhenTheNetworkIsBack() {
        PhoneKit.phone(app, relay, online = false)
        val row = runBlocking { app.sender.add(Shared.Link("https://example.com/offline", "Offline")) }
        assertEquals(Status.FAILED, row.status)
        assertEquals(ErrorCode.NETWORK, row.errorCode)
        assertEquals(0, row.attempts)
        assertTrue(PhoneKit.jobs().contains(FlushWorker.NAME))
        assertTrue("nothing published", relay.messages(LabKit.vectorPairing.keys.inboxTopic).isEmpty())
        // The screen's publish while still offline leaves it waiting.
        assertEquals(Status.FAILED, runBlocking { app.sender.publish(row.id) }!!.status)
        assertTrue(relay.messages(LabKit.vectorPairing.keys.inboxTopic).isEmpty())

        com.daylight.share.sender.PhoneLab.onlineOverride = true
        val next = runBlocking { FlushWorker.run(app, now = System.currentTimeMillis()) }
        assertNull("nothing waits any more", next)
        assertEquals(Status.SENT, PhoneKit.store(app).load().first.single().status)
        assertEquals(1, relay.messages(LabKit.vectorPairing.keys.inboxTopic).size)
    }

    /** Flush passes come at least 3 minutes apart; one that comes sooner says when the next may run. */
    @Test
    fun flushPassesAreThreeMinutesApart() {
        PhoneKit.phone(app, relay, online = false)
        runBlocking {
            app.sender.add(Shared.Link("https://example.com/a", "A"))
        }
        com.daylight.share.sender.PhoneLab.onlineOverride = true
        relay.offline = true
        val t0 = System.currentTimeMillis()
        // The relay is still unreachable: the pass tries, the row keeps waiting, and the next pass is 3 minutes away.
        assertEquals(Outbox.FLUSH_SPACING_MS, runBlocking { FlushWorker.run(app, now = t0) })
        relay.offline = false
        assertEquals(Outbox.FLUSH_SPACING_MS - 60_000, runBlocking { FlushWorker.run(app, now = t0 + 60_000) })
        assertTrue("not sent before its time", relay.messages(LabKit.vectorPairing.keys.inboxTopic).isEmpty())
        assertNull(runBlocking { FlushWorker.run(app, now = t0 + Outbox.FLUSH_SPACING_MS) })
        assertEquals(1, relay.messages(LabKit.vectorPairing.keys.inboxTopic).size)
    }

    /** Lab off: the flush job does nothing; the v1.1 back-off sends what waits (LAB-PLAN 1.3). */
    @Test
    fun withLabOffTheFlushDoesNothing() {
        PhoneKit.phone(app, relay, online = false)
        runBlocking { app.sender.add(Shared.Link("https://example.com/b", "B")) }
        app.setLab(false)
        com.daylight.share.sender.PhoneLab.onlineOverride = true
        assertNull(runBlocking { FlushWorker.run(app) })
        assertTrue(relay.messages(LabKit.vectorPairing.keys.inboxTopic).isEmpty())
        // v1.1's Retry now still sends it.
        runBlocking { app.sender.retry(PhoneKit.store(app).load().first.single().id) }
        assertEquals(1, relay.messages(LabKit.vectorPairing.keys.inboxTopic).size)
    }
}
