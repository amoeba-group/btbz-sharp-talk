package site.amoeba.shoptalk.internal

/**
 * What the WebView says about itself. The widget is a modern single-page app (ES modules, nullish
 * coalescing), so a WebView older than [MIN_WIDGET_MAJOR] loads the page and then never runs it:
 * the chat times out instead of failing loudly. Knowing the version lets the error screen say so.
 */
internal object WebViewVersion {
    /** Chrome 80 (Feb 2020): the oldest engine the widget's production bundle runs on. */
    const val MIN_WIDGET_MAJOR = 80

    private val CHROME = Regex("""Chrome/(\d+)""")

    /** `Chrome/37.0.0.0` -> 37; null when the user agent does not say. */
    fun major(userAgent: String?): Int? =
        userAgent?.let { CHROME.find(it)?.groupValues?.get(1)?.toIntOrNull() }

    /** True only when the version is known and below the minimum: an unknown engine is never blamed. */
    fun isTooOldForWidget(userAgent: String?): Boolean =
        major(userAgent)?.let { it < MIN_WIDGET_MAJOR } ?: false
}
