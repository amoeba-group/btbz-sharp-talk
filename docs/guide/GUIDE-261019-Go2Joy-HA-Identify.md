# GUIDE-261019 — Go2Joy Hotel Admin: 로그인 사용자 연동(identify) · 동의 배너 생략 · 헤더 이름

- 대상: Go2Joy HA(Hotel Admin) 개발팀 · 근거: [PLN-261019-Go2Joy-HA-Consent-Skip-Header-Name](../plan/PLN-261019-Go2Joy-HA-Consent-Skip-Header-Name.md) · 공통 가이드: [임베드 SDK 설치 가이드 §3](임베드SDK설치가이드_Embed-SDK.ko.md)
- 효과: HA 로그인 사용자는 **개인정보 안내 배너 없이** 바로 상담하고, 위젯 헤더 로고 옆에 **프로필 이름**이 보입니다. 상담원 배정에 쓰는 호텔·지역·권한도 같은 호출로 전달됩니다.

## 1. 원리
SharpTalk 테넌트 go2joy의 동의 방식은 **"호스트 앱 약관"**(`consent_source = host_terms`)입니다. 이 모드에서는
HA 서버가 **서명한** `identify` 호출을 받은 세션만 "약관으로 동의 완료"로 기록되고 배너가 사라집니다.
서명이 없거나 틀리면 방문자는 게스트로 남고 배너가 그대로 나옵니다(동의 우회 방지). `name`은 서명 대상이 아니며
표시용으로만 쓰입니다 — 보낼 때마다 위젯의 표시 이름을 갱신합니다.

## 2. HA 서버 — 서명 생성 (로그인 완료 시 1회)
```js
// Node.js 예시. SHOPTALK_EMBED_SECRET = SharpTalk이 전달한 go2joy 임베드 시크릿(서버에만 보관, 브라우저에 노출 금지)
const crypto = require('crypto');
function sharptalkIdentity(user, hotel) {
  const attributes = {
    hotel_id: String(hotel.id),         // 허용 키 5개: hotel_id · hotel_name · region · province · role
    hotel_name: hotel.name,
    region: hotel.region,               // north | central | south
    role: user.role,                    // 예: owner | reception
  };
  // 빈 값은 빼고 보냅니다(서명 문자열에서도 빠져야 함)
  const attrs = Object.fromEntries(Object.entries(attributes).filter(([, v]) => v != null && String(v).trim() !== ''));
  const signing = [String(user.id), ...Object.keys(attrs).sort().map((k) => `${k}=${attrs[k]}`)].join('\n');
  const hash = crypto.createHmac('sha256', process.env.SHOPTALK_EMBED_SECRET).update(signing).digest('hex');
  return { userId: String(user.id), hash, attributes: attrs, name: user.displayName }; // name = /profile에 보이는 이름
}
```
이 객체를 로그인 응답(또는 페이지 초기 데이터)에 실어 브라우저로 내려 줍니다. 시크릿 자체는 절대 내려 보내지 않습니다.

## 3. HA 페이지 — 위젯에 전달
```html
<script>
  window.SHARPTALK_WIDGET_CONFIG = { shop: "https://www.go2joy.vn", widgetUrl: "https://shoptalk.amoeba.site/widget", agent: "hotel-partner" };
</script>
<script src="https://shoptalk.amoeba.site/widget/embed.js" defer></script>
<script>
  // 로그인 사용자가 있을 때(페이지 로드 직후 또는 로그인 직후). 로더가 아직 준비 전이면 큐에 쌓였다가 전달됩니다.
  window.SharpTalk = window.SharpTalk || window.ShopTalk;
  SharpTalk.identify({ userId: identity.userId, hash: identity.hash, name: identity.name, attributes: identity.attributes });
  // 로그아웃 시: SharpTalk.logout();  // 세션을 끊어 다음 사용자가 이전 이름·동의를 물려받지 않게
</script>
```
- `userId`·`attributes`는 서명한 값과 **문자 단위로 같아야** 합니다(공백·대소문자 포함).
- SPA라면 라우트 전환이 아니라 **로그인 상태가 확정되는 시점**에 한 번 호출하면 됩니다. 같은 세션에 다시 호출해도 안전합니다(덮어씀).

## 4. 확인 방법
| 확인 | 기대 |
|---|---|
| 위젯 열기 | 개인정보 안내 배너 없음, 바로 인사말·시나리오 버튼 |
| 헤더 | `[G2J] <프로필 이름>` (설정값 `headerGreeting = {name}`), 언어 전환 시에도 이름 유지 |
| 브라우저 네트워크 | `POST /api/v1/public/embed/identify` → 200, 응답 `customerName`·`consentState: "granted"` |
| 401 `E5048`(EMBED_IDENTITY_INVALID) | 서명 불일치 — 서명 문자열(줄바꿈·키 정렬·빈 값 제거)과 시크릿을 확인. 이때 위젯은 게스트로 동작하고 배너가 보임 |
| SharpTalk 콘솔 | 라이브챗 세션에 호텔·지역 속성, 고객 정보에 이름 |

## 5. 운영 메모
- 임베드 시크릿은 환경별로 다릅니다(스테이징 `shoptalk.amoeba.site` / 프로덕션). 재발급은 SharpTalk 콘솔 설정 › 임베드 › 시크릿 재발급(마스터).
- 약관 URL·버전(`privacy_policy_url`, `consent_notice_version`)을 SharpTalk 설정 › 개인정보 안내에 넣어 두면 세션마다 "어느 버전의 약관으로 동의했는지"가 기록됩니다. 약관을 바꾸면 버전을 올려 주세요.
- 헤더에 "Chào {name}"처럼 인사말을 붙이고 싶으면 설정 › 위젯 문구 › 로그인 사용자 인사말(언어별)을 바꾸면 됩니다.
