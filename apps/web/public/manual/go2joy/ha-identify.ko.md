# Hotel Admin 로그인 사용자 연동 — 규격 v1.4

> Go2Joy HA 개발팀이 구현할 로그인 사용자 연동 규격 v1.4입니다(2026-10-24). 맨 앞 체크리스트를 모두 통과하면 완료입니다. 일정·담당은 [작업요청서](work-request.ko.html). 인쇄·전달용: [PDF](ha-identify.ko.pdf)


> HA 직원이 로그인한 상태로 위젯을 열면 **HA 서버가 직원·호텔 정보를 서명**하고, HA FE가 그 패키지를 **그대로** 위젯에 넘깁니다.
> SharpTalk은 서명을 검증한 뒤 호텔을 기업고객으로, 직원을 연락처로 등록하고, 호텔 계정 단위로 대화를 잇고, 호텔 권역에 맞는 팀에 배정합니다.
> **v1.4에서는 HA가 권역을 계산하지 않습니다.** 성 번호(`province_sn`)만 보내면 SharpTalk이 Go2Joy 성 목록으로 이름과 권역을 정합니다.

| 항목 | 내용 |
|---|---|
| 수신 | Go2Joy Hotel Admin(HA) 개발팀(백엔드·FE) · Go2Joy PM |
| 발신 | SharpTalk (Amoeba) |
| 일자 / 버전 | 2026-10-24 · **v1.4** (v1.3 2026-10-22 · v1.0 PDF 2026-10-20은 폐기) |
| 환경 | HA UAT `https://go2joy-ha-uat.go2joy.io` ↔ SharpTalk 스테이징 `https://shoptalk.amoeba.site` · 운영은 Go2Joy 서버 `https://sharptalk.go2joy.vn`(설치 대기) |
| 함께 보는 문서 | [작업요청서](GUIDE-261023-Go2Joy-Work-Request.md)(WR 번호·일정) · [v1.3](GUIDE-261022-Go2Joy-HA-Identify-v1.3.md)(이전 규격) |
| 예제 코드 | [sharptalk_identity.php](files/sharptalk_identity.php.txt) · [vectors.php](files/vectors.php.txt)(테스트 벡터 실행) |

---

## ✅ HA가 해야 할 일 — 체크리스트

**이 표가 이 문서의 핵심입니다.** 각 줄의 확인 방법까지 통과하면 완료입니다.

### A. HA 백엔드 (WR-01 · WR-02) — 10/27(화)
- [ ] **A1. 서명 키(embed secret)를 HA 서버 환경변수에만 둔다** — FE·브라우저·앱·로그·문서에 넣지 않는다. 스테이징 값은 SharpTalk이 보안 채널로 전달(WR-02 결정 당일).
  확인: 저장소·번들 어디에도 secret 문자열이 없다.
- [ ] **A2. 로그인 세션으로만 호출되는 엔드포인트를 만든다**(예: `GET /api/v1/staff/sharptalkIdentity`).
  확인: 비로그인 호출은 401.
- [ ] **A3. 값은 HA 세션·DB에서 읽는다** — 브라우저가 보낸 값으로 만들지 않는다.
- [ ] **A4. `userId = "ha:" + userSn`** — 로그인 ID(`go2joysupport` 등)가 아니라 바뀌지 않는 직원 번호.
- [ ] **A5. 속성은 4개만**: `hotel_id` · `hotel_name` · `province_sn` · `role`.
  - `hotel_code`·`hotel_group_id`·`user_id`·`user_sn`·`district` 같은 **목록 밖 키는 보내지 않는다**(서명 계산에서 빠져 401).
  - `region`·`province`(이름)도 보내지 않는다. 전환 기간이라 401은 아니지만 `province_sn`이 우선하고, 전환이 끝나면 401이 된다.
- [ ] **A6. `province_sn` = 선택 호텔의 Go2Joy `provinceSn`**(Province Feed `sn`, 문자열 숫자, 예: Hồ Chí Minh = `"1"`).
- [ ] **A7. `role` = HA 역할 코드**(화면 언어와 무관한 값). **코드표**(코드 · 베트남어/영어 표시명)를 SharpTalk에 회신.
- [ ] **A8. "전체 호텔"을 고른 경우** `hotel_id` · `hotel_name` · `province_sn`을 빼고 `role`만 서명.
- [ ] **A9. 정규화 순서를 지킨다**: **NFC → 공백 정리(NBSP 포함) → trim → 120자(`mb_substr`)**. PHP `intl`·`mbstring` 확장 필요.
- [ ] **A10. 빈 값은 필드째 뺀다** — attributes와 `name` · `email` · `phone` 모두(빈 `email`은 400).
- [ ] **A11. `hash = hex(HMAC-SHA256(secret, 서명 문자열))`**, 서명 문자열은 5.1 형식(키 알파벳 순).
- [ ] **A12. 테스트 벡터 T1 ~ T6이 모두 일치**(5.4) — 결과를 SharpTalk에 회신.
- [ ] **A13. 응답 패키지는 HTTPS로 로그인 세션에만 반환하고 로그에 남기지 않는다.**

### B. HA FE (WR-04) — 10/28(수)
- [ ] **B1. 브라우저에서 패키지를 만들지 않는다** — 지금의 `sharptalkSignIn`(프로필 값으로 조립)과 초기값 `hash: "testing"`을 **삭제**.
- [ ] **B2. A2의 응답을 받아 `SharpTalk.identify(응답)`에 그대로 넘긴다**(키 추가·수정 금지).
- [ ] **B3. 다시 호출하는 시점**: 로그인 확정 · 페이지 새로고침 · **호텔 선택 변경(전체 호텔 포함)** · HA 언어 변경.
- [ ] **B4. `SharpTalk.logout()` 호출 시점**: 로그아웃 버튼 · **세션·토큰 만료 자동 로그아웃** · 다른 계정 로그인 직전 · 다른 탭 로그아웃(`storage` 이벤트 등).
- [ ] **B5. `locale`** — 지금처럼 `localStorage.lang` → `vi`/`en`, 바뀌면 `setLocale`.
- [ ] **B6. CSP(`script-src` · `frame-src` · `connect-src`)·CORS에 SharpTalk 도메인 허용.**
- [ ] **B7. SharpTalk 도메인 3곳**(`embed.js` src · `widgetUrl` · `ivy:event` origin 검사)을 **환경 설정값 하나**로 묶는다(운영 전환 시 한 번에 교체).
  확인(B 전체): DevTools › Network `POST …/public/embed/identify` **200**(`consentState: "granted"`), 페이지에 `ivy:event` `identified {ok: true}`.

### C. UAT 공동 점검 (WR-05) — 10/29 ~ 10/30
- [ ] **C1. 8절 체크리스트 전 항목 통과**(SharpTalk과 함께).
- [ ] **C2. 테스트 계정** `Quản lý`(여러 호텔) 1개 + `Lễ tân`(호텔 1개) 1개, 북부·남부 호텔 포함(WR-14).

### D. 운영 배포 (WR-06) — 운영 UAT 전
- [ ] **D1. 운영 embed secret 적용** — 스테이징과 다른 값(SharpTalk 보안 채널 전달).
- [ ] **D2. 운영 도메인으로 교체**: `https://sharptalk.go2joy.vn/widget/embed.js` · `widgetUrl` · origin 검사.
- [ ] **D3. 운영 CSP·CORS 반영, HA 배포 일정 사전 공유.**
  확인: 운영 HA에서 identify 200, 스테이징 secret으로 만든 패키지는 운영에서 401.

---

## v1.4 변경 사항
| 항목 | v1.0 (10/20 PDF) | v1.3 | **v1.4** |
|---|---|---|---|
| `userId` | 로그인 ID | `"ha:" + userSn` | v1.3과 같음 |
| 서명 속성 키 | `hotel_id` · `hotel_name` · `province` · `region` · `role` | 같음 | **`hotel_id` · `hotel_name` · `province_sn` · `role`** |
| 성 | 성 이름 | 성 이름 | **`province_sn`** = Go2Joy `provinceSn` |
| 권역 | HA 산출(3값) | HA 산출(5코드) | **보내지 않음** — SharpTalk 산출 |
| 역할 | 표시명(`Lễ tân`) | 표시명 | **역할 코드** |
| 정규화 | trim · 120자 | + NFC | **NFC → 공백 정리 → trim → 120자** |
| "전체 호텔" | 규정 없음 | 재호출만 | 호텔 키 3개 빼고 `role`만 |
| 빈 값 | 빈 attributes·email 제외 | 같음 | 빈 `name` · `email` · `phone`도 제외 |
| 테스트 벡터 | T1 · T2 | T1 ~ T5 | **T1 ~ T6**(이전 벡터 사용 안 함) |

**왜 바꾸나**
- 권역표를 HA와 SharpTalk 양쪽에 두면 어긋납니다. Go2Joy Partner API의 Province Feed 한 곳을 기준으로 합니다.
- 성 이름·역할 표시명은 HA 언어(vi/en)에 따라 바뀌어 서명 값이 달라질 수 있습니다. 번호와 코드는 바뀌지 않습니다.

**전환 기간**: SharpTalk은 v1.3 형식(`province` · `region` 키)도 당분간 검증 통과시킵니다. `province_sn`이 함께 오면 **`province_sn`으로 정한 값이 우선**입니다. HA가 v1.4로 전환해 UAT를 통과하면 v1.3 키 허용을 끝내고 날짜를 알립니다.

## 1. SharpTalk이 하는 일
| 단계 | 내용 |
|---|---|
| 검증 | 받은 값 그대로 서명 문자열을 만들어 HMAC 비교. 다르면 401 E5048(게스트 유지) |
| 성·권역 | `province_sn` → Go2Joy 성 목록(80개, Partner API Province Feed, 매일 갱신)에서 **성 이름·권역**을 채움. 목록에 없는 번호는 권역 없이 저장하고 기본 담당자로 보냄 |
| 등록 | 호텔 = 기업고객(`hotel_id`), 직원 = 연락처(`userId`), 역할 기록 |
| 연속성 | 호텔 계정 단위로 이전 대화를 이음(세션 종료·다른 PC·다른 직원) |
| 배정 | 고객이 고른 상담카테고리 × 호텔 권역 → 팀 × 업무 라벨(규칙은 Go2Joy가 콘솔에서 관리) |

**권역 산출표**(Province Feed `region`)

| 번호 | 코드 | 이름 |
|---|---|---|
| 1 | `south` | South |
| 2 | `north` | North |
| 3 | `central` | Central |
| 4 | `north_center` | North Central |
| 5 | `south_center` | South Center |
| 10 | `region_10` | 문서 미기재(마닐라 17개 시) — 작업요청서 WR-27 회신 후 확정 |

## 2. 전달 데이터 (v1.4)
| 필드 | 서명 | 값 | HA 출처(예) | 예 |
|---|---|---|---|---|
| `userId` | 예 | `"ha:" + userSn` | HA DB 직원 번호 | `ha:1001` |
| `attributes.hotel_id` | 예 | 선택 호텔 `hotelSn`(문자열) | 세션의 선택 호텔 | `"1721"` |
| `attributes.hotel_name` | 예 | 호텔명 | HA DB 호텔 | `A In Hotel Del Luna` |
| `attributes.province_sn` | 예 | 호텔 소재 성의 `provinceSn`(문자열) | HA DB 호텔 → provinceSn | `"1"` |
| `attributes.role` | 예 | HA 역할 코드 | HA DB 역할 키 | `RECEPTIONIST`(예시 — 실제 코드는 A7 회신) |
| `name` · `email` · `phone` | 아니오 | 표시용, 비면 필드째 제외 | 프로필 | `G2J SUPPORT` |

## 3. 통신 흐름
```
HA FE ──(로그인 세션)──▶ HA 서버  GET /api/v1/staff/sharptalkIdentity
                         └ 세션·DB에서 값 → 정규화 → 서명 → 패키지 반환
HA FE ── SharpTalk.identify(패키지 그대로) ──▶ 위젯 iframe
위젯  ── POST /api/v1/public/embed/identify ──▶ SharpTalk
                         └ 서명 검증 → province_sn → 성 이름·권역 → 기업고객·연락처 → 대화 연결
위젯  ── ivy:event { event: "identified", ok } ──▶ HA FE(선택: 로그)
```

## 4. 서명 문자열
```
attributes 없음 : userId
attributes 있음 : userId + "\n" + key=value + "\n" + key=value ...   (키 알파벳 순)

hash = hex( HMAC-SHA256( key = SHARPTALK_EMBED_SECRET, message = 서명 문자열(UTF-8) ) )
       → 소문자 hex 64자

예 (T2):
ha:1001
hotel_id=1721
hotel_name=A In Hotel Del Luna
province_sn=1
role=RECEPTIONIST
```
- 키 순서: `hotel_id` → `hotel_name` → `province_sn` → `role`.
- 보내는 값은 서명한 값과 **완전히 같아야** 합니다(공백·대소문자·성조 부호 포함).

## 5. 구현

### 5.1 HA 서버 (PHP) — [sharptalk_identity.php](files/sharptalk_identity.php.txt)
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

### 5.3 패키지 예 (T2)
```json
{
  "userId": "ha:1001",
  "hash": "fb670d6fbaac555b40b2f9896ec7de0604a1fad83aaf9e892f293f1d3be9faa7",
  "name": "G2J SUPPORT",
  "attributes": { "hotel_id": "1721", "hotel_name": "A In Hotel Del Luna", "province_sn": "1", "role": "RECEPTIONIST" }
}
```

### 5.4 테스트 벡터 (v1.4)
테스트 secret은 `test-secret-do-not-use`입니다(실제 secret 아님). 아래 해시는 **SharpTalk 서버 검증 코드**와 **5.1 PHP 예제(PHP 8.3 + intl)** 로 각각 계산해 일치를 확인했습니다. 역할 코드·`userSn`은 예시 값입니다.

| # | 입력 | 기대 해시 |
|---|---|---|
| T1 | `ha:1001` · 속성 없음 | `244f6fa4c1c48d077d54bd632b0897042fa413e36d55921517c462e2af51e618` |
| T2 | `ha:1001` · hotel_id=`1721`, hotel_name=`A In Hotel Del Luna`, province_sn=`1`, role=`RECEPTIONIST` | `fb670d6fbaac555b40b2f9896ec7de0604a1fad83aaf9e892f293f1d3be9faa7` |
| T3 | `ha:2002` · hotel_id=`2001`, hotel_name=`Huế Garden Hotel`, province_sn=`32`, role=`OWNER` | `0df74c490621c521a673b7bbd6014e6e3141a086d04c7c2f8de3699d31e581d7` |
| T4 | `ha:3003` · hotel_id=`3001`, hotel_name=`Hạ Long Bay Hotel`, province_sn=`15`, role=`RECEPTIONIST` | `7e5cf87cdd3dc38574ec8f3f9fe6671e9650806d28f4741a55bb508f53b77ea9` |
| T5 | `ha:1001` · role=`MANAGER`(**전체 호텔**) | `d57dc894632e52a7ca62d97f4cbec924eb33982dff23f57058b7299d24f57f20` |
| T6 | T3과 같은 값을 흐트러뜨려 입력: hotel_id=`" 2001"`(앞 공백), hotel_name=`"  Hu" + "e\u0302\u0301" + "  Garden\u00A0Hotel\u00A0"`(분해형 ế · 이중 공백 · NBSP), province_sn=`32`(숫자형) → 5.1 정규화 후 서명 | **T3과 같아야 함** `0df74c490621c521a673b7bbd6014e6e3141a086d04c7c2f8de3699d31e581d7` |

- 실행: `docker run --rm -v "$PWD/scripts/go2joy/php":/w php:8.3-cli sh -c 'apt-get update -qq && apt-get install -y -qq libicu-dev && docker-php-ext-install intl && php /w/vectors.php'`
- 결과 성/권역(SharpTalk 저장 값): T2 Hồ Chí Minh · `south`, T3 Thừa Thiên Huế · `north_center`, T4 Quảng Ninh · `north`, T5 없음(기본 담당자).
- v1.0 ~ v1.3의 벡터는 사용하지 않습니다(T1만 같음).

### 5.5 SharpTalk 응답
| 결과 | 의미 | 조치 |
|---|---|---|
| 200 | 검증 성공 — 세션 '검증됨', 기업고객·연락처 연결 | — |
| 401 · E5048 | 서명 불일치: 문자열·secret·환경 불일치, 모르는 키, 120자 초과·줄바꿈, NFC/공백 차이, 숫자가 아닌 `province_sn` | 4절과 비교, 5.4 재실행 |
| 400 | 형식 오류(빈 email 등) | 빈 필드 제외 |
| 404 | 채팅 세션 없음 | 위젯 자동 처리, 새로고침 |

## 6. 보안
- secret은 HA 서버 환경변수에만. 스테이징·운영 secret은 다릅니다(SharpTalk이 보안 채널로 전달).
- 서명 패키지를 가진 사람은 그 직원으로 채팅하고 그 호텔의 이전 대화를 볼 수 있습니다. 로그에 남기지 말고, 로그아웃 처리(B4)를 빠뜨리지 마십시오.
- 서명 유효기간(`ts`) 적용 여부는 작업요청서 WR-03에서 결정합니다(적용하면 v1.5로 함께 변경).
- 공용 PC(프런트 데스크): B4의 자동 로그아웃·계정 전환 처리가 특히 중요합니다.

## 7. SharpTalk 쪽 상태
| 항목 | 상태 |
|---|---|
| v1.4 수신(`province_sn` → 성 이름·권역, v1.3 병행) | 스테이징 배포(10/27 목표) |
| Go2Joy 성 목록 80개(번호 색인) | 스테이징 입력 · 운영은 설치 시 투입 |
| 서명 없는 로그인 임시 허용(스테이징 UAT용) | A·B 완료 후 종료 |
| 역할 코드 표시 이름 | A7 코드표 수령 후 |

## 8. UAT 체크리스트 (WR-05)
| 점검 | 기대 |
|---|---|
| 미로그인 상태에서 위젯 | 게스트, 동의 안내 표시(현재와 같음) |
| HA 로그인 → 위젯 | identify **200**, `identified {ok: true}`, 동의 안내 없음, 인사말에 직원 이름, 콘솔 "검증됨" |
| 콘솔 › 고객 › 기업고객 | 호텔 1건(이름 · 성 · 권역 — SharpTalk 산출), 연락처에 직원·역할 코드 |
| HA 언어 vi ↔ en | 서명 값 그대로 → 같은 대화가 이어지고 응답 언어만 바뀜 |
| 호텔 선택 변경 | 새 호텔로 기업고객·대화 전환 |
| "전체 호텔" → 상담원 연결 | 200, 호텔 없음, 기본 담당자 |
| 권역별 호텔(north · north_center · south_center · south)에서 상담원 연결 → 상담카테고리 선택 | 콘솔 규칙대로 팀 배정, 알람센터에 배정자 표시 |
| 성조가 많은 호텔명(분해형 입력 포함) | 200 |
| email 빈 직원 | email 필드 없이 200 |
| 로그아웃 · 세션 만료 · 다른 계정 로그인 | 게스트(또는 새 계정), 이전 직원 대화 안 보임 |
| 서명 대상 값 하나를 재서명 없이 수정 | 401, 게스트. `name` · `email` · `phone`은 서명 대상이 아니라 바꿔도 200 |
| 목록 밖 키(예: `district`)를 넣고 서명 | 401(모르는 키는 서명 계산에서 빠짐) |
