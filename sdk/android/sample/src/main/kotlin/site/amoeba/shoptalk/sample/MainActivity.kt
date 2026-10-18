package site.amoeba.shoptalk.sample

import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Bundle
import android.os.StrictMode
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.TextView
import android.widget.Toast
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.commit
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import site.amoeba.shoptalk.ShopTalkChatFragment
import site.amoeba.shoptalk.ShopTalkConfig
import site.amoeba.shoptalk.ShopTalkContext
import site.amoeba.shoptalk.ShopTalkError
import site.amoeba.shoptalk.ShopTalkHeader
import site.amoeba.shoptalk.ShopTalkIdentityProvider
import site.amoeba.shoptalk.ShopTalkListener

/**
 * Test rig that mimics how the Go2Joy app embeds the chat: an identity provider backed by
 * a (fake) backend, an optional NATIVE header drawn by the app, a "from a booking" context
 * button, error reporting, and back handling. Not a deliverable; it exists so the AAR can
 * be verified on a device against staging.
 *
 * Every value is overridable from adb, e.g.
 *   adb shell am start -n site.amoeba.shoptalk.sample/.MainActivity \
 *     -e widget_url https://shoptalk.amoeba.site/widget/ -e shop https://www.go2joy.vn \
 *     -e agent hotel-admin -e locale vi -e header native -e hotline "1900 638 838"
 * Local widget on the emulator: -e widget_url http://10.0.2.2:5174/ --ez insecure true
 */
class MainActivity : FragmentActivity() {

    private lateinit var backend: FakeBackend
    private var manualIdentifyDone = false

    override fun onCreate(savedInstanceState: Bundle?) {
        // Many host apps run StrictMode in debug builds, some with penaltyDeath. The SDK must not touch the disk
        // or the network on the main thread, so the sample turns it on: a violation names the SDK frame in logcat
        // (tag StrictMode) instead of showing up later as a freeze on a slow phone.
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            StrictMode.setThreadPolicy(StrictMode.ThreadPolicy.Builder().detectAll().penaltyLog().build())
        }
        super.onCreate(savedInstanceState)
        backend = FakeBackend(intent)

        val header = when (intent.getStringExtra("header")?.lowercase()) {
            "native" -> ShopTalkHeader.NATIVE
            "widget" -> ShopTalkHeader.WIDGET
            else -> null // not set: the tenant's admin console decides
        }

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }
        if (header == ShopTalkHeader.NATIVE) column.addView(nativeToolbar())
        val bar = contextBar()
        column.addView(bar)
        // Edge-to-edge on target 35: this bar sits at the top, so it clears the status bar itself.
        // The SDK fragment below only pads for what still overlaps IT.
        ViewCompat.setOnApplyWindowInsetsListener(bar) { v, insets ->
            v.updatePadding(top = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top)
            insets
        }
        column.addView(
            FrameLayout(this).apply { id = CONTAINER_ID },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f),
        )
        setContentView(column)

        if (savedInstanceState == null) {
            val config = ShopTalkConfig(
                widgetUrl = intent.getStringExtra("widget_url") ?: DEFAULT_WIDGET_URL,
                shop = intent.getStringExtra("shop") ?: DEFAULT_SHOP,
                locale = intent.getStringExtra("locale") ?: "vi",
                agent = intent.getStringExtra("agent") ?: DEFAULT_AGENT,
                accessKey = intent.getStringExtra("access"),
                header = header,
                errorHotline = intent.getStringExtra("hotline"),
                allowInsecureUrl = intent.getBooleanExtra("insecure", false),
            )
            supportFragmentManager.commit {
                replace(CONTAINER_ID, ShopTalkChatFragment.newInstance(config), CHAT_TAG)
            }
        }
        attachHostCallbacks()
    }

    override fun onResumeFragments() {
        super.onResumeFragments()
        // Listener and provider are plain fields, so re-attach after a configuration change.
        attachHostCallbacks()
    }

    private fun attachHostCallbacks() {
        chat()?.apply {
            listener = hostListener
            if (intent.getBooleanExtra("manual_identify", false)) {
                // Verification switch: the one-shot identify() path, issued before the widget is ready.
                if (!manualIdentifyDone) {
                    manualIdentifyDone = true
                    lifecycleScope.launch { backend.sharpTalkIdentity()?.let { identify(it) } }
                }
            } else {
                // Asked when the widget is ready, on every reload, and on identity-expired.
                identityProvider = ShopTalkIdentityProvider { backend.sharpTalkIdentity() }
            }
        }
    }

    private fun chat(): ShopTalkChatFragment? =
        supportFragmentManager.findFragmentByTag(CHAT_TAG) as? ShopTalkChatFragment

    // ── host UI ──────────────────────────────────────────────────────────────

    /** What the app draws itself when header = NATIVE: back, title, and a menu driving widget commands. */
    private fun nativeToolbar(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Color.parseColor("#F3F4F6"))
        addView(Button(context).apply {
            text = "←"
            setOnClickListener { onBackPressedDispatcher.onBackPressed() } // same path as the system back
        })
        addView(
            TextView(context).apply { text = "Go2Joy Support"; textSize = 16f },
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
        )
        addView(Button(context).apply {
            text = "⋮"
            setOnClickListener { showMenu(this) }
        })
    }

    private fun showMenu(anchor: View) {
        PopupMenu(this, anchor).apply {
            menu.add("Tiếng Việt").setOnMenuItemClickListener { chat()?.setLocale("vi"); true }
            menu.add("English").setOnMenuItemClickListener { chat()?.setLocale("en"); true }
            menu.add("한국어").setOnMenuItemClickListener { chat()?.setLocale("ko"); true }
            menu.add("Settings").setOnMenuItemClickListener { chat()?.openSettings(); true }
            menu.add("End conversation").setOnMenuItemClickListener { chat()?.endConversation(); true }
            menu.add("Reload").setOnMenuItemClickListener { chat()?.reload(); true }
            show()
        }
    }

    /** Pretend the user came from the booking screen. */
    private fun contextBar(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        addView(Button(context).apply {
            text = "Context: booking"
            setOnClickListener {
                chat()?.setContext(
                    ShopTalkContext(
                        screen = "bookings",
                        ref = "#G2J-8841",
                        label = "Booking #G2J-8841",
                        prefill = "Guest did not show up, I need to report a no-show",
                    ),
                )
            }
        })
        addView(Button(context).apply {
            text = "Clear context"
            setOnClickListener { chat()?.setContext(null) }
        })
        addView(Button(context).apply {
            text = "Logout"
            setOnClickListener { chat()?.logout() }
        })
    }

    // ── SDK callbacks ────────────────────────────────────────────────────────

    private val hostListener = object : ShopTalkListener {
        override fun onCloseRequest() {
            Log.i(TAG, "close-request, finishing")
            finish()
        }

        override fun onReady() {
            Log.i(TAG, "widget ready (identity requests so far: ${backend.calls})")
        }

        override fun onIdentified(ok: Boolean) {
            Log.i(TAG, "identified ok=$ok")
        }

        override fun onIdentityExpired() {
            Log.i(TAG, "identity expired; SDK is asking the provider again")
        }

        override fun onUnread(count: Int) {
            Log.i(TAG, "unread=$count") // a real app would badge its menu entry here
        }

        override fun onError(error: ShopTalkError) {
            // Never log identity or message content; the error type alone is enough here.
            Log.w(TAG, "error: ${error::class.simpleName}")
            if (error is ShopTalkError.IdentityProviderFailed) {
                Toast.makeText(this@MainActivity, "Identity unavailable, continuing as guest", Toast.LENGTH_SHORT).show()
            }
        }
    }

    companion object {
        private const val TAG = "ShopTalkSample"
        private const val CONTAINER_ID = 0x0F0F01
        private const val CHAT_TAG = "shoptalk-chat"

        /** Staging by default. */
        private const val DEFAULT_WIDGET_URL = "https://shoptalk.amoeba.site/widget/"

        /** Tenant lookup key (tenants.shop_domain), not a domain of the app. */
        private const val DEFAULT_SHOP = "https://www.go2joy.vn"
        private const val DEFAULT_AGENT = "hotel-admin"
    }
}
