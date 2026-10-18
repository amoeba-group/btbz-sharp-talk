package site.amoeba.shoptalk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import site.amoeba.shoptalk.internal.SessionOwner
import site.amoeba.shoptalk.internal.SessionOwner.Step

class SessionOwnerTest {

    private class MemoryStore : SessionOwner.Store {
        val data = mutableMapOf<String, String>()
        override fun read(key: String) = data[key]
        override fun write(key: String, value: String?) {
            if (value == null) data.remove(key) else data[key] = value
        }
    }

    private val scope = "https://talk.example.com/widget|https://www.go2joy.vn"
    private val store = MemoryStore()
    private val owner = SessionOwner(store)

    private fun stored() = store.data.values.singleOrNull()

    /** A full, uneventful sign-in: before, then the widget's confirmation. */
    private fun signIn(userId: String): Step {
        val step = owner.beforeIdentify(scope, userId)
        owner.committed(scope, userId)
        return step
    }

    @Test
    fun `the first identity on a device needs no reset`() {
        assertEquals(Step.KEEP, owner.beforeIdentify(scope, "alice"))
    }

    @Test
    fun `the same user coming back keeps the session and writes nothing`() {
        signIn("alice")
        val before = store.data.toMap()
        assertEquals(Step.KEEP, owner.beforeIdentify(scope, "alice"))
        assertEquals(before, store.data)
    }

    @Test
    fun `a different user must drop the previous session first`() {
        signIn("alice")
        assertEquals(Step.LOGOUT_FIRST, owner.beforeIdentify(scope, "bob"))
        owner.committed(scope, "bob")
        assertEquals(Step.KEEP, owner.beforeIdentify(scope, "bob"))
    }

    @Test
    fun `until the identify is confirmed the owner is parked on reset, never on the new user`() {
        signIn("alice")
        owner.beforeIdentify(scope, "bob")
        assertEquals(SessionOwner.RESET, stored())
        assertNotEquals(SessionOwner.fingerprint("bob"), stored())
    }

    @Test
    fun `a crash before the confirmation forces a logout for whoever comes next, even the same user`() {
        signIn("alice")
        owner.beforeIdentify(scope, "bob") // process dies here: no committed()
        assertEquals(Step.LOGOUT_FIRST, owner.beforeIdentify(scope, "bob"))
        assertEquals(Step.LOGOUT_FIRST, owner.beforeIdentify(scope, "carol"))
        assertEquals(Step.LOGOUT_FIRST, owner.beforeIdentify(scope, null))
    }

    @Test
    fun `a failed identify leaves reset in place so the next launch starts clean`() {
        owner.beforeIdentify(scope, "alice") // identify rejected: committed() is never called
        assertEquals(SessionOwner.RESET, stored())
        assertEquals(Step.LOGOUT_FIRST, owner.beforeIdentify(scope, "alice"))
    }

    @Test
    fun `a guest who then signs in keeps the conversation`() {
        assertEquals(Step.KEEP, owner.beforeIdentify(scope, null))
        assertEquals(Step.KEEP, owner.beforeIdentify(scope, "alice"))
    }

    @Test
    fun `signed out after a user drops the session, then signed out again does not`() {
        signIn("alice")
        assertEquals(Step.LOGOUT_FIRST, owner.beforeIdentify(scope, null))
        assertEquals(SessionOwner.RESET, stored())
        owner.committed(scope, null) // the logout went out
        assertTrue(store.data.isEmpty())
        assertEquals(Step.KEEP, owner.beforeIdentify(scope, null))
    }

    @Test
    fun `a logout that was never dispatched keeps reset so the next identify still resets`() {
        signIn("alice")
        owner.beforeIdentify(scope, null) // evaluate() refused: no committed(null)
        assertEquals(Step.LOGOUT_FIRST, owner.beforeIdentify(scope, "alice"))
    }

    @Test
    fun `a guest who never identified is left alone and nothing is stored`() {
        assertEquals(Step.KEEP, owner.beforeIdentify(scope, null))
        assertTrue(store.data.isEmpty())
    }

    @Test
    fun `after the host logged out itself the next user needs no second reset`() {
        signIn("alice")
        owner.loggedOut(scope)
        assertEquals(Step.KEEP, owner.beforeIdentify(scope, "bob"))
    }

    @Test
    fun `a manual logout that could not be sent yet marks the owner unknown`() {
        signIn("alice")
        owner.logoutPending(scope)
        assertEquals(Step.LOGOUT_FIRST, owner.beforeIdentify(scope, "alice"))
    }

    @Test
    fun `owners are tracked per widget and shop`() {
        val other = "https://other.example.com/widget|https://shop.example.com"
        signIn("alice")
        assertEquals(Step.KEEP, owner.beforeIdentify(other, "bob"))
        assertEquals(Step.LOGOUT_FIRST, owner.beforeIdentify(scope, "bob"))
    }

    @Test
    fun `the store never holds the raw user id`() {
        signIn("alice@example.com")
        val value = stored()!!
        assertFalse(value.contains("alice"))
        assertEquals(64, value.length)
        assertTrue(value.all { it in '0'..'9' || it in 'a'..'f' })
    }

    @Test
    fun `fingerprints are stable, differ per user, and never equal the reset marker`() {
        assertEquals(SessionOwner.fingerprint("42"), SessionOwner.fingerprint("42"))
        assertNotEquals(SessionOwner.fingerprint("42"), SessionOwner.fingerprint("43"))
        assertNotEquals(SessionOwner.RESET, SessionOwner.fingerprint("reset"))
        assertNull(MemoryStore().read("owner|x"))
    }
}
