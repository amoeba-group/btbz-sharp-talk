@file:Suppress("DEPRECATION")

package site.amoeba.shoptalk

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import site.amoeba.shoptalk.internal.ShopTalkProtocol
import site.amoeba.shoptalk.internal.ShopTalkProtocol.Inbound

class ShopTalkProtocolTest {

    // ── outbound ─────────────────────────────────────────────────────────────

    @Test
    fun `identify carries required fields and omits absent optionals`() {
        val json = JSONObject(
            ShopTalkProtocol.identifyJson(ShopTalkUser(userId = "42", hash = "abc", name = "Ngân")),
        )
        assertEquals("ivy:identify", json.getString("type"))
        val user = json.getJSONObject("user")
        assertEquals("42", user.getString("userId"))
        assertEquals("abc", user.getString("hash"))
        assertEquals("Ngân", user.getString("name"))
        assertFalse(user.has("email"))
        assertFalse(user.has("phone"))
    }

    @Test
    fun `commands match the bridge contract`() {
        val open = JSONObject(ShopTalkProtocol.openJson("orders"))
        assertEquals("ivy:command", open.getString("type"))
        assertEquals("open", open.getString("action"))
        assertEquals("orders", open.getString("tab"))

        val locale = JSONObject(ShopTalkProtocol.localeJson("vi"))
        assertEquals("locale", locale.getString("action"))
        assertEquals("vi", locale.getString("locale"))

        assertEquals("logout", JSONObject(ShopTalkProtocol.logoutJson()).getString("action"))
    }

    @Test
    fun `locale tags collapse to the base subtag the widget understands`() {
        assertEquals("vi", ShopTalkProtocol.normalizeLocale("vi-VN"))
        assertEquals("vi", ShopTalkProtocol.normalizeLocale("vi_VN"))
        assertEquals("ko", ShopTalkProtocol.normalizeLocale(" KO "))
        assertEquals("en", ShopTalkProtocol.normalizeLocale("en"))
    }

    @Test
    fun `injection quotes the payload so it cannot break out of the script`() {
        val hostile = """{"type":"ivy:identify","user":{"name":"a'b\"c\n d"}}"""
        val script = ShopTalkProtocol.injection(hostile)
        assertTrue(script.startsWith("window.__shoptalkHost && window.__shoptalkHost("))
        // The payload must round-trip as a single JS string literal: no raw
        // quotes or line separators may survive unescaped.
        val literal = script.removePrefix("window.__shoptalkHost && window.__shoptalkHost(")
            .removeSuffix(");")
        assertTrue(literal.first() == '"' && literal.last() == '"')
        val body = literal.substring(1, literal.length - 1)
        assertFalse(body.contains('\n'))
        assertFalse(Regex("(?<!\\\\)\"").containsMatchIn(body))
    }

    // ── inbound ──────────────────────────────────────────────────────────────

    @Test
    fun `known messages parse to their events`() {
        assertEquals(Inbound.Ready, ShopTalkProtocol.parse("""{"type":"ivy:ready"}"""))
        assertEquals(Inbound.CloseRequest, ShopTalkProtocol.parse("""{"type":"ivy:close-request"}"""))
        assertEquals(
            Inbound.Identified(true),
            ShopTalkProtocol.parse("""{"type":"ivy:event","event":"identified","ok":true}"""),
        )
        assertEquals(
            Inbound.Identified(false),
            ShopTalkProtocol.parse("""{"type":"ivy:event","event":"identified","ok":false}"""),
        )
    }

    @Test
    fun `unknown types are tolerated and malformed input is ignored`() {
        // Forward compatibility: an old AAR must survive new widget messages.
        assertEquals(Inbound.Unknown, ShopTalkProtocol.parse("""{"type":"ivy:something-new"}"""))
        assertEquals(Inbound.Unknown, ShopTalkProtocol.parse("""{"type":"ivy:event","event":"other"}"""))
        assertNull(ShopTalkProtocol.parse("not json at all"))
        assertNull(ShopTalkProtocol.parse(""))
    }

    // ── listener isolation ───────────────────────────────────────────────────

    @Test
    fun `a throwing listener is contained and reported`() {
        var caught: Throwable? = null
        val listener = object : ShopTalkListener {
            override fun onCloseRequest() = error("host bug")
        }
        ShopTalkProtocol.dispatchSafely(listener, Inbound.CloseRequest) { caught = it }
        assertEquals("host bug", caught?.message)
    }

    @Test
    fun `dispatch routes each event to its callback`() {
        val calls = mutableListOf<String>()
        val listener = object : ShopTalkListener {
            override fun onReady() { calls += "ready" }
            override fun onCloseRequest() { calls += "close" }
            override fun onIdentified(ok: Boolean) { calls += "identified:$ok" }
        }
        val fail: (Throwable) -> Unit = { throw AssertionError(it) }
        ShopTalkProtocol.dispatchSafely(listener, Inbound.Ready, fail)
        ShopTalkProtocol.dispatchSafely(listener, Inbound.Identified(false), fail)
        ShopTalkProtocol.dispatchSafely(listener, Inbound.CloseRequest, fail)
        ShopTalkProtocol.dispatchSafely(listener, Inbound.Unknown, fail)
        ShopTalkProtocol.dispatchSafely(null, Inbound.Ready, fail)
        assertEquals(listOf("ready", "identified:false", "close"), calls)
    }

    // ── 0.2.0 outbound ───────────────────────────────────────────────────────

    @Test
    fun `settings, end and back commands carry only type and action`() {
        for ((json, action) in listOf(
            ShopTalkProtocol.settingsJson() to "settings",
            ShopTalkProtocol.endJson() to "end",
            ShopTalkProtocol.backJson() to "back",
        )) {
            val o = JSONObject(json)
            assertEquals("ivy:command", o.getString("type"))
            assertEquals(action, o.getString("action"))
            assertEquals(2, o.length())
        }
    }

    @Test
    fun `context command carries screen and only the optionals that are set`() {
        val full = JSONObject(
            ShopTalkProtocol.contextJson(
                ShopTalkContext(screen = "bookings", ref = "#G2J-8841", label = "Booking #G2J-8841", prefill = "No-show"),
            ),
        )
        assertEquals("ivy:command", full.getString("type"))
        assertEquals("context", full.getString("action"))
        val ctx = full.getJSONObject("context")
        assertEquals("bookings", ctx.getString("screen"))
        assertEquals("#G2J-8841", ctx.getString("ref"))
        assertEquals("Booking #G2J-8841", ctx.getString("label"))
        assertEquals("No-show", ctx.getString("prefill"))

        val minimal = JSONObject(ShopTalkProtocol.contextJson(ShopTalkContext(screen = "home"))).getJSONObject("context")
        assertEquals(1, minimal.length())
        assertFalse(minimal.has("ref"))
        assertFalse(minimal.has("label"))
        assertFalse(minimal.has("prefill"))

        val partial = JSONObject(
            ShopTalkProtocol.contextJson(ShopTalkContext(screen = "s", label = "L", ref = "  ", prefill = "")),
        ).getJSONObject("context")
        assertEquals(2, partial.length())
        assertEquals("L", partial.getString("label"))
    }

    @Test
    fun `null context is an explicit JSON null that clears the chip`() {
        val o = JSONObject(ShopTalkProtocol.contextJson(null))
        assertEquals("context", o.getString("action"))
        assertTrue(o.has("context"))
        assertTrue(o.isNull("context"))
    }

    @Test
    fun `context text is data - quotes and newlines cannot break the injection`() {
        val label = "a'b\"c\nd"
        val json = ShopTalkProtocol.contextJson(ShopTalkContext("s", label = label, prefill = "</script>"))
        val script = ShopTalkProtocol.injection(json)
        assertFalse(script.contains('\n'))
        assertFalse(script.contains("</script>"))
        // Round trip: the literal decodes back to exactly the message we built.
        val literal = script.removePrefix("window.__shoptalkHost && window.__shoptalkHost(").removeSuffix(");")
        val decoded = JSONObject("{\"v\":$literal}").getString("v")
        assertEquals(label, JSONObject(decoded).getJSONObject("context").getString("label"))
    }

    // ── 0.2.0 inbound ────────────────────────────────────────────────────────

    @Test
    fun `identity-expired and back events parse`() {
        assertEquals(
            Inbound.IdentityExpired,
            ShopTalkProtocol.parse("""{"type":"ivy:event","event":"identity-expired"}"""),
        )
        assertEquals(
            Inbound.Back(true),
            ShopTalkProtocol.parse("""{"type":"ivy:event","event":"back","handled":true}"""),
        )
        assertEquals(
            Inbound.Back(false),
            ShopTalkProtocol.parse("""{"type":"ivy:event","event":"back","handled":false}"""),
        )
        // No answer payload = not handled (SDK then closes).
        assertEquals(Inbound.Back(false), ShopTalkProtocol.parse("""{"type":"ivy:event","event":"back"}"""))
    }

    @Test
    fun `open-url parses with and without mode`() {
        assertEquals(
            Inbound.OpenUrl("https://www.go2joy.vn/hotel/1", "external"),
            ShopTalkProtocol.parse("""{"type":"ivy:open-url","url":"https://www.go2joy.vn/hotel/1","mode":"external"}"""),
        )
        assertEquals(
            Inbound.OpenUrl("https://x.example/", null),
            ShopTalkProtocol.parse("""{"type":"ivy:open-url","url":"https://x.example/"}"""),
        )
        // A known message with no usable url is malformed, not silently Unknown.
        assertNull(ShopTalkProtocol.parse("""{"type":"ivy:open-url"}"""))
        assertNull(ShopTalkProtocol.parse("""{"type":"ivy:open-url","url":""}"""))
        assertNull(ShopTalkProtocol.parse("""{"type":"ivy:open-url","url":5}"""))
    }

    @Test
    fun `unread parses numbers, numeric strings and clamps negatives`() {
        assertEquals(Inbound.Unread(3), ShopTalkProtocol.parse("""{"type":"ivy:unread","count":3}"""))
        assertEquals(Inbound.Unread(0), ShopTalkProtocol.parse("""{"type":"ivy:unread","count":0}"""))
        assertEquals(Inbound.Unread(7), ShopTalkProtocol.parse("""{"type":"ivy:unread","count":"7"}"""))
        assertEquals(Inbound.Unread(0), ShopTalkProtocol.parse("""{"type":"ivy:unread","count":-4}"""))
        assertNull(ShopTalkProtocol.parse("""{"type":"ivy:unread"}"""))
        assertNull(ShopTalkProtocol.parse("""{"type":"ivy:unread","count":"many"}"""))
    }

    @Test
    fun `non-ivy json is unknown not an error`() {
        assertEquals(Inbound.Unknown, ShopTalkProtocol.parse("""{"foo":1}"""))
        assertEquals(Inbound.Unknown, ShopTalkProtocol.parse("""{"type":5}"""))
        assertEquals(Inbound.Unknown, ShopTalkProtocol.parse("""{"type":"ivy:event"}"""))
    }

    // ── dispatch of the new events ───────────────────────────────────────────

    @Test
    fun `dispatch routes identity-expired and unread, and leaves back and open-url to the fragment`() {
        val calls = mutableListOf<String>()
        val listener = object : ShopTalkListener {
            override fun onCloseRequest() { calls += "close" }
            override fun onIdentityExpired() { calls += "expired" }
            override fun onUnread(count: Int) { calls += "unread:$count" }
        }
        val fail: (Throwable) -> Unit = { throw AssertionError(it) }
        ShopTalkProtocol.dispatchSafely(listener, Inbound.IdentityExpired, fail)
        ShopTalkProtocol.dispatchSafely(listener, Inbound.Unread(5), fail)
        ShopTalkProtocol.dispatchSafely(listener, Inbound.Back(false), fail)
        ShopTalkProtocol.dispatchSafely(listener, Inbound.OpenUrl("https://x.example/", null), fail)
        assertEquals(listOf("expired", "unread:5"), calls)
    }

    @Test
    fun `guard returns the fallback and reports when host code throws`() {
        var reported: Throwable? = null
        val result = ShopTalkProtocol.guard(false, { reported = it }) { error("boom") }
        assertFalse(result)
        assertEquals("boom", reported?.message)
        assertTrue(ShopTalkProtocol.guard(false, { throw AssertionError() }) { true })
    }

    @Test
    fun `a throwing listener is contained for every new callback`() {
        val listener = object : ShopTalkListener {
            override fun onCloseRequest() = error("close")
            override fun onIdentityExpired() = error("expired")
            override fun onUnread(count: Int) = error("unread")
        }
        val seen = mutableListOf<String?>()
        ShopTalkProtocol.dispatchSafely(listener, Inbound.IdentityExpired) { seen += it.message }
        ShopTalkProtocol.dispatchSafely(listener, Inbound.Unread(1)) { seen += it.message }
        assertEquals(listOf("expired", "unread"), seen)
    }

    @Test
    fun `error types are plain values`() {
        val cause = IllegalStateException("x")
        assertSame(cause, ShopTalkError.IdentityProviderFailed(cause).cause)
        assertEquals(
            ShopTalkError.LoadFailed(-2, "net::ERR_NAME_NOT_RESOLVED"),
            ShopTalkError.LoadFailed(-2, "net::ERR_NAME_NOT_RESOLVED"),
        )
        assertEquals(ShopTalkError.LoadTimeout, ShopTalkError.LoadTimeout)
    }
}
