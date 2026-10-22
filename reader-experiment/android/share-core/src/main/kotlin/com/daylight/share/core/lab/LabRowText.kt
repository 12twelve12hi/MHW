package com.daylight.share.core.lab

import com.daylight.share.core.ErrorCode
import com.daylight.share.core.Kind
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.RowText
import com.daylight.share.core.Status

/**
 * A row as the Lab delivery timeline shows it (LAB-PLAN 2.5; the JS `describeLabRow`; vectors > labRowText).
 * [label], [sentence] and [action] are as [RowText]'s; [stepLine] is null for v1.1 rows (rules 1 and 4); [final] is
 * true for reader, queued and handed. Show the sentence and the step line on the newest row and on every row that is
 * not final; elsewhere they go in the row's details. The row's accessibility label is [a11yLabel] (never the step line,
 * which is hidden from screen readers).
 */
data class LabRowText(val label: String, val sentence: String?, val action: String?, val stepLine: String?, val final: Boolean) {
    /** "{label}. {sentence}", or the label alone. */
    val a11yLabel: String get() = if (!sentence.isNullOrEmpty()) "$label. $sentence" else label

    /**
     * [lab]: Lab is on in this app. [inboxLab] and [hasCap]: the ledger's (null [hasCap]: [inboxLab] alone decides).
     * [state]: the ledger's state token for this row, or null. [online]: false when this device is offline (null:
     * unknown, counted as online).
     */
    data class Context(
        val lab: Boolean,
        val inboxLab: Boolean = false,
        val hasCap: ((String) -> Boolean)? = null,
        val state: String? = null,
        val online: Boolean? = null,
    ) {
        companion object {
            /** A context from a ledger snapshot, for the row [id]. */
            fun of(lab: Boolean, snapshot: LabLedger.Snapshot, id: String, online: Boolean? = null) =
                Context(lab, snapshot.inboxLab, snapshot::hasCap, snapshot.state(id)?.s, online)
        }
    }

    companion object {
        fun of(row: OutboxRow, now: Long, ctx: Context): LabRowText =
            of(row.status, row.errorCode, row.kind, row.size, row.created, now, ctx)

        /** The 2.5 rules, in order. A row saved by v1.0 has no error code: pass "". */
        fun of(status: String, errorCode: String, kind: String, size: Long, created: Long, now: Long, ctx: Context): LabRowText {
            val v = RowText.of(status, errorCode, size, created, now)
            val v11 = LabRowText(v.label, v.sentence, v.action, null, false)
            if (!ctx.lab) return v11 // rule 1
            fun out(id: String, line: String, final: Boolean = false) =
                LabRowText(LabText["rows.$id.label"], LabText["rows.$id.sentence"], null, line, final)
            if (ctx.online == false && (status == Status.SENDING || (status == Status.FAILED && errorCode == ErrorCode.NETWORK))) {
                return out("offline", stepLine(GOING, null, null)) // rule 2
            }
            if (status != Status.DELIVERED) { // rule 3
                val line = when (status) {
                    Status.SENDING -> stepLine(GOING, null, null)
                    Status.FAILED, Status.EXPIRED -> stepLine(STOPPED, null, null)
                    Status.SENT -> stepLine(DONE, GOING, null)
                    else -> null
                }
                return v11.copy(stepLine = line)
            }
            val hasSt = ctx.hasCap?.invoke(Lab.Caps.ST) ?: true
            if (!ctx.inboxLab || !hasSt) return v11 // rule 4
            return when (ctx.state) { // rule 5
                "waiting" -> out("waiting", stepLine(DONE, DONE, GOING))
                "held" -> out("held", stepLine(DONE, DONE, GOING))
                "inbox" -> out("inbox", stepLine(DONE, DONE, STOPPED))
                "failed" -> out("failed", stepLine(DONE, DONE, STOPPED))
                "handed" -> out(if (kind == Kind.FILE) "handedFile" else "handedLink", stepLine(DONE, DONE, null, LabText["steps.handed"]), true)
                "queued" -> out("queued", stepLine(DONE, DONE, DONE), true)
                "reader" -> out("reader", stepLine(DONE, DONE, DONE), true)
                else -> out("delivered", stepLine(DONE, DONE, GOING))
            }
        }

        private const val DONE = "done"
        private const val GOING = "going"
        private const val STOPPED = "stopped"

        /** "Sent ✓ · On your Daylight … · In the Reader": the three steps, each with its mark or none. */
        private fun stepLine(sent: String?, daylight: String?, reader: String?, readerName: String = LabText["steps.reader"]): String {
            fun step(name: String, mark: String?) = if (mark == null) name else "$name ${LabText["marks.$mark"]}"
            return listOf(step(LabText["steps.sent"], sent), step(LabText["steps.daylight"], daylight), step(readerName, reader))
                .joinToString(LabText["stepJoin"])
        }

        /**
         * Faster checks (2.5): true while a delivered row from the last 10 minutes has no settled state, so a visible app
         * reads the ack topic every [Lab.FAST_CHECK_MS]. [states]: the ledger's ([LabLedger.Snapshot.states]).
         */
        fun wantsFastChecks(rows: List<OutboxRow>, now: Long, states: Map<String, LabLedger.Entry>): Boolean =
            rows.any { r -> r.status == Status.DELIVERED && now - r.delivered <= Lab.FAST_CHECK_WINDOW_MS && states[r.id]?.s !in Lab.SETTLED_STATES }
    }
}
