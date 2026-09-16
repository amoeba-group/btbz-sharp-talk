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

## 4. 자바스크립트 API

| 호출 | 동작 |
|---|---|
| `ShopTalk.init(options)` | 설치·부팅 |
| `ShopTalk.open('chat' \| 'orders' \| 'notifications')` | 위젯 열기(탭 지정 가능) |
| `ShopTalk.close()` / `ShopTalk.toggle()` | 닫기 / 토글 |
| `ShopTalk.identify({ userId, hash, … })` | 로그인 사용자 전달 |
| `ShopTalk.logout()` | 세션 해제 → 게스트로 |
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

