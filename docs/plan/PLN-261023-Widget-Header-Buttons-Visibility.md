# PLN-261023 — 위젯 헤더 버튼(언어 선택·설정) 노출 설정

- REQ: `docs/analysis/REQ-261023-Widget-Header-Buttons-Visibility.md`
- 상태: **승인됨 (2026-10-23, 권장안 D1~D4)**

## 결정 사항

| # | 결정 | 권장안 | 대안 |
|---|---|---|---|
| D1 | 버튼 노출과 테스트 모드 토글의 관계 | **독립** — 같은 카드 안 ② 영역이지만 "노출 제한 사용 안 함"이어도 버튼 설정은 적용. (테스트 끝내고 제한을 끄는 순간 숨겼던 버튼이 다시 나타나는 일이 없게) | 테스트 모드가 켜져 있고 기간 안일 때만 적용 |
| D2 | 저장 위치 | **`tenants.widget_access` JSON에 `controls: { language, settings }` 추가** — 스키마 변경 0, 카드 저장 버튼 하나·요청 하나 | `widget_theme`(디자인 패키지 내보내기 대상, brand 필수라 테마 없는 테넌트 처리 필요) |
| D3 | 언어 버튼 숨김 시 언어 결정 | **화면 언어 우선**: 로더가 `<html lang>` 출처를 표시(`lang_src=doc`)해 위젯이 화면 선택으로 인정, 위젯은 이전 방문의 수동 선택을 무시. 로더가 `<html lang>` 변경을 감지(MutationObserver)해 `setLocale` 자동 전달 → SPA 전환도 따라감 | 현행 유지(설정에 locale 넘기는 스토어만 따름 — `<html lang>`만 쓰는 스토어는 이전 선택에 고정) |
| D4 | 설정 버튼 숨김 시 개인정보 선택 경로 | **AI 고지 줄(채팅 상단/하단)에 작은 "개인정보 선택" 텍스트 링크를 남김** — 같은 패널을 연다. CCPA 상시 링크 요건 유지 | 완전 숨김(콘솔에 "개인정보 선택 경로가 사라집니다" 경고만) |

옵션 1(IP)은 기존 기능(IP·URL·기간·초대 키) 그대로 — 화면 구조만 ①로 묶음. 변경 없음.

## 화면 (ASCII 와이어프레임)

### 콘솔 `/settings/widget` — 노출 카드
```
┌─ 위젯 노출 설정 ──────────────────────────────────────────────┐
│                                                               │
│ ① 노출 제한 (테스트 모드)                     [● 사용 중 ]     │
│    지정한 IP 또는 URL에서만, 아래 기간 동안만 위젯을 노출합니다.  │
│    기간      [2026-10-24 09:00] ~ [2026-10-31 18:00]           │
│    허용 IP   [203.0.113.7 ✕] [10.0.0.0/8 ✕]  [______] [+추가]  │
│    허용 URL  [https://shop.example.com/test ✕]  [______] [+추가]│
│    초대 링크 …(기존 그대로)                                     │
│ ───────────────────────────────────────────────────────────── │
│ ② 헤더 버튼 노출                                               │
│    테스트 모드 사용 여부와 관계없이 항상 적용됩니다.              │
│    언어 선택 버튼   (●) 노출함  ( ) 노출 안 함                   │
│      └ 노출 안 함: 위젯은 스토어 화면의 언어를 따릅니다.          │
│    설정 버튼        ( ) 노출함  (●) 노출 안 함                   │
│      └ 노출 안 함: 개인정보 선택은 채팅 안내 줄 링크로 남습니다.  │
│                                                               │
│                                            [취소]  [저장]      │
└───────────────────────────────────────────────────────────────┘
저장 → 토스트 "저장했습니다"(자동 닫힘) / 실패 → 오류 토스트(수동 닫힘)
```

### 위젯 헤더
```
현행                                   언어·설정 모두 숨김
┌──────────────────────────────┐       ┌──────────────────────────────┐
│ IVY USA        🌐KO  ⚙   ✕  │       │ IVY USA                   ✕ │
├──────────────────────────────┤       ├──────────────────────────────┤
│ AI 상담원이 답변합니다.        │       │ AI 상담원이 답변합니다.        │
│                              │       │            개인정보 선택 ›   │ ← D4
```
닫기(✕)는 대상 아님(모바일에서 닫을 방법이 사라짐 — PLN-260817 D-2).

## 단계

### S1 — 타입·API (스키마 변경 없음)
- `packages/types/src/common/widget-access.ts`: `WidgetHeaderControls { language: boolean; settings: boolean }`, `WidgetAccess.controls?`, 기본값 `{ language: true, settings: true }`, 정규화(미지 값=true).
- `tenant.service.ts` 저장/조회: `controls` 병합 저장, 판정식(`isWidgetVisible`)에는 **관여하지 않음**(D1).
  - ⚠️ `enabled=true` + 규칙 0개 거절 검증은 ① 영역에만 — 제한 꺼진 채 ②만 저장 가능해야 함.
- 요청 DTO `controls: { language?: boolean; settings?: boolean }`(snake 단일 단어라 그대로) / 응답 매퍼 `controls`.
- 세션 ensure 응답(`SessionResponse`)에 `headerControls` 추가 — 테넌트 설정 단일 출처, 미리보기 테마 응답(`preview-theme`)도 동일 값.
- 단위 테스트: 기본값, 부분 저장, 제한 off에서 ②만 저장, 판정식 무영향.

### S2 — 위젯
- `widgetStore`에 `headerControls`, `adoptTenantConfig`에서 수용 + 테마와 함께 shop별 캐시(첫 페인트 깜빡임 방지).
- `WidgetPanel.tsx` 헤더: `language=false`면 `LanguageSwitcher` 미렌더, `settings=false`면 ⚙ 미렌더.
- D3: `language=false`일 때 `initialLanguage()`가 localStorage 수동 선택을 건너뜀; 세션 ensure의 수동 오버라이드 판정도 동일.
- D4: `settings=false`일 때 AI 고지 줄에 "개인정보 선택" 링크(`setSettingsOpen(true)`), 동의 배너 링크는 그대로. i18n 6언어(기존 `chat.consent.privacyChoices` 재사용).

### S3 — 로더 `public/embed.js` (D3)
- 설정에 `locale`이 없고 `<html lang>`에서 언어를 읽었으면 `lang_src=doc`을 덧붙임(`host_locale=1`은 그대로 설정 지정 시에만).
  - 로더는 테넌트 설정을 모르므로 판단은 위젯이 함: `language=false` 테넌트에서만 `lang_src=doc` 값을 화면 선택으로 승격. 버튼을 노출하는 테넌트는 현행 순서 유지(방문자 선택 존중).
- `<html lang>` 속성 MutationObserver → 바뀌면 기존 `locale` 명령 전송(위젯이 제공 언어 밖이면 무시하는 기존 규칙 그대로). 설정에 `locale`을 명시한 호스트는 감시하지 않음(그쪽은 `setLocale`/새로고침 계약).
- 로더 계약 문자열 변경 없음(추가 파라미터만) — 구버전 위젯과 혼재해도 무해.

### S4 — 콘솔
- `WidgetAccessCard.tsx`: 카드 제목 "위젯 노출 설정", ① 기존 내용, ② 라디오 2쌍 + 보조 문구, 저장은 기존 버튼 하나(dirty 판정에 controls 포함), 성공/실패 토스트.
- `settings.json` 6언어: `widgetAccess.cardTitle`, `controls.*` 키. `npm run i18n:check`.
- 미리보기 위젯이 같은 값을 반영(저장 후).

### S5 — 검증·문서
- typecheck·api/widget/web 테스트, i18n:check.
- 실측(스테이징, 임베드 페이지로 — 미리보기 창 검증≠임베드 검증): ① 버튼 숨김/노출 전환 ② `<html lang="ko">` 페이지에서 이전에 EN 고른 브라우저 → KO로 열림 ③ SPA형 `<html lang>` 변경 → 위젯 언어 전환 ④ 설정 숨김 시 고지 줄 링크로 개인정보 패널 열림 ⑤ 노출 제한 판정 무회귀(IP 규칙).
- TCR → RPT.

## 사이드 임팩트
| 영역 | 영향 | 대응 |
|---|---|---|
| 노출 제한 판정(로더·ensure) | `controls`가 같은 JSON에 들어감 | 판정 함수는 필드를 읽지 않음 — 테스트로 고정 |
| 기존 테넌트 | `controls` 없음 → 기본 노출 | 무회귀, SQL 없음 |
| 트리거 모드(ivyusa) | 이미 언어 버튼 숨김 | 그대로(트리거 모드 숨김 OR 설정 숨김) |
| 모바일 SDK(앱 모드) | 헤더 동일 컴포넌트 | 같이 적용 — 앱이 `setLocale`로 언어를 넘기므로 D3와 충돌 없음 |
| 버튼 노출 테넌트 | D3 로더 변경 | 위젯이 `language=false`일 때만 승격 → 현행 순서 유지 |
| CCPA/개인정보 | 설정 숨김 | D4 링크로 경로 유지 |
| 커스텀 위젯 디자인/패키지 | 없음(D2: theme 미사용) | — |

## 배포
- 스키마 변경 없음(JSON 필드 추가) → SQL 선적용 불필요, `## Migration` 섹션 불요.
- 위젯·로더·API·웹 동시 배포. 로더는 `Cache-Control` 짧음 — 구 로더+신 위젯 조합은 D3 SPA 감지만 빠지고 나머지 정상.
