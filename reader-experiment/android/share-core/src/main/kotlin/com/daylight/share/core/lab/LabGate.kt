package com.daylight.share.core.lab

import com.daylight.share.core.server.Deadline
import com.daylight.share.core.server.ServerError
import com.daylight.share.core.server.ServerState
import com.daylight.share.core.server.ServerStateSource

/**
 * A feature's gate (LAB-PLAN 1.5, 2.6, 2.7.2; the JS `labGate`; vectors > labGate). It is blocking (the server state
 * may take up to [Context.deadlineMs]): run it off the main thread.
 */
object LabGate {
    /**
     * [lab], [paired]: this app's. [hasCap]: the ledger's ([LabLedger.Snapshot.hasCap]); null means no capability.
     * [local]: the app's own checks for a feature, e.g. "needs-notifications", or null when they pass. [server]: a
     * [com.daylight.share.core.server.DaylightServer] (or null: none); its state is raced against [deadlineMs], and a
     * server that has not answered by then gives OFFLINE. [serverMessage]: the server module's text for a state, for an
     * OFFLINE the deadline decided. [built]: false gives `later` once everything else is ready (null: built).
     * [app], [platform]: for the texts ([LabText.needsMessage]).
     */
    class Context(
        val lab: Boolean,
        val paired: Boolean,
        val hasCap: ((String) -> Boolean)? = null,
        val local: ((String) -> String?)? = null,
        val server: ServerStateSource? = null,
        val serverMessage: ((String) -> String?)? = null,
        val built: ((String) -> Boolean)? = null,
        val app: String? = null,
        val platform: String? = null,
        val deadlineMs: Long = Lab.GATE_DEADLINE_MS,
    )

    /**
     * [ready]: the feature may run. Otherwise [state] and the one sentence to show under the control ([message]), the
     * [short] state, and the one [button] the note may carry. [state] is "lab-off" when Lab is off (its message is
     * "Turn on Lab in {app} to use this.").
     */
    data class Result(val ready: Boolean, val state: String, val message: String?, val short: String?, val button: String?)

    /**
     * Checks, in order: Lab on; paired; the Inbox capability ([Lab.FEATURE_CAPS]); [Context.local]; the server state
     * (for server features); [Context.built]. [feature]: a Lab feature id (F01…) or a server feature key ("files", "ai",
     * "pdf", "email", "feeds", "deliver"). When a later server call fails with a [ServerError], call
     * `server.noteError(key, err)` (2.6).
     */
    fun run(feature: String, ctx: Context): Result {
        fun result(state: String, message: String?) = Result(
            state == "ready", state, if (state == "ready") null else message, LabText.needsMessage(state, short = true), LabText.button(state),
        )
        fun not(state: String, message: String? = null) =
            result(state, message ?: LabText.needsMessage(state, app = ctx.app, platform = ctx.platform, feature = feature))
        if (!ctx.lab) {
            val app = ctx.app ?: LabText.appName(ctx.platform)
            return Result(false, "lab-off", LabText.fill(LabText["labOff"], mapOf("app" to app)), null, null)
        }
        if (!ctx.paired) return not("needs-pairing")
        Lab.FEATURE_CAPS[feature]?.let { cap ->
            if (ctx.hasCap?.invoke(cap) != true) return not("needs-inbox")
        }
        val local = ctx.local?.invoke(feature)
        if (local != null && local != "ready") return not(local)
        val key = Lab.SERVER_FEATURES[feature] ?: feature.takeIf { it in Lab.SERVER_KEYS }
        if (key != null) {
            val server = ctx.server ?: return not("needs-server")
            val r: ServerState = try {
                Deadline.run(ctx.deadlineMs, { ServerState("OFFLINE", null) }) { server.state(key) }
            } catch (e: ServerError) {
                if (e.code == "OFFLINE") ServerState("OFFLINE", e.message) else ServerState("error", e.message)
            } catch (e: Exception) {
                ServerState("error", e.message)
            }
            if (r.state != "ready") {
                if (r.state == "needs-server" || r.state == "needs-lab-inbox") return not(r.state)
                val message = r.message ?: ctx.serverMessage?.invoke(r.state)
                return result(if (LabText.short(r.state) != null) r.state else "error", message)
            }
        }
        if (ctx.built != null && !ctx.built.invoke(feature)) return not("later")
        return result("ready", null)
    }
}
