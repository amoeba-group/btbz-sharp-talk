package site.amoeba.shoptalk.compose

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
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
