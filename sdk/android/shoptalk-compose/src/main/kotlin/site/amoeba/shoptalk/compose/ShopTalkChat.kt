package site.amoeba.shoptalk.compose

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.fragment.app.FragmentActivity
import androidx.fragment.compose.AndroidFragment
import site.amoeba.shoptalk.ShopTalkChatFragment
import site.amoeba.shoptalk.ShopTalkConfig
import site.amoeba.shoptalk.ShopTalkIdentityProvider
import site.amoeba.shoptalk.ShopTalkListener

/**
 * The ShopTalk chat for Compose hosts: [ShopTalkChatFragment] inside `AndroidFragment`.
 * The host activity must be a `FragmentActivity` (`AppCompatActivity` is one).
 *
 * [config] is read once, when the fragment is created (it travels as fragment
 * arguments); [identityProvider] and [listener] are re-applied on every recomposition,
 * so lambdas capturing fresh state are safe.
 *
 * ```kotlin
 * ShopTalkChat(
 *     config = ShopTalkConfig(widgetUrl = "https://shoptalk.amoeba.site/widget/", shop = "https://www.go2joy.vn", agent = "hotel-admin"),
 *     identityProvider = ShopTalkIdentityProvider { api.sharpTalkIdentity() },
 *     listener = object : ShopTalkListener { override fun onCloseRequest() { navController.popBackStack() } },
 *     modifier = Modifier.fillMaxSize(),
 * )
 * ```
 * Imperative calls (`setContext`, `openSettings`, ...) need the fragment: capture it
 * from the `onFragment` callback.
 */
@Composable
fun ShopTalkChat(
    config: ShopTalkConfig,
    identityProvider: ShopTalkIdentityProvider?,
    listener: ShopTalkListener,
    modifier: Modifier = Modifier,
    onFragment: (ShopTalkChatFragment) -> Unit = {},
) {
    // Android Studio's @Preview has no Activity and cannot host a Fragment: draw nothing there
    // instead of failing the preview.
    if (LocalInspectionMode.current) return
    // The stock Android Studio Compose template is a plain ComponentActivity. AndroidFragment then
    // fails with a message about a View, which does not say what to change. Say it here, first.
    val host = LocalContext.current.findActivity()
    check(host is FragmentActivity) {
        "ShopTalkChat needs a FragmentActivity host (AppCompatActivity is one), but this screen runs in " +
            "${host?.javaClass?.name ?: "a context that is not an Activity"}. " +
            "Change the activity's superclass to AppCompatActivity or FragmentActivity (setContent { } works as before) " +
            "and give it an AppCompat theme. See the SDK guide, Compose section."
    }
    AndroidFragment<ShopTalkChatFragment>(
        modifier = modifier,
        arguments = ShopTalkChatFragment.createArguments(config),
        onUpdate = { fragment ->
            fragment.identityProvider = identityProvider
            fragment.listener = listener
            onFragment(fragment)
        },
    )
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
