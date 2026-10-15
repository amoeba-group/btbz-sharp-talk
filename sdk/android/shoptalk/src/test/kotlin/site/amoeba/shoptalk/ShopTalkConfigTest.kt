package site.amoeba.shoptalk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShopTalkConfigTest {

    @Test
    fun `minimal config opens app mode with no launcher`() {
        val url = ShopTalkConfig(widgetUrl = "https://talk.example.com/widget/").launchUrl()
        assertEquals("https://talk.example.com/widget/?embed=1&mode=app", url)
    }

    @Test
    fun `all params are appended and encoded`() {
        val url = ShopTalkConfig(
            widgetUrl = "https://talk.example.com/widget", // no trailing slash
            shop = "go2joy.example.com",
            agent = "hotel concierge", // space must not survive raw
        ).launchUrl()
        assertEquals(
            "https://talk.example.com/widget/?embed=1&mode=app" +
                "&shop=go2joy.example.com&agent=hotel+concierge",
            url,
        )
    }

    @Test
    fun `locale never goes into the url - the widget does not read it there`() {
        val url = ShopTalkConfig(widgetUrl = "https://t.example/w", locale = "vi").launchUrl()
        assertFalse(url.contains("locale"))
    }

    @Test
    fun `blank optional params are omitted`() {
        val url = ShopTalkConfig(widgetUrl = "https://t.example/w", shop = "", agent = " ".trim()).launchUrl()
        assertEquals("https://t.example/w/?embed=1&mode=app", url)
    }

    @Test
    fun `widget urls stay in the webview and external ones do not`() {
        val config = ShopTalkConfig(widgetUrl = "https://talk.example.com/widget/")
        assertTrue(config.isWidgetUrl("https://talk.example.com/widget/?embed=1&mode=app"))
        assertTrue(config.isWidgetUrl("https://talk.example.com/widget"))
        assertTrue(config.isWidgetUrl("about:blank"))
        assertFalse(config.isWidgetUrl("https://shop.example.com/product/1"))
        assertFalse(config.isWidgetUrl("mailto:cs@example.com"))
    }

    // ── 0.2.0 parameters ─────────────────────────────────────────────────────

    @Test
    fun `access key, native header and shop-agent combine in a stable order`() {
        val url = ShopTalkConfig(
            widgetUrl = "https://shoptalk.amoeba.site/widget/",
            shop = "https://www.go2joy.vn",
            agent = "hotel-admin",
            accessKey = "k 1&x",
            header = ShopTalkHeader.NATIVE,
        ).launchUrl()
        assertEquals(
            "https://shoptalk.amoeba.site/widget/?embed=1&mode=app" +
                "&shop=https%3A%2F%2Fwww.go2joy.vn&agent=hotel-admin&access=k+1%26x&chrome=native",
            url,
        )
    }

    @Test
    fun `header null adds no chrome param, WIDGET forces the widget header, NATIVE the app header`() {
        val base = ShopTalkConfig(widgetUrl = "https://t.example/w")
        assertEquals("https://t.example/w/?embed=1&mode=app", base.launchUrl())
        assertNull(base.header)
        assertEquals(
            "https://t.example/w/?embed=1&mode=app&chrome=widget",
            base.copy(header = ShopTalkHeader.WIDGET).launchUrl(),
        )
        assertEquals(
            "https://t.example/w/?embed=1&mode=app&chrome=native",
            base.copy(header = ShopTalkHeader.NATIVE).launchUrl(),
        )
    }

    @Test
    fun `attachments, startTab, hotline and locale stay out of the url`() {
        val url = ShopTalkConfig(
            widgetUrl = "https://t.example/w",
            locale = "vi",
            startTab = ShopTalkTab.ORDERS,
            attachments = ShopTalkAttachments(camera = false, multiple = false),
            errorHotline = "1900 638 838",
        ).launchUrl()
        assertEquals("https://t.example/w/?embed=1&mode=app", url)
    }

    @Test
    fun `defaults - camera and multiple on, no insecure, no hotline`() {
        val c = ShopTalkConfig(widgetUrl = "https://t.example/w")
        assertTrue(c.attachments.camera)
        assertTrue(c.attachments.multiple)
        assertFalse(c.allowInsecureUrl)
        assertNull(c.errorHotline)
        assertNull(c.hotlineDialNumber())
    }

    // ── https enforcement ────────────────────────────────────────────────────

    @Test
    fun `plain http is rejected by default`() {
        assertThrows(IllegalArgumentException::class.java) {
            ShopTalkConfig(widgetUrl = "http://talk.example.com/widget/")
        }
        assertThrows(IllegalArgumentException::class.java) {
            ShopTalkConfig(widgetUrl = "http://10.0.2.2:5174/")
        }
        assertThrows(IllegalArgumentException::class.java) {
            ShopTalkConfig(widgetUrl = "http://localhost:5174/")
        }
    }

    @Test
    fun `allowInsecureUrl opens only local dev hosts`() {
        for (host in listOf("10.0.2.2:5174", "localhost:5174", "127.0.0.1:5174", "[::1]:5174")) {
            val c = ShopTalkConfig(widgetUrl = "http://$host/", allowInsecureUrl = true)
            assertEquals("http://$host/?embed=1&mode=app", c.launchUrl())
        }
        // A public host over http stays rejected even in debug mode.
        assertThrows(IllegalArgumentException::class.java) {
            ShopTalkConfig(widgetUrl = "http://talk.example.com/widget/", allowInsecureUrl = true)
        }
        // And https needs no flag.
        ShopTalkConfig(widgetUrl = "https://talk.example.com/widget/", allowInsecureUrl = true)
    }

    @Test
    fun `non-http schemes and malformed urls are rejected`() {
        for (bad in listOf("ftp://t.example/w", "javascript:alert(1)", "file:///sdcard/w", "talk.example.com/widget", "", "https://", "https:///x")) {
            assertThrows("should reject: $bad", IllegalArgumentException::class.java) {
                ShopTalkConfig(widgetUrl = bad, allowInsecureUrl = true)
            }
        }
    }

    // ── bridge origin gate ───────────────────────────────────────────────────

    @Test
    fun `bridge origin matches scheme host and port only`() {
        val c = ShopTalkConfig(widgetUrl = "https://talk.example.com/widget/")
        assertTrue(c.isWidgetOrigin("https://talk.example.com/widget/?embed=1"))
        assertTrue(c.isWidgetOrigin("https://TALK.example.com:443/other"))
        assertFalse(c.isWidgetOrigin("https://talk.example.com.evil.test/widget/"))
        assertFalse(c.isWidgetOrigin("https://evil.test/https://talk.example.com/widget/"))
        assertFalse(c.isWidgetOrigin("http://talk.example.com/widget/"))
        assertFalse(c.isWidgetOrigin("https://talk.example.com:8443/widget/"))
        assertFalse(c.isWidgetOrigin("about:blank"))
        assertFalse(c.isWidgetOrigin(null))
        assertFalse(c.isWidgetOrigin(""))
    }

    @Test
    fun `hotline keeps only dialable characters`() {
        val c = ShopTalkConfig(widgetUrl = "https://t.example/w", errorHotline = "Hotline: +84 1900-638.838 ")
        assertEquals("+841900638838", c.hotlineDialNumber())
        assertNull(c.copy(errorHotline = "call us").hotlineDialNumber())
    }
}
