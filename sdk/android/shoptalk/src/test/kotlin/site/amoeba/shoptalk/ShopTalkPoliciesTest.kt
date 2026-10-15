package site.amoeba.shoptalk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import site.amoeba.shoptalk.internal.AttachmentRules
import site.amoeba.shoptalk.internal.UrlPolicy

class ShopTalkPoliciesTest {

    @Test
    fun `open-url from the widget allows web links only`() {
        assertTrue(UrlPolicy.isOpenUrlAllowed("https://www.go2joy.vn/x"))
        assertTrue(UrlPolicy.isOpenUrlAllowed("HTTP://example.com"))
        for (bad in listOf(
            "intent://scan/#Intent;scheme=zxing;end", "file:///sdcard/a", "content://x/y",
            "javascript:alert(1)", "tel:1900", "mailto:a@b.c", "market://details?id=x",
            " https://leading-space.example", "//example.com/x", "example.com", "",
        )) {
            assertFalse("should block: $bad", UrlPolicy.isOpenUrlAllowed(bad))
        }
    }

    @Test
    fun `tapped links also allow mail and phone but nothing else`() {
        assertTrue(UrlPolicy.isLinkAllowed("https://x.example"))
        assertTrue(UrlPolicy.isLinkAllowed("mailto:cs@example.com"))
        assertTrue(UrlPolicy.isLinkAllowed("tel:+841900638838"))
        assertFalse(UrlPolicy.isLinkAllowed("sms:123"))
        assertFalse(UrlPolicy.isLinkAllowed("intent://x#Intent;end"))
        assertFalse(UrlPolicy.isLinkAllowed("javascript:alert(1)"))
    }

    @Test
    fun `scheme is read strictly`() {
        assertEquals("https", UrlPolicy.scheme("https://a"))
        assertNull(UrlPolicy.scheme("no-scheme"))
        assertNull(UrlPolicy.scheme("1http://a"))
    }

    @Test
    fun `camera is offered only when the input accepts images`() {
        assertTrue(AttachmentRules.acceptsImages(null))
        assertTrue(AttachmentRules.acceptsImages(emptyArray()))
        assertTrue(AttachmentRules.acceptsImages(arrayOf("")))
        assertTrue(AttachmentRules.acceptsImages(arrayOf("image/*")))
        assertTrue(AttachmentRules.acceptsImages(arrayOf("*/*")))
        // The widget's real accept attribute arrives as one comma-joined string or split.
        val accept = ".jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.avif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
        assertTrue(AttachmentRules.acceptsImages(arrayOf(accept)))
        assertTrue(AttachmentRules.acceptsImages(accept.split(',').toTypedArray()))
        assertFalse(AttachmentRules.acceptsImages(arrayOf("application/pdf", ".docx")))
    }

    @Test
    fun `multiple needs both the host and the input`() {
        assertTrue(AttachmentRules.allowMultiple(true, true))
        assertFalse(AttachmentRules.allowMultiple(true, false))
        assertFalse(AttachmentRules.allowMultiple(false, true))
    }
}
