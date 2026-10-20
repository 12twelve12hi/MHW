package com.daylight.share.core

import org.junit.Assume
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit

/**
 * Runs `node ../../share/js/mock-relay.mjs` on a free port (ntfy.sh's limits: 2,000,000 bytes per attachment and
 * 20,000,000 live bytes per visitor) for a test class or a single test. With `--control`, [control] reaches the test
 * hooks (failing downloads and publishes, the clock) and [state] counts downloads per attachment.
 */
class MockRelay private constructor(private val process: Process, val url: String) : AutoCloseable {
    override fun close() {
        process.destroy()
        if (!process.waitFor(5, TimeUnit.SECONDS)) process.destroyForcibly()
    }

    private val http = UrlConnectionHttp()

    /** POSTs a control request (`fail-downloads?count=1&status=503`, `clock?advanceSec=60`, …); returns its answer. */
    @Suppress("UNCHECKED_CAST")
    fun control(pathAndQuery: String): Map<String, Any?> {
        val r = http.send("POST", "$url/__mock/$pathAndQuery", body = ByteArray(0))
        check(r.ok) { "mock control $pathAndQuery: ${r.status}" }
        return Json.parse(String(r.body, Charsets.UTF_8).trim()) as Map<String, Any?>
    }

    /** {published, downloads, downloadsById, offsetSec}. */
    @Suppress("UNCHECKED_CAST")
    fun state(): Map<String, Any?> = Json.parse(String(http.send("GET", "$url/__mock/state").body, Charsets.UTF_8).trim()) as Map<String, Any?>

    /** How often each attachment (by ntfy message id) was downloaded. */
    @Suppress("UNCHECKED_CAST")
    fun downloadsById(): Map<String, Int> = (state()["downloadsById"] as Map<String, Any?>).mapValues { (it.value as Double).toInt() }

    /** Moves the mock's clock [sec] seconds further (message `time`, 12 h message and 3 h attachment expiry). */
    fun advance(sec: Long) {
        control("clock?advanceSec=$sec")
    }

    companion object {
        val node: String get() = System.getProperty("dls.node") ?: "node"
        val shareDir: File get() = File(System.getProperty("dls.mockRelay") ?: "../../share/js/mock-relay.mjs").absoluteFile.parentFile.parentFile

        fun nodeAvailable(): Boolean = try {
            ProcessBuilder(node, "--version").redirectErrorStream(true).start().waitFor(20, TimeUnit.SECONDS)
        } catch (e: Exception) {
            false
        }

        /** Starts the relay; skips the test (rather than failing it) when node is not installed. */
        fun start(vararg extraArgs: String): MockRelay {
            Assume.assumeTrue("node is needed for the mock relay", nodeAvailable())
            val script = File(shareDir, "js/mock-relay.mjs")
            val p = ProcessBuilder(listOf(node, script.path, "--port", "0") + extraArgs).redirectErrorStream(true).start()
            val reader = BufferedReader(InputStreamReader(p.inputStream))
            val deadline = System.currentTimeMillis() + 20_000
            while (System.currentTimeMillis() < deadline) {
                val line = reader.readLine() ?: break
                val m = Regex("listening on (http://\\S+)").find(line)
                if (m != null) {
                    Thread { runCatching { while (reader.readLine() != null) Unit } }.apply { isDaemon = true }.start()
                    return MockRelay(p, m.groupValues[1])
                }
            }
            p.destroyForcibly()
            error("mock relay did not start")
        }

        /** Runs the JS reference implementation (src/test/js/interop.mjs) and returns its JSON output. */
        fun js(vararg args: String): Any? {
            val lib = File(shareDir, "js/daylight-share.js").path
            val script = File("src/test/js/interop.mjs").absolutePath
            val p = ProcessBuilder(listOf(node, script, lib) + args).redirectErrorStream(true).start()
            val out = p.inputStream.bufferedReader().readText()
            check(p.waitFor(120, TimeUnit.SECONDS) && p.exitValue() == 0) { "node interop failed: $out" }
            return Json.parse(out.trim().lines().last())
        }
    }
}
