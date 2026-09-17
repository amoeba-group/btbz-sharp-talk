---
document_id: WIDGET-RADIUS-BUG-1.1.0
version: 1.1.0
status: Verified
created: 2026-09-17
updated: 2026-09-17
author: 김익용
reviewers: [Claude]
change_log:
  - version: 1.0.0
    date: 2026-09-17
    author: 김익용
    description: Initial bug report from live investigation on ambshop-dev
  - version: 1.1.0
    date: 2026-09-17
    author: Claude
    description: Verified against source (main 0f862fe); §5-6 mechanism corrected, §6-1 allowlist gap added, filenames moved to repo convention
---

# [BUG] 커스텀 위젯 모서리 라운딩 미반영 (custom widget corner-radius has no visible effect)

```
labels: ["bug", "severity:major", "sharptalk-widget", "design-token"]
```

> 원 보고서(v1.0.0, 번들 분석 기준)를 소스(main `0f862fe`) 대조로 검증한 판입니다.
> 검증에서 **바뀐 결론은 §5-6 한 곳**이고, **새로 발견된 갭이 §6-1**입니다. 나머지는
> 원 보고서가 정확했습니다 — 유틸 카운트(41/10/25) 포함.

## 1. Bug Description (버그 설명)

- **Summary**: 테넌트 설정 → 위젯 → 커스텀 위젯의 `모서리` 옵션은 저장·전달까지 정상이지만
  **CSS 규칙 단 하나만 이 값을 소비**합니다. 패널 내부 컴포넌트는 전부 Tailwind 고정
  라운딩을 쓰고 있어 설정을 바꿔도 체감 변화가 없습니다.
- **Severity**: Major (설정 기능이 사실상 동작하지 않음 — 기능 신뢰도 문제)
- **Environment**: Production (`shoptalk.amoeba.site`) / Storefront `ambshop-dev.myshopify.com`
- **Component**: SharpTalk Widget (React, embedded iframe) + SharpTalk Console

## 2. Steps to Reproduce (재현 절차)

1. `https://shoptalk.amoeba.site/settings/widget` → 커스텀 위젯 → 편집
2. 모서리를 `보통(12px)` → `크게(16px)`(또는 `작게(8px)`)로 바꾸고 **저장 후 사용함**
3. `https://ambshop-dev.myshopify.com/`에서 채팅 위젯 열기
4. 말풍선·빠른답장 카드·버튼·목록 행·입력창·헤더 비교

## 3. Expected Behavior (기대 동작)

패널·말풍선·빠른답장 카드·카드·버튼·목록 행 등 위젯 표면 전체가 **하나의 디자인 토큰**으로
테넌트 모서리 설정을 따른다.

## 4. Actual Behavior (실제 동작)

눈에 띄는 변화가 없습니다. 데스크톱 패널의 **바깥 모서리만** 몇 픽셀 바뀌고, 그것도
뷰포트 640px 이상에서만 적용됩니다.

## 5. Evidence (증거)

**5-1. 설정은 스토어프론트까지 정상 전달됨.** 라이브 위젯 런타임 CSS 변수:

```
--ivy-radius      = 16px        <- 크게(16px) 정상 적용
--ivy-root-size   = 16.00px
--ivy-panel-w     = 380px
--ivy-panel-h     = 720px
```

**5-2. 테마 빌더가 변수를 씀** — `packages/types/src/common/widget-theme.ts`
(공유 패키지, 콘솔도 같은 파일을 임포트):

```ts
if (design?.radius) vars['--ivy-radius'] = `${RADIUS_PX[design.radius]}px`;
```

**5-3. 소비처는 단 하나** — `apps/widget/src/index.css` 전체 76줄 중:

```css
@media (min-width: 640px) {
  .ivy-panel-desktop {
    width: var(--ivy-panel-w, 404px);
    height: var(--ivy-panel-h, 600px);
    border-radius: var(--ivy-radius, 12px);   /* 유일한 소비처 */
  }
}
```

**5-4. 모바일은 구조적으로 사각**: 640px 미만에서 패널은 `rounded-none` 전체화면이라
설정 효과가 **0**입니다.

**5-5. 패널 컴포넌트는 고정 유틸 사용** (소스 실측, main `0f862fe`):

| Utility | 고정값 | 개수 | 설정 추종? |
|---------|-------|------|-----------|
| `rounded-lg` | 8px | 41 | ❌ |
| `rounded-full` | 9999px | 25 | n/a (의도적 핀/원형) |
| `rounded-xl` | 12px | 10 | ❌ |
| `rounded-2xl` | 16px | 1 | ❌ |
| `rounded-md` | 6px | 1 | ❌ |
| `rounded-none` | 0 | 1 | n/a (모바일 전체화면) |
| `rounded-bl-sm` | 2px | 1 | n/a (말풍선 꼬리) |

영향 컴포넌트: `st-message`, `st-quick-reply` 카드 변형, 상품/정보 카드, 그리고 버튼·
목록 행·알림·주문 항목의 41개 `rounded-lg` 호출부.

**5-6. 콘솔 미리보기 — ⚠️ 원 보고서 정정.**
원문은 "콘솔 스타일시트에 `--ivy-radius` 참조 0 → 미리보기가 설정을 반영 못 함"이었으나,
**기전이 다릅니다.** 콘솔은 CSS 변수가 아니라 **인라인 스타일로 `RADIUS_PX`를 직접 적용**
합니다(`WidgetDesignsCard.tsx`) — 즉 **바깥 컨테이너 모서리는 이미 설정을 따랐고**, 안
따른 것은 내부 말풍선(`rounded-xl` 고정)뿐입니다.
결론적으로 **미리보기는 위젯의 결함을 정확히 복제**하고 있었고, "편집기와 스토어프론트가
둘 다 같은 방식으로 틀려서 아무도 못 잡았다"는 원 보고서의 판단 자체는 유효합니다.

또한 편집기에는 미리보기가 **둘** 있습니다 — 정적 미리보기와, 실제 위젯을 preview
토큰으로 띄우는 `openPreview`. 후자는 위젯을 고치면 자동으로 정상화됩니다.

## 6. Root Cause (원인)

라운딩 토큰이 **테마 주입 레이어(`--ivy-radius`)에만 도입되고 컴포넌트 레이어로 전파되지
않았습니다.** 위젯은 Tailwind 기본 라운딩 스케일로 만들어졌고, 고정 유틸 → 토큰 이행이
패널 껍데기에서만 완료됐습니다.

이것은 **토큰 배관 누락**이지 저장·테넌트 해석·캐시 결함이 아닙니다. 폰트
(`--ivy-root-size`, `--ivy-font-family`)와 패널 크기(`--ivy-panel-w/h`)는 배관이 제대로
되어 있고 실제로 동작합니다.

### 6-1. 함께 고쳐야 하는 갭 (검증에서 신규 발견)

`apps/widget/src/lib/theme.ts`에 **`THEMED_PROPERTIES`** 라는 명시적 목록이 있습니다 —
주석 그대로 *"Every property applyTheme may set — listed so clearing is exhaustive."*
테마 해제 시 루트에서 지울 속성 목록입니다.

빌더에 파생 변수를 추가하면서 **이 목록을 갱신하지 않으면**, 테넌트가 커스텀 디자인을
해제하거나 다른 디자인으로 바꿀 때 **낡은 radius 변수가 루트에 남습니다.** 증상은
이번 버그의 정반대 — "설정을 껐는데 모서리가 그대로". 조용히 실패하는 종류라
[[invisible-fallback-trap]]과 동일한 계열입니다.

## 7. Scope of Impact (영향 범위)

- 커스텀 위젯 디자인을 쓰는 전 테넌트(현재 `ivyusa`/`IVY Figma`, `go2joy` 예정)
- API·DB·백엔드 변경 없음. 프런트엔드(위젯 + 콘솔 + 공유 types)만
- 기본 `보통(12px)` 테넌트는 보정만 맞으면 무회귀 — POL-001 Rule 1

## 8. Related (연관)

- 구현 계획: `docs/plan/PLN-260917-Widget-Radius-Token.md`
- 테스트: `docs/test/TCR-260917-Widget-Radius-Token.md`
- 수정 기록·예방 패턴: `docs/bug-fix/FIX-260917-Widget-Radius-Token.md`
