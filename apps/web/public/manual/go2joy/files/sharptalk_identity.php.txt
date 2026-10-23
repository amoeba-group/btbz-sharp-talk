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
 * @param string     $userSn      staff number from the HA DB (never the login ID)
 * @param array|null $hotel       ['sn' => …, 'name' => …, 'provinceSn' => …] or null for "all hotels"
 * @param string     $roleCode    HA role code (language independent)
 * @param array      $profile     ['name' => …, 'email' => …, 'phone' => …] — display only, not signed
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
