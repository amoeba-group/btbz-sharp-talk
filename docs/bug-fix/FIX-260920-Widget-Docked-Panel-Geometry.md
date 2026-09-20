# FIX-260920 — 도킹 모드 패널이 창 높이를 벗어나고, 크기·모서리 설정이 무시됨

- 신고(2026-09-20): "콘솔 설정 문제가 아니라 embed.js 도킹 모드 스타일 버그" — 세로가 브라우저와
  연동 안 됨(bottom 827 > viewport 759) · 하단 여백 없음 · 라운딩 미반영 · 380×720 대신 420×800
- 영향: 트리거(도킹) 모드를 켠 스토어 — 스테이징 `ivyusa` / `ambshop-dev.myshopify.com`
- 관련: PLN/RPT-260916-Ivyusa-Widget-Figma-Design(P2 도킹) · FIX-260917-Widget-Radius-Token ·
  GUIDE-260920-Ivyusa-Custom-Widget-Apply

## 1. 증상 (신고 4건, 전부 재현)

스테이징 트리거 하네스(`/widget/trigger-test.html?shop=ambshop-dev.myshopify.com`)는 위젯과
동일 오리진이라 iframe 내부까지 측정할 수 있다. 수정 전 실측:

```
뷰포트 1335×725
iframe   top=68  right=0  w=420  h=753.81  → bottom=821.8   (창 아래로 넘침)
         border-radius=0
iframe 내부(위젯 문서)
  inner viewport = 420×754
  .st-panel = 420×753.9 @ (0,0), border-radius 0   ← 프레임을 꽉 채운 모바일 시트
  matchMedia('(min-width: 640px)') = false
  토큰은 정상 도달: --ivy-panel-w=380px  --ivy-panel-h=720px  --ivy-radius=16px
```

콘솔 설정은 정상이었다. 값은 전부 위젯까지 도착했고, **쓰이지 않았다.**

## 2. 근본 원인 — 두 개, 서로 다른 층

### 2-1. 로더: 도킹 프레임이 시작 오프셋을 높이에서 빼지 않았다

```js
OPEN = { w: 'min(420px, 100vw)', h: 'min(800px, 100vh)' };   // 수정 전
frame.style.top = triggerOffset + 'px';                       // = 68px
```

`top: 68px` + `height: 100vh` = 창 아래로 정확히 오프셋만큼 초과. 하단 여백 항은 아예 없었다.

### 2-2. 위젯: 브레이크포인트 기준이 틀렸다 (진짜 원인)

`.ivy-panel-desktop`(패널 폭·높이·모서리)과 패널 배치 `sm:` 클래스가 전부
`@media (min-width: 640px)` 뒤에 있었다. 그런데 위젯이 보는 뷰포트는 **자기 iframe의 폭**이고,
로더가 만드는 프레임은 **구조적으로 항상 640px 미만**이다(패널 최대 480 + 패드 40 = 520).

→ **임베드 환경에서 데스크톱 카드 스타일은 한 번도 적용된 적이 없다.** 모든 스토어가 모바일
시트(풀블리드·모서리 0·설정 크기 무시)로 렌더되고 있었고, 도킹 모드에서 처음 눈에 띄었을 뿐이다.
플로팅도 같았다 — FIX-260916의 검증 기록 "패널 420×798"이 그 증거(380이 아니라 프레임 폭).

"420×800 하드코딩"은 아니었다: `panelFrame() = 패널 + PANEL_FRAME_PAD{w:40,h:80}`로,
그림자·거터·런처 줄 자리다. 프레임은 의도된 값이고, 문제는 **그 안에서 패널이 그려지는 방식**이었다.

### 2-3. 왜 두 번의 검증을 통과했나

콘솔 "실제 위젯 미리보기"는 모달(`max-w-2xl`) 안의 `w-full` iframe이라 640px 분기가 열린다.
**미리보기에서는 맞게, 실제 임베드에서는 틀리게** 보였다. 9/16 Figma 대조와 9/17 모서리 토큰
검증이 모두 이 창으로 이뤄졌다.

## 3. 수정

| 파일 | 변경 |
|---|---|
| `apps/widget/public/embed.js` | `frameSize` + `recomputeOpen()` 분리. 도킹이면 높이에서 `offsetTop + (25 − 20)`을 예약(`min(800px, calc(100vh − 73px))`), 플로팅은 `min(h, 100vh)` 그대로. 모드·오프셋이 바뀌는 `applyLauncher`에서 재계산. 열린 패널 판정을 `frame.style.width !== OPEN.w` → **`isOpen`** 으로 교체 |
| `apps/widget/src/index.css` | `.ivy-panel-desktop`을 미디어 쿼리 밖으로. 폭 `min(--ivy-panel-w, calc(100vw − 20px))`, 높이 `min(--ivy-panel-h, calc(100vh − 20px))`, 모서리 `var(--ivy-radius)` |
| `apps/widget/src/components/widget/WidgetPanel.tsx` | 레이아웃 분기를 뷰포트 폭 → **`?compact=1`(부모 창 폭, 로더가 이미 보내던 신호)** 로. 시트/카드 클래스는 **배타적**으로 출력(평범한 유틸리티끼리 순서 싸움을 시키지 않는다). 플로팅 카드 `bottom-24` → `bottom-5` |
| `apps/widget/test/embed-dock-geometry.test.mjs` | 신규 5건: 오프셋 예약·오프셋 증가·플로팅 무변경·열린 패널이 테마 변경을 따라감(붕괴 금지)·`.ivy-panel-desktop`이 다시 미디어 쿼리에 들어가면 실패 |

**하단 25px의 출처**: 프레임이 5px, 패널 자신의 `bottom-5`가 20px을 낸다. 로더가 25를 통째로
예약하면 패널 거터와 겹쳐 45px이 된다 — `DOCK_BOTTOM_GAP − PANEL_GUTTER` 산식을 코드에 남겼다.

**`bottom-24` → `bottom-5`**: 프레임이 아래로 예약하는 값은 `PANEL_FRAME_PAD.h = 80`인데 패널은
96px을 띄우려 했다. 지금까지는 패널이 프레임을 꽉 채워 드러나지 않았고, 카드가 실제로 그려지는
순간 **위쪽 16px이 잘린다**. 런처는 패널이 열려 있는 동안 그려지지 않으므로 96px을 비울 이유도 없다.

**iframe에 `border-radius`를 주지 않은 이유**: ①프레임을 패널에 딱 맞추면 `shadow-lg`가 잘리고
②로더는 모서리 값을 받지 못해 `ivy:launcher` 계약을 3파일에 걸쳐 넓혀야 한다. 패널이 제 크기로
그려지기 시작하면 모서리는 토큰으로 저절로 맞는다 — 실측으로 확인했다.

## 4. 검증 (수정 후, 로컬 실측)

로컬 빌드(`VITE_API_BASE_URL=스테이징`)를 `:4173`에 올리고 같은 하네스로 측정.

| 경우 | 결과 |
|---|---|
| 도킹, 창 778px (패널 높이가 안 들어가는 경우) | 프레임 420×705 `top=68` · 패널 **380×685** · **radius 16** · 우측 20 · **하단 정확히 25** · 컴포저 보임 |
| 플로팅(하네스 `?notrigger=1` 폴백) | 프레임 420×778 · 패널 **380×720**(설정 그대로, 클램프 없음) · radius 16 · 우·하 20 · 상단 38(잘림 없음) · 헤더 X 복귀 |
| 종 클릭 → 바깥 클릭 | 닫힘 |
| 종 클릭 → 종 재클릭 | 닫힘 |
| 종 재클릭 → 다시 열기 | 열림 |

> 측정 함정: 백그라운드 탭에서는 CSS 트랜지션이 멈춰 `getComputedStyle`이 전환 전 값(0×0)을
> 돌려준다. 프레임 크기는 **탭을 포그라운드로 올린 뒤** 읽어야 한다.

자동 검사: widget `node --test` **36/36**, types 테스트, `tsc`(widget·web·types), widget·web 빌드,
`node --check embed.js`.

## 5. 영향 범위

- **플로팅 모드의 렌더가 실제로 바뀐다** — 처음으로 테넌트가 설정한 패널 크기와 모서리가 적용된다.
  회귀가 아니라 의도된 변경이며, 지금까지 보이던 "프레임을 꽉 채운 사각형"이 정상이 아니었다.
- 모바일(부모 창 <640px)과 앱 모드는 지금과 동일한 풀스크린 시트.
- 스키마 변경 없음. 배포 대상은 위젯 번들 + `embed.js`.

## 6. 배포 상태 · 실 스토어 실측

| 항목 | 상태 |
|---|---|
| PR | **#551** (squash → main `31263ef`) |
| SQL | 없음 (스키마 변경 없음) |
| staging | 배포 완료 2026-09-20 — `deploy-staging.sh`, api/web/widget/pwa/nginx 재생성, api healthy |
| production | 배포 완료 2026-09-20 — `main:production` 승격(`2233fe0`) → `check-migrations.sh` OK(80 적용·대기 0) → `deploy-self-hosted.sh`. api healthy·`successfully started` 1회·widget/console 200 |

배포 확인은 상태코드가 아니라 **내용**으로:

```
curl .../widget/embed.js | grep -c DOCK_BOTTOM_GAP            → 2
widget CSS 번들의 .ivy-panel-desktop                           → 미디어 쿼리 밖, 클램프 포함
```

프로덕션 스모크(`sharptalk.amoeba.site/widget/trigger-test.html`, 테마 미설정 기본 테넌트):
로더 `DOCK_BOTTOM_GAP` 2건 · 위젯 CSS 미디어 쿼리 밖 · 스테이징과 `embed.js` 바이트 동일 ·
패널 **404×600 모서리 12**(문서화된 기본값)로 카드 렌더, 창 밖 초과 0px. 수정 전이라면
444×680 풀블리드 사각형이었을 자리다.

실 스토어 `ambshop-dev.myshopify.com` (스테이징 연결, 헤더 `#st-bell` 설치 완료, 로그인 상태):

```
뷰포트 1004×857, 헤더 바닥 61
frame  top=68  420×784  bottom=852   → 창 밖 초과 0px   (수정 전: +68px)
       inline height = min(800px, calc(100vh - 73px))  ← 857-73 = 784 그대로
패널    380×720(설정값 그대로) · 모서리 16 · 우측 여백 20 · 헤더 바로 아래 도킹
```

창이 패널보다 낮을 때만 클램프가 걸리고, 그때 하단 여백이 정확히 25px가 된다(§4 로컬 실측).

## 7. 예방 패턴 (일반화)

**iframe 안에서 `@media (min-width: …)`로 "데스크톱이냐"를 묻지 말 것.** 그 질문의 답은 호스트
페이지의 폭인데, 프레임 안에서 보이는 것은 프레임의 폭이다. 프레임을 만드는 쪽만 진짜 폭을 알고
있으므로, 그 사실은 **신호로 전달받아야 한다**(여기서는 이미 있던 `?compact=1`).

따름 정리: **미리보기 창에서 한 검증은 임베드 검증이 아니다.** 미리보기 iframe은 폭이 달라
분기가 갈린다 — 레이아웃 변경은 실제 임베드 폭에서 한 번 더 봐야 한다.
