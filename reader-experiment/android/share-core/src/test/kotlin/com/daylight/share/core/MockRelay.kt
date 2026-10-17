package com.daylight.share.core

import org.junit.Assume
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit

/** Runs `node ../../share/js/mock-relay.mjs` on a free port for the duration of a test class. */
class MockRelay private constructor(private val process: Process, val url: String) : AutoCloseable {
    override fun close() {
        process.destroy()
        if (!process.waitFor(5, TimeUnit.SECONDS)) process.destroyForcibly()
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
            check(p.waitFor(60, TimeUnit.SECONDS) && p.exitValue() == 0) { "node interop failed: $out" }
            return Json.parse(out.trim().lines().last())
        }
    }
}
