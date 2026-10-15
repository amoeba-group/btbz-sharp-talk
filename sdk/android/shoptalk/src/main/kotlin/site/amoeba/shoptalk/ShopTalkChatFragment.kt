package site.amoeba.shoptalk

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.res.Configuration
import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.core.view.updatePadding
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import java.io.File
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import site.amoeba.shoptalk.internal.AttachmentRules
import site.amoeba.shoptalk.internal.ConfigBundle
import site.amoeba.shoptalk.internal.ShopTalkBridge
import site.amoeba.shoptalk.internal.ShopTalkErrorView
import site.amoeba.shoptalk.internal.ShopTalkProtocol
import site.amoeba.shoptalk.internal.UrlPolicy

/**
 * The ShopTalk conversation, hosted in a WebView.
 *
 * The same widget the web SDK embeds, so a fix on the web reaches the app with
 * no second implementation. This fragment's whole job is what a WebView does
 * not do for free: identify the user, close the screen, let a photo be
 * attached, keep links out of the chat view, never show a white screen on a
 * load failure, and keep the input above the keyboard.
 *
 * ```kotlin
 * val chat = ShopTalkChatFragment.newInstance(ShopTalkConfig(widgetUrl = "…", shop = "…"))
 * chat.identityProvider = ShopTalkIdentityProvider { backend.signedIdentity() }
 * chat.listener = object : ShopTalkListener {
 *     override fun onCloseRequest() { parentFragmentManager.popBackStack() }
 * }
 * ```
 *
 * Threading: call the public methods on the main thread.
 */
class ShopTalkChatFragment : Fragment() {

    /** Host callbacks. Exceptions thrown here are logged, never propagated. */
    var listener: ShopTalkListener? = null

    /**
     * Asked for a fresh signed identity when the widget is ready, after every reload,
     * and on `identity-expired`. Setting it after the widget is already ready (and
     * none was set before) triggers one request right away.
     */
    var identityProvider: ShopTalkIdentityProvider? = null
        set(value) {
            val hadProvider = field != null
            field = value
            if (value != null && !hadProvider && widgetReady) requestIdentity()
        }

    private lateinit var config: ShopTalkConfig
    private var root: FrameLayout? = null
    private var webView: WebView? = null
    private var loadingView: ProgressBar? = null
    private var errorView: View? = null

    /**
     * True once the widget said `ivy:ready`. Before the page's JS module loads,
     * an injected call is a silent no-op, so commands wait here, mirroring the
     * 20-message queue the widget keeps for the opposite race.
     */
    private var widgetReady = false

    /** State re-applied on every ready (the widget forgets it on reload). Identity is NOT here by design. */
    private var lastLocaleJson: String? = null
    private var lastContextJson: String? = null

    /** Commands (and one-shot identify) issued before the widget was ready. */
    private val pending = ArrayDeque<String>()

    private var uiLocale: String? = null
    private var identityJob: Job? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private val loadTimeout = Runnable { if (!widgetReady) showError(ShopTalkError.LoadTimeout) }
    private var backAnswerTimeout: Runnable? = null

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var chooserDialog: AlertDialog? = null
    private var pendingCapture: Pair<File, Uri>? = null
    private var previousSoftInputMode: Int? = null

    private val backCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() = onBackPressedByUser()
    }

    private val filePicker =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            // A cancelled pick MUST still deliver null: a callback left hanging
            // makes every later file chooser silently refuse to open.
            resolveFileCallback(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data),
            )
        }

    private val cameraCapture =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val capture = pendingCapture
            pendingCapture = null
            if (capture != null && result.resultCode == android.app.Activity.RESULT_OK && capture.first.length() > 0) {
                resolveFileCallback(arrayOf(capture.second))
            } else {
                capture?.first?.delete()
                resolveFileCallback(null)
            }
        }

    // ── public control (safe to call at any time; queued until the widget is up) ──

    /**
     * Announce a signed identity ONCE. It is not re-sent when the widget reloads
     * (a cached signature may have expired): set [identityProvider] for that.
     */
    fun identify(identity: ShopTalkIdentity) = send(ShopTalkProtocol.identifyJson(identity))

    @Deprecated("Use identify(ShopTalkIdentity) or identityProvider", ReplaceWith("identify(user.toIdentity())"))
    @Suppress("DEPRECATION")
    fun identify(user: ShopTalkUser) = identify(user.toIdentity())

    fun open(tab: ShopTalkTab) = send(ShopTalkProtocol.openJson(tab.wire))

    /**
     * Switch the widget language. Sent as a bridge command (the widget reads no
     * `locale` URL parameter) and re-sent on every (re)load. Also localizes the
     * SDK's own native strings (attachment chooser, error screen).
     */
    fun setLocale(locale: String) {
        val code = ShopTalkProtocol.normalizeLocale(locale)
        uiLocale = code
        val json = ShopTalkProtocol.localeJson(code)
        lastLocaleJson = json
        if (widgetReady) evaluate(json)
    }

    /**
     * Drop the identity (visitor becomes a guest). After an account switch call this,
     * then [reload] (or [identify]) so the new user's identity is requested.
     */
    fun logout() {
        identityJob?.cancel()
        pending.removeAll { it.contains("ivy:identify") }
        send(ShopTalkProtocol.logoutJson())
    }

    /** Show or clear the "where in the app" chip. Re-applied after a reload. */
    fun setContext(context: ShopTalkContext?) {
        val json = ShopTalkProtocol.contextJson(context)
        lastContextJson = if (context == null) null else json
        if (widgetReady) evaluate(json)
    }

    /** Open the widget's preferences (language / privacy). */
    fun openSettings() = send(ShopTalkProtocol.settingsJson())

    /** End the conversation (same as the widget's own "end" button). */
    fun endConversation() = send(ShopTalkProtocol.endJson())

    /** Reload the widget; the identity provider is asked again once it is ready. */
    fun reload() {
        val web = webView ?: return
        hideError()
        resetForNewPage()
        loadingView?.isVisible = true
        web.loadUrl(config.launchUrl())
    }

    // ── lifecycle ────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        config = ConfigBundle.read(requireArguments())
        config.locale?.let {
            val code = ShopTalkProtocol.normalizeLocale(it)
            uiLocale = code
            lastLocaleJson = ShopTalkProtocol.localeJson(code)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        val context = requireContext()
        // Opaque white: the widget is forced light, so a dark host theme must not show through.
        val frame = FrameLayout(context).apply { setBackgroundColor(Color.WHITE) }
        root = frame

        val web = WebView(context).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            settings.javaScriptEnabled = true
            // The session token lives in localStorage; without this a returning
            // visitor loses their conversation on every open.
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            forceLight(this)
            addJavascriptInterface(ShopTalkBridge(::onBridgeMessage), JS_INTERFACE)
            webViewClient = ChatWebViewClient()
            webChromeClient = ChatWebChromeClient()
        }
        webView = web
        frame.addView(web)

        loadingView = ProgressBar(context).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER,
            )
        }
        frame.addView(loadingView)

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(config.launchUrl())
        }
        return frame
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        // The message input must rise with the keyboard. adjustResize covers
        // classic windows; the insets listener covers edge-to-edge (target 35).
        activity?.window?.let { window ->
            previousSoftInputMode = window.attributes.softInputMode
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        ViewCompat.setOnApplyWindowInsetsListener(view) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime(),
            )
            v.updatePadding(top = bars.top, bottom = bars.bottom)
            insets
        }
        // Removed automatically when the view lifecycle ends.
        requireActivity().onBackPressedDispatcher.addCallback(viewLifecycleOwner, backCallback)
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView?.saveState(outState)
    }

    override fun onDestroyView() {
        mainHandler.removeCallbacks(loadTimeout)
        cancelBackWait()
        identityJob?.cancel()
        identityJob = null
        // A dialog or file pick resolving after this view is gone would deliver into a
        // destroyed WebView: cancel it instead.
        chooserDialog?.dismiss()
        chooserDialog = null
        pendingCapture?.first?.delete()
        pendingCapture = null
        resolveFileCallback(null)
        previousSoftInputMode?.let { activity?.window?.setSoftInputMode(it) }
        previousSoftInputMode = null
        widgetReady = false
        webView?.let { web ->
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        }
        webView = null
        loadingView = null
        errorView = null
        root = null
        super.onDestroyView()
    }

    // ── bridge plumbing ──────────────────────────────────────────────────────

    /** Arrives on the WebView's JS thread. */
    private fun onBridgeMessage(json: String) {
        mainHandler.post {
            val web = webView ?: return@post
            // The interface is injected into whatever page the WebView shows; only
            // the widget's own origin may drive the SDK.
            if (!config.isWidgetOrigin(web.url)) {
                Log.w(TAG, "bridge message from a non-widget origin ignored")
                return@post
            }
            val inbound = ShopTalkProtocol.parse(json)
            if (inbound == null) {
                emitError(ShopTalkError.BridgeMalformed)
                return@post
            }
            when (inbound) {
                ShopTalkProtocol.Inbound.Ready -> onWidgetReady()
                ShopTalkProtocol.Inbound.IdentityExpired -> requestIdentity()
                is ShopTalkProtocol.Inbound.Back -> onBackAnswer(inbound.handled)
                is ShopTalkProtocol.Inbound.OpenUrl -> openExternal(inbound.url, fromWidget = true)
                else -> Unit
            }
            ShopTalkProtocol.dispatchSafely(listener, inbound) { t ->
                Log.w(TAG, "ShopTalkListener threw; ignored to protect the chat", t)
            }
        }
    }

    private fun onWidgetReady() {
        mainHandler.removeCallbacks(loadTimeout)
        hideError()
        widgetReady = true
        // Language first, then the app's standing state, then whatever the host
        // queued, then a FRESH identity: same order the host would have produced live.
        lastLocaleJson?.let(::evaluate)
        config.startTab?.let { evaluate(ShopTalkProtocol.openJson(it.wire)) }
        lastContextJson?.let(::evaluate)
        while (pending.isNotEmpty()) evaluate(pending.removeFirst())
        requestIdentity()
    }

    private fun requestIdentity() {
        val provider = identityProvider ?: return
        if (view == null) return
        identityJob?.cancel()
        identityJob = viewLifecycleOwner.lifecycleScope.launch {
            val identity = try {
                provider.identity()
            } catch (e: CancellationException) {
                throw e
            } catch (t: Throwable) {
                // The visitor continues as a guest; the host decides what to do about it.
                emitError(ShopTalkError.IdentityProviderFailed(t))
                null
            }
            // A reload while the provider was busy: that page will ask again.
            if (identity != null && widgetReady) evaluate(ShopTalkProtocol.identifyJson(identity))
        }
    }

    private fun send(json: String) {
        if (widgetReady && webView != null) {
            evaluate(json)
        } else {
            if (pending.size >= MAX_PENDING) pending.removeFirst()
            pending.addLast(json)
        }
    }

    private fun evaluate(json: String) {
        val web = webView ?: return
        // Never hand identity or commands to a page that is not the widget.
        if (!config.isWidgetOrigin(web.url)) return
        web.evaluateJavascript(ShopTalkProtocol.injection(json), null)
    }

    private fun emitError(error: ShopTalkError) {
        ShopTalkProtocol.guard(Unit, { Log.w(TAG, "ShopTalkListener.onError threw", it) }) {
            listener?.onError(error)
        }
    }

    private fun resetForNewPage() {
        widgetReady = false
        identityJob?.cancel()
        cancelBackWait()
    }

    // ── back ─────────────────────────────────────────────────────────────────

    private fun onBackPressedByUser() {
        // Nothing in the widget to answer (still loading, or the error screen is up):
        // back simply leaves the chat.
        if (!widgetReady || errorView != null) {
            closeFromBack()
            return
        }
        // A second press while the widget has not answered yet: stop waiting, leave.
        if (backAnswerTimeout != null) {
            cancelBackWait()
            closeFromBack()
            return
        }
        evaluate(ShopTalkProtocol.backJson())
        val timeout = Runnable {
            // A widget older than 0.2 never answers `back`: behave as before (close).
            backAnswerTimeout = null
            closeFromBack()
        }
        backAnswerTimeout = timeout
        mainHandler.postDelayed(timeout, BACK_ANSWER_TIMEOUT_MS)
    }

    private fun onBackAnswer(handled: Boolean) {
        if (backAnswerTimeout == null) return // unsolicited
        cancelBackWait()
        if (!handled) closeFromBack()
    }

    private fun cancelBackWait() {
        backAnswerTimeout?.let(mainHandler::removeCallbacks)
        backAnswerTimeout = null
    }

    private fun closeFromBack() {
        val l = listener
        if (l == null) {
            // No host listener to dismiss us: don't trap the user, let the system handle back.
            backCallback.isEnabled = false
            activity?.onBackPressedDispatcher?.onBackPressed()
            backCallback.isEnabled = true
        } else {
            ShopTalkProtocol.guard(Unit, { Log.w(TAG, "ShopTalkListener threw; ignored", it) }) {
                l.onCloseRequest()
            }
        }
    }

    // ── native error screen ──────────────────────────────────────────────────

    private fun showError(error: ShopTalkError) {
        val frame = root ?: return
        if (errorView != null) return // one screen, one report
        mainHandler.removeCallbacks(loadTimeout)
        loadingView?.isVisible = false
        val res = strings()
        val hotline = config.errorHotline?.takeIf { config.hotlineDialNumber() != null }
        val view = ShopTalkErrorView(
            context = frame.context,
            title = res.getString(R.string.shoptalk_error_title),
            message = res.getString(R.string.shoptalk_error_message),
            retryLabel = res.getString(R.string.shoptalk_error_retry),
            hotlineLabel = hotline?.let { res.getString(R.string.shoptalk_error_hotline, it) },
            onRetry = { reload() },
            onHotline = ::dialHotline,
        ).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        errorView = view
        frame.addView(view)
        emitError(error)
    }

    private fun hideError() {
        errorView?.let { (it.parent as? ViewGroup)?.removeView(it) }
        errorView = null
    }

    private fun dialHotline() {
        val number = config.hotlineDialNumber() ?: return
        try {
            startActivity(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null)))
        } catch (_: ActivityNotFoundException) {
            // No dialer (tablet / emulator): the number stays visible on screen.
        }
    }

    /** Native strings follow the widget locale the host chose, falling back to the device language. */
    private fun strings(): Resources {
        val ctx = requireContext()
        val code = uiLocale ?: return ctx.resources
        val cfg = Configuration(ctx.resources.configuration)
        cfg.setLocale(Locale.forLanguageTag(code))
        return ctx.createConfigurationContext(cfg).resources
    }

    // ── external links ───────────────────────────────────────────────────────

    /**
     * [fromWidget] = the widget asked via `ivy:open-url` (web links only); otherwise a
     * link tapped in the conversation (web, mail, phone). Other schemes are dropped:
     * `intent:`, `file:`, `content:` and friends must never be launched on a page's say-so.
     */
    private fun openExternal(url: String, fromWidget: Boolean) {
        val allowed = if (fromWidget) UrlPolicy.isOpenUrlAllowed(url) else UrlPolicy.isLinkAllowed(url)
        if (!allowed) {
            Log.w(TAG, "blocked external link with scheme ${UrlPolicy.scheme(url)}")
            return
        }
        val uri = Uri.parse(url)
        val handled = ShopTalkProtocol.guard(false, { Log.w(TAG, "ShopTalkListener threw; ignored", it) }) {
            listener?.onOpenUrl(uri) ?: false
        }
        if (handled) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            // Nothing handles it; swallowing beats navigating the chat away.
        }
    }

    // ── attachments ──────────────────────────────────────────────────────────

    private fun resolveFileCallback(uris: Array<Uri>?) {
        val callback = filePathCallback ?: return
        filePathCallback = null
        callback.onReceiveValue(uris)
    }

    private fun showAttachmentChooser(params: WebChromeClient.FileChooserParams?) {
        val ctx = context
        if (ctx == null || !isAdded) {
            resolveFileCallback(null)
            return
        }
        val res = strings()
        val multiple = AttachmentRules.allowMultiple(
            config.attachments.multiple,
            params?.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE,
        )
        val labels = mutableListOf<String>()
        val actions = mutableListOf<() -> Unit>()

        val captureAvailable = config.attachments.camera &&
            AttachmentRules.acceptsImages(params?.acceptTypes) &&
            Intent(MediaStore.ACTION_IMAGE_CAPTURE).resolveActivity(ctx.packageManager) != null
        if (captureAvailable) {
            labels += res.getString(R.string.shoptalk_attach_camera)
            actions += ::launchCamera
        }
        labels += res.getString(R.string.shoptalk_attach_gallery)
        actions += { launchGallery(multiple) }
        labels += res.getString(R.string.shoptalk_attach_files)
        actions += { launchFiles(params, multiple) }

        chooserDialog?.dismiss()
        chooserDialog = AlertDialog.Builder(ctx)
            .setTitle(res.getString(R.string.shoptalk_attach_title))
            .setItems(labels.toTypedArray()) { _, which ->
                chooserDialog = null
                actions[which]()
            }
            .setNegativeButton(res.getString(R.string.shoptalk_attach_cancel)) { d, _ -> d.cancel() }
            // Back / tap outside / Cancel: the WebView still needs its null.
            .setOnCancelListener {
                chooserDialog = null
                resolveFileCallback(null)
            }
            .create()
            .also { it.show() }
    }

    private fun launchPicker(intent: Intent) {
        try {
            filePicker.launch(intent)
        } catch (_: ActivityNotFoundException) {
            resolveFileCallback(null)
        } catch (_: SecurityException) {
            resolveFileCallback(null)
        }
    }

    private fun launchGallery(multiple: Boolean) {
        launchPicker(
            Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
            },
        )
    }

    private fun launchFiles(params: WebChromeClient.FileChooserParams?, multiple: Boolean) {
        val intent = params?.createIntent()
            ?: Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
        launchPicker(intent)
    }

    private fun launchCamera() {
        val ctx = context
        if (ctx == null) {
            resolveFileCallback(null)
            return
        }
        try {
            val dir = File(ctx.cacheDir, CAPTURE_DIR).apply { mkdirs() }
            // Captures live only until sent; sweep leftovers (e.g. a killed process) by age.
            val cutoff = System.currentTimeMillis() - CAPTURE_MAX_AGE_MS
            dir.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }

            val file = File.createTempFile("IMG_", ".jpg", dir)
            val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.shoptalk.fileprovider", file)
            pendingCapture?.first?.delete()
            pendingCapture = file to uri
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData = ClipData.newRawUri("shoptalk", uri)
            }
            cameraCapture.launch(intent)
        } catch (_: Exception) {
            // No camera app, no cache space, or the host manifest declares CAMERA without
            // holding it (the capture intent then throws SecurityException): the user
            // can still use the gallery, and the WebView gets its null.
            pendingCapture?.first?.delete()
            pendingCapture = null
            resolveFileCallback(null)
        }
    }

    // ── rendering ────────────────────────────────────────────────────────────

    /** The widget has no dark mode yet: stop the WebView from algorithmically darkening it (FR-M09). */
    private fun forceLight(web: WebView) {
        if (Build.VERSION.SDK_INT >= 33) {
            web.settings.isAlgorithmicDarkeningAllowed = false
        } else if (Build.VERSION.SDK_INT >= 29) {
            @Suppress("DEPRECATION")
            web.settings.forceDark = WebSettings.FORCE_DARK_OFF
        }
        if (Build.VERSION.SDK_INT >= 29) web.isForceDarkAllowed = false
    }

    private inner class ChatWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (config.isWidgetUrl(url)) return false
            // Links in a conversation open outside. Followed inside this WebView,
            // the customer would have no way back.
            openExternal(url, fromWidget = false)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            resetForNewPage() // a reload re-runs the ready handshake
            mainHandler.removeCallbacks(loadTimeout)
            if (config.isWidgetOrigin(url)) mainHandler.postDelayed(loadTimeout, LOAD_TIMEOUT_MS)
            super.onPageStarted(view, url, favicon)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (errorView == null) loadingView?.isVisible = false
            super.onPageFinished(view, url)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                showError(ShopTalkError.LoadFailed(error.errorCode, error.description?.toString().orEmpty()))
            }
        }

        override fun onReceivedHttpError(
            view: WebView,
            request: WebResourceRequest,
            errorResponse: WebResourceResponse,
        ) {
            if (request.isForMainFrame && errorResponse.statusCode >= 400) {
                showError(ShopTalkError.LoadFailed(errorResponse.statusCode, errorResponse.reasonPhrase.orEmpty()))
            }
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel() // never proceed past a certificate problem
            if (config.isWidgetOrigin(error.url)) {
                showError(ShopTalkError.LoadFailed(WebViewClient.ERROR_FAILED_SSL_HANDSHAKE, "SSL error"))
            }
        }
    }

    private inner class ChatWebChromeClient : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView?,
            callback: ValueCallback<Array<Uri>>?,
            params: FileChooserParams?,
        ): Boolean {
            // Without this override an Android WebView does nothing at all on a
            // file input: "the photo did not send" with no error anywhere.
            if (callback == null) return false
            resolveFileCallback(null) // supersede a chooser that never resolved
            chooserDialog?.dismiss()
            filePathCallback = callback
            showAttachmentChooser(params)
            return true
        }
    }

    companion object {
        private const val TAG = "ShopTalk"

        /** Fixed by the widget's host detection; renaming silently downgrades to "no host". */
        private const val JS_INTERFACE = "ShopTalkAndroid"

        /** Same depth as the widget's own pre-mount queue. */
        private const val MAX_PENDING = 20

        /** Without `ivy:ready` by then the native error screen replaces the blank page. */
        private const val LOAD_TIMEOUT_MS = 15_000L

        /** How long a back press waits for the widget's `back` answer before closing. */
        private const val BACK_ANSWER_TIMEOUT_MS = 500L

        private const val CAPTURE_DIR = "shoptalk_capture"
        private const val CAPTURE_MAX_AGE_MS = 24L * 60 * 60 * 1000

        /**
         * Fragment arguments for [config]: for hosts that instantiate the fragment
         * themselves (e.g. Compose `AndroidFragment`). Prefer [newInstance] otherwise.
         */
        @JvmStatic
        fun createArguments(config: ShopTalkConfig): Bundle = ConfigBundle.write(config)

        @JvmStatic
        fun newInstance(config: ShopTalkConfig): ShopTalkChatFragment =
            ShopTalkChatFragment().apply { arguments = createArguments(config) }
    }
}
