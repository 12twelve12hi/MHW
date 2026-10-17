// The Daylight Share APK: share target and sender on phones, the Daylight Inbox on the DC-1.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Minutes since 2026-10-01 00:00 UTC: every build, from CI or a laptop, installs over any earlier one.
val minutesSinceOctober = (System.currentTimeMillis() / 60_000L - 29_846_880L).toInt()
val buildNumber = System.getenv("DLS_BUILD") ?: "local"

android {
    namespace = "com.daylight.share"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.daylight.share"
        minSdk = 26
        targetSdk = 35
        versionCode = 1_000 + minutesSinceOctober
        versionName = "1.0.$buildNumber"
    }

    // A throwaway key committed on purpose: debug and release builds, local or CI, are signed the same way, so a new
    // APK installs over the old one without uninstalling first.
    signingConfigs {
        create("share") {
            storeFile = file("share-debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("share")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("share")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }

    packaging {
        resources.excludes += setOf("META-INF/{AL2.0,LGPL2.1}", "META-INF/versions/9/previous-compilation-data.bin")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

tasks.withType<Test>().configureEach {
    testLogging {
        events("passed", "skipped", "failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

dependencies {
    implementation(project(":share-core"))

    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // QR codes: zxing core draws the pairing code; the embedded scanner reads it (no Play Services needed).
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
}
