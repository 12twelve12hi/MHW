package com.daylight.share.core

/**
 * What every surface shows for an outbox row (CHANGES-v1.1 2.5; vectors > statusText): the same words as the JS
 * `describeRow` and the Swift `RowText`. [sentence] is null or one sentence to show under [label]; [action] is null,
 * [RETRY_NOW] (button "Retry now") or [TRY_AGAIN] (button "Try again"). Every row can also be removed.
 */
data class RowText(val label: String, val sentence: String?, val action: String?) {
    /** The button's words for [action], or null when the row has no button. */
    val button: String? get() = when (action) {
        RETRY_NOW -> "Retry now"
        TRY_AGAIN -> "Try again"
        else -> null
    }

    /** The label, then the sentence when there is one ("Waiting to send. Couldn’t send right now. …"). */
    val line: String get() = if (sentence == null) label else "${label.trimEnd('.', '…')}. $sentence"

    companion object {
        const val RETRY_NOW = "retry-now"
        const val TRY_AGAIN = "try-again"
        private const val DAY_MS = 86_400_000L

        fun of(row: OutboxRow, now: Long = System.currentTimeMillis()): RowText =
            of(row.status, row.errorCode, row.size, row.created, now)

        /** The 2.5 table. A row saved by v1.0 has no error code: pass "". */
        fun of(status: String, errorCode: String, size: Long, created: Long, now: Long): RowText = when (status) {
            Status.SENDING -> RowText("Sending…", null, null)
            Status.SENT -> RowText(
                "Sent · waiting for your Daylight",
                if (now - created < DAY_MS) null else "Your Daylight hasn’t picked this up yet. It is sent again twice a day.",
                null,
            )
            Status.DELIVERED -> RowText("Delivered ✓", "Saved on your Daylight.", null)
            Status.FAILED -> when (errorCode) {
                ErrorCode.FULL -> RowText("Waiting to send", "A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.", null)
                ErrorCode.REFUSED -> RowText("Waiting to send", "The relay set on your Daylight turned this down. It will try again in about 3 hours.", null)
                else -> RowText("Waiting to send", "Couldn’t send right now. It will try again by itself.", RETRY_NOW)
            }
            Status.EXPIRED -> when (errorCode) {
                ErrorCode.FULL -> RowText("Not delivered", "Too much was sent from this network for hours, so it stopped trying. Try again later.", TRY_AGAIN)
                ErrorCode.REFUSED -> RowText("Not delivered", "The relay set on your Daylight keeps turning this down. Check that setting on your Daylight, then try again.", TRY_AGAIN)
                ErrorCode.TOO_LARGE -> RowText("Not delivered", Text.tooBigMessage(size), null)
                ErrorCode.GONE -> RowText("Not delivered", "This is no longer stored on this device. Share it again.", null)
                else -> RowText("Not delivered", "Your Daylight didn’t pick this up within a week. Is it on and online?", TRY_AGAIN)
            }
            else -> RowText("", null, null)
        }
    }
}

/** Why a row is `failed` or `expired` (`OutboxRow.errorCode`; "" for none, and for rows saved by v1.0). */
object ErrorCode {
    /** No connection, a timeout, 408, 429 or 5xx: retried fast (1 min x min(60, 2^attempts)). */
    const val NETWORK = "network"
    /** 413: this network's attachment storage or daily bandwidth on the relay is used up; retried after 185 min. */
    const val FULL = "full"
    /** Any other 4xx: the relay refuses the request; retried after 185 min. */
    const val REFUSED = "refused"
    /** Over 9 MB (a row saved by v1.0): never sent. */
    const val TOO_LARGE = "too-large"
    /** The content copy is no longer on this device. */
    const val GONE = "gone"
}

/**
 * What an app does with a pairing that arrives (PROTOCOL 1.3 "Confirmation"; vectors > pairingConfirmation), like the
 * JS `pairingConfirmation`. When [ask], show [title] and [lines] with the buttons [button] and "Cancel", and pair only
 * on [button]; otherwise pair at once and show [notice] when it is not null.
 */
data class PairingConfirmation(val ask: Boolean, val title: String?, val lines: List<String>, val button: String?, val notice: String?) {
    /** Where the pairing came from. */
    enum class Source {
        /** From outside the app: a QR code scanned with the camera, a tapped link, the web sender's `#pair=`. */
        LINK,
        /** Typed, pasted or scanned on the app's own pairing screen. */
        APP,
    }

    companion object {
        /** [current]: the pairing in use, or null. [next]: the parsed pairing. */
        fun of(current: Pairing?, next: Pairing, source: Source): PairingConfirmation {
            val nextRelay = next.relay
            if (current != null && current.sameSecret(next)) {
                val moved = current.relay != nextRelay
                return PairingConfirmation(
                    false, null, emptyList(), null,
                    if (moved) "Pairing updated: now sending through ${Relay.host(nextRelay)}." else "Pairing updated.",
                )
            }
            val replaces = current != null
            if (source == Source.APP && !replaces) return PairingConfirmation(false, null, emptyList(), null, null)
            val lines = ArrayList<String>()
            lines += "Code starts ${Base32.encode(next.secret).take(4)}. Check it matches the code on your Daylight."
            if (nextRelay != Limits.DEFAULT_RELAY) lines += "Sends through ${Relay.host(nextRelay)}."
            if (current != null) {
                lines += "This replaces ${Text.cleanName(current.name).ifEmpty { "your current Daylight" }}. Items not yet delivered to it will not be sent."
            }
            return PairingConfirmation(
                true, "Pair with ${Text.cleanName(next.name).ifEmpty { "a Daylight" }}?", lines, if (replaces) "Switch" else "Pair", null,
            )
        }
    }
}
