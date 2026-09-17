---
document_id: WIDGET-RADIUS-FN-1.2.0
version: 1.2.0
status: Implemented
created: 2026-09-17
updated: 2026-09-17
author: 김익용
reviewers: [Claude]
change_log:
  - version: 1.0.0
    date: 2026-09-17
    author: 김익용
    description: Initial functional specification + WBS for radius token propagation
  - version: 1.1.0
    date: 2026-09-17
    author: Claude
    description: T-001b(THEMED_PROPERTIES) 추가, T-004 축소(공유 빌더·실위젯 미리보기 실측), 가드를 CI 스크립트 패턴으로 확정, storefront 제외 명문화
  - version: 1.2.0
    date: 2026-09-17
    author: Claude
    description: 스테이징 실측에서 접두어 없는 `rounded`(4px) 10개소 누락 발견 → xs 단 신설(0.33)·이행·가드 정규식 보강
---

# 위젯 라운딩 토큰 전파 — 기능 정의 + WBS (PLN-260917)

| 항목 | 내용 |
|---|---|
| 근거 | REQ-260917-Widget-Radius-Token |
| 유형 | 버그 수정 / 개선 — **API·DB·백엔드 변경 없음** |
| UI 영향 | 기존 화면의 **모서리 값만** 변경(신규 화면·컴포넌트 없음 → 와이어프레임 해당 없음). 기본 설정에서는 무변경(NFR-001) |
| 설계 원칙 | 테넌트 입력 1개(`sm\|md\|lg`) → 파생 토큰 스케일 1개 → 전 컴포넌트. **컴포넌트를 추가할 때 테마 레이어를 다시 건드리지 않아도 되는 구조** |

## 1. 설계 근거

현재 모델은 원시값(`--ivy-radius`) 하나를 노출하고 컴포넌트가 **손으로 참여**하기를
기대합니다. 그래서 비-핀 라운딩 호출부 57곳 중 56곳이 누락됐습니다. 수정은 의존 방향을
뒤집습니다 — 테마 레이어가 **스케일**을 발행하고, Tailwind가 그 스케일을 이름 있는
유틸로 등록하고, 컴포넌트는 **이름만** 소비합니다(픽셀값 금지).

| 접근 | 유지보수성 |
|------|-----------|
| 컴포넌트마다 `style={{borderRadius}}` | ❌ 새 컴포넌트마다 토큰을 기억해야 함 |
| `--ivy-radius` 하나 + 컴포넌트별 수동 CSS | ❌ 현재 상태 — 56곳 누락 |
| **파생 스케일 + Tailwind 테마 유틸** | ✅ 새 컴포넌트가 자연스럽게 `rounded-st-*`를 집고, 린트로 강제 가능 |

## 2. POL-001 — 라운딩 스케일 정책

`r = RADIUS_PX[setting]`, `RADIUS_PX = { sm: 8, md: 12, lg: 16 }` (변경 없음)

| 토큰 | 공식 | 작게 r=8 | 보통 r=12 | 크게 r=16 | 대체 대상(현행 고정값) |
|-------|---------|---------|----------|----------|-------------------------------|
| `--ivy-radius-xs` | `round(r × 0.33)` | 3px | **4px** | 5px | Tailwind bare `rounded` (4px) |
| `--ivy-radius-sm` | `round(r × 0.50)` | 4px | **6px** | 8px | `rounded-md` (6px) |
| `--ivy-radius-md` | `round(r × 0.67)` | 5px | **8px** | 11px | `rounded-lg` (8px) |
| `--ivy-radius-lg` | `round(r × 1.00)` | 8px | **12px** | 16px | `rounded-xl` (12px) |
| `--ivy-radius-xl` | `round(r × 1.33)` | 11px | **16px** | 21px | `rounded-2xl` (16px) |
| `--ivy-radius` | `r` | 8px | 12px | 16px | 패널 껍데기(기존 유지) |

- **Rule 1**: `md`에서 파생값이 현행 하드코딩 값과 **정확히 일치** → 무회귀.
- **Rule 1b** *(v1.2)*: 접두어 없는 `rounded`(4px)가 스케일 최하단보다 작아 **`xs` 단을 신설**했습니다. `sm`(6px)으로 올리면 기본 설정에서 눈에 보이는 변화가 생겨 NFR-001 위반.
- **Rule 2**: 각 파생값을 `[2px, 28px]`로 clamp — 테마 레이어는 clamp 안 된 수를 내보내지
  않습니다(임베드 로더가 패널 크기에 취하는 방어 자세와 동일).
- **Rule 3**: 완전 원형(`9999px`)은 **장식이 아니라 의미**이므로 스케일에서 제외 —
  런처·전송 버튼·아바타·안읽음 배지·상태 점·칩형 빠른답장·메시지 입력창.
- **Rule 4**: 커스텀 디자인이 없으면 변수는 미설정이고 Tailwind 폴백(4/6/8/12/16px)이
  적용 — 오늘의 기본 위젯과 동일.
- **Rule 5** *(v1.1 추가)*: `components/storefront/`(개발용 모의 상점 페이지)는 **제외**.
  머천트 사이트를 흉내 내는 화면이라 우리 테넌트 테마를 따르면 안 됩니다.

## 3. POL-002 — 모바일 패널 모서리

640px 미만에서 패널은 뷰포트를 채우므로 모서리가 화면 밖입니다 → `rounded-none` 유지.
**[TBD]** 바텀시트 형태로 제시할 경우 상단 두 모서리에만 `var(--ivy-radius)` 적용 —
이번 범위 밖, 필요 시 별도 개선 건.

## 4. 기능 정의

### FN-001 — 테마 빌더가 파생 스케일 발행
- **모듈**: `packages/types/src/common/widget-theme.ts` (위젯·콘솔 공유)
- **구현**: `RADIUS_SCALE`, `clampRadius()`, 그리고 **`radiusVars(radius)`** 를 신설하고
  `buildThemeVariables`가 이를 호출. 콘솔 미리보기도 같은 함수를 쓰므로 **상수 중복이
  아예 생기지 않습니다**(원안의 "패키지 분리 or 중복+parity 테스트" 고민 불필요 —
  빌더가 이미 공유 패키지에 있음).
- **에러 처리**: 미지 값 → 아무것도 발행하지 않음(Rule 4).

### FN-001b — 해제 경로 갱신 *(v1.1 신규, REQ §6-1)*
- **모듈**: `apps/widget/src/lib/theme.ts` — `THEMED_PROPERTIES`에 파생 변수 5개 추가.
- **없으면**: 디자인 해제·전환 시 낡은 모서리가 남음(조용한 실패).
- **회귀 방지**: 빌더가 쓰는 모든 `--ivy-*`가 해제 목록에 있는지 검사하는 **계약 테스트**
  (`apps/widget/test/theme-properties.test.mjs`) — 특정 4개가 아니라 *일반 규칙*을 지켜
  다음 변수 추가 때도 작동.

### FN-002 — Tailwind 유틸 등록
- **모듈**: `apps/widget/tailwind.config.js` (+ 콘솔 미리보기용 `apps/web/tailwind.config.js`)

```js
borderRadius: {
  'st-xs': 'var(--ivy-radius-xs, 4px)',
  'st-sm': 'var(--ivy-radius-sm, 6px)',
  'st-md': 'var(--ivy-radius-md, 8px)',
  'st-lg': 'var(--ivy-radius-lg, 12px)',
  'st-xl': 'var(--ivy-radius-xl, 16px)',
}
```

- 폴백이 현행 픽셀값과 동일 → 미테마 위젯 무변경.

### FN-003 — 컴포넌트 호출부 이행
| From | To | 개수 |
|------|----|-------|
| `rounded` (bare) | `rounded-st-xs` | 10 |
| `rounded-md` | `rounded-st-sm` | 1 |
| `rounded-lg` | `rounded-st-md` | 36 |
| `rounded-xl` | `rounded-st-lg` | 9 |
| `rounded-2xl` | `rounded-st-xl` | 1 |
| `rounded-full` / `rounded-none` / `rounded-bl-sm` | *(유지)* | 25 / 1 / 1 |

패널 기준 **57개소**(전체 64개소 중 storefront 7개소는 Rule 5로 제외).
기계적 치환은 시작점이고 개별 검토가 산출물 — 검토 결과 썸네일 계열은 애초에 토큰을 받지
않았고(이미지는 `rounded-full`/카드 내부), 유일한 소형 요소는 첨부 버튼이라 `st-md`가
맞아 하향 조정 대상은 없었습니다.

### FN-004 — 콘솔 미리보기 정합
- **문제**: 정적 미리보기의 **껍데기는 이미 설정을 따랐고 내부 말풍선만** 고정이었음
  (REQ §5-6 정정).
- **구현**: 미리보기 컨테이너가 `radiusVars()`로 같은 변수 5개를 주입하고, 말풍선은
  `rounded-st-lg`를 사용. 실위젯 preview(`openPreview`)는 위젯 수정으로 자동 해결.
- **수용 기준**: 저장 전에도 모서리를 바꾸면 미리보기가 즉시 반영.

### FN-005 — 회귀 가드
- **구현**: `scripts/check-radius-tokens.mjs` + `npm run radius:check` + CI 스텝
  (저장소가 이미 쓰는 `env:check`/`check-migrations` 게이트와 동일 패턴).
  패널 컴포넌트에 `rounded`(접두어 없는 4px 포함)·`rounded-(sm|md|lg|xl|2xl|3xl)`가
  나타나면 실패하고 **대체 토큰을 지목**. 주석은 스캔 전에 제거 — 라운딩을 설명하는
  산문은 클래스가 아닙니다. `rounded-full`·`rounded-none`·`rounded-bl-sm`·storefront는 허용.
- **근거**: 이 가드가 없으면 다음 컴포넌트에서 같은 방식으로 다시 썩습니다 — 그게
  이 버그의 실제 근본 원인입니다.

## 5. 요구사항 요약

| ID | 요구사항 | 우선순위 |
|----|-------------|----------|
| FR-001 | 테마 레이어가 5단 파생 스케일 발행 | P0 |
| FR-001b | 해제 목록이 파생 변수를 포함(+일반 계약 테스트) | P0 |
| FR-002 | Tailwind가 `rounded-st-*`로 노출 | P0 |
| FR-003 | 비-핀 패널 컴포넌트 전부가 스케일 소비 | P0 |
| FR-004 | 콘솔 미리보기가 설정을 즉시 반영 | P1 |
| FR-005 | 모바일 전체화면 패널은 사각 유지 | P1 |

| ID | 비기능 | 기준 |
|----|-------------|----------|
| NFR-001 | 기본 `보통(12px)`에서 무회귀 | 계산값이 수정 전과 동일 |
| NFR-002 | 수정이 썩지 않을 것 | CI 가드가 신규 고정 라운딩 차단 |
| NFR-003 | 런타임 비용 증가 없음 | CSS 변수만, 요청 0 추가 |
| NFR-004 | API/DB/백엔드 무변경 | 프런트엔드 diff |

## 6. WBS

| ID | 작업 | 의존 | 산정 | 상태 |
|----|------|------|------|------|
| T-001 | 파생 스케일 발행 + `radiusVars()` (FN-001) | - | 0.5d | ✅ |
| T-001b | `THEMED_PROPERTIES` + 계약 테스트 (FN-001b) | T-001 | 0.25d | ✅ |
| T-002 | Tailwind 토큰 등록 (FN-002) | T-001 | 0.25d | ✅ |
| T-003 | 57개소 이행 + 개별 검토 (FN-003) | T-002 | 1.5d | ✅ |
| T-004 | 콘솔 미리보기 정합 (FN-004) | T-001 | 0.25d | ✅ |
| T-005 | CI 가드 (FN-005) | T-003 | 0.5d | ✅ |
| T-006 | 검증 TC-001~014 | T-003,T-004 | 0.5d | ✅ |

**산정 합계 3.75d** (원안 4.25d — T-004가 공유 빌더·실위젯 미리보기 확인으로 축소)

## 7. 리스크

| 리스크 | 완화 |
|------|-----------|
| 일괄 치환이 의도적 고정값을 바꿈 | T-003 개별 검토 + `md` 계산값 대조(수정 전과 동일해야 함) |
| **정규식이 못 보는 형태가 남음** | 실제로 발생 — 접두어 없는 `rounded` 10개소가 1차 스윕을 빠져나갔고 **스테이징 실측(계산값 순회)** 으로 검출. 정적 검사만 믿지 말고 배포본에서 값 분포를 확인할 것 |
| 콘솔·위젯 스케일 상수 drift | **소멸** — `radiusVars()` 한 함수를 양쪽이 호출 |
| 라이브 커스텀 디자인 테넌트가 세션 중 변화를 봄 | `md` 중립 보정으로 출시, `ivyusa` 사전 통지 |
| 런처의 `rounded-full`이 실수로 치환됨 | 제외 목록 명문화 + 가드 + TC-008 |
| 디자인 해제 시 변수 잔존 | T-001b(계약 테스트가 일반 규칙으로 방지) |

## 8. 범위 밖

- 콘솔의 컴포넌트별 라운딩 개별 오버라이드(전역 설정 1개가 제품 모델)
- 모바일 바텀시트 상단 모서리(POL-002 `[TBD]`)
- 그림자·테두리 두께·여백 토큰 — 같은 계열의 갭이지만 별건

## 9. 배포 참고

위젯은 해시 파일명으로 서빙되므로 **스토어프론트 변경·재설치 불필요**. 임베드 로더가
부모 `localStorage`에 캐시하는 것은 런처 위치/크기/패널 프레임뿐이고 radius는 포함되지
않아 캐시 무효화 단계도 없습니다. 쇼퍼는 다음 페이지 로드에서 새 번들을 받습니다.
