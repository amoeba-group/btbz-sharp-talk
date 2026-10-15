package site.amoeba.shoptalk

/**
 * Supplies a FRESH signed identity whenever the widget needs one: when it becomes
 * ready, after every reload, and when it reports `identity-expired`. The SDK never
 * caches or replays an old identity (signatures can expire), so the host's backend
 * is asked again each time.
 *
 * Return null for "nobody is signed in" (the visitor stays a guest). Throwing is
 * reported as [ShopTalkError.IdentityProviderFailed] and the chat continues as guest.
 *
 * Runs on the main dispatcher; switch with `withContext(Dispatchers.IO)` for network.
 */
fun interface ShopTalkIdentityProvider {
    suspend fun identity(): ShopTalkIdentity?
}
