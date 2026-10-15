package site.amoeba.shoptalk.internal

/** Pure decisions for the attachment chooser (kept apart from Android so JVM tests cover them). */
internal object AttachmentRules {
    private val IMAGE_EXT = setOf("jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif")

    /**
     * Whether the file input accepts photos, so "Take photo" makes sense. An input with no
     * `accept` list takes anything.
     */
    fun acceptsImages(acceptTypes: Array<String>?): Boolean {
        val types = acceptTypes.orEmpty().flatMap { it.split(',') }
            .map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        if (types.isEmpty()) return true
        return types.any {
            it == "*/*" || it.startsWith("image/") ||
                (it.startsWith(".") && it.substring(1) in IMAGE_EXT)
        }
    }

    /** Several files only when the host allows it AND the widget input is `multiple`. */
    fun allowMultiple(hostAllows: Boolean, inputIsMultiple: Boolean): Boolean =
        hostAllows && inputIsMultiple
}
