package site.amoeba.shoptalk

import java.net.URI
import java.net.URLEncoder

/**
 * Who draws the chat header, when the app wants to decide it explicitly.
 * [NATIVE] adds `chrome=native` so the widget drops its header and the app supplies
 * back, title and menu (commands `locale`, `settings`, `end`); [WIDGET] adds
 * `chrome=widget` to force the widget's own header. Not setting it at all
 * ([ShopTalkConfig.header] = null) adds no param and lets the tenant's admin console
 * choose; an explicit param always wins over the admin setting.
 */
enum class ShopTalkHeader { WIDGET, NATIVE }

/**
 * Attachment options for the native chooser.
 *
 * @param camera Offer "Take photo" (system camera app via a capture intent, no CAMERA
 *   permission needed). Hidden anyway when no camera app can handle the intent.
 * @param multiple Allow picking several files at once (still bound by the widget input).
 */
data class ShopTalkAttachments(
    val camera: Boolean = true,
    val multiple: Boolean = true,
)

/**
 * Where and how the chat opens. The same values the web embed uses — the widget
 * URL parameters are the contract (docs/guide/모바일SDK연동가이드_Mobile-SDK.ko.md §1).
 *
 * Parameter order keeps the 0.1.0 positional order (`widgetUrl, shop, locale, agent`);
 * everything added in 0.2.0 comes after it.
 *
 * @param widgetUrl Where the widget is served, e.g. `https://talk.example.com/widget/`.
 *   Must be `https`, unless [allowInsecureUrl] and the host is local (see below).
 * @param shop Store domain identifying the tenant (same value the web SDK uses). A
 *   tenant lookup key, not a domain of the app.
 * @param locale Initial UI language (e.g. `vi`); omitted = the widget auto-detects
 *   (stored manual pick, else device language, else English). Delivered over the
 *   bridge as an `ivy:command`/`locale` once the widget is ready — the widget
 *   reads no `locale` URL parameter (verified against useEmbedCommands/i18n).
 * @param agent AI agent code to pin the session to; omitted = the tenant's default.
 * @param accessKey Sent as `access=` when the tenant enabled widget access control.
 * @param header See [ShopTalkHeader]. Null (default) = no `chrome` param; the admin console decides.
 * @param startTab Tab to open once the widget is ready (sent as an `open` command —
 *   the widget reads no start-tab URL parameter). Null = the widget default.
 * @param attachments See [ShopTalkAttachments].
 * @param errorHotline Phone number shown on the native error screen (tap = dial).
 * @param allowInsecureUrl DEBUG ONLY. Lets [widgetUrl] be `http://` when the host is
 *   `localhost`, `127.0.0.1`, `[::1]` or `10.0.2.2` (emulator to dev machine).
 *   Any other plain-http host is rejected even when this is true.
 * @throws IllegalArgumentException when [widgetUrl] is not an accepted URL.
 */
data class ShopTalkConfig(
    val widgetUrl: String,
    val shop: String? = null,
    val locale: String? = null,
    val agent: String? = null,
    val accessKey: String? = null,
    val header: ShopTalkHeader? = null,
    val startTab: ShopTalkTab? = null,
    val attachments: ShopTalkAttachments = ShopTalkAttachments(),
    val errorHotline: String? = null,
    val allowInsecureUrl: Boolean = false,
) {
    init {
        val uri = parseUri(widgetUrl)
            ?: throw IllegalArgumentException("widgetUrl is not a valid absolute URL")
        val scheme = uri.scheme.lowercase()
        val host = uri.host?.lowercase()
        when {
            host.isNullOrEmpty() ->
                throw IllegalArgumentException("widgetUrl has no host")
            scheme == "https" -> Unit
            scheme == "http" && allowInsecureUrl && host in LOCAL_HOSTS -> Unit
            scheme == "http" ->
                throw IllegalArgumentException(
                    "widgetUrl must be https (http is accepted only with allowInsecureUrl " +
                        "for localhost / 127.0.0.1 / 10.0.2.2)",
                )
            else -> throw IllegalArgumentException("widgetUrl scheme must be https")
        }
    }

    /** The URL the WebView opens: app mode, no launcher, panel open. */
    internal fun launchUrl(): String {
        val base = widgetUrl.trimEnd('/')
        val params = StringBuilder("embed=1&mode=app")
        fun add(key: String, value: String?) {
            if (!value.isNullOrBlank()) {
                params.append('&').append(key).append('=')
                    .append(URLEncoder.encode(value, "UTF-8"))
            }
        }
        add("shop", shop)
        add("agent", agent)
        add("access", accessKey)
        when (header) {
            ShopTalkHeader.NATIVE -> add("chrome", "native")
            ShopTalkHeader.WIDGET -> add("chrome", "widget")
            null -> Unit // no param: the tenant's admin console decides (app-config)
        }
        return "$base/?$params"
    }

    /** True when [url] belongs to the widget itself; anything else is an external link. */
    internal fun isWidgetUrl(url: String): Boolean =
        url == "about:blank" || url.startsWith(widgetUrl.trimEnd('/'))

    /**
     * True when [url] shares scheme, host and port with [widgetUrl]. This, not a
     * string prefix, gates the JS bridge: `https://talk.example.com.evil.test`
     * starts with `https://talk.example.com` but is a different origin.
     */
    internal fun isWidgetOrigin(url: String?): Boolean {
        if (url.isNullOrEmpty()) return false
        val a = parseUri(url) ?: return false
        val b = parseUri(widgetUrl) ?: return false
        val hostA = a.host?.lowercase() ?: return false
        return a.scheme.lowercase() == b.scheme.lowercase() &&
            hostA == b.host?.lowercase() &&
            effectivePort(a) == effectivePort(b)
    }

    /** Digits, `+`, `*`, `#` of [errorHotline] (all a dialer needs). Null = no hotline. */
    internal fun hotlineDialNumber(): String? =
        errorHotline?.filter { it.isDigit() || it == '+' || it == '*' || it == '#' }
            ?.takeIf { it.isNotEmpty() }

    private companion object {
        val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "[::1]", "::1", "10.0.2.2")

        fun parseUri(raw: String): URI? =
            try {
                URI(raw.trim()).takeIf { it.scheme != null }
            } catch (_: Exception) {
                null
            }

        fun effectivePort(uri: URI): Int =
            if (uri.port != -1) uri.port else if (uri.scheme.equals("https", true)) 443 else 80
    }
}
