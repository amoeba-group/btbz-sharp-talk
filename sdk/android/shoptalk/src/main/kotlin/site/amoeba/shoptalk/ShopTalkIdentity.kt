package site.amoeba.shoptalk

import org.json.JSONException
import org.json.JSONObject

/**
 * The signed identity package produced by the HOST's backend, forwarded to the
 * widget verbatim inside `ivy:identify.user`.
 *
 * The SDK does not read, rewrite or sign anything: it only checks that `userId`
 * and `hash` are present, so it keeps working whichever signing contract the
 * tenant uses (`attributes`, `claims`, or whatever comes next). The secret never
 * lives in the app: the backend computes `hash` and the app just carries it.
 *
 * Accepted shapes (extra fields are passed through untouched):
 * ```json
 * { "userId": "...", "hash": "..." }
 * { "userId": "...", "hash": "...", "attributes": { "hotel_id": "..." }, "name": "..." }
 * { "userId": "...", "hash": "...", "claims": { "hotel_sn": 1, "iat": 1760000000 } }
 * ```
 */
class ShopTalkIdentity private constructor(internal val user: JSONObject) {

    /** The user id from the package (not secret, but still never logged by the SDK). */
    val userId: String get() = user.getString("userId")

    /** Redacted on purpose: identities must not leak into logs (NFR-M01). */
    override fun toString(): String = "ShopTalkIdentity(userId=***, hash=***)"

    companion object {
        /**
         * Wrap the JSON object your backend returned.
         *
         * @throws IllegalArgumentException if [raw] is not a JSON object or `userId` /
         *   `hash` is missing or not a non-blank string.
         */
        @JvmStatic
        fun fromJson(raw: String): ShopTalkIdentity {
            val obj = try {
                JSONObject(raw)
            } catch (e: JSONException) {
                throw IllegalArgumentException("identity is not a JSON object", e)
            }
            requireText(obj, "userId")
            requireText(obj, "hash")
            return ShopTalkIdentity(obj)
        }

        /**
         * Build from parts you already hold (the signature still comes from your server).
         * [attributes] / [claims] must be exactly what the server signed.
         */
        @JvmStatic
        @JvmOverloads
        fun of(
            userId: String,
            hash: String,
            attributes: Map<String, String>? = null,
            claims: Map<String, Any>? = null,
            name: String? = null,
            email: String? = null,
            phone: String? = null,
        ): ShopTalkIdentity {
            val obj = JSONObject().put("userId", userId).put("hash", hash)
            name?.let { obj.put("name", it) }
            email?.let { obj.put("email", it) }
            phone?.let { obj.put("phone", it) }
            attributes?.let { map ->
                val a = JSONObject()
                for ((k, v) in map) a.put(k, v)
                obj.put("attributes", a)
            }
            claims?.let { map ->
                val c = JSONObject()
                for ((k, v) in map) c.put(k, JSONObject.wrap(v))
                obj.put("claims", c)
            }
            requireText(obj, "userId")
            requireText(obj, "hash")
            return ShopTalkIdentity(obj)
        }

        private fun requireText(obj: JSONObject, key: String) {
            val v = obj.opt(key)
            require(v is String && v.isNotBlank()) { "identity.$key is required (non-blank string)" }
        }
    }
}
