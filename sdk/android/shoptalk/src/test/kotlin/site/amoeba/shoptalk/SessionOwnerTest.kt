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

    private fun owner(store: MemoryStore = MemoryStore()) = SessionOwner(store) to store

    @Test
    fun `the first identity on a device needs no reset`() {
        val (o, _) = owner()
        assertEquals(Step.KEEP, o.onIdentity(scope, "alice"))
    }

    @Test
    fun `the same user coming back keeps the session`() {
        val (o, _) = owner()
        o.onIdentity(scope, "alice")
        assertEquals(Step.KEEP, o.onIdentity(scope, "alice"))
        assertEquals(Step.KEEP, o.onIdentity(scope, "alice"))
    }

    @Test
    fun `a different user must drop the previous session first`() {
        val (o, _) = owner()
        o.onIdentity(scope, "alice")
        assertEquals(Step.LOGOUT_FIRST, o.onIdentity(scope, "bob"))
        // and Bob is the owner now
        assertEquals(Step.KEEP, o.onIdentity(scope, "bob"))
    }

    @Test
    fun `signed out after a user must drop the session, signed out again must not`() {
        val (o, store) = owner()
        o.onIdentity(scope, "alice")
        assertEquals(Step.LOGOUT_FIRST, o.onIdentity(scope, null))
        assertTrue(store.data.isEmpty())
        assertEquals(Step.KEEP, o.onIdentity(scope, null))
    }

    @Test
    fun `a guest who never identified is left alone`() {
        val (o, _) = owner()
        assertEquals(Step.KEEP, o.onIdentity(scope, null))
    }

    @Test
    fun `a guest who then signs in keeps the conversation`() {
        val (o, _) = owner()
        o.onIdentity(scope, null)
        assertEquals(Step.KEEP, o.onIdentity(scope, "alice"))
    }

    @Test
    fun `after the host logged out itself the next user needs no second reset`() {
        val (o, _) = owner()
        o.onIdentity(scope, "alice")
        o.onLogout(scope)
        assertEquals(Step.KEEP, o.onIdentity(scope, "bob"))
    }

    @Test
    fun `owners are tracked per widget and shop`() {
        val (o, _) = owner()
        val other = "https://other.example.com/widget|https://shop.example.com"
        o.onIdentity(scope, "alice")
        assertEquals(Step.KEEP, o.onIdentity(other, "bob"))
        assertEquals(Step.LOGOUT_FIRST, o.onIdentity(scope, "bob"))
    }

    @Test
    fun `the store never holds the raw user id`() {
        val (o, store) = owner()
        o.onIdentity(scope, "alice@example.com")
        val stored = store.data.values.single()
        assertFalse(stored.contains("alice"))
        assertEquals(64, stored.length)
        assertTrue(stored.all { it in '0'..'9' || it in 'a'..'f' })
    }

    @Test
    fun `fingerprints are stable and differ per user`() {
        assertEquals(SessionOwner.fingerprint("42"), SessionOwner.fingerprint("42"))
        assertNotEquals(SessionOwner.fingerprint("42"), SessionOwner.fingerprint("43"))
        assertNull(MemoryStore().read("owner|x"))
    }
}
