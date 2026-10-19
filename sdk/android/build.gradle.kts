// Toolchain: Kotlin 2.2.0 (what the Go2Joy app builds with). KGP 2.2.0 supports
// AGP 7.3.1-8.10.0 and Gradle 7.6.3-8.14 (kotlinlang.org compatibility table), so the
// proven AGP 8.5.2 + Gradle 8.7 wrapper pair stays. The library must stay buildable
// offline once the caches are warm. Delivery is a Maven-format folder: `./gradlew deliveryZip` (README).
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("com.android.library") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.0" apply false
}

// ---- Delivery ------------------------------------------------------------------------------------------------
// `./gradlew deliveryZip` -> dist/maven/ (AAR + POM + Gradle module metadata + sources + checksums) and
// dist/shoptalk-android-<version>-maven.zip. The client unzips it into their repo or uploads it to their Artifactory/Nexus.
val shoptalkVersion = (findProperty("shoptalk.version") ?: "0.2.0").toString()
val deliveryDir = layout.projectDirectory.dir("dist/maven")

val cleanDelivery = tasks.register<Delete>("cleanDelivery") {
    group = "delivery"
    description = "Empties dist/maven so a release never mixes files from an older build."
    delete(deliveryDir)
}

val publishDelivery = tasks.register("publishDelivery") {
    group = "delivery"
    description = "Publishes :shoptalk and :shoptalk-compose into dist/maven."
    dependsOn(cleanDelivery)
    dependsOn(
        ":shoptalk:publishReleasePublicationToDeliveryRepository",
        ":shoptalk-compose:publishReleasePublicationToDeliveryRepository",
    )
}

subprojects {
    tasks.configureEach {
        if (name.startsWith("publishReleasePublicationToDelivery")) mustRunAfter(cleanDelivery)
    }
}

tasks.register<Zip>("deliveryZip") {
    group = "delivery"
    description = "dist/maven as one zip to hand to the client."
    dependsOn(publishDelivery)
    from(deliveryDir)
    // maven-metadata.xml carries a lastUpdated timestamp and only matters for dynamic versions; leaving it out makes the
    // zip (and the SHA-256 we quote for it) identical on every build of the same sources.
    exclude("**/maven-metadata.xml*")
    destinationDirectory.set(layout.projectDirectory.dir("dist"))
    archiveFileName.set("shoptalk-android-$shoptalkVersion-maven.zip")
    isReproducibleFileOrder = true
    isPreserveFileTimestamps = false
}
