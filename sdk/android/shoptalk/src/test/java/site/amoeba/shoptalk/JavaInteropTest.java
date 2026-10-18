package site.amoeba.shoptalk;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The public data classes have default arguments. Without @JvmOverloads a Java caller must pass
 * every parameter (found with a Java consumer app: `new ShopTalkConfig("url")` did not compile).
 */
public class JavaInteropTest {
    private static final String URL = "https://talk.example.com/widget/";

    @Test
    public void configNeedsOnlyTheWidgetUrl() {
        ShopTalkConfig config = new ShopTalkConfig(URL);
        assertEquals(URL, config.getWidgetUrl());
        assertNull(config.getShop());
        assertNull(config.getAgent());
        assertFalse(config.getAllowInsecureUrl());
    }

    @Test
    public void configAcceptsLeadingOptionalArguments() {
        ShopTalkConfig config = new ShopTalkConfig(URL, "https://www.go2joy.vn", "vi", "hotel-admin");
        assertEquals("https://www.go2joy.vn", config.getShop());
        assertEquals("vi", config.getLocale());
        assertEquals("hotel-admin", config.getAgent());
        assertTrue(config.getAttachments().getCamera());
    }

    @Test
    public void contextAndAttachmentsHaveShortConstructors() {
        ShopTalkContext context = new ShopTalkContext("bookings", "G2J-8841", "Booking #G2J-8841");
        assertEquals("bookings", context.getScreen());
        assertNull(context.getPrefill());
        assertTrue(new ShopTalkAttachments().getMultiple());
        assertFalse(new ShopTalkAttachments(false).getCamera());
    }
}
