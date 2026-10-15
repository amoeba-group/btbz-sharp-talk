package site.amoeba.shoptalk.internal

import android.os.Bundle
import site.amoeba.shoptalk.ShopTalkAttachments
import site.amoeba.shoptalk.ShopTalkConfig
import site.amoeba.shoptalk.ShopTalkHeader
import site.amoeba.shoptalk.ShopTalkTab

/** Fragment-argument (de)serialisation of [ShopTalkConfig]; the fragment is recreated from this Bundle. */
internal object ConfigBundle {
    private const val WIDGET_URL = "shoptalk:widget_url"
    private const val SHOP = "shoptalk:shop"
    private const val LOCALE = "shoptalk:locale"
    private const val AGENT = "shoptalk:agent"
    private const val ACCESS = "shoptalk:access"
    private const val HEADER = "shoptalk:header"
    private const val START_TAB = "shoptalk:start_tab"
    private const val CAMERA = "shoptalk:camera"
    private const val MULTIPLE = "shoptalk:multiple"
    private const val HOTLINE = "shoptalk:hotline"
    private const val INSECURE = "shoptalk:insecure"

    fun write(config: ShopTalkConfig): Bundle = Bundle().apply {
        putString(WIDGET_URL, config.widgetUrl)
        putString(SHOP, config.shop)
        putString(LOCALE, config.locale)
        putString(AGENT, config.agent)
        putString(ACCESS, config.accessKey)
        putString(HEADER, config.header?.name)
        putString(START_TAB, config.startTab?.name)
        putBoolean(CAMERA, config.attachments.camera)
        putBoolean(MULTIPLE, config.attachments.multiple)
        putString(HOTLINE, config.errorHotline)
        putBoolean(INSECURE, config.allowInsecureUrl)
    }

    fun read(args: Bundle): ShopTalkConfig = ShopTalkConfig(
        widgetUrl = requireNotNull(args.getString(WIDGET_URL)) { "widgetUrl is required" },
        shop = args.getString(SHOP),
        locale = args.getString(LOCALE),
        agent = args.getString(AGENT),
        accessKey = args.getString(ACCESS),
        header = args.getString(HEADER)?.let { runCatching { ShopTalkHeader.valueOf(it) }.getOrNull() },
        startTab = args.getString(START_TAB)?.let { runCatching { ShopTalkTab.valueOf(it) }.getOrNull() },
        attachments = ShopTalkAttachments(
            camera = args.getBoolean(CAMERA, true),
            multiple = args.getBoolean(MULTIPLE, true),
        ),
        errorHotline = args.getString(HOTLINE),
        allowInsecureUrl = args.getBoolean(INSECURE, false),
    )
}
