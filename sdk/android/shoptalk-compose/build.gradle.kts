import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Optional Compose wrapper. A separate module on purpose: the core AAR carries no
// Compose, so apps without Compose pay nothing for it.
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "site.amoeba.shoptalk.compose"
    compileSdk = 35

    defaultConfig {
        minSdk = 21
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
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
