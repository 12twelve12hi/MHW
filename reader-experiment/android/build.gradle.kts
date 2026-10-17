// Plugin versions live here, on the root build script's classpath, so the Kotlin and Android plugins share one class
// loader. The Android Gradle Plugin is only put on the classpath when ":app" is part of the build (see settings).
buildscript {
    val withApp = gradle.extra["dlsWithApp"] == true
    repositories {
        mavenCentral()
        google()
        gradlePluginPortal()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.20")
        if (withApp) {
            classpath("com.android.tools.build:gradle:8.9.1")
            classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:2.1.20")
        }
    }
}
