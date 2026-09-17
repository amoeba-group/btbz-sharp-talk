# FIX-260917 — 콘솔 설치 스니펫이 로더가 아닌 HTML을 가리킴 (임베드·SDK 카드)

| 항목 | 내용 |
|---|---|
| 작성일 | 2026-09-17 |
| 발견 경위 | "스테이징 콘솔에서 설정한 내용이 `ambshop-dev.myshopify.com`에 반영되지 않는다"는 사용자 보고를 추적하던 중, 콘솔이 발급하는 설치 스니펫의 로더 주소를 실측하다 발견 |
| 성격 | 프런트엔드(콘솔) 1줄 결함 — API/DB/스키마 무변경 |

## 1. 증상

테넌트가 **[테넌트 설정] → 위젯 설정 → 임베드·SDK** 카드의 설치 스니펫을 복사해
상점에 붙여넣으면 **위젯이 아예 뜨지 않습니다.** 콘솔에서 무엇을 설정하든(모서리·색·
문구) 상점에는 아무것도 반영되지 않습니다.

## 2. 근본 원인

`apps/web/src/domain/settings/EmbedCard.tsx`가 로더 주소를 **콘솔 자신의 origin**으로
조립했습니다:

```ts
const host = window.location.origin;                  // https://shoptalk.amoeba.site
`<script src="${host}/v1/embed.js" defer></script>`   // ← /widget 이 빠짐
```

실제 로더는 nginx가 **`/widget/v1/embed.js`** 로 서빙합니다
(`docker/*/nginx.widget.conf`의 `location = /widget/v1/embed.js` — "로더 계약이 위젯
재빌드와 무관하게 유지되도록" 고정한 버전 경로).

### 왜 조용히 실패하는가 — 이 결함의 핵심

없는 경로인데 **404가 아닙니다.** 콘솔 SPA의 history fallback이 걸려 `index.html`을
**200 + `text/html`** 로 돌려줍니다. 브라우저는 HTML을 스크립트로 실행하지 않으므로
로더가 안 뜨는데, 네트워크 탭에는 빨간 줄 하나 없습니다.

| 경로 | 응답 |
|---|---|
| `/v1/embed.js` (스니펫이 안내하던 것) | **200 · text/html · 583 B** (콘솔 index.html) |
| `/widget/v1/embed.js` (실제 로더) | 200 · application/javascript · 41,497 B |

## 3. 수정

- `apps/web/src/lib/widget-url.ts` 신설 — `WIDGET_URL`(`/widget` 포함)과
  **`EMBED_LOADER_URL`**(`${WIDGET_URL}/v1/embed.js`)을 한 곳에서 정의.
- `EmbedCard`가 `EMBED_LOADER_URL`을 사용.
- 같은 상수를 각자 다시 선언하던 3개 파일(`SettingsPage`·`WidgetDesignsCard`·
  `AgentsSection`)도 공유 상수를 임포트하도록 통합 — **이 결함의 원인이 "공유 상수를
  쓰지 않은 파일 하나"** 였으므로, 중복 선언 자체를 없앴습니다.

검증: 빌드 산출물(`widget-url-*.js`)에 `"https://shoptalk.amoeba.site/widget" + "/v1/embed.js"`
가 들어가고, 그 주소는 실제로 200 `application/javascript` 41 KB를 반환합니다.

## 4. 예방 패턴

**① "200"은 배포·설치 검증의 근거가 아니다 — 내용(Content-Type·본문)을 봐야 한다.**
SPA fallback이 있는 호스트에서는 **어떤 오타 경로든 200을 돌려줍니다.** 이 저장소는
배포 검증에서 이미 같은 교훈을 쓰고 있었는데(`401=배포됨 / 404=미배포`), **설치 스니펫**
에는 그 기준이 적용되지 않고 있었습니다.

**② 외부에 배포되는 문자열(설치 스니펫)은 실제로 fetch해서 확인한다.**
스니펫은 우리 화면 안에서는 "그럴듯하게" 보이지만, 그것이 가리키는 주소가 살아 있는지는
아무도 검사하지 않았습니다. 생성기를 바꾸면 **생성된 URL을 한 번 받아보는 것**이
유일하게 신뢰할 수 있는 검증입니다.

**③ 같은 상수를 여러 파일이 각자 선언하면, 틀리는 건 항상 "안 쓴 한 곳"이다.**
`WIDGET_URL`은 3곳에서 동일하게 선언돼 있었고 전부 옳았습니다. 틀린 곳은 그 상수를
쓰지 않고 `window.location.origin`으로 대신한 네 번째 파일이었습니다.

## 5. 배포 상태

| 환경 | 상태 |
|---|---|
| main | (PR 대기) |
| 스테이징 | — |
| 프로덕션 | — |

---

## 6. 후속 — 스니펫 주소만으로는 부족했다 (FIX-260917-Embed-Self-Base)

주소를 고쳐 배포한 뒤 실제 스니펫으로 다시 확인하니, 위젯은 여전히 뜨지 않았습니다.
iframe은 생성되는데 그 주소가 **`https://widget.ivyusa.app`** — 존재하지 않는 도메인
(`ERR_NAME_NOT_RESOLVED`)이었습니다.

`embed.js`가 위젯 위치를 이렇게 정하고 있었기 때문입니다:

```js
var base = String(cfg.widgetUrl || 'https://widget.ivyusa.app')...
```

콘솔 스니펫은 `widgetUrl`을 넣지 않으므로 **항상** 이 죽은 기본값으로 갔습니다. 즉
결함은 두 겹이었고, 첫 겹(경로 누락)만 고쳤을 때는 증상이 그대로였습니다.

**수정**: 로더가 **자기 `<script src>` 에서 베이스를 유도**합니다
(`.../widget/embed.js`와 고정 경로 `.../widget/v1/embed.js` 둘 다 → `.../widget`).
`cfg.widgetUrl`은 명시 오버라이드로 유지(로더와 위젯을 분리 호스팅하는 경우). 유도도
실패하면 **조용히 죽은 주소로 가지 않고 콘솔 에러를 남기고 중단**합니다.

**검증**: `apps/widget/test/embed-self-base.test.mjs` 5건(버전/비버전 경로 유도,
widgetUrl 오버라이드 우선, currentScript 부재 시 script 태그 폴백, 죽은 도메인이
코드에 재등장하지 않음 — 주석은 제외하고 검사). 폴백을 되돌리면 3건이 실패하는 것까지
역검증. 전체 위젯 테스트 31/31.

### 예방 패턴 (추가)

**④ 기본값이 "한 번도 살아본 적 없는 값"이면, 그 코드 경로는 한 번도 실행된 적이 없다.**
`widget.ivyusa.app`은 계획만 되고 배포된 적 없는 도메인입니다. 모든 실사용 설치가
`widgetUrl`을 명시했기 때문에 아무도 몰랐고, 콘솔이 `widgetUrl` 없는 스니펫을 발급하기
시작하자 그제야 드러났습니다. **폴백 기본값은 실제로 그 경로로 한 번 돌려봐야** 합니다.

**⑤ 호스팅되는 리소스는 자기 주소를 안다.** 로더에게 "너는 어디 있니"를 설정으로 묻는
대신 `document.currentScript.src`에서 유도하면, 환경마다 다른 스니펫을 관리할 필요가
사라집니다 — 이번 결함의 두 겹 모두가 "주소를 손으로 적었기 때문"에 생겼습니다.
