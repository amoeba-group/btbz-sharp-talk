# Hotel Admin 로그인 사용자 정보를 SharpTalk 대화에 연동 — v1.1

> 로그인 상태이면 관리자 이름·호텔·성/시·지역을 위젯 스크립트에 **서명과 함께** 전달하고, SharpTalk이 이를 검증해
> 지역 담당 상담팀(하노이 / 호찌민)으로 연결합니다.

| 항목 | 내용 |
|---|---|
| 수신 | Go2Joy Hotel Admin(HA) 개발팀 |
| 발신 | SharpTalk (Amoeba) |
| 일자 / 버전 | 2026-10-21 · **v1.1** (v1.0: 2026-10-20) |
| 환경 | HA UAT `https://go2joy-ha-uat.go2joy.io` ↔ SharpTalk 스테이징 `https://shoptalk.amoeba.site` |
| 참고 | Go2Joy 파트너 API 문서(dev.go2joy.vn — Support Assistant API) · Go2Joy 지역표 `Khu vực và Tỉnh_ Thành phố.xlsx` · SharpTalk REQ-261021 · RPT-261019 |

## v1.1 변경 사항 (v1.0 대비)
| # | 변경 | 위치 |
|---|---|---|
| 1 | **`region` 값을 Go2Joy 지역표 기준 4종으로 변경**: `North` · `North Center` · `South Center` · `South`(표의 `REGIONS_TEXT` 그대로). v1.0의 `north` · `central` · `south`는 쓰지 않습니다 | 4절, 5.1, 부록 A |
| 2 | **`province` = 지역표의 `NAME`** 그대로(예: `Hồ Chí Minh`, `Thừa Thiên Huế`) | 4절, 부록 A |
| 3 | 상담원 배정 시점 명시: ① **AI가 답할 수 없어 이관**할 때 ② **직원이 상담원 연결을 요청**할 때. 지역 → 팀 매핑안 추가 | 3.1, 4.2 |
| 4 | **호텔 미선택**(체인 "전체 호텔") 상태 처리: 호텔 관련 속성을 빼고 보냄 | 3절 표, 5.2 |
| 5 | **유니코드(NFC)·공백 정규화** 규칙 추가 — 베트남어 성조 부호 때문에 서명이 어긋나는 사례 방지 | 5.1, 5.2 |
| 6 | **테스트 벡터 갱신**: T2의 region 값 변경(`South`), T3(North Center)·T4(region 없음) 추가 | 5.4 |
| 7 | UAT 체크리스트에 AI 이관·지역 4종·호텔 미선택·NFC 항목 추가 | 8절 |
| 8 | 파트너 API 접속 테스트 결과와 Go2Joy 확인 요청 추가 | 7.1 |

---

## 요약
- **미로그인**: 현재 스크립트를 그대로 유지합니다. 위젯은 지금처럼 표시됩니다(게스트, 동의 안내 표시).
- **로그인**: HA 서버가 식별 패키지(사용자 ID, 이름, 호텔, 성/시, 지역, 역할)를 만들고 **서명**합니다. HA FE가 `SharpTalk.identify(...)`로 패키지를 위젯에 넘기면, SharpTalk이 서명을 다시 계산해 일치할 때 대화에 정보를 연결합니다.
- **상담원 배정**: AI가 답하지 못해 이관하거나 직원이 "상담원 연결"을 요청하면, SharpTalk이 서명된 **지역**으로 하노이 / 호찌민 팀을 고릅니다.
- **Go2Joy 작업**: 서명 패키지를 반환하는 서버 엔드포인트 1개(PHP 약 35줄) · FE JavaScript 약 15줄 · 로그아웃 시 `SharpTalk.logout()` 호출.
- **SharpTalk 측 구현 상태**: 수신·검증·동의 생략·헤더 이름·콘솔 표시·지역 배정은 **이미 동작**합니다(6절). v1.1에서 추가하는 NFC 정규화와 성 → 지역 대체 매핑은 **UAT 전에 스테이징에 배포**합니다(9절).

## 1. 배경

### 1.1 현황
HA UAT에는 SharpTalk 스크립트(`embed.js`)가 이미 설치되어 있습니다. JoyBot 위젯은 로그인 페이지를 포함한 모든 페이지에 표시되며, 로그인하지 않은 사용자도 채팅할 수 있습니다. 이 동작은 그대로 유지합니다.

### 1.2 문제
SharpTalk은 지금 누가 채팅하는지 모릅니다. 그래서 모든 사용자가 '게스트'로 처리됩니다.
- HA 관리자는 로그인할 때 이미 Go2Joy 약관에 동의했는데도 데이터 처리 동의 안내가 표시됩니다.
- 사용자 이름 대신 일반 제목 "Support center"가 표시됩니다.
- 호텔 / 성·시 / 지역을 알 수 없어 올바른 지원팀(하노이 또는 호찌민)으로 연결하지 못하고, 콘솔의 상담원도 어느 호텔을 지원하는지 알 수 없습니다.

### 1.3 SharpTalk이 로그인 사용자를 직접 조회할 수 없는 이유
Go2Joy 파트너 API는 **파트너 단위 인증**(clientId + HMAC-SHA256 서명 + IP 화이트리스트)이며 **호텔 데이터**만 제공합니다. "지금 HA에 로그인한 사용자"를 알려주는 엔드포인트(사용자 토큰, `/me`, `/profile`)는 없습니다.

또한 2026-10-21 접속 테스트(7.1)에서 HA UAT 테스트 호텔(1721)은 Hotel Feed에 없었고, `getHotelInfo` 응답에는 성·지역 필드가 없었습니다. 따라서 **로그인 사용자와 그 호텔의 성·지역은 HA가 직접 보내야 합니다**.

## 2. SharpTalk 개요
SharpTalk은 Amoeba의 멀티 테넌트 고객지원 채팅 플랫폼입니다. Go2Joy(테넌트 `go2joy`) 기준으로는 다음과 같습니다.
- **위젯**: 스크립트 1개(`embed.js`)로 HA 페이지에 삽입됩니다. 화면 오른쪽 아래의 JoyBot입니다.
- **AI 어시스턴트**: Go2Joy 지식 베이스로 답변하며, AI와 상담원의 모든 답변은 검수(모더레이션)를 거칩니다.
- **상담원 연결**: 사람이 필요하면 라우팅 규칙(지역, 성·시, 호텔, 역할 등)에 따라 SharpTalk 콘솔의 Go2Joy 상담원(CS / Sale Admin)에게 연결됩니다.
- **사용자 식별**: HA가 유효한 식별 패키지를 보내면 채팅 세션이 '게스트'에서 '검증됨'으로 바뀌고, 호텔·지역 정보가 라우팅과 콘솔 표시에 쓰입니다.

## 3. 통신 흐름
1~4단계는 Go2Joy 시스템에서, 5~9단계는 SharpTalk에서 처리합니다.

| 단계 | 주체 | 동작 |
|---|---|---|
| 1 | HA 사용자 → HA FE | 로그인(기존과 동일) |
| 2 | HA FE → HA 서버 | 식별 패키지 요청 |
| 3 | HA 서버 | 로그인 세션·DB로 payload 생성 → **NFC 정규화** → secret으로 HMAC-SHA256 서명 |
| 4 | HA 서버 → HA FE | `{userId, hash, name, attributes}` 반환 |
| 5 | HA FE → SharpTalk 위젯(iframe) | `SharpTalk.identify(패키지)` — 값을 가공하지 않고 그대로 |
| 6 | 위젯 → SharpTalk API | `POST /api/v1/public/embed/identify` |
| 7 | SharpTalk API | 서명 재계산·비교 → 일치하면 채팅 세션에 저장, 불일치하면 401 E5048(게스트 유지) |
| 8 | SharpTalk API → 위젯 | 200: verified, 이름, 동의 상태 |
| 9 | 위젯 → HA FE | `identified` 이벤트 `{ok}` |
| 결과 | — | 위젯: 동의 안내 제거, 제목에 사용자 이름 / 콘솔: 호텔·성/시·지역·역할 표시 |

| 상황 | 동작 |
|---|---|
| 미로그인 | 추가 호출 없음. 현재와 동일: 게스트, 동의 안내 표시 |
| 로그인 직후 / 로그인 상태로 새로고침 | 로그인 상태가 확정되면 `SharpTalk.identify()`를 1회 호출 |
| 선택 호텔 변경 | 서버가 새 호텔로 패키지를 다시 서명 → `identify` 재호출(안전하며 덮어씀). 이미 배정된 상담원은 유지되고, 다음 연결부터 새 지역 기준 |
| **호텔 미선택**(체인 "전체 호텔") | `hotel_id`·`hotel_name`·`province`·`region`을 **빼고** 서명·전송(`role`만 남거나 속성 없음) → 지역 미상 → 폴백 담당자 |
| 로그아웃 | `SharpTalk.logout()` 호출 — 세션을 끊어 다음 사용자가 이름·호텔을 이어받지 않도록 함 |
| 서명 오류 / 변조된 패키지 | SharpTalk이 거부(401 E5048). 위젯은 게스트 모드로 계속 동작하며 채팅은 중단되지 않음 |

### 3.1 상담원 배정 시점
배정은 채팅을 시작할 때가 아니라 **사람이 필요해지는 순간**에 한 번 실행됩니다. 두 경우 모두 같은 라우팅 규칙을 씁니다.

| 트리거 | 예 | SharpTalk 이관 사유 |
|---|---|---|
| ① AI가 답할 수 없어 이관 | 지식 베이스에 근거가 없음, 신뢰도 미달, 정책상 사람이 답해야 하는 주제 | `low_confidence` · `policy` · `moderation_blocked` |
| ② 직원이 상담원 연결을 요청 | 위젯의 "상담원 연결" 버튼·칩 | `user_request` |

두 트리거 모두 **식별 단계(5~8)에서 저장한 지역**을 읽습니다. 따라서 HA는 로그인 직후 `identify`만 해 두면 되고, 이관 시점에 따로 할 일은 없습니다.

> 서명 키를 FE에 두고 JSON을 직접 보내면 안 되는 이유: 브라우저의 데이터는 누구나 DevTools로 고칠 수 있습니다. 서명 없는 값을 믿으면 다른 호텔 관리자를 사칭하거나, 다른 지역을 골라 지원 순서를 앞당기거나, 동의 절차를 건너뛸 수 있습니다. 서버만 아는 secret으로 HA 서버가 만든 HMAC 서명이 "Go2Joy가 발급했고 변조되지 않았음"을 증명합니다.

## 4. 전달 데이터
"HA 내 출처"는 HA FE에 이미 있는 데이터입니다(2026-10-20 UAT 계정으로 확인). **서명할 때 HA 서버는 브라우저가 아니라 자체 로그인 세션·DB에서 값을 가져와야 합니다.**

| 정보 | HA 내 출처 (UAT 예시) | SharpTalk 필드 | 서명 | 용도 |
|---|---|---|---|---|
| 사용자 ID | User Id · `profile.value.userId` · `go2joysupport` | `userId` | 예 | 식별, 채팅 이력 연결 |
| 이름 | Name · `profile.value.fullName` · `G2J SUPPORT` | `name` | 아니오 | 위젯 제목, 콘솔 |
| 이메일 | Email · `profile.value.email` | `email` | 아니오 | 콘솔 프로필, 업무 시간 외 회신(선택) |
| 휴대폰 | Mobile (My profile) | `phone` | 아니오 | 콘솔 프로필(선택) |
| 선택 호텔 | `profile.value.hotelSn` · `1721` | `attributes.hotel_id` | 예 | 라우팅, 콘솔 |
| 호텔명 | `profile.hotelViewList[].name` · `A In Hotel Del Luna` | `attributes.hotel_name` | 예 | 콘솔, 라우팅 |
| **성·시** | 호텔의 성 → **지역표 `NAME`** · `Hồ Chí Minh` | `attributes.province` | 예 | 성·시 기준 라우팅 |
| **지역** | 성 → **지역표 `REGIONS_TEXT`** · `South` | `attributes.region` | 예 | **지역 기준 라우팅(팀 선택)** |
| 역할 | `TRACKING_PROFILE.roleName` · `Lễ tân` | `attributes.role` | 예 | 라우팅, 콘솔 |
| 사업자 상호 / 주소 | My profile | `business_name` / `address` (제안) | — | **미지원** — Go2Joy가 필요하다고 확인하면 SharpTalk에서 먼저 활성화 |

### 4.1 지역(region) 규약 — v1.1 변경
`region`과 `province`는 Go2Joy가 제공한 지역표(`Khu vực và Tỉnh_ Thành phố.xlsx`, 63개 성)의 값을 **표기 그대로** 씁니다. SharpTalk이 이 표를 Go2Joy 파트너 API Province Feed와 대조한 결과 63개 성 이름과 지역 코드가 모두 일치했습니다. 즉 **HA DB의 성 테이블이 가진 region 값을 그대로 쓰면 됩니다**.

| REGIONS | `region`으로 보낼 값 | 성 수 | 예 |
|---|---|---|---|
| 2 | `North` | 25 | Hà Nội, Hải Phòng, Quảng Ninh |
| 4 | `North Center` | 6 | Thanh Hóa, Nghệ An, Thừa Thiên Huế |
| 5 | `South Center` | 13 | Đà Nẵng, Khánh Hòa, Lâm Đồng |
| 1 | `South` | 19 | Hồ Chí Minh, Bình Dương, Cần Thơ |

- 전체 목록은 **부록 A**에 있습니다.
- 숫자 코드(`1`, `2` …)나 v1.0의 `north` · `central` · `south`는 보내지 마십시오.
- HA가 지역을 계산할 수 없는 경우에는 `province`만 보내도 됩니다. 이때는 SharpTalk이 같은 지역표로 `region`을 채웁니다(9절 S2, UAT 전 배포).

### 4.2 지역 → 상담팀 (Go2Joy 확인 필요)
팀 배정은 SharpTalk 콘솔에서 설정합니다. 아래는 제안이며, Go2Joy가 확정해 주면 그대로 설정합니다.

| 순서 | 규칙 | 지역 | 업무 조건 | 담당 |
|---|---|---|---|---|
| 1 | 하노이 Sale Admin | North, North Center | 정산·계약·수수료 관련 문의 | 하노이 팀 × Sale Admin |
| 2 | 하노이 CS | North, North Center | — | 하노이 팀 × CS |
| 3 | 호찌민 Sale Admin | South, South Center | 정산·계약·수수료 관련 문의 | 호찌민 팀 × Sale Admin |
| 4 | 호찌민 CS | South, South Center | — | 호찌민 팀 × CS |
| 5 | 폴백 | (지역 없음) | — | 지정 담당자 |

**확인 요청**: ① 2팀(하노이·호찌민)인지 지역별 4팀인지 ② **South Center**(다낭·중부 고원 13개 성)는 어느 팀인지 ③ 팀별 상담원 계정 ④ Sale Admin으로 보낼 문의의 기준 ⑤ 폴백 담당자.

### 4.3 중요 규칙
- `attributes`에는 `hotel_id`, `hotel_name`, `province`, `region`, `role` **5개 키만** 보냅니다. 알 수 없는 키는 SharpTalk이 서명 계산 전에 제거하므로 서명이 어긋나 **패키지 전체가 거부됩니다(401)**.
- 서명하지 않는 필드(`name`, `email`, `phone`)는 표시용입니다. 값이 비어 있으면 필드 자체를 빼십시오(`email`이 빈 값이거나 형식 오류이면 400).
- `name`은 보낼 때마다 갱신되고, `email`/`phone`은 SharpTalk 프로필이 비어 있을 때만 기록됩니다.

## 5. 기술 사양

### 5.1 서명 문자열 (문자 단위로 정확히 일치해야 함)
```
no attributes   : userId
with attributes : userId + "\n" + key=value + "\n" + key=value ...   (keys in alphabetical order)

hash = hex( HMAC-SHA256( key = SHARPTALK_EMBED_SECRET, message = signing string as UTF-8 ) )
       → 64 lowercase hex characters

Example signing string (UAT data, v1.1):
go2joysupport
hotel_id=1721
hotel_name=A In Hotel Del Luna
province=Hồ Chí Minh
region=South
role=Lễ tân
```
- 값은 **앞뒤 공백을 제거**하고, 줄바꿈 없이, **최대 120자**입니다. 빈 값은 서명 문자열과 payload **모두에서** 뺍니다.
- 전송하는 `attributes` 값은 서명한 값과 **완전히 같아야** 합니다(공백, 대소문자, 베트남어 성조 부호 포함).
- **[v1.1] 유니코드 정규화(NFC)**: 같은 `Hồ Chí Minh`이라도 조합형(NFC)과 분해형(NFD)은 바이트가 달라 해시가 달라집니다. Go2Joy 데이터에는 분해형이 섞여 있는 경우가 있습니다(파트너 API Hotel Feed 일부 설명에서 확인). **서명 전에 모든 값을 NFC로 정규화**하고, 정규화한 그 값을 그대로 전송하십시오(5.2의 `$clean`).
- **[v1.1] 공백**: PHP의 `trim()`은 NBSP(U+00A0) 같은 유니코드 공백을 지우지 않지만, SharpTalk(JavaScript `trim()`)은 지웁니다. 값 끝에 NBSP가 남으면 서명이 어긋나므로 5.2처럼 유니코드 공백을 명시적으로 정리하십시오.
- `hotel_id`는 문자열(`"1721"`)로 보내고, `userId`는 최대 120자입니다.
- Go2Joy 파트너 API 서명과 같은 개념(HMAC-SHA256, 키 알파벳 정렬)이며, 문자열 형식과 방향만 다릅니다.

### 5.2 Hotel Admin 서버 (PHP)
```php
<?php
// New endpoint on the HA server, e.g. GET /api/v1/staff/sharptalkIdentity
// — returned only to a signed-in session, over HTTPS, never logged.
// SHARPTALK_EMBED_SECRET: signing key, server only (environment variable).
// NEVER send it to the browser, front-end code or logs.
// $staff[...] / $hotel[...] column names are illustrative — use HA's real data.
// $hotel['province_name'] / $hotel['region_text'] come from Go2Joy's province table
// (NAME / REGIONS_TEXT, see Appendix A). $hotel = null when no hotel is selected.

function sharptalk_clean($v): string
{
    $s = (string) ($v ?? '');
    if (class_exists('Normalizer')) {                       // ext-intl
        $s = Normalizer::normalize($s, Normalizer::FORM_C); // [v1.1] NFC before signing
    }
    // [v1.1] collapse ALL whitespace incl. NBSP (U+00A0) and ideographic space (U+3000)
    $s = preg_replace('/[\s\x{00A0}\x{2000}-\x{200B}\x{3000}]+/u', ' ', $s);
    return mb_substr(trim($s), 0, 120);
}

function sharptalk_identity(array $staff, ?array $hotel): array
{
    $attributes = array_filter([
        'hotel_id'   => sharptalk_clean($hotel['sn'] ?? ''),            // "1721"
        'hotel_name' => sharptalk_clean($hotel['name'] ?? ''),          // "A In Hotel Del Luna"
        'province'   => sharptalk_clean($hotel['province_name'] ?? ''), // "Hồ Chí Minh"  (NAME)
        'region'     => sharptalk_clean($hotel['region_text'] ?? ''),   // "South"        (REGIONS_TEXT)
        'role'       => sharptalk_clean($staff['role_name'] ?? ''),     // "Lễ tân"
    ], fn($v) => $v !== '');                 // drop empty values (signature + payload)
    ksort($attributes, SORT_STRING);         // keys in alphabetical order

    $userId = sharptalk_clean($staff['user_id']);   // "go2joysupport"
    $lines  = [$userId];
    foreach ($attributes as $k => $v) {
        $lines[] = $k . '=' . $v;
    }
    $hash = hash_hmac('sha256', implode("\n", $lines), getenv('SHARPTALK_EMBED_SECRET'));

    $payload = ['userId' => $userId, 'hash' => $hash];    // hash: lowercase hex, 64 chars
    $profile = [
        'name'  => sharptalk_clean($staff['full_name'] ?? ''),  // not signed — display
        'email' => trim((string) ($staff['email'] ?? '')),      // not signed
        'phone' => trim((string) ($staff['mobile'] ?? '')),     // not signed
    ];
    foreach ($profile as $k => $v) {
        if ($v !== '') $payload[$k] = $v;                     // omit empty fields
    }
    if ($attributes) {
        $payload['attributes'] = $attributes;                 // exactly the signed values
    }
    return $payload;
}
```
- 120자 제한은 SharpTalk에서 JavaScript 문자열 길이(UTF-16 단위)로 셉니다. 베트남어(NFC)는 PHP `mb_substr`와 같은 길이이지만, 이모지 같은 문자는 2자로 셉니다. 호텔 이름에 이모지가 있을 수 있다면 100자 정도로 여유 있게 자르십시오.
- **NFC 정규화에는 PHP `intl` 확장(`Normalizer`)이 필요합니다.** `intl`이 없으면 위 코드는 정규화를 건너뜁니다. 이때도 서명은 그대로 검증됩니다(SharpTalk은 받은 값 그대로 서명을 검증하므로). 다만 분해형 값이 그대로 저장되므로 `intl` 사용을 권장합니다. SharpTalk도 저장 전에 NFC로 정규화합니다(9절 S1).
- 이 코드는 PHP 8.3에서 실행해 5.4의 T1~T4 해시가 그대로 나오는 것을 확인했습니다(2026-10-21). 분해형(NFD) + NBSP 입력도 `intl`이 있으면 T2 해시가 나옵니다.
- 응답 JSON은 `json_encode($payload, JSON_UNESCAPED_UNICODE)`처럼 보내도 되고 기본 이스케이프(`\u1ed3` 형태)로 보내도 됩니다. 브라우저가 JSON을 해석하면 같은 문자가 되므로 서명에는 영향이 없습니다. 다만 **FE에서 값을 가공하지 마십시오**.

### 5.3 Hotel Admin FE
**임베드 스크립트(현재 코드 대체)**
```html
<!-- (1) KEEP the current script (guests still get the chatbot); add locale + a queue -->
<script>
  window.SHARPTALK_WIDGET_CONFIG = {
    shop: "https://www.go2joy.vn",
    widgetUrl: "https://shoptalk.amoeba.site/widget",
    agent: "hotel-partner",
    locale: "vi"                      // current HA language: "vi" | "en"
  };
  // Queue: lets the page call SharpTalk.* before embed.js (defer) has loaded
  window.SharpTalk = window.SharpTalk || { q: [] };
  function sharptalkCall(method, arg) {
    if (typeof window.SharpTalk[method] === 'function') window.SharpTalk[method](arg);
    else window.SharpTalk.q.push([method, arg]);
  }
</script>
<script src="https://shoptalk.amoeba.site/widget/embed.js" defer></script>
```

**로그인 / 호텔 변경 / 로그아웃 시 호출**
```js
// (2) ADD — once the user is known to be signed in (just signed in, or page reloaded)
//          and AGAIN whenever the selected hotel changes (incl. "all hotels")
async function sharptalkSignIn() {
  const identity = await haApi.get('/staff/sharptalkIdentity'); // signed package (5.2)
  sharptalkCall('identify', identity); // pass it through UNCHANGED
}

// (3) ADD — on sign-out
function sharptalkSignOut() {
  sharptalkCall('logout');
}

// (Optional) receive the verification result for HA-side logging
window.addEventListener('message', (e) => {
  if (e.origin !== 'https://shoptalk.amoeba.site' || !e.data || e.data.type !== 'ivy:event') return;
  if (e.data.event === 'identified') {
    console.info('[SharpTalk] identify', e.data.ok ? 'OK' : 'rejected — check signature/secret');
  }
});
```

**UAT 데이터 기준으로 FE가 위젯에 넘기는 패키지(v1.1)**
```json
{
  "userId": "go2joysupport",
  "hash": "<64 hex chars computed by the HA server>",
  "name": "G2J SUPPORT",
  "email": "<email>",
  "phone": "<mobile>",
  "attributes": {
    "hotel_id": "1721",
    "hotel_name": "A In Hotel Del Luna",
    "province": "Hồ Chí Minh",
    "region": "South",
    "role": "Lễ tân"
  }
}
```

### 5.4 테스트 벡터 (v1.1 갱신)
테스트용 secret `test-secret-do-not-use`(실제 secret 아님)를 씁니다. HA 서명 코드가 아래 해시를 **정확히** 만들어 내면, 실제 secret을 쓸 때도 SharpTalk에서 승인됩니다. 모든 해시는 SharpTalk 서버의 실제 검증 코드로 계산했습니다.

| # | userId + attributes | 기대 해시 |
|---|---|---|
| T1 | `go2joysupport` · (attributes 없음) | `9f4c6d749cd0545c69969edf105e09ad1e695c8b2db9d5b750005bb6b1b2fdea` |
| T2 | `go2joysupport` · hotel_id=`1721`, hotel_name=`A In Hotel Del Luna`, province=`Hồ Chí Minh`, region=`South`, role=`Lễ tân` | `fd3949c1bd48116b8b52d4b37a0e03de9ed4e0845c49897967efef60aa91926b` |
| T3 | `ha-test-02` · hotel_id=`2001`, hotel_name=`Huế Garden Hotel`, province=`Thừa Thiên Huế`, region=`North Center`, role=`Chủ khách sạn` | `605723a42994ddc8b59a822882a652afcc4c410e8d19cd8441e0063248be2743` |
| T4 | `ha-test-03` · hotel_id=`3001`, hotel_name=`Hạ Long Bay Hotel`, province=`Quảng Ninh`, role=`Lễ tân` (**region 없음**) | `506d8d3aa38bdba5a0abf28eb1e68ab37aac53b68dbbe07e12fb39316db35ee2` |

- v1.0의 T2(`region=south`, 해시 `bd80e8cd…f432d2`)는 **폐기**합니다.
- 입력 문자열은 모두 NFC입니다. 같은 T2를 분해형(NFD)으로 서명하면 `72fc3fab…5bf75f`처럼 **다른 해시**가 나옵니다. NFD 입력으로 T2를 실행했을 때 `sharptalk_clean()`을 거쳐 T2의 기대 해시가 나오면 정규화가 올바르게 동작하는 것입니다.

### 5.5 SharpTalk 응답
위젯이 `POST https://shoptalk.amoeba.site/api/v1/public/embed/identify`를 직접 호출합니다. Go2Joy가 이 API를 직접 호출할 필요는 없으며, 점검할 때 DevTools › Network에서 확인할 수 있습니다.

| 결과 | 의미 | 조치 |
|---|---|---|
| 200 | 검증 성공 — 채팅 세션 '검증됨', 호텔·지역 연결 | — |
| 401 · E5048 | 서명 불일치: 서명 문자열 오류, secret·환경 불일치, 알 수 없는 키, 120자 초과·줄바꿈 포함 값, NFC/공백 차이 | 5.1과 비교, 5.4 테스트 벡터 재실행 |
| 400 | 형식 오류: email 빈 값·형식 오류, userId 길이 초과 등 | 빈 필드 제외, 형식 확인 |
| 404 | 채팅 세션 없음 | 위젯이 자동 처리, 페이지 새로고침 |

## 6. 동작 검증 (v1.0에서 이어짐)
- **6.1 HA UAT 실제 페이지(2026-10-20)**: HA FE가 가진 데이터(userId, 이름, 호텔 1721, Hồ Chí Minh, Lễ tân)로 패키지를 만들어 가짜 해시로 `SharpTalk.identify`를 호출 → 1초 안에 `identified {ok:false}` 수신, API는 401 E5048. **전달 경로는 동작하고, 서명 없는 패키지는 거부됩니다.**
- **6.2 서명된 정상 흐름(2026-10-19, RPT-261019)**: go2joy 테넌트의 스테이징 secret으로 서명 → 세션 verified, HA 약관 기준 동의 기록, 동의 안내 없음, 제목에 이름 표시, 이름 변경 반영, 미서명 세션은 게스트 유지.
- **6.3 [v1.1] 테스트 벡터 재계산(2026-10-21)**: 5.4의 T1~T4를 SharpTalk 서버 검증 코드로 직접 계산해 표의 값과 일치함을 확인했습니다. 5.2의 PHP 코드(PHP 8.3)도 같은 해시를 냅니다. 호텔을 선택하지 않고 역할도 없는 패키지는 T1과 같은 해시입니다.
- **6.4 [v1.1] 지역표 대조(2026-10-21)**: 지역표 63행 = 파트너 API Province Feed 63개 성(이름·region 모두 일치).

HMAC-SHA256은 결정적이므로 같은 secret과 같은 서명 문자열이면 PHP, Node 등 어떤 언어에서도 같은 해시가 나옵니다. HA 코드가 5.4 테스트 벡터와 같은 결과를 내면 실제 연동에서도 승인됩니다.

## 7. 보안 및 서명 키 선택
| | **A — SharpTalk 발급 별도 secret(권장)** | B — Go2Joy client secret 사용 |
|---|---|---|
| identify 서명 키 | Go2Joy 전용 embed secret, 환경별 1개, 보안 채널로 전달 | Go2Joy가 SharpTalk에 발급한 client secret |
| 준비 상태 | 즉시 사용 가능 — 스테이징에서 사용 중 | SharpTalk에 "파트너가 준 secret 입력" 기능 추가 필요(소규모) |
| 키 유출 시 | 채팅 식별에만 영향, 파트너 API는 영향 없음 | 채팅 식별과 파트너 API 호출 권한 모두 영향 |
| 키 교체 | 독립적: SharpTalk 콘솔에서 교체, HA는 환경변수 1개 갱신 | Go2Joy가 client secret을 바꿀 때마다 SharpTalk도 동시에 갱신해야 함(아니면 모든 identify가 401) |
| Go2Joy 관리 키 수 | 2 | 1 |

**SharpTalk 제안: 방안 A — 방향별로 키 1개.** HA → SharpTalk(식별)은 SharpTalk이 발급한 embed secret, SharpTalk → Go2Joy API는 Go2Joy client key/secret을 발급 목적대로 사용합니다.

**일반 원칙**
- secret은 HA 서버(환경변수)에만 둡니다. FE 코드, 브라우저, 모바일 앱, 로그, 문서에 넣지 마십시오.
- 서명된 패키지는 로그인 세션에만 HTTPS로 반환하고, 로그에 남기지 않습니다.
- 현재 서명 패키지에는 유효기간이 없습니다. 어떤 사용자의 패키지를 손에 넣은 사람은 그 사용자 이름으로 채팅에 재사용할 수 있습니다. Go2Joy가 요청하면 SharpTalk이 유효기간이 있는 서명 시각 필드를 추가할 수 있습니다.
- 로그아웃 시 반드시 `SharpTalk.logout()`을 호출하십시오. 프런트 데스크 공용 PC에서 특히 중요합니다.
- 스테이징과 프로덕션의 secret은 다르며, SharpTalk이 별도로 전달합니다(일반 이메일·채팅으로 보내지 않음).

### 7.1 [v1.1] 파트너 API 접속 테스트 결과와 확인 요청
Go2Joy가 발급한 테스트 client key로 2026-10-21 `staging-partner.go2joy.vn`에 접속했습니다(Province / District / Hotel Feed, getHotelInfo 모두 성공, 140~250ms). 다음을 확인 부탁드립니다.

| # | 관찰 | 요청 |
|---|---|---|
| P1 | 스테이징이 **서명·timestamp·Authorization 헤더·IP**를 검증하지 않음(틀린 secret, 1시간 전 timestamp도 성공). clientId만 검증, 틀리면 `code 10`(문서상 8) | 서명을 검증하는 테스트 환경, 또는 고정 요청 본문에 대한 **기대 서명 샘플** |
| P2 | Hotel Feed에 `provinceSn=0, districtSn=0, hotelSnList=[…]`를 보내면, 목록 중 피드에 있는 호텔이 **하나도 없을 때 필터가 무시되고 전체가 반환**됨 | 일치하는 호텔이 없으면 빈 목록을 반환하도록 수정, 또는 동작 확인 |
| P3 | 이 clientId로 보이는 Hotel Feed 호텔이 13개뿐이고, HA UAT 테스트 호텔 1721이 없음 | 피드 범위(HA 호텔 전체 포함 여부) |
| P4 | 운영 연동 | SharpTalk 서버 IP 화이트리스트 등록(스테이징·운영 IP는 별도 전달), 운영 client key 발급 절차 |

## 8. 구현 및 점검

### 8.1 역할 분담
| 주체 | 작업 | 비고 |
|---|---|---|
| Go2Joy | 서명된 식별 패키지를 반환하는 서버 엔드포인트(5.2) — **region = REGIONS_TEXT, province = NAME, NFC 정규화** | PHP 약 35줄 |
| Go2Joy | FE: 임베드 스크립트 교체, 로그인 후·**호텔 변경 시** identify, 로그아웃 시 logout(5.3) | JS 약 15줄 |
| Go2Joy | 서명 코드로 5.4 **T1~T4** 실행, 결과를 SharpTalk에 전달 | 연동 전 |
| Go2Joy | 서명 키 방안 선택(7절) | A 권장 |
| Go2Joy | **지역 → 팀 매핑 확정과 팀별 상담원 계정**, Sale Admin 문의 기준, 폴백 담당(4.2) | 라우팅 설정 입력용 |
| Go2Joy | HA 약관 URL + 버전 전달 | HA 약관 기준 동의 기록용 |
| Go2Joy | 이메일·휴대폰 전송 여부, 사업자 상호·주소 필요 여부 | — |
| Go2Joy | 파트너 API 확인 요청 P1~P4(7.1) | — |
| SharpTalk | 보안 채널로 스테이징 secret 전달 | 방안 A |
| SharpTalk | 콘솔에 지역 → 팀 라우팅 규칙 설정(AI 이관·직원 요청 공통) | 4.2 확정 후 |
| SharpTalk | **[v1.1] 수신 속성 NFC 정규화 + 성 → 지역 대체 매핑(지역표 63행)** | 9절, UAT 전 스테이징 배포 |

### 8.2 UAT 체크리스트
| 점검 | 기대 결과 |
|---|---|
| 미로그인 상태에서 위젯 열기 | 현재와 동일: 게스트, 동의 안내 표시 |
| 로그인 후 위젯 열기 | 동의 안내 없음, 제목에 이름 표시 |
| DevTools › Network: `POST …/public/embed/identify` | 200, 응답에 `consentState: "granted"` |
| identified 이벤트 리스너(5.3) | `ok: true` |
| SharpTalk 콘솔 › Live chat | 세션에 호텔, 성·시, 지역(`South` 등), 역할 표시 |
| **[v1.1] AI가 답할 수 없는 질문을 보냄** | AI가 이관 → **지역에 맞는 팀**으로 연결 |
| 채팅에서 "상담원 연결" 요청 | 지역에 맞는 팀으로 연결(하노이 / 호찌민) |
| **[v1.1] 지역별 호텔로 각각 로그인**(North / North Center / South Center / South) | 4.2에서 확정한 팀으로 연결 |
| 선택 호텔 변경 | 콘솔에 새 호텔 표시, 다음 연결부터 새 지역 기준 |
| **[v1.1] 호텔 미선택("전체 호텔")** | 200, 지역 없음 → 폴백 담당자 |
| **[v1.1] 성·호텔 이름에 성조 부호가 많은 호텔**(예: Thừa Thiên Huế) | 401 없이 200, 콘솔 표기 정상 |
| 로그아웃 후 위젯 열기 | 게스트 모드로 복귀 |
| 패키지 값 하나를 재서명 없이 수정 | 401 E5048, `ok: false`, 위젯 게스트 모드 |

## 9. SharpTalk 측 추가 작업 (v1.1)
| # | 작업 | 효과 | 일정 |
|---|---|---|---|
| S1 | 서명 검증 후 속성 값을 **NFC로 정규화**해 저장·규칙 비교에 사용(서명 검증은 받은 그대로) | HA가 분해형을 보내도 성·시 조건이 어긋나지 않음 | UAT 전 |
| S2 | go2joy 테넌트에 **성 → 지역 대체 매핑**(지역표 63행) 등록: `region`이 없고 `province`만 있으면 `region`을 채움. 둘 다 있는데 다르면 서명 값을 유지하고 경고 로그 | HA가 지역을 계산할 수 없어도 지역 배정 가능 | UAT 전 |
| S3 | 콘솔 라우팅 규칙에서 지역을 4종 중 선택 | 오타로 규칙이 맞지 않는 일 방지 | UAT 전(선택) |
| S4 | 4.2 확정 후 라우팅 규칙·팀·상담원 설정 | 하노이 / 호찌민 배정 | Go2Joy 확정 후 |

---

## 부록 A. 지역표 (Go2Joy 제공 `Khu vực và Tỉnh_ Thành phố.xlsx`, 63개 성)
`province` = NAME, `region` = REGIONS_TEXT. 2026-10-21 파트너 API Province Feed와 63/63 일치.

| REGIONS | region | province (NAME) |
|---|---|---|
| 2 | North | Hà Nội, Hà Giang, Cao Bằng, Bắc Kạn, Tuyên Quang, Lào Cai, Điện Biên, Lai Châu, Sơn La, Yên Bái, Hoà Bình, Thái Nguyên, Lạng Sơn, Quảng Ninh, Bắc Giang, Phú Thọ, Vĩnh Phúc, Bắc Ninh, Hải Dương, Hải Phòng, Hưng Yên, Thái Bình, Hà Nam, Nam Định, Ninh Bình |
| 4 | North Center | Thanh Hóa, Nghệ An, Hà Tĩnh, Quảng Bình, Quảng Trị, Thừa Thiên Huế |
| 5 | South Center | Đà Nẵng, Quảng Nam, Quảng Ngãi, Bình Định, Phú Yên, Khánh Hòa, Ninh Thuận, Bình Thuận, Kon Tum, Gia Lai, Đắk Lắk, Đắk Nông, Lâm Đồng |
| 1 | South | Hồ Chí Minh, Bình Phước, Tây Ninh, Bình Dương, Đồng Nai, Bà Rịa - Vũng Tàu, Long An, Tiền Giang, Bến Tre, Trà Vinh, Vĩnh Long, Đồng Tháp, An Giang, Kiên Giang, Cần Thơ, Hậu Giang, Sóc Trăng, Bạc Liêu, Cà Mau |

- 이 표는 통폐합(2025-07, 63 → 34) 전 체계입니다. Go2Joy가 성 체계를 바꾸면 새 표를 SharpTalk에 전달해 주십시오(S2 매핑 갱신).
- 필리핀(REGIONS 10)은 이 표에 없습니다. PH HA를 대상으로 할 경우 별도로 협의합니다.
