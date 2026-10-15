@file:Suppress("DEPRECATION")

package site.amoeba.shoptalk.internal

import org.json.JSONObject
import site.amoeba.shoptalk.ShopTalkContext
import site.amoeba.shoptalk.ShopTalkIdentity
import site.amoeba.shoptalk.ShopTalkListener
import site.amoeba.shoptalk.ShopTalkUser

/**
 * The bridge message contract, kept byte-identical to the web/RN/iOS channels
 * (apps/widget/src/lib/host-bridge.ts). This file only builds and parses JSON
 * (org.json, no Android UI types), so the whole contract is coverable by JVM unit tests.
 */
internal object ShopTalkProtocol {

    // ── outbound (app → widget) ──────────────────────────────────────────────

    /**
     * The signed package goes in verbatim as `user`: the SDK does not know which
     * signing contract (attributes / claims / ...) the tenant uses, and must not.
     */
    fun identifyJson(identity: ShopTalkIdentity): String =
        JSONObject().put("type", "ivy:identify").put("user", identity.user).toString()

    /** 0.1.0 entry point, kept for callers still on [ShopTalkUser]. */
    @Suppress("DEPRECATION")
    fun identifyJson(user: ShopTalkUser): String = identifyJson(user.toIdentity())

    fun openJson(tab: String): String = command("open").put("tab", tab).toString()

    fun localeJson(locale: String): String = command("locale").put("locale", locale).toString()

    fun logoutJson(): String = command("logout").toString()

    /** Open the widget's preferences (language / privacy) panel. */
    fun settingsJson(): String = command("settings").toString()

    /** Same action as the widget's own "end conversation" button. */
    fun endJson(): String = command("end").toString()

    /** Ask the widget to consume a back press; it answers `ivy:event` `back` `{handled}`. */
    fun backJson(): String = command("back").toString()

    /**
     * `{ action:'context', context:{screen, ref?, label?, prefill?} }`. Absent
     * optionals are omitted, and null context becomes an explicit JSON null
     * (clears the chip). Blank optionals are treated as absent.
     */
    fun contextJson(context: ShopTalkContext?): String {
        val body: Any = if (context == null) {
            JSONObject.NULL
        } else {
            val c = JSONObject().put("screen", context.screen)
            context.ref?.takeIf { it.isNotBlank() }?.let { c.put("ref", it) }
            context.label?.takeIf { it.isNotBlank() }?.let { c.put("label", it) }
            context.prefill?.takeIf { it.isNotBlank() }?.let { c.put("prefill", it) }
            c
        }
        return command("context").put("context", body).toString()
    }

    private fun command(action: String): JSONObject =
        JSONObject().put("type", "ivy:command").put("action", action)

    /**
     * `vi-VN` / `vi_VN` → `vi`. The widget's language registry holds bare
     * two-letter codes and ignores anything else, the same base-subtag rule its
     * own browser detection applies.
     */
    fun normalizeLocale(tag: String): String =
        tag.trim().split('-', '_').first().lowercase()

    /**
     * The script evaluated inside the WebView. `JSONObject.quote` turns the
     * payload into a JS string literal, so quotes and newlines inside it cannot
     * break out of the injection. The `&&` guard makes a call before the bridge
     * global exists a silent no-op instead of a ReferenceError nobody can see.
     */
    fun injection(json: String): String {
        // Android's JSONObject.quote leaves U+2028/U+2029 raw; they were line terminators
        // inside JS string literals before ES2019, so escape them explicitly.
        val literal = JSONObject.quote(json).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        return "window.__shoptalkHost && window.__shoptalkHost($literal);"
    }

    // ── inbound (widget → app) ───────────────────────────────────────────────

    sealed interface Inbound {
        data object Ready : Inbound
        data object CloseRequest : Inbound
        data class Identified(val ok: Boolean) : Inbound
        data object IdentityExpired : Inbound
        data class Back(val handled: Boolean) : Inbound
        data class OpenUrl(val url: String, val mode: String?) : Inbound
        data class Unread(val count: Int) : Inbound
        data object Unknown : Inbound
    }

    /**
     * Null = not JSON, or a known message with an unusable payload (the caller
     * reports BridgeMalformed); unknown types are [Inbound.Unknown], tolerated on
     * purpose so old AARs survive new widget messages and vice versa.
     */
    fun parse(json: String): Inbound? {
        val obj = try {
            JSONObject(json)
        } catch (_: Exception) {
            return null
        }
        return when (obj.opt("type")) {
            "ivy:ready" -> Inbound.Ready
            "ivy:close-request" -> Inbound.CloseRequest
            "ivy:event" -> when (obj.opt("event")) {
                "identified" -> Inbound.Identified(obj.optBoolean("ok"))
                "identity-expired" -> Inbound.IdentityExpired
                "back" -> Inbound.Back(obj.optBoolean("handled"))
                else -> Inbound.Unknown
            }
            "ivy:open-url" -> {
                val url = obj.opt("url") as? String
                if (url.isNullOrBlank()) null else Inbound.OpenUrl(url, obj.opt("mode") as? String)
            }
            "ivy:unread" -> {
                val count = when (val raw = obj.opt("count")) {
                    is Number -> raw.toInt()
                    is String -> raw.trim().toIntOrNull()
                    else -> null
                }
                if (count == null) null else Inbound.Unread(count.coerceAtLeast(0))
            }
            else -> Inbound.Unknown
        }
    }

    /**
     * Dispatch to the host's listener without letting its exceptions reach the WebView.
     * [Inbound.Back] and [Inbound.OpenUrl] have no plain callback: the fragment owns
     * them (back needs the close-request fallback, open-url needs android.net.Uri).
     */
    fun dispatchSafely(listener: ShopTalkListener?, inbound: Inbound, onError: (Throwable) -> Unit) {
        listener ?: return
        try {
            when (inbound) {
                Inbound.Ready -> listener.onReady()
                Inbound.CloseRequest -> listener.onCloseRequest()
                is Inbound.Identified -> listener.onIdentified(inbound.ok)
                Inbound.IdentityExpired -> listener.onIdentityExpired()
                is Inbound.Unread -> listener.onUnread(inbound.count)
                is Inbound.Back, is Inbound.OpenUrl, Inbound.Unknown -> Unit
            }
        } catch (t: Throwable) {
            onError(t)
        }
    }

    /** Run host code; on a throw report it and return [fallback]. */
    inline fun <T> guard(fallback: T, onError: (Throwable) -> Unit, block: () -> T): T =
        try {
            block()
        } catch (t: Throwable) {
            onError(t)
            fallback
        }
}
