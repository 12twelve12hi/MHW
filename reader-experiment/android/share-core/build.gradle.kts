// The Daylight Share protocol (../../share/PROTOCOL.md) as plain Kotlin/JVM: no Android classes, no dependencies.
// Tests check it against ../../share/vectors/test-vectors.json and against the mock ntfy relay (node).
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("org.jetbrains.kotlin.jvm")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.1.20")
}

val shareDir = rootProject.projectDir.resolve("../share")
val serverDir = rootProject.projectDir.resolve("../server")

tasks.test {
    // The vectors and the mock relay are shared with the other implementations.
    systemProperty("dls.vectors", shareDir.resolve("vectors/test-vectors.json").absolutePath)
    systemProperty("dls.labVectors", shareDir.resolve("vectors/lab-vectors.json").absolutePath)
    systemProperty("dls.serverVectors", serverDir.resolve("vectors/server-vectors.json").absolutePath)
    systemProperty("dls.serverClient", serverDir.resolve("client/daylight-server.js").absolutePath)
    systemProperty("dls.mockRelay", shareDir.resolve("js/mock-relay.mjs").absolutePath)
    System.getenv("DLS_NODE")?.let { systemProperty("dls.node", it) }
    // Set DLS_LIVE_RELAY=https://ntfy.sh to run the live round trip against a real relay.
    System.getenv("DLS_LIVE_RELAY")?.let { systemProperty("dls.liveRelay", it) }
    inputs.dir(shareDir.resolve("vectors"))
    inputs.file(serverDir.resolve("vectors/server-vectors.json"))
    inputs.file(serverDir.resolve("client/daylight-server.js"))
    // The JS side of the interop and skew tests: the references (with the v1.0 and v1.1 fixtures) and the driver.
    inputs.files(fileTree(shareDir.resolve("js")) { include("*.js", "*.mjs", "test/fixtures/**") })
    inputs.dir("src/test/js")
    testLogging {
        events("passed", "skipped", "failed")
        showStandardStreams = true
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
