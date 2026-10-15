package site.amoeba.shoptalk.internal

/**
 * Which URLs the SDK will hand to the system (ACTION_VIEW / the listener).
 * String-based on purpose: android.net.Uri returns defaults in JVM unit tests,
 * and a scheme check must not depend on a lenient parser.
 */
internal object UrlPolicy {
    private val SCHEME = Regex("^([A-Za-z][A-Za-z0-9+.-]*):")

    /** Lower-case scheme, or null when [url] does not start with one (leading space, none, ...). */
    fun scheme(url: String): String? = SCHEME.find(url)?.groupValues?.get(1)?.lowercase()

    /** `ivy:open-url` from the widget: web links only. */
    fun isOpenUrlAllowed(url: String): Boolean = scheme(url) in setOf("http", "https")

    /** A link tapped inside the conversation: web links plus mail and phone. */
    fun isLinkAllowed(url: String): Boolean = scheme(url) in setOf("http", "https", "mailto", "tel")
}
