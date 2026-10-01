# REQ-261001 — 빠른 답변 버튼 404 · 개인정보 안내 문구 테넌트화

- 요청(2026-10-01, 2건):
  1. **빠른 답변 버튼** — 작업이 "메시지 보내기"인데도 버튼을 누르면 `/api/v1/chat/scenario`를 호출해
     404. 미리보기에는 "Resource not found", 파트너 화면에서는 "자료 없음"으로 보였다(추정).
     → "메시지 보내기" 버튼은 일반 채팅 경로로 보내야 한다.
  3. **개인정보 안내 문구** — 테넌트 설정에 개인정보 처리방침 URL과 동의 안내 버전만 있고 문구 편집
     칸이 없다. 지금 보이는 문구는 플랫폼 기본값. URL·버전도 비어 있다.
     → 문구를 테넌트별로 편집하거나 업종(커머스·숙박)별 기본 문구가 필요하다.
- 조사 기준 커밋: main `ef5bd42`(2026-10-01)
- 관련: PLN-260903-Conversation-Defaults-Console(시나리오 버튼) · PLN-261001(go2joy 파트너 위젯) ·
  PLN-Privacy-Control-Gap Stage 2(개인정보 고지 설정)

---

## 1. 요구 ① 빠른 답변 버튼

### 1-1. 원인 (코드로 확정)

`/chat/scenario`는 **내장 스크립트가 있는 액션만** 처리한다.

```ts
// apps/api/src/domain/chat/scenario.service.ts
const builtIn = SCENARIOS[action];
if (!builtIn) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
```

콘솔의 작업 선택지에는 `message`("메시지 보내기")가 있는데(`SCENARIO_ACTIONS`,
`action_message: '메시지 보내기'`), **`SCENARIOS`에 `message` 스크립트는 없다.** 그래서 이 액션을
시나리오 API로 보내는 호출자는 전부 404를 받는다.

### 1-2. 어느 화면이 그 호출을 하는가 — 셋 중 하나만 잘못돼 있다

| 호출 지점 | 현재 동작 | 판정 |
|---|---|---|
| **콘솔 미리보기** `PreviewPanel.tsx` | 칩 클릭 → `runScenario(chip.id)` → `/chat/scenario` **무조건** | ❌ **결함 확정.** `message` 버튼 4개 모두 404 → "Resource not found" |
| 위젯 메인 메뉴 `ChatTab.handleScenario` | `case 'message': default:` → `doSend(label)` (채팅 경로) | ✅ 이미 정상 |
| 위젯 답변 뒤 칩(커머스 꺼짐 테넌트) | `a.button ? handleScenario(a.button) : handleQuickReply(...)` | ✅ 이미 정상 |
| 위젯 스크립트 후속 칩 `handleQuickReply` | `default:` → `scenario(id)` | ⚠️ 스크립트 없는 id가 오면 같은 404(현재 그런 조합은 없음) |

### 1-3. 실데이터 — 보고와 일치

스테이징 `tenant_ai_config`:

```
tenant 1 (ivyusa)  actions = ["my_orders","product_help","contact_support","affiliate"]
tenant 4 (go2joy)  actions = ["message","message","message","message"]   ← 4개 전부
```

go2joy는 네 버튼이 모두 `message`다. 콘솔 미리보기에서 어느 것을 눌러도 404가 난다 —
**사용자가 본 그대로다.**

### 1-4. 파트너 화면의 "자료 없음"은 아직 확정 아님

현재 main의 위젯은 `message`를 채팅 경로로 보낸다(§1-2). 따라서 파트너가 본 증상은
(a) 콘솔 미리보기를 본 것이거나, (b) 더 오래된 위젯 빌드였거나, (c) 404가 아니라 **KB 답변이
실제로 약했던** 별개 문제일 수 있다. 확인 방법: 파트너 화면에서 버튼을 누른 뒤 네트워크 탭에
`/chat/scenario` **404**가 찍히는지 / `/chat/message` 200인데 답이 "자료 없음"인지. 전자면 위젯
빌드 문제, 후자면 지식 문제다.

### 1-5. 설계 공백 하나 더

`message` 버튼은 **보낼 문장을 따로 가질 수 없다** — 라벨이 곧 질문이다. 라벨 "체크인 방법"이
그대로 질문이 되는데, 운영자가 "체크인은 어떻게 하나요?"처럼 묻고 싶어도 칸이 없다.

## 2. 요구 ③ 개인정보 안내 문구

### 2-1. 원인 (코드로 확정)

안내 문구 전체가 **위젯 번들의 i18n**에 있다(6언어 하드코딩):

```ts
// apps/widget/src/i18n/locales/ko.ts
consent: {
  title: '개인정보 처리 안내',
  body: 'CCPA에 따라 상담 제공을 위해 … 분석 도구(Google Analytics)를 사용합니다…',
  items: '수집 항목: 채팅 메시지, 요청하신 주문 조회 내역, 기본 기기 정보',
  retention: '보관 기간: 채팅 데이터는 최대 365일 보관 후 삭제됩니다.',
  aiProcessor: 'AI 처리: 메시지는 미국 소재 제3자 AI 제공업체가 처리합니다.',
}
```

서버가 테넌트별로 내려주는 것은 **URL·버전·AI 처리 지역**뿐이다(`privacyNotice()`), 문구 자체는 없다.
즉 숙박 테넌트(go2joy)도 **"주문 조회 내역"과 CCPA 문구**를 그대로 본다.

### 2-2. 실데이터

| 환경 | 상태 |
|---|---|
| 스테이징 | 테넌트 **15개 중 URL 보유 1개, 버전 보유 0개** |
| 프로덕션 | 테넌트 1(ivyusa) — URL·버전 **둘 다 NULL** |
| go2joy | `commerce_enabled = 0`(숙박)인데 커머스 문구 노출 |

URL이 비면 배너에서 "개인정보 처리방침" 링크가 **렌더되지 않는다**(`{privacyPolicyUrl && …}`) —
깨진 링크는 아니지만, 고지에 정책 링크가 없는 상태다.

### 2-3. 이미 있는 재료

- `tenants.commerce_enabled` — 커머스/비커머스를 구분하는 **신호가 이미 있다**. "주문 조회 내역"
  한 줄은 이 값만으로 지금 바로 가를 수 있다.
- `AI_PROCESSING_REGION` — AI 처리 지역은 이미 배포별로 문구에 보간된다.
- `consent_notice_version` + `noticeOutdated` — 문구가 바뀌면 **재동의를 받는 장치가 이미 있다**.

## 3. 갭 분석

| # | 요구 | 판정 | 필요한 것 |
|---|---|---|---|
| G1 | `message` 버튼이 404 나지 않을 것 | **결함** | 콘솔 미리보기의 디스패치를 위젯과 같게(액션별 분기) |
| G2 | 어떤 호출자든 안전할 것 | **권장 보강** | 서버가 `message`/미지 액션을 404 대신 **일반 메시지로 처리**(구 위젯·SDK·향후 클라이언트까지 한 번에) |
| G3 | 버튼이 보낼 문장을 따로 지정 | **신규(선택)** | 버튼에 `message` 필드(비우면 라벨 사용), 6언어 |
| G4 | 안내 문구 테넌트별 편집 | **신규** | 문구 저장소 + 콘솔 편집 + 버전 연동 |
| G5 | 업종별 기본 문구 | **신규** | 프로필(커머스·숙박·일반) 중 택1, 플랫폼이 6언어 유지 |
| G6 | 커머스 꺼짐 테넌트의 "주문 조회" 문구 | **즉시 가능** | 기존 `commerce_enabled`로 해당 줄만 분기 |
| G7 | URL·버전 비어 있음 | **운영** | 코드가 아니라 설정 입력. 콘솔에 "미설정" 경고 노출은 코드 |

## 4. 설계 선택지 — 안내 문구

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| **A. 업종 프로필** | `tenants.privacy_profile` = commerce / lodging / generic. 문구는 플랫폼이 6언어로 유지 | 운영자가 고를 것이 하나, 번역 품질·법무 검토를 플랫폼이 통제 | 업종이 늘 때마다 코드 |
| **B. 전면 편집** | 테넌트가 title·body·items·purpose·retention·aiProcessor를 6언어로 직접 편집 | 무엇이든 표현 가능 | **6필드 × 6언어 = 36칸**, 법무 검토 없는 문구가 그대로 고객에게, 번역 누락 시 빈 고지 |
| **C. A + 부분 덮어쓰기(권장)** | 프로필을 고르고, 필요한 줄만 테넌트가 덮어씀(빈 값은 프로필 문구 유지) | 대부분은 고르기만, 예외는 한 줄만 고침 | 구현이 A보다 한 겹 많음 |

**권장 C.** 커스텀 위젯(`widget_designs`)·시나리오 스크립트(`mergeScript`)가 이미 "기본 위에 테넌트
덮어쓰기" 패턴을 쓰고 있어 구조가 낯설지 않다.

## 5. 제약·전제

| # | 내용 |
|---|---|
| C1 | **문구를 바꾸면 재동의가 필요하다.** 실질적 변경은 `consent_notice_version`을 올려야 하고, 올리면 기존 동의자 전원이 다시 묻는다. 저장 UI가 이 선택을 명시적으로 물어야 한다(“중요한 변경입니까?”) |
| C2 | 고지 문구는 **법적 문서**다. 전면 편집(B)을 열면 플랫폼은 문구 품질을 보증할 수 없다 — 권장안 C에서도 "덮어쓴 문구의 책임은 테넌트"임을 콘솔에 명시 |
| C3 | 6언어 전부 채워지지 않으면 **조용한 영어 폴백**이 아니라 빈 줄이 될 수 있다 — 덮어쓰기는 언어별로 비어 있으면 프로필 문구로 되돌아가야 한다 |
| C4 | `message` 버튼 수정은 **스크립트가 있는 액션의 동작을 바꾸지 않아야** 한다(`delivery_status`는 계속 스크립트) |
| C5 | 서버 폴백(G2)을 넣으면 404가 사라져 **설정 오류가 조용해진다** — 폴백 시 `logger.warn`을 남겨야 추적된다(4xx는 기본적으로 서버 로그에 안 남는다) |

## 6. 미결 결정

| # | 결정 | 선택지 | 제안 |
|---|---|---|---|
| **D1** | ①의 수정 범위 | ⓐ 콘솔 미리보기만 / ⓑ **미리보기 + 서버 폴백**(미지 액션 = 메시지) | **ⓑ** — 미리보기만 고치면 구 위젯·SDK·다음 클라이언트가 같은 404를 다시 만난다 |
| **D2** | 버튼 전용 메시지 필드(G3) | 넣는다 / 라벨만 쓴다 | **넣는다(선택 입력)** — 라벨은 짧아야 하고 질문은 길어야 한다 |
| **D3** | 안내 문구 방식 | A / B / **C** | **C**(프로필 + 부분 덮어쓰기) |
| **D4** | 프로필 종류 | commerce · lodging · generic | 셋으로 시작, 추가는 코드 |
| **D5** | 버전 올리기 | 저장 시 자동 / **운영자가 선택** | **선택** — 오타 수정까지 전원 재동의를 받게 할 수는 없다 |
| **D6** | 빈 URL·버전 | 그대로 둔다 / **콘솔에 미설정 경고** | 경고 + 저장 유도(기본값을 임의로 채우지 않는다) |

## 7. 범위 제안

| 단계 | 내용 |
|---|---|
| P1 | ① 수정: 콘솔 미리보기 디스패치 + 서버 폴백(+경고 로그) + 회귀 테스트 |
| P2 | ③-a 즉시 개선: `commerce_enabled`로 "주문 조회 내역" 줄 분기(기존 플래그만 사용) |
| P3 | ③-b 프로필(commerce/lodging/generic) + 테넌트 부분 덮어쓰기 + 콘솔 편집 + 버전 올리기 선택 |
| P4 | ③-c 콘솔에 URL·버전 미설정 경고 |
| — | G3(버튼 메시지 필드)은 D2 결정 시 P1에 포함 |

## 8. 연관 지점

- 서버: `domain/chat/scenario.service.ts`(404 지점) · `chat/scenario-scripts.ts`(`SCENARIOS`) ·
  `domain/session/session.service.ts`(`privacyNotice`) · `domain/tenant/entity/tenant.entity.ts`
- 콘솔: `domain/ai-settings/PreviewPanel.tsx`(결함) · `AiSettingsPage.tsx`(`SCENARIO_ACTIONS`) ·
  `domain/privacy-notice/PrivacyNoticePage.tsx`
- 위젯: `components/chat/ChatTab.tsx`(정상 분기) · `components/chat/ConsentBanner.tsx` ·
  `i18n/locales/*.ts`(`consent.*` 문구)
