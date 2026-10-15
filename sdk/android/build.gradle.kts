// Toolchain: Kotlin 2.2.0 (what the Go2Joy app builds with). KGP 2.2.0 supports
// AGP 7.3.1-8.10.0 and Gradle 7.6.3-8.14 (kotlinlang.org compatibility table), so the
// proven AGP 8.5.2 + Gradle 8.7 wrapper pair stays. The library must stay buildable
// offline once the caches are warm: this AAR is hand-delivered, not fetched by consumers.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("com.android.library") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.0" apply false
}
