package site.amoeba.shoptalk

import android.net.Uri

/**
 * What the widget tells the host app. All methods have empty defaults except
 * the one that matters: [onCloseRequest] is where the host MUST dismiss the
 * chat screen. In app mode the widget fills the screen, so ignoring it leaves
 * the visitor staring at a blank page.
 *
 * A listener that throws never takes the WebView down with it; the exception is
 * logged and swallowed (there is no console inside a WebView to surface it).
 */
interface ShopTalkListener {
    /** The widget mounted and is listening. Identity is requested from the provider automatically. */
    fun onReady() {}

    /** The visitor tapped close or pressed back with nothing left to close: dismiss this screen now. */
    fun onCloseRequest()

    /** The server accepted (or rejected) the signed identity. Rejection keeps the guest session. */
    fun onIdentified(ok: Boolean) {}

    /** The widget says the signed identity expired; the SDK is already asking the provider for a new one. */
    fun onIdentityExpired() {}

    /**
     * A link was tapped (or the widget asked to open a URL). Return true when the app
     * handled it. Default false = the SDK opens it with ACTION_VIEW. Only http, https,
     * mailto and tel links reach this method; other schemes are dropped by the SDK.
     */
    fun onOpenUrl(url: Uri): Boolean = false

    /** Unread staff replies (for an app-side badge). */
    fun onUnread(count: Int) {}

    /** See [ShopTalkError]. */
    fun onError(error: ShopTalkError) {}
}
