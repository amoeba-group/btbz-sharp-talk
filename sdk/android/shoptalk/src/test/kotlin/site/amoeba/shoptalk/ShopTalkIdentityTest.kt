package site.amoeba.shoptalk

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import site.amoeba.shoptalk.internal.ShopTalkProtocol

/** The identity package is forwarded verbatim; the SDK only insists on userId + hash. */
class ShopTalkIdentityTest {

    private fun userOf(identity: ShopTalkIdentity): JSONObject {
        val msg = JSONObject(ShopTalkProtocol.identifyJson(identity))
        assertEquals("ivy:identify", msg.getString("type"))
        return msg.getJSONObject("user")
    }

    /**
     * Structural JSON equality. `JSONObject.similar` is not in android.jar's org.json,
     * which wins on the compile classpath of an Android unit test, so it cannot be used here.
     */
    private fun sameJson(a: Any?, b: Any?): Boolean = when {
        a is JSONObject && b is JSONObject ->
            a.length() == b.length() && a.keys().asSequence().all { b.has(it) && sameJson(a.get(it), b.get(it)) }
        a is org.json.JSONArray && b is org.json.JSONArray ->
            a.length() == b.length() && (0 until a.length()).all { sameJson(a.get(it), b.get(it)) }
        a is Number && b is Number -> a.toString() == b.toString()
        else -> a == b
    }

    @Test
    fun `attributes form is forwarded verbatim`() {
        val raw = """{"userId":"u-1","hash":"h-1","name":"Ngân","attributes":{"hotel_id":"H1","hotel_name":"A In Hotel","region":"south","province":"HCM","role":"manager"}}"""
        val user = userOf(ShopTalkIdentity.fromJson(raw))
        assertTrue(sameJson(JSONObject(raw), user))
    }

    @Test
    fun `claims form is forwarded verbatim including numbers`() {
        val raw = """{"userId":"u-2","hash":"h-2","claims":{"hotel_sn":9004,"role":"owner","iat":1760000000,"province":"HN"}}"""
        val user = userOf(ShopTalkIdentity.fromJson(raw))
        assertTrue(sameJson(JSONObject(raw), user))
        assertEquals(1760000000L, user.getJSONObject("claims").getLong("iat"))
    }

    @Test
    fun `minimal form and unknown future fields pass through`() {
        val minimal = """{"userId":"u-3","hash":"h-3"}"""
        assertTrue(sameJson(JSONObject(minimal), userOf(ShopTalkIdentity.fromJson(minimal))))

        val future = """{"userId":"u-4","hash":"h-4","signed_at":"2026-10-16T00:00:00Z","scopes":["a","b"],"nested":{"x":{"y":1}}}"""
        assertTrue(sameJson(JSONObject(future), userOf(ShopTalkIdentity.fromJson(future))))
    }

    @Test
    fun `missing or blank userId or hash is rejected`() {
        for (bad in listOf(
            """{"hash":"h"}""",
            """{"userId":"u"}""",
            """{"userId":"","hash":"h"}""",
            """{"userId":"u","hash":"  "}""",
            """{"userId":null,"hash":"h"}""",
            """{"userId":"u","hash":null}""",
            """{"userId":42,"hash":"h"}""",
            """{}""",
        )) {
            assertThrows("should reject: $bad", IllegalArgumentException::class.java) {
                ShopTalkIdentity.fromJson(bad)
            }
        }
    }

    @Test
    fun `non json input is rejected with IllegalArgumentException`() {
        for (bad in listOf("", "not json", "[1,2]", "\"str\"")) {
            assertThrows("should reject: $bad", IllegalArgumentException::class.java) {
                ShopTalkIdentity.fromJson(bad)
            }
        }
    }

    @Test
    fun `of builds the same shape as the backend package`() {
        val identity = ShopTalkIdentity.of(
            userId = "u-5",
            hash = "h-5",
            attributes = mapOf("hotel_id" to "H1", "role" to "staff"),
            name = "An",
            email = "an@example.com",
            phone = "0900000000",
        )
        val user = userOf(identity)
        assertEquals("u-5", user.getString("userId"))
        assertEquals("h-5", user.getString("hash"))
        assertEquals("An", user.getString("name"))
        assertEquals("an@example.com", user.getString("email"))
        assertEquals("0900000000", user.getString("phone"))
        assertEquals("H1", user.getJSONObject("attributes").getString("hotel_id"))
        assertFalse(user.has("claims"))
        assertEquals("u-5", identity.userId)
    }

    @Test
    fun `of with claims keeps value types and omits absent optionals`() {
        val user = userOf(
            ShopTalkIdentity.of("u-6", "h-6", claims = mapOf("hotel_sn" to 9004, "role" to "owner", "ok" to true)),
        )
        val claims = user.getJSONObject("claims")
        assertEquals(9004, claims.getInt("hotel_sn"))
        assertEquals("owner", claims.getString("role"))
        assertTrue(claims.getBoolean("ok"))
        assertFalse(user.has("attributes"))
        assertFalse(user.has("name"))
    }

    @Test
    fun `of validates userId and hash too`() {
        assertThrows(IllegalArgumentException::class.java) { ShopTalkIdentity.of("", "h") }
        assertThrows(IllegalArgumentException::class.java) { ShopTalkIdentity.of("u", "") }
    }

    @Test
    fun `toString never leaks the id or the hash`() {
        val text = ShopTalkIdentity.fromJson("""{"userId":"secret-user","hash":"secret-hash"}""").toString()
        assertFalse(text.contains("secret-user"))
        assertFalse(text.contains("secret-hash"))
    }

    @Suppress("DEPRECATION")
    @Test
    fun `0_1_0 ShopTalkUser still works and now carries attributes`() {
        val old = ShopTalkUser(userId = "42", hash = "abc", name = "Ngân")
        val user = userOf(old.toIdentity())
        assertEquals("42", user.getString("userId"))
        assertFalse(user.has("attributes"))

        val withAttrs = ShopTalkUser("42", "abc", attributes = mapOf("role" to "staff"))
        assertEquals("staff", userOf(withAttrs.toIdentity()).getJSONObject("attributes").getString("role"))
        // 0.1.0 identifyJson(ShopTalkUser) entry point keeps its output shape.
        val json = JSONObject(ShopTalkProtocol.identifyJson(old))
        assertEquals("abc", json.getJSONObject("user").getString("hash"))
    }

    @Test
    fun `hostile strings stay data - quotes and newlines survive the injection quoting`() {
        val identity = ShopTalkIdentity.of("u'1\"x", "h\n</script>", name = "a\u2028b")
        val script = ShopTalkProtocol.injection(ShopTalkProtocol.identifyJson(identity))
        assertTrue(script.startsWith("window.__shoptalkHost && window.__shoptalkHost(\""))
        assertFalse(script.contains('\n'))
        assertFalse(script.contains('\u2028'))
        assertFalse(script.contains("</script>"))
    }
}
