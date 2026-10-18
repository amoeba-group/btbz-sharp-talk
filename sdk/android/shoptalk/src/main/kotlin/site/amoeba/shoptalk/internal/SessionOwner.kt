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
 *
 * The stored value must never say "this session is NOT X's" while it still is. So it only ever moves
 * to a user's fingerprint AFTER the widget confirmed that identify, and in between it holds [RESET],
 * which means "owner unknown, drop the session before the next identify". A crash, a lost command or
 * a failed identify therefore costs at most one unnecessary logout, never a leak.
 */
internal class SessionOwner(private val store: Store) {

    interface Store {
        fun read(key: String): String?
        fun write(key: String, value: String?)
    }

    enum class Step {
        /** The WebView session belongs to this user, or to nobody: nothing to reset. */
        KEEP,

        /** The WebView session may belong to someone else: reset it to a guest before going on. */
        LOGOUT_FIRST,
    }

    /**
     * Call before delivering an identity ([userId]), or before acting on "nobody is signed in" (null).
     * Says whether the previous session must be dropped first and, when anything is about to change,
     * parks the stored owner on [RESET] until [committed] says it settled.
     */
    fun beforeIdentify(scope: String, userId: String?): Step {
        val key = key(scope)
        val previous = store.read(key)
        if (userId == null) {
            if (previous == null) return Step.KEEP
            store.write(key, RESET)
            return Step.LOGOUT_FIRST
        }
        if (previous == fingerprint(userId)) return Step.KEEP
        store.write(key, RESET)
        return if (previous == null) Step.KEEP else Step.LOGOUT_FIRST
    }

    /**
     * The new state is real: the widget confirmed the identify of [userId], or (null) the logout was
     * dispatched so the session is a guest's now.
     */
    fun committed(scope: String, userId: String?) = store.write(key(scope), userId?.let(::fingerprint))

    /** The host asked for the logout itself and it went out: the session is a guest's now. */
    fun loggedOut(scope: String) = committed(scope, null)

    /** The host asked for a logout that could not be sent yet: remember that the owner is unknown. */
    fun logoutPending(scope: String) = store.write(key(scope), RESET)

    private fun key(scope: String) = "owner|$scope"

    companion object {
        /** Cannot collide with a fingerprint (those are 64 hex characters). */
        const val RESET = "reset"

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

    // commit(), not apply(): a write that is still in memory when the process dies is the exact
    // failure this class exists to survive. One tiny file, written rarely.
    override fun write(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.commit()
    }
}
