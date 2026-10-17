// Daylight Share for Android: ":share-core" is the protocol (pure Kotlin/JVM, reusable inside the Reader), ":app" is
// the APK. ":app" needs an Android SDK; without one (ANDROID_HOME, ANDROID_SDK_ROOT or sdk.dir in local.properties)
// only ":share-core" is built, so the protocol tests run anywhere with a JDK.
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        google()
    }
}

rootProject.name = "daylight-share"

include(":share-core")

val localSdk = java.util.Properties().let { p ->
    val f = file("local.properties")
    if (f.isFile) f.reader().use(p::load)
    p.getProperty("sdk.dir")
}
val androidSdk = listOfNotNull(System.getenv("ANDROID_HOME"), System.getenv("ANDROID_SDK_ROOT"), localSdk)
    .firstOrNull { it.isNotBlank() && file(it).isDirectory }
val withApp = androidSdk != null && providers.gradleProperty("dls.skipApp").orNull != "true"
gradle.extra["dlsWithApp"] = withApp
if (withApp) include(":app")
