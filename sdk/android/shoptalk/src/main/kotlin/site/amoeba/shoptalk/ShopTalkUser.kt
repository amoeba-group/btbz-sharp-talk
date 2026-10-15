package site.amoeba.shoptalk

/**
 * Identity the host app has already authenticated.
 *
 * [hash] is `HMAC_SHA256(embed_secret, userId)` and MUST be produced on the
 * host's server: the secret must never ship inside the app bundle, which
 * anyone can unpack. A rejected signature does not block the conversation: the
 * visitor simply continues as a guest.
 *
 * Deprecated in 0.2.0: use [ShopTalkIdentity] (forwards the backend's signed package
 * verbatim) with a [ShopTalkIdentityProvider]. Kept so 0.1.0 callers still compile.
 */
@Deprecated(
    "Use ShopTalkIdentity + ShopTalkIdentityProvider",
    ReplaceWith("ShopTalkIdentity.of(userId, hash)"),
)
data class ShopTalkUser(
    val userId: String,
    val hash: String,
    val name: String? = null,
    val email: String? = null,
    val phone: String? = null,
    /** Signed together with [userId] by the host server; passed through untouched. */
    val attributes: Map<String, String>? = null,
) {
    fun toIdentity(): ShopTalkIdentity =
        ShopTalkIdentity.of(
            userId = userId, hash = hash, attributes = attributes,
            name = name, email = email, phone = phone,
        )
}
