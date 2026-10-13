# 샵톡 임베드 SDK 설치 가이드

고객사 사이트에 샵톡 위젯을 설치하고, 로그인한 사용자를 위젯에 알려주는 방법.
(PLN-260819 S1~S3 기준)

## 1. 위젯 설치

콘솔 → **설정 → 임베드 · SDK**에서 설치 코드를 복사해 페이지에 붙여넣습니다.

```html
<script>
  window.ShopTalk = window.ShopTalk || { q: [] };
  ShopTalk.q.push(['init', { shop: "your-store.myshopify.com" }]);
</script>
<script src="https://talk.example.com/v1/embed.js" defer></script>
```

> 설정을 **스크립트 태그보다 먼저** 큐에 넣는 이유: `defer` 스크립트는 문서 파싱이 끝난 뒤
> 실행되므로, 그 아래에 `ShopTalk.init(...)`을 인라인으로 쓰면 로더가 아직 없어 오류가 납니다.

`init()` 옵션

| 키 | 설명 |
|---|---|
| `shop` | 테넌트를 식별하는 스토어 도메인 (콘솔의 "스토어 도메인") |
| `locale` | 초기 언어 (`en`·`ko`·`es`·`vi`·`ja`·`zh`). 생략 시 페이지의 `lang` |
| `widgetUrl` | 위젯이 다른 도메인에 있을 때만 |
| `ga4Id` | GA4 측정 ID (선택) |

> 설정 전역 방식(`window.SHARPTALK_WIDGET_CONFIG` 설정 후 스크립트 삽입)도 **그대로
> 동작합니다.** 2026-09-10 이전 이름인 `window.IVY_WIDGET_CONFIG`도 영구히 인식하므로
> **이미 설치된 스토어는 아무것도 바꾸지 않아도 됩니다** — 새 설치만 새 이름을 쓰세요.
> JS API 전역도 `window.SharpTalk`·`window.ShopTalk` 어느 쪽이든 같은 객체입니다.

## 2. 허용 도메인

위젯은 **콘솔에 등록된 도메인에서만** 뜹니다. 비워두면 스토어 도메인만 허용합니다.

> **현재 기본값은 관측 모드입니다.** 아메바가 차단을 켜기 전까지는 목록에 없는 도메인도
> 동작하며 서버 로그에만 기록됩니다. 실제 차단 전환 전에 목록을 채워두시면 전환 시점에
> 아무것도 끊기지 않습니다.

- 정확히 일치: `https://www.example.com`
- 서브도메인: `https://*.example.com` (⚠️ 최상위 `example.com`은 **포함하지 않습니다** — 둘 다
  쓰려면 둘 다 등록하세요)
- 개발용 포트: `http://localhost` (포트를 적지 않으면 모든 포트 허용)

## 3. 로그인 연동 (선택)

고객사 시스템에 로그인한 사용자를 위젯이 알아보게 하려면, **고객사 서버**가 사용자 ID를
서명해 전달합니다.

### 3.1 시크릿 발급

콘솔 → 임베드 · SDK → **로그인 연동**에서 발급합니다. **화면을 닫으면 다시 볼 수 없으니**
바로 서버 환경변수에 넣으세요.

### 3.2 서버에서 서명

시크릿은 **절대 브라우저로 내려보내지 마세요.** 서명은 서버에서만 만듭니다.

```js
// Node.js
const crypto = require('crypto');
const hash = crypto.createHmac('sha256', process.env.SHOPTALK_EMBED_SECRET)
  .update(String(user.id))
  .digest('hex');
```

```python
# Python
import hmac, hashlib, os
hash = hmac.new(os.environ['SHOPTALK_EMBED_SECRET'].encode(),
                str(user.id).encode(), hashlib.sha256).hexdigest()
```

```php
// PHP
$hash = hash_hmac('sha256', (string)$user->id, getenv('SHOPTALK_EMBED_SECRET'));
```

### 3.3 페이지에서 전달

```html
<script>
  ShopTalk.identify({
    userId: "12345",        // 서명한 값과 정확히 같아야 합니다
    hash:   "<서버에서 생성한 해시>",
    name:   "Nguyen T.",    // 선택
    email:  "user@example.com" // 선택
  });
</script>
```

- **서명 대상은 `userId` 하나**입니다. `name`·`email`·`phone`은 서명하지 않으며 참고값으로만
  저장됩니다(비어 있는 항목만 채우고, 이미 확인된 값은 덮어쓰지 않습니다).
- 서명이 맞지 않으면 방문자는 **게스트로 계속 대화할 수 있습니다.** 로그인 실패가 문의 자체를
  막지 않습니다.

### 3.4 v2 — 파트너 컨텍스트(호텔·역할)까지 서명하기 (선택)

상담원 콘솔에 **"어느 호텔의 누구"**인지 보여주고 싶다면(파트너 포털·B2B 데스크) `claims`를 함께
보내고, 해시는 `userId` 하나가 아니라 **`userId|hotelSn|role|iat`** 문자열을 서명합니다.
`hotelName`·`hotelCode`는 표시용이며 서명하지 않습니다. `claims`가 있는데 v1 해시(`userId`만 서명)를
보내면 **전체가 거부**됩니다(자가 신고 호텔이 서명된 것처럼 보이는 일을 막기 위해서입니다).

```php
// PHP — HA가 선택한 호텔로 서명 (호텔을 바꾸면 다시 identify)
$iat   = time();                                  // 초 단위, 서버 시각 ±10분 안에 도착해야 함
$role  = 'receptionist';                          // manager | receptionist | internal
$parts = [(string)$user->id, (string)$hotelSn, $role, (string)$iat];
if (!empty($province)) { $parts[] = (string)$province; }   // province를 보낼 때만, 보내는 문자열 그대로
$canon = implode('|', $parts);
$hash  = hash_hmac('sha256', $canon, getenv('SHOPTALK_EMBED_SECRET'));
```

```html
<script>
  ShopTalk.identify({
    userId: "12345",
    hash:   "<위 $hash>",
    name:   "Nguyen T.",
    claims: {
      hotelSn:   "1721",                 // 서명 대상
      role:      "receptionist",        // 서명 대상
      iat:       1759734000,            // 서명 대상 (초)
      hotelName: "A In Hotel Del Luna", // 표시용
      hotelCode: "HCM_001_001721",      // 표시용
      province:  "Đà Nẵng"              // 선택 — 있으면 서명 대상 (아래 참고)
    }
  });
</script>
```

- **호텔 지역 라우팅(선택)**: 호텔의 시/도를 `province`로 함께 보내면, 테넌트가 지역 라우팅을 켠 경우
  해당 지역을 담당하는 팀(북부 / 남부)에게 대화가 전달됩니다. `province`를 보낼 때는 서명 문자열 끝에
  `|province`를 **보내는 문자열 그대로** 붙이고, 보내지 않을 때는 붙이지 않습니다. 비어 있는 값은 보내지
  말고 항목 자체를 빼세요. `province`를 보내면서 기존 공식(`userId|hotelSn|role|iat`)으로 서명하면
  서명이 맞지 않아 거부(E5048)되고 방문자는 게스트로 남습니다. 두 쪽(발급 서버와 `claims`)을 함께 바꾸세요.
- 로그인 사용자가 **다른 호텔로 전환**하면 새 `claims`로 `identify`를 다시 호출하세요. 로그아웃은
  `ShopTalk.logout()`.
- **세션 분리**: 이미 다른 사용자·호텔·역할로 연결된 세션에 `identify`를 호출하면 서버가 **새 세션을
  만들고 새 세션 토큰을 돌려줍니다.** 위젯이 그 토큰으로 자동 전환하므로 호스트가 할 일은 없고,
  이전 사용자의 대화는 이어지지 않습니다. 같은 사용자·호텔·역할로 다시 호출하거나 게스트에서 로그인으로
  바뀌는 경우에는 같은 세션이 유지됩니다. 로그인 중이던 세션에서 `identify`가 실패하면(서명 오류 등)
  위젯은 새 게스트 세션으로 초기화됩니다.
- `ShopTalk.logout()`은 위젯만 비우던 것에서 한 단계 더 나아가 **서버의 로그인 연결(호텔·역할 포함)도
  해제**하고, AI가 진행 중이던 대화를 종료한 뒤 새 게스트 세션을 엽니다. 상담원이 맡았거나 상담원
  대기 중인 대화는 닫지 않고 로그인 연결만 해제합니다.
- 콘솔(라이브 채팅·고객)에는 호텔명과 **서명된 hotelSn**이 함께 표시되고, 테넌트가 링크 템플릿을
  설정했다면 "호스트 시스템에서 열기" 버튼이 붙습니다(AI 설정 → 게스트 안내).
- 에이전트가 "로그인 안내만" 정책이면 identify 전의 방문자는 게스트 공개 카테고리로만 답을 받고,
  그 밖의 질문에는 로그인 안내(설정한 로그인/가입 URL 카드)가 나갑니다. 위젯이 그 URL을 열 때
  이 로더에 `ivy:open-url`을 보내며, 로더는 **위젯 iframe에서 온 https URL만** 따라갑니다.

## 4. 자바스크립트 API

| 호출 | 동작 |
|---|---|
| `ShopTalk.init(options)` | 설치·부팅 |
| `ShopTalk.open('chat' \| 'orders' \| 'notifications')` | 위젯 열기(탭 지정 가능) |
| `ShopTalk.close()` / `ShopTalk.toggle()` | 닫기 / 토글 |
| `ShopTalk.identify({ userId, hash, claims?, … })` | 로그인 사용자 전달 (`claims` = v2 호텔·역할 컨텍스트, §3.4) |
| `ShopTalk.logout()` | 서버의 로그인 연결 해제 + 새 게스트 세션 (§3.4) |
| `ShopTalk.setLocale('vi')` | 언어 변경 |
| `ShopTalk.on(event, fn)` / `off` | 이벤트 구독 |

스크립트 로드 전에 호출해야 한다면 큐를 씁니다:

```html
<script>
  window.ShopTalk = window.ShopTalk || { q: [] };
  ShopTalk.q.push(['init', { shop: 'your-store.myshopify.com' }]);
  ShopTalk.q.push(['open', 'chat']);
</script>
```

## 5. 자주 겪는 문제

| 증상 | 확인 |
|---|---|
| 위젯이 안 뜬다 | 콘솔 → 임베드 · SDK의 **허용 도메인**에 현재 페이지 도메인이 있는지 |
| 로그인해도 게스트로 보인다 | `userId`가 서명한 값과 같은지, 시크릿을 재발급한 뒤 서버를 갱신했는지 |
| 주문 탭이 비어 있다 | 신원 연동이 성공했는지(위와 동일), 해당 사용자의 주문이 동기화됐는지 |

## 6. 보안 메모

- **시크릿은 서버에만** 둡니다. 브라우저에서 해시를 만들면 그 순간 시크릿이 공개됩니다.
- 허용 도메인은 **오설치·무단 임베드를 막는 장치**이지 위조 방지가 아닙니다. 사용자가 누구인지는
  서명이 증명합니다.
- 시크릿 재발급 시 **기존 서명은 즉시 무효**입니다. 서버 값을 먼저 준비한 뒤 재발급하세요.

## 파일럿 호텔 제한과 `visibility` 이벤트 (PLN-261012 SG-40)

테넌트가 콘솔 *설정 > 위젯 설정 > 호텔별 파일럿 범위*를 켜면, 서버가 **매 메시지마다** 세션의
서명된 `claims.hotelSn`을 파일럿 목록과 대조합니다. 목록에 없는 호텔에는 안내문만 돌려주고
대화를 저장하지도 AI를 부르지도 않습니다. 목록에 호텔을 추가하면 **다시 로그인하지 않아도** 다음
메시지부터(최대 60초, 보통 즉시) 응대합니다. `hotelSn`이 없는 방문자(로그인 전, v1 신원,
만료된 신원)는 "게스트"로 보며 콘솔의 *게스트 허용* 스위치를 따릅니다.

위젯은 이 판정에 맞춰 스스로 비켜 줍니다. 호스트가 할 일은 거의 없지만, 알고 싶다면:

| 호출 / 이벤트 | 내용 |
|---|---|
| `ShopTalk.on('visibility', fn)` | `fn({ visible, reason, mode })` — 판정이 **바뀔 때마다** 한 번 |
| `visible: true, reason: null` | 서비스 대상 (파일럿 미사용 테넌트 포함) |
| `visible: false, reason: 'pilot', mode: 'hide'` | 목록 밖 호텔 — 위젯 숨김 |
| `visible: true, reason: 'pilot', mode: 'notice'` | 목록 밖 호텔 — 런처는 두고 열면 안내문 |

- **가역적입니다.** 숨김은 iframe을 지우지 않고 `display`만 바꿉니다(`removeChild`로 지우는
  노출 제한과 다름). 호스트가 호텔을 바꿔 `ShopTalk.identify(...)`를 다시 부르면 새 판정이 오고,
  대상 호텔이면 위젯이 다시 나타납니다. 숨겨진 동안에도 위젯은 90초마다(탭이 보일 때만) 판정을
  다시 확인하므로, 콘솔에서 호텔이 추가되면 재식별 없이 돌아옵니다.
- 파일럿 목록이 켜진 테넌트는 위젯이 판정을 알리기 전까지 숨겨져 있습니다(재방문은 즉시). 판정이
  10초 안에 오지 않으면(구 위젯 빌드) 보이게 두고 거부는 서버가 맡습니다.
- **하위 호환:** 구 위젯은 메시지를 보내지 않고, 구 로더는 알 수 없는 메시지를 무시합니다. 어느
  쪽이든 서버 판정은 그대로라서 목록 밖 호텔이 응대되는 일은 없습니다.
- 헤더 트리거 모드의 종 아이콘처럼 호스트 쪽 진입점이 있다면 `visible: false`일 때 호스트가 직접
  숨기세요. 네이티브 앱은 같은 메시지(`type: 'ivy:visibility'`)를 브리지로 받습니다. 앱 모드(WebView가
  곧 화면)에서는 숨길 수 없으므로 안내문이 있으면 화면에 안내문을 보여 줍니다.
- `identify`와 `session/ensure` 응답에는 `pilot: { eligible: true | false | null }`이 붙습니다
  (`null` = 파일럿 목록 미사용).

## 스토어 헤더로 열기 (트리거 모드)

떠 있는 런처 대신 **스토어가 가진 요소**로 위젯을 열 수 있습니다(PLN-260916). 콘솔에서 *설정 > 위젯 설정 > 위젯 테마 > 런처 모드*를 "스토어 헤더 트리거"로 바꾸고, 스니펫에 `trigger`(여는 요소의 CSS 선택자)를 넣습니다.

```html
<button id="st-bell" type="button" aria-label="Notifications">🔔
  <span data-sharptalk-badge style="display:none"></span>
</button>
<script>
  window.SHARPTALK_WIDGET_CONFIG = {
    shop: "<your-shop>",
    widgetUrl: "https://<host>/widget",
    trigger: "#st-bell",     // 이 요소를 누르면 열립니다
    badge: "[data-sharptalk-badge]"  // 선택: 기본값이 이 선택자입니다
  };
</script>
<script src="https://<host>/widget/embed.js" defer></script>
```

- 패널은 **헤더 아래 우측에 도킹**되고(상단 오프셋은 콘솔에서 지정), 패널 **바깥을 클릭하면 닫힙니다**.
- `data-sharptalk-badge` 요소에 **읽지 않은 알림 수**가 자동으로 들어가고 0이면 숨겨집니다.
- 스크립트 API(`SharpTalk.open()` / `close()` / `toggle()`)는 두 모드 모두에서 그대로 동작합니다.
- 닫혀 있는 동안 iframe은 0×0으로 접히므로 페이지 클릭을 가로채지 않습니다.

