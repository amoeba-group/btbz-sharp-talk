package site.amoeba.shoptalk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import site.amoeba.shoptalk.internal.WebViewVersion

class WebViewVersionTest {

    private fun ua(chrome: String) =
        "Mozilla/5.0 (Linux; Android 5.0.2; Android SDK built for x86_64 Build/LSY66K) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Version/4.0 Chrome/$chrome Mobile Safari/537.36"

    @Test
    fun `reads the major version from the user agents seen on devices`() {
        assertEquals(37, WebViewVersion.major(ua("37.0.0.0")))
        assertEquals(44, WebViewVersion.major(ua("44.0.2403.119")))
        assertEquals(124, WebViewVersion.major(ua("124.0.6367.219")))
    }

    @Test
    fun `unknown or odd user agents give no version`() {
        assertNull(WebViewVersion.major(null))
        assertNull(WebViewVersion.major(""))
        assertNull(WebViewVersion.major("Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/118.0"))
        assertNull(WebViewVersion.major("Chrome/ not a number"))
    }

    @Test
    fun `only a known version below the minimum counts as too old`() {
        assertTrue(WebViewVersion.isTooOldForWidget(ua("37.0.0.0")))
        assertTrue(WebViewVersion.isTooOldForWidget(ua("79.0.3945.136")))
        assertFalse(WebViewVersion.isTooOldForWidget(ua("80.0.3987.162")))
        assertFalse(WebViewVersion.isTooOldForWidget(ua("124.0.6367.219")))
    }

    @Test
    fun `an unknown engine is never blamed`() {
        assertFalse(WebViewVersion.isTooOldForWidget(null))
        assertFalse(WebViewVersion.isTooOldForWidget("some custom agent"))
    }
}
