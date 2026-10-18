package site.amoeba.shoptalk.internal

import android.content.Context
import java.security.MessageDigest

/**
 * Remembers WHOSE conversation the widget's WebView is holding.
 *
 * The WebView keeps the widget's chat session between app launches. The server binds that session
 * to whoever identifies on it, so if the host identifies another user (or nobody) without calling
 * `logout()` first, the new person lands in the previous person's thread. Seen on an emulator: user B
 * saw user A's messages. The host is told to call `logout()` when its user signs out, but that is
 * easy to miss, and a privacy leak is the wrong place to depend on it.
 *
 * So the SDK keeps a fingerprint (SHA-256, never the raw user id) of the last identified user, per
 * widget and shop, and asks for a logout whenever the next identity is different.
 */
internal class SessionOwner(private val store: Store) {

    interface Store {
        fun read(key: String): String?
        fun write(key: String, value: String?)
    }

    enum class Step {
        /** The WebView session belongs to this user, or to nobody: nothing to reset. */
        KEEP,

        /** The WebView session belongs to someone else: reset it to a guest before going on. */
        LOGOUT_FIRST,
    }

    /**
     * [userId] is the identity about to be delivered, or null when the host says nobody is signed in.
     * Records the new owner and says whether the old one's session must be dropped first.
     */
    fun onIdentity(scope: String, userId: String?): Step {
        val key = key(scope)
        val previous = store.read(key)
        val next = userId?.let(::fingerprint)
        store.write(key, next)
        return if (previous != null && previous != next) Step.LOGOUT_FIRST else Step.KEEP
    }

    /** The host logged the widget out itself: the session is a guest's now. */
    fun onLogout(scope: String) = store.write(key(scope), null)

    private fun key(scope: String) = "owner|$scope"

    companion object {
        /** Stable, one-way, 64 hex characters. */
        fun fingerprint(userId: String): String =
            MessageDigest.getInstance("SHA-256")
                .digest(userId.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
    }
}

/** App-private storage for [SessionOwner]. */
internal class PrefsSessionStore(context: Context) : SessionOwner.Store {
    private val prefs =
        context.applicationContext.getSharedPreferences("shoptalk_sdk_session", Context.MODE_PRIVATE)

    override fun read(key: String): String? = prefs.getString(key, null)

    override fun write(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
}
