package site.amoeba.shoptalk.sample

import android.content.Intent
import kotlinx.coroutines.delay
import org.json.JSONObject
import site.amoeba.shoptalk.ShopTalkIdentity

/**
 * Stand-in for the host app's own backend. In a real app this is an authenticated call
 * (`GET /api/sharptalk/identity`) and the server signs with the embed secret; the secret
 * must NEVER be in the app. Here the signed package arrives through adb extras instead,
 * so a device test can use a hash produced elsewhere:
 *
 * ```
 * adb shell am start -n site.amoeba.shoptalk.sample/.MainActivity \
 *   -e user_id 42 -e user_hash <hmac> -e attributes '{"hotel_id":"H1","role":"manager"}'
 * adb shell am start ... -e identity_json '{"userId":"42","hash":"...","claims":{...}}'
 * ```
 */
class FakeBackend(private val intent: Intent) {

    /** Simulates the network round trip and counts calls, so the log shows when the SDK asked. */
    var calls = 0
        private set

    suspend fun sharpTalkIdentity(): ShopTalkIdentity? {
        calls++
        android.util.Log.i("ShopTalkSample", "provider asked (#$calls)")
        delay(300)
        android.util.Log.i("ShopTalkSample", "provider answering (#$calls)")
        // Verification switch: the host's own backend is down (the SDK must change nothing).
        if (intent.getBooleanExtra("identity_fail", false)) error("simulated backend failure")
        intent.getStringExtra("identity_json")?.let { return ShopTalkIdentity.fromJson(it) }
        val userId = intent.getStringExtra("user_id") ?: return null // signed out: guest
        val hash = intent.getStringExtra("user_hash") ?: return null
        val attributes = intent.getStringExtra("attributes")?.let { raw ->
            val json = JSONObject(raw)
            json.keys().asSequence().associateWith { json.getString(it) }
        }
        return ShopTalkIdentity.of(userId = userId, hash = hash, attributes = attributes)
    }
}
