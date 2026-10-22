package com.daylight.share.core.server

import com.daylight.share.core.Bytes
import com.daylight.share.core.FileLocks
import com.daylight.share.core.Http
import com.daylight.share.core.Json
import com.daylight.share.core.JsonFiles
import com.daylight.share.core.Pairing
import com.daylight.share.core.Relay
import com.daylight.share.core.RelayClient
import com.daylight.share.core.UrlConnectionHttp
import java.io.File
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Where the server client keeps its state (DESIGN 13.1): one JSON value per key. [FileServerStore] keeps them in one
 * file next to the outbox; [MemoryServerStore] serves tests.
 */
interface ServerStore {
    fun get(key: String): Any?
    fun set(key: String, value: Any?)
    fun remove(key: String)
}

/** A [ServerStore] in one JSON file, written atomically on every change; its lock is per file. */
class FileServerStore(val file: File) : ServerStore {
    private val lock = FileLocks.of(file)
    private fun read(): LinkedHashMap<String, Any?> = LinkedHashMap(JsonFiles.readObject(file) ?: emptyMap())
    override fun get(key: String): Any? = synchronized(lock) { read()[key] }
    override fun set(key: String, value: Any?) = synchronized(lock) { JsonFiles.write(file, read().also { it[key] = value }) }
    override fun remove(key: String) {
        synchronized(lock) {
            val m = read()
            if (m.containsKey(key)) {
                m.remove(key)
                JsonFiles.write(file, m)
            }
        }
    }
}

/** A [ServerStore] in memory, keeping JSON copies (as a file would). */
class MemoryServerStore : ServerStore {
    private val m = LinkedHashMap<String, String>()
    override fun get(key: String): Any? = synchronized(m) { m[key]?.let(Json::parse) }
    override fun set(key: String, value: Any?) = synchronized(m) { m[key] = Json.write(value) }
    override fun remove(key: String) = synchronized(m) { m.remove(key); Unit }
    fun keys(): Set<String> = synchronized(m) { m.keys.toSet() }
}

/** The storage keys of DESIGN 13.1 (`server/pendingMove` included). */
object ServerKeys {
    const val CONFIG = "server/config"
    const val CONFIG_AT = "server/configAt"
    const val PIN = "server/pin"
    const val PENDING_MOVE = "server/pendingMove"
    const val STATUS = "server/status"
    const val STATUS_AT = "server/statusAt"
    const val BAD_AUTH_AT = "server/badAuthAt"
    const val MANUAL_URL = "server/manualUrl"
    const val HOSTED = "server/hosted"
    const val HOSTED_ACK_CURSOR = "server/hostedAckCursor"
    const val EMAIL_ADDRESS = "server/emailAddress"
    const val NOTICES = "server/notices"
    val ALL = listOf(CONFIG, CONFIG_AT, PIN, PENDING_MOVE, STATUS, STATUS_AT, BAD_AUTH_AT, MANUAL_URL, HOSTED, HOSTED_ACK_CURSOR, EMAIL_ADDRESS, NOTICES)
}

/** One message of a server topic: its ntfy id, relay time (s) and frame (null for attachments and junk). */
class ServerTopicMessage(val id: String, val time: Long, val frame: ByteArray?)

/** Runs blocking work with a deadline (the gate's 5 s, the status request's 5 s). */
object Deadline {
    private val pool = Executors.newCachedThreadPool { r -> Thread(r, "daylight-deadline").apply { isDaemon = true } }

    /** [block]'s result, or [onTimeout]'s when it has not finished within [ms]. What [block] throws is rethrown. */
    fun <T> run(ms: Long, onTimeout: () -> T, block: () -> T): T {
        val f = pool.submit(Callable { block() })
        return try {
            f.get(ms, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            f.cancel(true)
            onTimeout()
        } catch (e: InterruptedException) {
            f.cancel(true)
            Thread.currentThread().interrupt()
            onTimeout()
        } catch (e: ExecutionException) {
            throw e.cause ?: e
        }
    }
}

/**
 * The app side of the Daylight server (DESIGN 13; LAB-PLAN 2.6's W0 subset), ported from
 * `server/client/daylight-server.js` under the same names: discovery (with TOFU pinning and moves), the manual
 * address, the status and each feature's state, requests with the error mapping, [noteError], the re-pairing lock and
 * the first-use notices. Every method is blocking: run it off the main thread. Discovery runs only with Lab on
 * (DESIGN 4.3): the app decides when to call it.
 */
class DaylightServer(
    val pairing: Pairing,
    private val store: ServerStore,
    private val http: Http = UrlConnectionHttp(),
    private val clock: () -> Long = System::currentTimeMillis,
) : ServerStateSource {
    private val relay: String = Relay.normalize(pairing.relay)

    val seed: ByteArray by lazy { ServerCode.deriveSeed(pairing.secret) }
    val values: ServerValues by lazy { ServerCode.derive(seed) }

    /** The Server code to show in Lab settings, with Copy ([token]: the relay's access token, if any). */
    fun serverCode(token: String? = null): String = ServerCode.format(seed, relay, token)

    /** What [discover] found: the [config] to use, where it came from, and the new origin when the server [moved]. */
    class Discovery(val config: ServerConfig, val source: String, val moved: String? = null)

    /**
     * -> the config ([Discovery.source] "relay", "manual" or "cache"), or null when no server announced itself. Applies
     * TOFU (4.3): the first config of this fingerprint pins its origin; a later one with another origin is used only
     * after [confirmMove] ([Discovery.moved] names it, and the old pin is used meanwhile). Throws [ServerError] OFFLINE
     * when the relay cannot be read and nothing is cached.
     */
    fun discover(force: Boolean = false): Discovery? {
        (store.get(ServerKeys.MANUAL_URL) as? String)?.let { manual ->
            return Discovery(ServerConfig(manual, ServerCode.SERVER_API, values.fingerprint, "lab", "", ""), "manual")
        }
        val cached = ServerConfig.fromJson(store.get(ServerKeys.CONFIG))?.takeIf { it.fingerprint == values.fingerprint }
        val at = longOf(store.get(ServerKeys.CONFIG_AT)) ?: 0L
        if (!force && cached != null && clock() - at < ServerCode.CONFIG_REFRESH_MS) return applyPin(cached, "cache")
        var found: ServerConfig? = null
        try {
            for (e in pollServerTopic(http, relay, values.configTopic, maxMessages = 50)) {
                val frame = e.frame ?: continue
                val header = try {
                    ServerBox.open(values, ServerBox.CONFIG, frame).first
                } catch (x: Exception) {
                    continue
                }
                val c = ServerConfig.check(header, clock())
                if (c != null && c.fingerprint == values.fingerprint && (found == null || c.sent > found.sent)) found = c
            }
        } catch (e: Exception) {
            if (cached != null) return applyPin(cached, "cache")
            throw e as? ServerError ?: ServerError("OFFLINE")
        }
        if (found == null) return cached?.let { applyPin(it, "cache") }
        store.set(ServerKeys.CONFIG, found.toJson())
        store.set(ServerKeys.CONFIG_AT, clock())
        return applyPin(found, "relay")
    }

    private fun applyPin(config: ServerConfig, source: String): Discovery {
        val pin = store.get(ServerKeys.PIN) as? Map<*, *>
        if (pin == null || pin["fingerprint"] != config.fingerprint) {
            store.set(ServerKeys.PIN, linkedMapOf("origin" to config.server, "fingerprint" to config.fingerprint))
            return Discovery(config, source)
        }
        val origin = pin["origin"] as? String
        if (origin != config.server) {
            store.set(ServerKeys.PENDING_MOVE, linkedMapOf("origin" to config.server, "fingerprint" to config.fingerprint))
            return Discovery(config.copy(server = origin ?: config.server), source, config.server)
        }
        return Discovery(config, source)
    }

    /** Accepts a changed server origin after the user said yes to "Your Daylight server moved to {host}. Use it?". */
    fun confirmMove(): Boolean {
        val p = store.get(ServerKeys.PENDING_MOVE) ?: return false
        store.set(ServerKeys.PIN, p)
        store.remove(ServerKeys.PENDING_MOVE)
        store.remove(ServerKeys.STATUS)
        return true
    }

    /**
     * Lab settings › Daylight server › Server address: validates [url] with GET /v1/hello, then /v1/status. -> the
     * origin. Throws [ServerError] BAD_REQUEST (not an https address), OFFLINE, NOT_FOUND (no Daylight server there) or
     * the status request's error.
     */
    fun setManualUrl(url: String): String {
        val origin = manualOrigin(url) ?: throw ServerError("BAD_REQUEST", "That isn’t a server address (https://…).")
        // As fetch(…).json(): no answer, or an answer that is not JSON, is OFFLINE.
        val hello = try {
            val r = http.send("GET", "$origin/v1/hello", readTimeoutMs = 15_000)
            Json.parse((Bytes.fromUtf8Strict(r.body) ?: throw IOException("not UTF-8")).trim())
        } catch (e: IOException) {
            throw ServerError("OFFLINE")
        } catch (e: Json.ParseException) {
            throw ServerError("OFFLINE")
        } catch (e: RuntimeException) {
            throw ServerError("OFFLINE")
        }
        if ((hello as? Map<*, *>)?.get("service") != "daylight-server") throw ServerError("NOT_FOUND", "No Daylight server answers at that address.")
        store.set(ServerKeys.MANUAL_URL, origin)
        store.remove(ServerKeys.STATUS)
        try {
            status(force = true)
        } catch (e: Exception) {
            store.remove(ServerKeys.MANUAL_URL)
            throw e
        }
        return origin
    }

    fun clearManualUrl() {
        store.remove(ServerKeys.MANUAL_URL)
        store.remove(ServerKeys.STATUS)
    }

    /** The origin to call: throws [ServerError] needs-server, pairing-mismatch, server-outdated or app-outdated. */
    private fun origin(): String {
        val d = discover()
        if (d == null) {
            val pin = store.get(ServerKeys.PIN) as? Map<*, *>
            val state = if (pin != null && pin["fingerprint"] != values.fingerprint) "pairing-mismatch" else "needs-server"
            throw ServerError(state, ServerMessages.localMessage(state))
        }
        if (d.config.api < ServerCode.SERVER_API_MIN) throw ServerError("server-outdated", ServerMessages.localMessage("server-outdated"))
        // Additive changes keep the major version; a higher major means this app is too old for the server.
        if (d.config.api > ServerCode.SERVER_API) throw ServerError("app-outdated", ServerMessages.localMessage("app-outdated"))
        return d.config.server
    }

    /**
     * A Bearer request to the server. [json] is sent as JSON; else [body] as given. -> the parsed JSON answer ({} for an
     * empty one). An error object whose code is a server code ([ServerMessages.isServerCode]) throws that [ServerError];
     * any other answer that is not 2xx throws BAD_AUTH (401) or SERVER_ERROR; no answer throws OFFLINE.
     */
    fun request(method: String, path: String, json: Any? = null, body: ByteArray? = null, query: Map<String, String>? = null, headers: Map<String, String> = emptyMap(), readTimeoutMs: Int = 60_000): Any? {
        val origin = origin()
        val q = if (query.isNullOrEmpty()) "" else "?" + query.entries.joinToString("&") { (k, v) -> URLEncoder.encode(k, "UTF-8") + "=" + URLEncoder.encode(v, "UTF-8") }
        val h = LinkedHashMap<String, String>()
        h["Authorization"] = "Bearer ${values.authToken}"
        h.putAll(headers)
        var payload = body
        if (json != null) {
            payload = Bytes.utf8(Json.write(json))
            h["Content-Type"] = "application/json"
        }
        val res = try {
            http.send(method, "$origin$path$q", h, payload, maxResponseBytes = 4L shl 20, readTimeoutMs = readTimeoutMs)
        } catch (e: IOException) {
            throw ServerError("OFFLINE")
        } catch (e: RuntimeException) {
            throw ServerError("OFFLINE")
        }
        return answer(res)
    }

    private fun answer(res: Http.Response): Any? {
        val text = Bytes.fromUtf8Strict(res.body) ?: String(res.body, Charsets.UTF_8)
        val data = if (text.isNotBlank()) runCatching { Json.parse(text.trim()) }.getOrNull() else null
        val err = (data as? Map<*, *>)?.get("error") as? Map<*, *>
        if (err != null && ServerMessages.isServerCode(err["code"])) {
            @Suppress("UNCHECKED_CAST")
            val extra = (err as Map<String, Any?>).filterKeys { it != "code" && it != "message" }
            throw ServerError(err["code"] as String, err["message"] as? String, res.status, extra)
        }
        if (!res.ok) throw ServerError(if (res.status == 401) "BAD_AUTH" else "SERVER_ERROR", status = res.status)
        return data ?: LinkedHashMap<String, Any?>()
    }

    /** GET /v1/status, cached for 10 minutes; the request waits at most [waitMs]. Offline, a cached status is returned. */
    fun status(force: Boolean = false, waitMs: Long = 5_000): Map<String, Any?> {
        @Suppress("UNCHECKED_CAST")
        val cached = store.get(ServerKeys.STATUS) as? Map<String, Any?>
        val at = longOf(store.get(ServerKeys.STATUS_AT)) ?: 0L
        if (!force && cached != null && clock() - at < ServerCode.STATUS_REFRESH_MS) return cached
        try {
            val s = Deadline.run(waitMs, { throw ServerError("OFFLINE") }) { request("GET", "/v1/status", readTimeoutMs = waitMs.toInt().coerceAtLeast(1)) }
            @Suppress("UNCHECKED_CAST")
            val m = s as? Map<String, Any?> ?: LinkedHashMap()
            store.set(ServerKeys.STATUS, m)
            store.set(ServerKeys.STATUS_AT, clock())
            store.remove(ServerKeys.BAD_AUTH_AT) // the server knows this device again: a later BAD_AUTH re-reads the config
            return m
        } catch (e: ServerError) {
            if (cached != null && e.code == "OFFLINE") return cached
            throw e
        }
    }

    /**
     * A feature's state from the cached config and status (DESIGN 14.1): ready, needs-server, pairing-mismatch,
     * server-outdated, app-outdated, locked, needs-key, needs-domain, needs-r2, needs-lab-inbox, needs-paid, error or
     * OFFLINE. Refreshes a status older than 10 minutes. Discovery and its relay poll have no deadline of their own, so
     * the Lab gate races this against its own 5 s. An error goes through [noteError]. Never throws.
     */
    override fun state(feature: String): ServerState {
        val s = try {
            origin()
            status()
        } catch (e: Exception) {
            return noteError(feature, e)
        }
        return ServerMessages.stateFromStatus(s, feature)
    }

    /**
     * After a server call for [feature] failed with [err] (LAB-PLAN 2.6, DESIGN 10.4): updates the cached status and
     * returns the state to show now ([ServerMessages.stateFromError]). Only this class writes `server/status`. Never
     * throws.
     * - NEEDS_KEY, NEEDS_LAB_INBOX, and NOT_CONFIGURED for the email domain or R2: the feature the error names (else
     *   [feature]) takes that state in the cached status, which is marked for refresh.
     * - LOCKED, BAD_AUTH and NOT_CONFIGURED for DAYLIGHT_SERVER_CODE concern the whole server: the cached status is
     *   dropped. The first BAD_AUTH of an episode also sets `server/badAuthAt` and removes `server/configAt`, so the
     *   next discovery re-reads the config topic once.
     * - Anything else (OFFLINE, RATE_LIMITED, AI_BUSY, …) leaves the cache as it is.
     */
    fun noteError(feature: String, err: Throwable): ServerState {
        val out = ServerMessages.stateFromError(err)
        val e = err as? ServerError
        val code = e?.code ?: ""
        try {
            if (code == "LOCKED" || code == "BAD_AUTH" || (code == "NOT_CONFIGURED" && out.state == "needs-server")) {
                store.remove(ServerKeys.STATUS)
                store.remove(ServerKeys.STATUS_AT)
                if (code == "BAD_AUTH" && store.get(ServerKeys.BAD_AUTH_AT) == null) {
                    store.set(ServerKeys.BAD_AUTH_AT, clock())
                    store.remove(ServerKeys.CONFIG_AT)
                }
            } else if (code == "NEEDS_KEY" || code == "NEEDS_LAB_INBOX" || code == "NOT_CONFIGURED") {
                val named = e?.feature as? String
                val key = if (named in ServerCode.FEATURES) named else if (feature in ServerCode.FEATURES) feature else null
                val cached = store.get(ServerKeys.STATUS) as? Map<*, *>
                if (key != null && cached != null) {
                    val features = LinkedHashMap<Any?, Any?>((cached["features"] as? Map<*, *>) ?: emptyMap<Any?, Any?>())
                    features[key] = linkedMapOf("state" to out.state, "message" to out.message)
                    val next = LinkedHashMap<Any?, Any?>(cached)
                    next["features"] = features
                    store.set(ServerKeys.STATUS, next)
                    store.remove(ServerKeys.STATUS_AT)
                }
            }
        } catch (x: Exception) {
            // storage trouble: the message is still shown
        }
        return out
    }

    /** The first-use notice for a feature (14.3), or null once shown. Call [markNoticeShown] after Continue. */
    fun notice(feature: String): String? {
        val shown = store.get(ServerKeys.NOTICES) as? Map<*, *> ?: emptyMap<Any?, Any?>()
        if (shown[if (feature == "pdf") "ai" else feature] == true) return null
        val delivery = (store.get(ServerKeys.CONFIG) as? Map<*, *>)?.get("delivery") as? String ?: "lab"
        return ServerMessages.noticeText(feature, delivery)
    }

    fun markNoticeShown(feature: String) {
        val shown = LinkedHashMap<Any?, Any?>(store.get(ServerKeys.NOTICES) as? Map<*, *> ?: emptyMap<Any?, Any?>())
        shown[if (feature == "pdf") "ai" else feature] = true
        store.set(ServerKeys.NOTICES, shown)
    }

    /** Before re-pairing: POST /v1/admin/lock with the old token (DESIGN 3.4), whether Lab is on or off. Never throws. */
    fun lockBeforeRepair(): Boolean {
        runCatching {
            store.remove(ServerKeys.STATUS)
            store.remove(ServerKeys.BAD_AUTH_AT)
        }
        return try {
            request("POST", "/v1/admin/lock", json = emptyMap<String, Any?>())
            true
        } catch (e: Exception) {
            false
        }
    }

    companion object {
        private fun longOf(v: Any?): Long? = (v as? Number)?.toLong()

        /** The manual address's origin: https, or http on localhost / 127.0.0.1 (tests); null for anything else. */
        internal fun manualOrigin(url: String): String? {
            val m = Regex("^(https?)://([^/?#@\\s]+)(?:[/?#].*)?$", RegexOption.IGNORE_CASE).matchEntire(url.trim()) ?: return null
            val scheme = m.groupValues[1].lowercase()
            var hostport = m.groupValues[2].lowercase()
            val host = if (hostport.startsWith("[")) hostport.substringBefore(']') + "]" else hostport.substringBefore(':')
            if (scheme == "http" && host != "localhost" && host != "127.0.0.1") return null
            if (scheme == "https" && hostport.endsWith(":443")) hostport = hostport.removeSuffix(":443")
            if (scheme == "http" && hostport.endsWith(":80")) hostport = hostport.removeSuffix(":80")
            if (host.isEmpty() || !Regex("^([a-z0-9_.-]+|\\[[0-9a-f:.]+])(:[0-9]{1,5})?$").matches(hostport)) return null
            return "$scheme://$hostport"
        }

        /**
         * Polls a server topic the hardened way (DESIGN 4.3, 5.4): at most [maxBytes] of the answer (a line the cap cuts
         * is dropped) and [maxMessages] messages; attachments are never downloaded. Throws [ServerError] OFFLINE when the
         * relay does not answer 2xx or cannot be reached.
         */
        fun pollServerTopic(http: Http, relay: String, topic: String, since: String = "all", maxBytes: Int = 262_144, maxMessages: Int = 200, token: String = ""): List<ServerTopicMessage> {
            val base = Relay.normalize(relay)
            val q = StringBuilder("poll=1&since=").append(URLEncoder.encode(since, "UTF-8"))
            if (token.isNotEmpty()) q.append("&auth=").append(URLEncoder.encode(token, "UTF-8"))
            val stream = try {
                http.stream("$base/$topic/json?$q", readTimeoutMs = 60_000)
            } catch (e: IOException) {
                throw ServerError("OFFLINE")
            }
            stream.use { s ->
                if (s.status !in 200..299) throw ServerError("OFFLINE", status = s.status)
                val out = ArrayList<ServerTopicMessage>()
                var bytes = 0L
                while (out.size < maxMessages) {
                    val line = try {
                        s.readLine()
                    } catch (e: IOException) {
                        null
                    } ?: break
                    bytes += Bytes.utf8(line).size + 1
                    if (bytes > maxBytes) break // the cap cuts this line
                    if (line.isBlank()) continue
                    val m = runCatching { Json.parse(line) }.getOrNull() as? Map<*, *> ?: continue
                    if (m["event"] != "message") continue
                    val id = m["id"] as? String ?: continue
                    val time = (m["time"] as? Double)?.takeIf { !it.isNaN() && !it.isInfinite() }?.toLong() ?: 0L
                    val text = m["message"] as? String
                    val frame = if (RelayClient.jsTruthy(m["attachment"]) || text == null) null else Bytes.fromBase64OrNull(text)
                    out += ServerTopicMessage(id, time, frame)
                }
                return out
            }
        }
    }
}
