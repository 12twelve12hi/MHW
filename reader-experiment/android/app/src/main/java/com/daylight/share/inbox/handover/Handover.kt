package com.daylight.share.inbox.handover

import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.annotation.VisibleForTesting
import com.daylight.share.App
import com.daylight.share.BuildConfig
import com.daylight.share.Role
import com.daylight.share.Work
import com.daylight.share.core.FileReceiverStore
import com.daylight.share.core.Limits
import com.daylight.share.core.Pairing
import com.daylight.share.inbox.InstantDeliveryService
import com.daylight.share.logi
import com.daylight.share.logw
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File

/**
 * The handover to the Lab Reader (LAB-PLAN 5.3.4; card K6): one receiver per pairing. The Lab Reader is the side-by-side
 * Reader copy on the lab tablet (`com.daylightcomputer.readerexperiment`, LAB-PLAN 5.1); its built-in inbox (R1) can
 * take over receiving for the Inbox's pairing, so items go into its library quietly instead of through Daylight Share.
 *
 * 1. **Arm.** Settings › Lab › **Let Daylight Reader (lab) receive** ([arm]) arms a 2-minute grant and shows "Open
 *    Daylight Reader (lab) › Settings › Labs › Send to Daylight and choose Take over."
 * 2. **Hand over.** [HandoverProvider] (authority `com.daylight.share.handover`) answers `call("pairing")` with `{code,
 *    relay, name}` ([pairingFor]), only while armed, with Lab on, in the Inbox role, and only to a calling package in
 *    [ALLOWED]: exactly the Lab Reader's pinned id, nothing else. The answer also carries `since`, the Inbox's receive
 *    cursor, so the Lab Reader can start where the Inbox stopped (it may ignore it). The grant is used up.
 * 3. **Elsewhere.** [receivingElsewhere] is then the Lab Reader's package. The Inbox stops polling the pairing lane (the
 *    15-minute job, the app's start and Check now: [beforePoll] in `InboxRepo.pollOnce`), the live connection (`Live`)
 *    and Instant delivery (its service stops itself), and sends one `lab: 0` hello (`LabReporter` reads its Lab as off
 *    while another app receives). The Lab card and the Inbox screen say "Daylight Reader (lab) receives for this Daylight
 *    now." The server lane (S0, Wave S) is not stopped here: it stays with Daylight Share until the Lab Reader's hello
 *    carries the cap `server` (4.2).
 * 4. **Resume rule.** Before each would-be poll ([beforePoll]) the Inbox asks the Reader's `ShareInboxProvider`
 *    (`<package>.shareinbox`, made visible by the manifest's `<queries>`) `call("receiving")`. It resumes by itself only
 *    when the Reader answers `{receiving: false}`, or when PackageManager says the package is no longer installed. A
 *    provider it cannot reach while the package is installed (not visible, not there, throwing, an answer without a
 *    Boolean `receiving`) is **not** a reason: two receivers would both take every item. It keeps waiting and shows
 *    "Can’t reach Daylight Reader (lab) right now." **Receive here again** ([receiveHereAgain]) shows only once the
 *    Reader said false, and asks again before it resumes.
 *
 * On resuming, the receive cursor moves up to the last time the Lab Reader may have been receiving (in relay time, from
 * the relay's clock as the Inbox last heard it; less the protocol's 30-minute overlap), so the Inbox does not take again
 * what the Lab Reader took meanwhile; what nobody took is still
 * cached on the relay, or comes again with its sender's re-send. Then Instant delivery starts again when it is on, a
 * hello goes, and the poll runs. A new pairing on the Inbox (Reset pairing) ends a handover at once: nobody else has it.
 *
 * Lab off does not end a handover (LAB-PLAN 1.3, "a handover outlives Lab off", decided Oct 22: ending it silently
 * would make both apps receive; the resume rule still runs), and the Inbox screen keeps its handover line, with
 * **Receive here again** once the Lab Reader says it stopped. Its words are LAB_TEXT's `handover.*` (5.3.4, word for
 * word). Log lines (tag `DaylightShare`): `lab: handover: …`.
 */
class Handover(private val app: App) {
    /** What the Lab Reader last answered (`receiving`), for the Lab card and the Inbox screen. */
    enum class Reach(val key: String) {
        RECEIVING("receiving"), NOT_RECEIVING("not-receiving"), UNREACHABLE("unreachable");

        companion object {
            fun of(key: String?): Reach? = entries.firstOrNull { it.key == key }
        }
    }

    /** What asking the Lab Reader gave: [Reach]'s three, or the package is gone. */
    enum class Answer { RECEIVING, NOT_RECEIVING, UNREACHABLE, NOT_INSTALLED }

    /** [elsewhere]: the package receiving instead of the Inbox (or null); [reach]: its last answer; [armedUntil]: ms. */
    data class State(val elsewhere: String? = null, val reach: Reach? = null, val armedUntil: Long = 0L)

    private val lock = Any()

    /** The clock of the grant and the answers (tests use a fake one). */
    @VisibleForTesting
    internal var clock: () -> Long = System::currentTimeMillis

    /** The handover's clock now (ms), for the Lab card's grant. */
    fun now(): Long = clock()

    private val _state = MutableStateFlow(read())

    /** The handover as the UI and the live connection follow it. */
    val state: StateFlow<State> get() = _state

    init {
        // A new pairing (Reset pairing, the debug setup link) ends a handover: the Lab Reader has the old one.
        app.scope.launch { app.inbox.pairingFlow.collect { if (it != null) endIfOtherPairing(it.keys.inboxTopic) } }
    }

    // ---------------------------------------------------------------------------------------------- who receives

    /**
     * The package that receives for the Inbox's current pairing instead of the Inbox, or null: the Inbox receives. A
     * handover recorded for another pairing reads as none. Reads the settings only (any thread, no lock).
     */
    fun receivingElsewhere(): String? {
        val pkg = app.prefs.receivingElsewhere ?: return null
        val topic = app.prefs.labHandoverTopic ?: return null
        return pkg.takeIf { currentTopic() == topic }
    }

    /** Whether the Lab Reader is installed (and visible: the manifest's `<queries>` names it). */
    fun labReaderInstalled(): Boolean = installed(LAB_READER) == true

    // ------------------------------------------------------------------------------------------- 1. arm the grant

    /** **Let Daylight Reader (lab) receive**: the Lab Reader may take the pairing within the next 2 minutes. */
    fun arm() {
        val until = clock() + GRANT_MS
        app.prefs.labHandoverArmedUntil = until
        publish()
        logi("lab: handover: armed for ${GRANT_MS / 1000} s")
    }

    /** Whether the grant is armed at [now] (a clock set back more than the grant's length reads as not armed). */
    fun armed(now: Long = clock()): Boolean {
        val until = app.prefs.labHandoverArmedUntil
        return until > now && until - now <= GRANT_MS
    }

    // ------------------------------------------------------------------------------------------ 2. hand it over

    /**
     * [HandoverProvider]'s `call("pairing")` from [caller] (the verified calling package, or null). -> `{code, relay,
     * name, since}` once, while armed, to an allowed caller; `{error: "not-armed"}` to an allowed caller otherwise (the
     * grant is not armed or has lapsed, Lab is off, or this is not the Inbox); null to anyone else.
     */
    fun pairingFor(caller: String?): Bundle? {
        if (caller == null || caller !in ALLOWED) {
            logw("lab: handover: refused the pairing to ${caller ?: "an unknown caller"}")
            return null
        }
        val answer = synchronized(lock) {
            val now = clock()
            if (app.prefs.role != Role.INBOX || !app.prefs.lab || !armed(now)) {
                logi("lab: handover: $caller asked for the pairing while not armed")
                return Bundle().apply { putString(KEY_ERROR, ERROR_NOT_ARMED) }
            }
            val p = app.inbox.ensurePairing()
            val topic = p.keys.inboxTopic
            val since = runCatching { receiverStore(topic).load().since }.getOrDefault("all")
            app.prefs.labHandoverArmedUntil = 0L
            app.prefs.labHandoverTopic = topic
            app.prefs.labHandoverReach = Reach.RECEIVING.key
            app.prefs.labHandoverSeenAt = now
            app.prefs.receivingElsewhere = caller
            Bundle().apply {
                putString(KEY_CODE, p.compactCode)
                putString(KEY_RELAY, p.relay)
                putString(KEY_NAME, app.prefs.deviceName)
                putString(KEY_SINCE, since)
            }
        }
        publish()
        logi("lab: handover: $caller receives for this Daylight now; the Inbox stops polling")
        // Instant delivery's service holds the live connection: it stops (and stops itself if started meanwhile).
        InstantDeliveryService.stop(app)
        // One lab: 0 hello: senders read this Inbox's Lab as off (LabReporter reads it so while another app receives).
        app.labReporter.labSwitched()
        return answer
    }

    // --------------------------------------------------------------------------------------- 4. the resume rule

    /**
     * Before each would-be poll of the pairing lane (`InboxRepo.pollOnce`): true when the Inbox receives and may poll.
     * While another app receives, asks it (`receiving`) and resumes only when it says false or is no longer installed;
     * otherwise records the answer and says false. Blocking (a provider call): off the main thread.
     */
    fun beforePoll(): Boolean {
        if (app.prefs.receivingElsewhere == null) return true
        val poll = synchronized(lock) {
            val pkg = receivingElsewhere()
            if (pkg == null) {
                // Recorded for another pairing (the collector ends it too): this pairing is the Inbox's alone.
                if (app.prefs.receivingElsewhere != null) end(why = "another pairing", skipCursor = false)
                true
            } else {
                when (val a = ask(pkg)) {
                    Answer.NOT_RECEIVING, Answer.NOT_INSTALLED -> {
                        end(why = if (a == Answer.NOT_INSTALLED) "$pkg is not installed" else "$pkg is not receiving", skipCursor = true)
                        true
                    }
                    Answer.RECEIVING -> {
                        note(Reach.RECEIVING)
                        logi("lab: handover: $pkg receives; poll skipped")
                        false
                    }
                    Answer.UNREACHABLE -> {
                        note(Reach.UNREACHABLE)
                        logw("lab: handover: can't reach $pkg; poll skipped (it is installed, so it may still be receiving)")
                        false
                    }
                }
            }
        }
        // No poll, so no ack digest: the 48-hour lab: 0 repeat goes on its own (K6 review).
        if (!poll) app.labReporter.whileElsewhere()
        return poll
    }

    /**
     * Asks the receiving app again for the Lab card and the Inbox screen, without resuming (that is [beforePoll]'s and
     * [receiveHereAgain]'s): a "not receiving" answer offers **Receive here again**. -> the answer, or null when the
     * Inbox receives. Blocking: off the main thread.
     */
    fun check(): Reach? {
        val reach = synchronized(lock) {
            val pkg = receivingElsewhere()
            if (pkg == null) {
                null
            } else {
                when (ask(pkg)) {
                    Answer.RECEIVING -> Reach.RECEIVING
                    Answer.NOT_RECEIVING, Answer.NOT_INSTALLED -> Reach.NOT_RECEIVING
                    Answer.UNREACHABLE -> Reach.UNREACHABLE
                }.also { note(it) }
            }
        }
        return reach
    }

    /**
     * **Receive here again** (offered once the Reader said false): asks again, and resumes only when it still says false
     * or is gone; then a poll runs now. -> whether the Inbox receives again.
     */
    fun receiveHereAgain(): Boolean {
        val resumed = synchronized(lock) {
            val pkg = receivingElsewhere()
            if (pkg == null) {
                true
            } else {
                when (val a = ask(pkg)) {
                    Answer.NOT_RECEIVING, Answer.NOT_INSTALLED -> {
                        end(why = if (a == Answer.NOT_INSTALLED) "$pkg is not installed" else "Receive here again", skipCursor = true)
                        true
                    }
                    Answer.RECEIVING -> false.also { note(Reach.RECEIVING) }
                    Answer.UNREACHABLE -> false.also { note(Reach.UNREACHABLE) }
                }
            }
        }
        if (resumed) Work.syncNow(app)
        return resumed
    }

    /**
     * Asks [pkg]: gone when PackageManager says it is not installed; else its provider's `call("receiving")`, whose
     * answer counts only as a Boolean `receiving`. Anything else (no provider, not visible, a SecurityException, a
     * missing or mistyped key) is [Answer.UNREACHABLE]. Blocking.
     */
    @VisibleForTesting
    internal fun ask(pkg: String): Answer {
        if (installed(pkg) == false) return Answer.NOT_INSTALLED
        val b: Bundle? = try {
            app.contentResolver.call(Uri.parse("content://${readerAuthority(pkg)}"), METHOD_RECEIVING, null, null)
        } catch (e: Exception) {
            logw("lab: handover: $pkg's inbox did not answer: ${e.javaClass.simpleName}: ${e.message}")
            return Answer.UNREACHABLE
        }
        if (b == null) return Answer.UNREACHABLE
        @Suppress("DEPRECATION")
        val receiving: Any? = b.get(KEY_RECEIVING)
        return when (receiving) {
            true -> Answer.RECEIVING
            false -> Answer.NOT_RECEIVING
            else -> Answer.UNREACHABLE
        }
    }

    /** true installed, false not installed (PackageManager says so), null not known. */
    private fun installed(pkg: String): Boolean? = try {
        app.packageManager.getPackageInfo(pkg, 0)
        true
    } catch (e: PackageManager.NameNotFoundException) {
        false
    } catch (e: Exception) {
        null
    }

    // ------------------------------------------------------------------------------------------------- the rest

    /** Records the Reader's answer; every answer but "not receiving" means it may have been receiving until now. */
    private fun note(reach: Reach) {
        app.prefs.labHandoverReach = reach.key
        if (reach != Reach.NOT_RECEIVING) app.prefs.labHandoverSeenAt = clock()
        publish()
    }

    /**
     * The Inbox receives again: the cursor moves up past what the Lab Reader took ([skipCursor]), the handover is
     * forgotten, Instant delivery starts again when it is on, and a hello goes. Called under [lock].
     */
    private fun end(why: String, skipCursor: Boolean) {
        val seenAt = app.prefs.labHandoverSeenAt
        val topic = app.prefs.labHandoverTopic
        if (skipCursor && topic != null && topic == currentTopic()) skipCursor(topic, seenAt)
        app.prefs.receivingElsewhere = null
        app.prefs.labHandoverTopic = null
        app.prefs.labHandoverReach = null
        app.prefs.labHandoverSeenAt = 0L
        publish()
        logi("lab: handover: the Inbox receives here again ($why)")
        if (app.prefs.role == Role.INBOX && app.prefs.instantDelivery) InstantDeliveryService.start(app)
        app.labReporter.labSwitched()
    }

    /** A new pairing ended the handover (its collector). */
    private fun endIfOtherPairing(topic: String) {
        if (app.prefs.receivingElsewhere == null) return
        synchronized(lock) {
            val handed = app.prefs.labHandoverTopic
            if (app.prefs.receivingElsewhere != null && handed != topic) end(why = "a new pairing", skipCursor = false)
        }
    }

    /**
     * Moves the receive cursor of pairing [topic] up to [seenAt] less the protocol's overlap (never back), and forgets
     * the incomplete items that started before it (the Lab Reader's to take; the cursor would otherwise go back to them).
     * [seenAt] is a time of this device's clock and the cursor a relay time: it is turned into relay time with the
     * relay's clock as the Inbox last heard it (`Prefs.inboxRelayOffsetMs`), so a DC-1 whose clock runs fast does not
     * skip what reached the relay after the Lab Reader stopped (K6 review). Without one yet, the device's clock it is.
     */
    private fun skipCursor(topic: String, seenAt: Long) {
        if (seenAt <= 0L) return
        val offset = app.prefs.inboxRelayOffsetMs
        if (offset == null) logw("lab: handover: the relay's clock is not known yet; this device's clock stands in for it")
        val relaySeenAt = seenAt + (offset ?: 0L)
        runCatching {
            val store = receiverStore(topic)
            synchronized(store.lock) {
                val st = store.load()
                val from = maxOf(0L, relaySeenAt / 1000 - Limits.CURSOR_OVERLAP_S)
                val prev = st.since.toLongOrNull()
                if (prev != null && prev >= from) return@runCatching
                st.since = from.toString()
                st.incomplete.entries.removeAll { it.value < from }
                store.save(st)
                logi("lab: handover: receiving from relay time $from on (the Lab Reader had what came before)")
            }
        }.onFailure { logw("lab: handover: the receive cursor stays: ${it.message}") }
    }

    /** The Inbox's receiver state for [topic]: the file `InboxRepo.receiver()` keeps it in. */
    private fun receiverStore(topic: String) = FileReceiverStore(File(File(app.filesDir, "inbox"), "receiver-$topic.json"))

    /** The Inbox's pairing's inbox topic, without making a pairing. */
    private fun currentTopic(): String? = app.inbox.pairingFlow.value?.keys?.inboxTopic
        ?: app.prefs.inboxCode?.let { code -> runCatching { Pairing(Pairing.parseCode(code)).keys.inboxTopic }.getOrNull() }

    private fun read(): State {
        val p = app.prefs
        return State(elsewhere = receivingElsewhere(), reach = Reach.of(p.labHandoverReach).takeIf { p.receivingElsewhere != null }, armedUntil = p.labHandoverArmedUntil)
    }

    private fun publish() {
        _state.value = read()
    }

    companion object {
        /** The Lab Reader's applicationId, pinned (LAB-PLAN 5.1: no suffix pattern); R1 confirms it on Rooted 2. */
        const val LAB_READER = "com.daylightcomputer.readerexperiment"

        /** Who may take the pairing: exactly the Lab Reader. */
        val ALLOWED: Set<String> = setOf(LAB_READER)

        /** This app's provider (`com.daylight.share.handover`). */
        val AUTHORITY: String = "${BuildConfig.APPLICATION_ID}.handover"

        /** The Lab Reader's `ShareInboxProvider` authority (`<applicationId>.shareinbox`, LAB-PLAN 5.3). */
        fun readerAuthority(pkg: String = LAB_READER): String = "$pkg.shareinbox"

        /** How long "Let Daylight Reader (lab) receive" lets the Lab Reader take the pairing. */
        const val GRANT_MS = 2 * 60_000L

        const val METHOD_PAIRING = "pairing"
        const val METHOD_RECEIVING = "receiving"
        const val KEY_CODE = "code"
        const val KEY_RELAY = "relay"
        const val KEY_NAME = "name"
        const val KEY_SINCE = "since"
        const val KEY_RECEIVING = "receiving"
        const val KEY_ERROR = "error"
        const val ERROR_NOT_ARMED = "not-armed"
    }
}
