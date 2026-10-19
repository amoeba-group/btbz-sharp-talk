import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Optional Compose wrapper. A separate module on purpose: the core AAR carries no
// Compose, so apps without Compose pay nothing for it.
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("maven-publish")
}

android {
    namespace = "site.amoeba.shoptalk.compose"
    compileSdk = 35

    defaultConfig {
        minSdk = 21
    }

    publishing {
        singleVariant("release") { withSourcesJar() }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    // Same stdlib floor as :shoptalk, so the POM does not pin the host to 2.2.0.
    coreLibrariesVersion = "2.1.0"
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    api(project(":shoptalk"))
    // Compose BOM 2024.12.01 = Compose 1.7.6, the line fragment-compose 1.8.x is built against.
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.ui:ui")
    api("androidx.fragment:fragment-compose:1.8.5")
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
                artifactId = "shoptalk-compose"
                version = (findProperty("shoptalk.version") ?: "0.2.0").toString()
                pom {
                    name.set("ShopTalk Android SDK: Compose wrapper")
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
