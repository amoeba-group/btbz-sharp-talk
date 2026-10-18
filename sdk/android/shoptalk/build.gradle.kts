import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
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

    testOptions {
        // android.util.Log in JVM tests returns defaults instead of throwing.
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // Hand-delivered AAR: dependencies must stay inside the androidx baseline any
    // host app already has — the AAR carries no POM to pull anything else in.
    implementation("androidx.core:core-ktx:1.15.0")
    // `api`, not `implementation`: ShopTalkChatFragment extends Fragment, so the
    // type is part of this library's public surface and consumers compile against it.
    api("androidx.fragment:fragment-ktx:1.8.5")
    // No explicit lifecycle-runtime-ktx / coroutines: fragment-ktx -> activity-ktx
    // already exposes androidx.lifecycle.lifecycleScope (api scope), keeping the
    // dependency list at core + fragment as the AAR requires.

    testImplementation("junit:junit:4.13.2")
    // Real org.json on the test classpath — the android.jar stub throws.
    testImplementation("org.json:json:20240303")
}
