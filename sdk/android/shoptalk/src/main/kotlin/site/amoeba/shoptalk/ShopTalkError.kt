package site.amoeba.shoptalk

/** Problems the SDK reports through [ShopTalkListener.onError]. The chat keeps working unless stated. */
sealed interface ShopTalkError {
    /** The widget page failed to load (network, DNS, TLS, HTTP >= 400). The native error screen is shown. */
    data class LoadFailed(val code: Int, val description: String) : ShopTalkError

    /** The widget did not announce `ivy:ready` within 15 s. The native error screen is shown. */
    data object LoadTimeout : ShopTalkError

    /** [ShopTalkIdentityProvider] threw; the visitor continues as a guest. */
    data class IdentityProviderFailed(val cause: Throwable) : ShopTalkError

    /** A bridge message from the widget could not be understood; it was ignored. */
    data object BridgeMalformed : ShopTalkError
}
