import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("maven-publish")
}

android {
    namespace = "site.amoeba.shoptalk"
    compileSdk = 35

    defaultConfig {
        minSdk = 21
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    publishing {
        singleVariant("release") { withSourcesJar() }
    }

    testOptions {
        // android.util.Log in JVM tests returns defaults instead of throwing.
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    // Built with Kotlin 2.2.0, but declared against the stdlib floor: a host app on Kotlin 2.1 must not be dragged to a
    // 2.2.0 stdlib. apiVersion makes the compiler reject any stdlib API newer than that floor.
    coreLibrariesVersion = "2.1.0"
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        apiVersion.set(KotlinVersion.KOTLIN_2_1)
    }
}

dependencies {
    // These versions are the FLOOR, published in the POM. A host app keeps its own newer androidx (Gradle takes the
    // higher one), so the SDK never forces a compileSdk bump. Each floor was run on a device (TCR-261016 section 11):
    // androidx 2021 (fragment 1.3.6, core 1.6.0, activity 1.2.4, lifecycle 2.3.1) works, 2020 (fragment 1.2.5) crashes
    // because Activity Result APIs arrived in fragment 1.3.0. Do NOT raise these just because newer exist: core 1.15
    // alone requires compileSdk 35 from every consumer.
    implementation("androidx.core:core-ktx:1.6.0")
    // `api`, not `implementation`: ShopTalkChatFragment extends Fragment, so the type is part of this library's
    // public surface and consumers compile against it.
    api("androidx.fragment:fragment-ktx:1.3.6")
    // lifecycleScope and, through it, kotlinx.coroutines: declared because the code uses them directly.
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.3.1")

    testImplementation("junit:junit:4.13.2")
    // Real org.json on the test classpath — the android.jar stub throws.
    testImplementation("org.json:json:20240303")
}

// ---- Delivery: a Maven-format folder (`./gradlew deliveryZip`, see README) ------------------------------------
// The POM states the FLOOR of what this module needs, not what it was last built with, so a host app keeps its own
// newer androidx (Gradle picks the higher version) and is never forced to raise its compileSdk.
afterEvaluate {
    publishing {
        publications {
            register<MavenPublication>("release") {
                from(components["release"])
                groupId = (findProperty("shoptalk.group") ?: "site.amoeba.shoptalk").toString()
                artifactId = "shoptalk-android"
                version = (findProperty("shoptalk.version") ?: "0.2.0").toString()
                pom {
                    name.set("ShopTalk Android SDK: core")
                    description.set("Embeds the ShopTalk customer chat widget in an Android app (WebView).")
                }
            }
        }
        repositories {
            maven {
                name = "delivery"
                url = uri(rootProject.layout.projectDirectory.dir("dist/maven"))
            }
        }
    }
}
