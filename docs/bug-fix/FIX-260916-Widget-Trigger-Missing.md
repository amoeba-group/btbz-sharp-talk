# FIX-260916 — 트리거 모드에서 위젯 버튼이 사라짐 (여는 수단 전무)

- 신고(2026-09-16): "위젯 설정 확인하고 나니 위젯 버튼 사라짐 — https://ambshop-dev.myshopify.com/"
- 영향: 스테이징 ivyusa 테넌트를 붙인 스토어에서 **채팅 위젯을 열 방법이 없음**(플로팅 버튼 숨김 + 트리거 요소 부재)
- 관련: REQ/PLN-260916-Ivyusa-Widget-Figma-Design(P2 헤더 트리거 모드), PR #534/#535

## 1. 증상
스토어 우하단의 파란 채팅 버튼이 보이지 않는다. 위젯 iframe은 로드되지만 크기가 0×0이라
화면에 아무것도 나타나지 않고, 클릭할 대상도 없다.

## 2. 근본 원인
P2 검증 때 스테이징 ivyusa 테마를 트리거 모드로 바꿔둔 채 되돌리지 않았다.

```json
"launcher": { "mode": "trigger", "triggerSelector": "#st-bell", "offsetTop": 72 }
```

트리거 모드의 계약은 "스토어가 자기 헤더에 여는 요소를 둔다"이다. 로더는 그 계약을 믿고
플로팅 런처를 숨긴다(`CLOSED = {w:'0px', h:'0px'}`). 그런데 실제 스토어
`ambshop-dev.myshopify.com` 테마에는 `#st-bell`이 아직 없다(삽입은 IVY 측 작업).
**요소가 없으면 여는 수단이 0개가 된다** — 로더는 그 상태를 알아차리지 못했다.

즉 결함은 "설정을 잘못 건드린 것" 하나가 아니라, **테넌트 설정 하나로 위젯을 완전히
잠글 수 있는데 로더에 안전장치가 없었던 것**이다. 콘솔에서 트리거 모드를 켜는 일은
누구나 할 수 있고, 스토어 테마 편집은 보통 다른 사람·다른 일정이므로 이 순서 역전은
재발이 예정된 사고다.

## 3. 즉시 조치 (완료)
스테이징 ivyusa 테마를 플로팅으로 되돌림.

```
PATCH /api/v1/tenants/widget-theme  → launcher {position:right, size:md, icon:chat}
POST  /api/v1/session/ensure        → launcher 확인(트리거 키 없음)
```

로더는 `ivy:launcher:{shop}`, 위젯은 `ivy_theme:{shop}`를 localStorage에 캐시하므로
첫 로드에서 직전 값이 잠깐 쓰일 수 있다. 위젯이 새 테마를 알리는 즉시 자가 교정되며,
바로 보고 싶으면 강력 새로고침(⌘⇧R)하면 된다.

## 4. 재발 방지 — 로더 폴백
`apps/widget/public/embed.js`가 트리거 요소의 존재를 직접 확인한다.

1. 트리거 모드로 시작하면 `checkTrigger()`가 `document.querySelector(cfg.trigger)`를
   조회한다. 없으면 600ms 간격으로 최대 6회(약 3.6초) 재시도한다 — 헤더를 나중에
   그리는 테마·앱 블록을 기다리기 위함.
2. 그래도 없으면 `triggerFellBack = true`로 전환: 닫힘 크기를 런처 크기로 되돌리고
   프레임을 재배치해 **플로팅 버튼을 다시 띄운다**.
3. 위젯에 `ivy:command action:'trigger-missing'`을 보낸다. 위젯 스토어의
   `triggerUnavailable` 플래그가 켜지고, `Widget.tsx`는 런처를, `WidgetPanel.tsx`는
   헤더의 닫기(X)를 다시 렌더한다(트리거 모드에서는 숨겨져 있던 것들).
4. 콘솔에 경고를 남긴다 — 선택자와 원인, 해야 할 일(헤더에 요소 추가 또는 모드 되돌리기).
5. 스니펫에 `trigger` 선택자 자체가 없는데 테마만 트리거 모드인 경우(실제 스토어가 이 경우다)는
   기다릴 요소가 없으므로 **재시도 없이 즉시** 폴백한다.
6. 나중에 테마가 갱신돼 `applyLauncher`가 다시 불려도, 이미 폴백했다면 트리거 모드로
   되돌아가지 않는다(같은 페이지에서 버튼이 다시 사라지는 깜빡임 방지).

콘솔 UI에도 같은 사실을 적었다(6개 언어 `widgetTheme.triggerHint`):
"스토어에 그 요소가 없으면 위젯이 자동으로 떠 있는 버튼으로 돌아갑니다."

## 5. 변경 파일
| 파일 | 변경 |
|---|---|
| `apps/widget/public/embed.js` | `triggerPresent()`·`checkTrigger()` 폴백, `triggerFellBack`, `launcherSizePx` 보존, `trigger-missing` 통지 |
| `apps/widget/src/store/widgetStore.ts` | `triggerUnavailable` + `setTriggerUnavailable` |
| `apps/widget/src/hooks/useEmbedCommands.ts` | `trigger-missing` 명령 수신 |
| `apps/widget/src/components/widget/Widget.tsx` | 폴백 시 런처 다시 렌더(스토어 구독) |
| `apps/widget/src/components/widget/WidgetPanel.tsx` | 폴백 시 헤더 X 다시 렌더 |
| `apps/widget/public/trigger-test.html` | `?notrigger=1` — 여는 요소가 없는 스토어 재현 |
| `apps/web/src/i18n/locales/*/settings.json` | 트리거 안내 문구에 폴백 설명 추가(6언어) |

## 6. 검증
- `?notrigger=1` 하네스(테마는 트리거 모드): 약 3.6초 후 플로팅 버튼 복귀, 클릭으로 패널 열림,
  헤더 X로 닫힘, 콘솔에 경고 1회.
- 기본 하네스(`#st-bell` 존재): 종 클릭으로 열고 닫힘, 폴백 없음, 경고 없음 — 기존 동작 무변경.
- 트리거 모드를 쓰지 않는 테넌트: 코드 경로 진입 없음.

## 7. 예방 패턴 (일반화)
**"호스트 페이지가 제공해야 하는 요소"에 기능을 의존시킬 때는, 그 요소가 없을 때의
동작을 기본 동작으로 되돌려 놓아야 한다.** 설정은 언제나 스토어 테마보다 먼저 바뀐다
(콘솔 클릭 1회 대 테마 배포 1회). 계약 위반을 침묵으로 처리하면 사용자에게는
"기능이 사라진 것"으로 보인다. 확인 → 유예 → 폴백 → 통지 순서를 기본형으로 삼는다.

부가: 검증용으로 바꾼 테넌트 설정은 검증 직후 되돌린다. 스테이징 테넌트는 실 스토어가
붙어 있는 살아있는 환경이다.
