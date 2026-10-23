<?php
// Run: docker run --rm -v "$PWD/scripts/go2joy/php":/w php:8.3-cli sh -c 'apt-get update -qq && apt-get install -y -qq libicu-dev && docker-php-ext-install intl && php /w/vectors.php'
// Must print the hashes of GUIDE v1.4 §5.4 (T6 = T3).
require __DIR__ . '/sharptalk_identity.php';
$s = 'test-secret-do-not-use';
$cases = [
  ['T1', '1001', null, null],
  ['T2', '1001', ['sn' => '1721', 'name' => 'A In Hotel Del Luna', 'provinceSn' => '1'], 'RECEPTIONIST'],
  ['T3', '2002', ['sn' => '2001', 'name' => 'Huế Garden Hotel', 'provinceSn' => '32'], 'OWNER'],
  ['T4', '3003', ['sn' => '3001', 'name' => 'Hạ Long Bay Hotel', 'provinceSn' => '15'], 'RECEPTIONIST'],
  ['T5', '1001', null, 'MANAGER'],
  ['T6', '2002', ['sn' => ' 2001', 'name' => "  Hu\u{0065}\u{0302}\u{0301}  Garden\u{00A0}Hotel\u{00A0}", 'provinceSn' => 32], 'OWNER'],
];
foreach ($cases as [$id, $sn, $hotel, $role]) {
  if ($role === null) {   // T1: no attributes at all
    echo $id, "\t", hash_hmac('sha256', 'ha:' . $sn, $s), "\n"; continue;
  }
  $p = sharptalk_identity($sn, $hotel, $role, ['name' => 'G2J SUPPORT', 'email' => ''], $s);
  echo $id, "\t", $p['hash'], "\t", json_encode($p, JSON_UNESCAPED_UNICODE), "\n";
}
