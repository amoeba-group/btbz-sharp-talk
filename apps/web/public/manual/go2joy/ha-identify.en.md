# Hotel Admin sign-in integration — spec v1.4

> Sign-in integration spec v1.4 for the Go2Joy HA dev team (2026-10-24). Done means every item in the checklist at the top passes. Schedule and owners: [work request](work-request.en.html). For printing or sending: [PDF](ha-identify.en.pdf)


> When an HA staff member opens the widget while signed in, **the HA server signs the staff and hotel data**, and HA FE passes that package to the widget **unchanged**.
> SharpTalk verifies the signature, registers the hotel as a business customer and the staff member as a contact, continues conversations per hotel account, and routes to the team for the hotel's region.
> **In v1.4, HA does not calculate the region.** HA sends only the province number (`province_sn`). SharpTalk sets the name and region from the Go2Joy province list.

| Item | Details |
|---|---|
| To | Go2Joy Hotel Admin (HA) dev team (backend, FE) · Go2Joy PM |
| From | SharpTalk (Amoeba) |
| Date / version | 2026-10-24 · **v1.4** (v1.3 2026-10-22 · v1.0 PDF 2026-10-20 are obsolete) |
| Environments | HA UAT `https://go2joy-ha-uat.go2joy.io` ↔ SharpTalk staging `https://shoptalk.amoeba.site` · Production is the Go2Joy server `https://sharptalk.go2joy.vn` (install pending) |
| Related docs | [Work request](GUIDE-261023-Go2Joy-Work-Request.en.md) (WR numbers, schedule) · [v1.3](GUIDE-261022-Go2Joy-HA-Identify-v1.3.md) (previous spec) |
| Sample code | [sharptalk_identity.php](files/sharptalk_identity.php.txt) · [vectors.php](files/vectors.php.txt) (runs the test vectors) |

---

## ✅ What HA must do — checklist

**This checklist is the core of this document.** An item is done when its check passes.

### A. HA backend (WR-01 · WR-02) — Tue 10/27
- [ ] **A1. Keep the signing key (embed secret) only in HA server environment variables.** Do not put it in FE, the browser, the app, logs or documents. SharpTalk sends the staging value over a secure channel (on the day WR-02 is decided).
  Check: the secret string appears nowhere in the repository or bundles.
- [ ] **A2. Create an endpoint that can be called only with a signed-in session** (e.g. `GET /api/v1/staff/sharptalkIdentity`).
  Check: a call without sign-in returns 401.
- [ ] **A3. Read values from the HA session and DB.** Do not build them from values sent by the browser.
- [ ] **A4. `userId = "ha:" + userSn`.** Use the staff number, which never changes. Do not use the login ID (`go2joysupport` etc.).
- [ ] **A5. Exactly 4 attributes**: `hotel_id` · `hotel_name` · `province_sn` · `role`.
  - **Do not send keys outside this list**, such as `hotel_code`·`hotel_group_id`·`user_id`·`user_sn`·`district` (they are left out of the signature calculation, so you get 401).
  - Do not send `region`·`province` (name) either. During the transition period this is not 401, but `province_sn` takes priority. After the transition it becomes 401.
- [ ] **A6. `province_sn` = the Go2Joy `provinceSn` of the selected hotel** (Province Feed `sn`, numeric string, e.g. Hồ Chí Minh = `"1"`).
- [ ] **A7. `role` = the HA role code** (a value that does not depend on the UI language). Send SharpTalk the **code table** (code · Vietnamese/English display name).
- [ ] **A8. When "All hotels" is selected**, leave out `hotel_id` · `hotel_name` · `province_sn` and sign only `role`.
- [ ] **A9. Follow the normalization order**: **NFC → collapse whitespace (incl. NBSP) → trim → 120 chars (`mb_substr`)**. Requires the PHP `intl`·`mbstring` extensions.
- [ ] **A10. Leave out empty values entirely (drop the field)**. This applies to attributes and to `name` · `email` · `phone` (an empty `email` returns 400).
- [ ] **A11. `hash = hex(HMAC-SHA256(secret, signing string))`**. The signing string uses the format in 5.1 (keys in alphabetical order).
- [ ] **A12. Test vectors T1 ~ T6 all match** (5.4). Send the results to SharpTalk.
- [ ] **A13. Return the response package over HTTPS only to the signed-in session. Do not log it.**

### B. HA FE (WR-04) — Wed 10/28
- [ ] **B1. Do not build the package in the browser.** **Delete** the current `sharptalkSignIn` (built from profile values) and the initial value `hash: "testing"`.
- [ ] **B2. Take the A2 response and pass it to `SharpTalk.identify(response)` unchanged** (do not add or change keys).
- [ ] **B3. Call again on**: sign-in confirmed · page reload · **hotel selection change (incl. All hotels)** · HA language change.
- [ ] **B4. Call `SharpTalk.logout()` on**: sign-out button · **automatic sign-out on session/token expiry** · right before another account signs in · sign-out in another tab (`storage` event etc.).
- [ ] **B5. `locale`**: same as now, `localStorage.lang` → `vi`/`en`. Call `setLocale` when it changes.
- [ ] **B6. Allow the SharpTalk domain in CSP (`script-src` · `frame-src` · `connect-src`) and CORS.**
- [ ] **B7. Put the 3 SharpTalk domain uses** (`embed.js` src · `widgetUrl` · `ivy:event` origin check) **behind one environment setting** (so you change it once when moving to production).
  Check (all of B): DevTools › Network `POST …/public/embed/identify` **200** (`consentState: "granted"`), and the page receives `ivy:event` `identified {ok: true}`.

### C. Joint UAT check (WR-05) — 10/29 ~ 10/30
- [ ] **C1. All items in the section 8 checklist pass** (together with SharpTalk).
- [ ] **C2. Test accounts**: 1 `Quản lý` (multiple hotels) + 1 `Lễ tân` (1 hotel), including hotels in the north and the south (WR-14).

### D. Production deploy (WR-06) — before production UAT
- [ ] **D1. Apply the production embed secret.** It differs from staging (SharpTalk sends it over a secure channel).
- [ ] **D2. Switch to the production domain**: `https://sharptalk.go2joy.vn/widget/embed.js` · `widgetUrl` · origin check.
- [ ] **D3. Apply production CSP and CORS. Share the HA deploy schedule in advance.**
  Check: identify returns 200 on production HA. A package made with the staging secret returns 401 on production.

---

## v1.4 changes
| Item | v1.0 (10/20 PDF) | v1.3 | **v1.4** |
|---|---|---|---|
| `userId` | Login ID | `"ha:" + userSn` | Same as v1.3 |
| Signed attribute keys | `hotel_id` · `hotel_name` · `province` · `region` · `role` | Same | **`hotel_id` · `hotel_name` · `province_sn` · `role`** |
| Province | Province name | Province name | **`province_sn`** = Go2Joy `provinceSn` |
| Region | Calculated by HA (3 values) | Calculated by HA (5 codes) | **Not sent**. Calculated by SharpTalk |
| Role | Display name (`Lễ tân`) | Display name | **Role code** |
| Normalization | trim · 120 chars | + NFC | **NFC → collapse whitespace → trim → 120 chars** |
| "All hotels" | Not defined | Call again only | Drop the 3 hotel keys, sign `role` only |
| Empty values | Empty attributes·email left out | Same | Empty `name` · `email` · `phone` also left out |
| Test vectors | T1 · T2 | T1 ~ T5 | **T1 ~ T6** (previous vectors no longer used) |

**Why the change**
- If both HA and SharpTalk keep a region table, they drift apart. The single source is the Province Feed of the Go2Joy Partner API.
- Province names and role display names change with the HA language (vi/en), so the signed values could differ. Numbers and codes do not change.

**Transition period**: For now, SharpTalk still accepts the v1.3 format (`province` · `region` keys). If `province_sn` is also sent, **the values set from `province_sn` take priority**. When HA has moved to v1.4 and passed UAT, we will end support for the v1.3 keys and announce the date.

## 1. What SharpTalk does
| Step | Details |
|---|---|
| Verify | Builds the signing string from the received values as-is and compares the HMAC. On mismatch: 401 E5048 (stays guest) |
| Province · region | `province_sn` → fills **province name and region** from the Go2Joy province list (80 entries, Partner API Province Feed, refreshed daily). A number not in the list is saved without a region and goes to the default assignee |
| Register | Hotel = business customer (`hotel_id`), staff = contact (`userId`), role recorded |
| Continuity | Continues previous conversations per hotel account (after session end, on another PC, with another staff member) |
| Routing | Consult category chosen by the customer × hotel region → team × work label (rules managed by Go2Joy in the console) |

**Region table** (Province Feed `region`)

| No. | Code | Name |
|---|---|---|
| 1 | `south` | South |
| 2 | `north` | North |
| 3 | `central` | Central |
| 4 | `north_center` | North Central |
| 5 | `south_center` | South Center |
| 10 | `region_10` | Not documented (17 cities of Manila). To be fixed after the reply to work request WR-27 |

## 2. Data sent (v1.4)
| Field | Signed | Value | HA source (example) | Example |
|---|---|---|---|---|
| `userId` | Yes | `"ha:" + userSn` | Staff number in HA DB | `ha:1001` |
| `attributes.hotel_id` | Yes | Selected hotel `hotelSn` (string) | Selected hotel in the session | `"1721"` |
| `attributes.hotel_name` | Yes | Hotel name | Hotel in HA DB | `A In Hotel Del Luna` |
| `attributes.province_sn` | Yes | `provinceSn` of the hotel's province (string) | Hotel in HA DB → provinceSn | `"1"` |
| `attributes.role` | Yes | HA role code | Role key in HA DB | `RECEPTIONIST` (example. Real codes come with the A7 reply) |
| `name` · `email` · `phone` | No | For display. Drop the field when empty | Profile | `G2J SUPPORT` |

## 3. Request flow
```
HA FE ──(signed-in session)──▶ HA server  GET /api/v1/staff/sharptalkIdentity
                         └ values from session/DB → normalize → sign → return package
HA FE ── SharpTalk.identify(package unchanged) ──▶ widget iframe
widget ── POST /api/v1/public/embed/identify ──▶ SharpTalk
                         └ verify signature → province_sn → province name/region → business customer/contact → link conversation
widget ── ivy:event { event: "identified", ok } ──▶ HA FE (optional: log)
```

## 4. Signing string
```
no attributes   : userId
with attributes : userId + "\n" + key=value + "\n" + key=value ...   (keys in alphabetical order)

hash = hex( HMAC-SHA256( key = SHARPTALK_EMBED_SECRET, message = signing string (UTF-8) ) )
       → 64 lowercase hex chars

Example (T2):
ha:1001
hotel_id=1721
hotel_name=A In Hotel Del Luna
province_sn=1
role=RECEPTIONIST
```
- Key order: `hotel_id` → `hotel_name` → `province_sn` → `role`.
- The values you send must be **exactly the same** as the values you signed (including spaces, letter case and tone marks).

## 5. Implementation

### 5.1 HA server (PHP) — [sharptalk_identity.php](files/sharptalk_identity.php.txt)
```php
<?php
// SharpTalk identify package — HA server (spec v1.4). Requires PHP intl + mbstring.

/** NFC → collapse whitespace (incl. NBSP) → trim → 120 chars. Order matters. */
function sharptalk_clean($value): string {
    $v = Normalizer::normalize((string) $value, Normalizer::FORM_C);
    if ($v === false) { $v = (string) $value; }
    $v = preg_replace('/[\s\x{00A0}\x{2000}-\x{200B}\x{3000}]+/u', ' ', $v);
    $v = trim($v);
    return mb_substr($v, 0, 120, 'UTF-8');
}

/**
 * @param string     $userSn   staff number from the HA DB (never the login ID)
 * @param array|null $hotel    ['sn' => …, 'name' => …, 'provinceSn' => …] or null for "all hotels"
 * @param string     $roleCode HA role code (language independent)
 * @param array      $profile  ['name' => …, 'email' => …, 'phone' => …] — display only, not signed
 */
function sharptalk_identity(string $userSn, ?array $hotel, string $roleCode, array $profile, string $secret): array {
    $attributes = ['role' => $roleCode];
    if ($hotel !== null) {
        $attributes['hotel_id']    = $hotel['sn'];
        $attributes['hotel_name']  = $hotel['name'];
        $attributes['province_sn'] = $hotel['provinceSn'];
    }
    $clean = [];
    foreach ($attributes as $k => $v) {
        $c = sharptalk_clean($v);
        if ($c !== '') { $clean[$k] = $c; }          // empty values are left out of signing AND payload
    }
    ksort($clean, SORT_STRING);
    $userId = 'ha:' . sharptalk_clean($userSn);
    $lines = [$userId];
    foreach ($clean as $k => $v) { $lines[] = $k . '=' . $v; }
    $hash = hash_hmac('sha256', implode("\n", $lines), $secret);

    $package = ['userId' => $userId, 'hash' => $hash];
    foreach (['name', 'email', 'phone'] as $f) {     // unsigned; drop when empty
        $c = sharptalk_clean($profile[$f] ?? '');
        if ($c !== '') { $package[$f] = $c; }
    }
    if ($clean) { $package['attributes'] = $clean; }
    return $package;
}

// Controller (login session required):
// $staff = currentStaff(); $hotel = selectedHotelOrNull();
// return json(sharptalk_identity($staff->sn, $hotel ? ['sn' => $hotel->sn, 'name' => $hotel->name,
//        'provinceSn' => $hotel->provinceSn] : null, $staff->roleCode,
//        ['name' => $staff->fullName, 'email' => $staff->email, 'phone' => $staff->mobile],
//        getenv('SHARPTALK_EMBED_SECRET')));
```

### 5.2 HA FE
```html
<script>
  window.SHARPTALK_WIDGET_CONFIG = {
    shop: "https://www.go2joy.vn",
    widgetUrl: SHARPTALK_ORIGIN + "/widget",        // B7: one setting per environment
    agent: "hotel-partner",
    locale: (localStorage.getItem("lang") || "vi").toLowerCase()
    // no `user` block, no hash here (B1)
  };
  window.SharpTalk = window.SharpTalk || { q: [] };
  function sharptalkCall(method, arg) {
    if (typeof window.SharpTalk[method] === "function") window.SharpTalk[method](arg);
    else window.SharpTalk.q.push([method, arg]);
  }
</script>
<script src="SHARPTALK_ORIGIN/widget/embed.js" defer></script>
```
```js
// B2 · B3: after sign-in, on reload, on hotel change (incl. "all hotels"), on language change
async function sharptalkSignIn() {
  const pkg = await haApi.get('/api/v1/staff/sharptalkIdentity'); // signed on the server
  sharptalkCall('identify', pkg);                                // UNCHANGED
}
// B4: sign-out button, session/token expiry, before another account signs in, other tab signed out
function sharptalkSignOut() { sharptalkCall('logout'); }
window.addEventListener('storage', (e) => { if (e.key === 'profile' && !e.newValue) sharptalkSignOut(); });
// B5
function sharptalkSetLocale(lang) { sharptalkCall('setLocale', String(lang || 'vi').toLowerCase()); }
// optional log
window.addEventListener('message', (e) => {
  if (e.origin !== SHARPTALK_ORIGIN || e.data?.type !== 'ivy:event') return;
  if (e.data.event === 'identified') console.info('[SharpTalk] identify', e.data.ok ? 'OK' : 'rejected');
});
```

### 5.3 Package example (T2)
```json
{
  "userId": "ha:1001",
  "hash": "fb670d6fbaac555b40b2f9896ec7de0604a1fad83aaf9e892f293f1d3be9faa7",
  "name": "G2J SUPPORT",
  "attributes": { "hotel_id": "1721", "hotel_name": "A In Hotel Del Luna", "province_sn": "1", "role": "RECEPTIONIST" }
}
```

### 5.4 Test vectors (v1.4)
The test secret is `test-secret-do-not-use` (not a real secret). The hashes below were computed separately by **the SharpTalk server verification code** and by **the 5.1 PHP sample (PHP 8.3 + intl)**, and they match. Role codes and `userSn` are example values.

| # | Input | Expected hash |
|---|---|---|
| T1 | `ha:1001` · no attributes | `244f6fa4c1c48d077d54bd632b0897042fa413e36d55921517c462e2af51e618` |
| T2 | `ha:1001` · hotel_id=`1721`, hotel_name=`A In Hotel Del Luna`, province_sn=`1`, role=`RECEPTIONIST` | `fb670d6fbaac555b40b2f9896ec7de0604a1fad83aaf9e892f293f1d3be9faa7` |
| T3 | `ha:2002` · hotel_id=`2001`, hotel_name=`Huế Garden Hotel`, province_sn=`32`, role=`OWNER` | `0df74c490621c521a673b7bbd6014e6e3141a086d04c7c2f8de3699d31e581d7` |
| T4 | `ha:3003` · hotel_id=`3001`, hotel_name=`Hạ Long Bay Hotel`, province_sn=`15`, role=`RECEPTIONIST` | `7e5cf87cdd3dc38574ec8f3f9fe6671e9650806d28f4741a55bb508f53b77ea9` |
| T5 | `ha:1001` · role=`MANAGER` (**All hotels**) | `d57dc894632e52a7ca62d97f4cbec924eb33982dff23f57058b7299d24f57f20` |
| T6 | Same values as T3, entered messy: hotel_id=`" 2001"` (leading space), hotel_name=`"  Hu" + "ế" + "  Garden Hotel "` (decomposed ế · double space · NBSP), province_sn=`32` (number type) → sign after 5.1 normalization | **Must equal T3** `0df74c490621c521a673b7bbd6014e6e3141a086d04c7c2f8de3699d31e581d7` |

- Run: `docker run --rm -v "$PWD/scripts/go2joy/php":/w php:8.3-cli sh -c 'apt-get update -qq && apt-get install -y -qq libicu-dev && docker-php-ext-install intl && php /w/vectors.php'`
- Resulting province/region (values SharpTalk saves): T2 Hồ Chí Minh · `south`, T3 Thừa Thiên Huế · `north_center`, T4 Quảng Ninh · `north`, T5 none (default assignee).
- Do not use the v1.0 ~ v1.3 vectors (only T1 is the same).

### 5.5 SharpTalk responses
| Result | Meaning | Action |
|---|---|---|
| 200 | Verified. Session is "verified", business customer and contact linked | — |
| 401 · E5048 | Signature mismatch: string·secret·environment mismatch, unknown key, over 120 chars or line break, NFC/whitespace difference, non-numeric `province_sn` | Compare with section 4, rerun 5.4 |
| 400 | Format error (empty email etc.) | Leave out empty fields |
| 404 | No chat session | Widget handles it automatically. Reload |

## 6. Security
- Keep the secret only in HA server environment variables. Staging and production secrets differ (SharpTalk sends them over a secure channel).
- Anyone holding a signed package can chat as that staff member and see that hotel's previous conversations. Do not log it, and do not skip sign-out handling (B4).
- Whether to add a signature expiry (`ts`) is decided in work request WR-03 (if added, it ships together as v1.5).
- Shared PCs (front desk): automatic sign-out and account switching in B4 are especially important.

## 7. SharpTalk status
| Item | Status |
|---|---|
| v1.4 support (`province_sn` → province name/region, v1.3 in parallel) | Staging deploy (target 10/27) |
| Go2Joy province list, 80 entries (indexed by number) | Loaded on staging · production loaded at install |
| Temporary unsigned sign-in (for staging UAT) | Ends after A and B are done |
| Role code display names | After the A7 code table is received |

## 8. UAT checklist (WR-05)
| Check | Expected |
|---|---|
| Widget while not signed in | Guest, consent notice shown (same as now) |
| HA sign-in → widget | identify **200**, `identified {ok: true}`, no consent notice, staff name in greeting, "verified" in console |
| Console › Customers › Business customers | 1 hotel (name · province · region, calculated by SharpTalk), staff and role code under contacts |
| HA language vi ↔ en | Signed values unchanged → same conversation continues, only the reply language changes |
| Change hotel selection | Business customer and conversation switch to the new hotel |
| "All hotels" → connect to agent | 200, no hotel, default assignee |
| Connect to agent from hotels in each region (north · north_center · south_center · south) → choose consult category | Team routing follows console rules, assignee shown in alarm center |
| Hotel name with many tone marks (incl. decomposed input) | 200 |
| Staff with empty email | 200 without the email field |
| Sign-out · session expiry · another account signs in | Guest (or the new account), previous staff conversations not visible |
| Change one signed value without re-signing | 401, guest. `name` · `email` · `phone` are not signed, so changing them still gives 200 |
| Add a key outside the list (e.g. `district`) and sign | 401 (unknown keys are left out of the signature calculation) |
