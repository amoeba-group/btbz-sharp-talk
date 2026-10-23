# RPT-261024 — 상담카테고리: 명칭 · 노출 설정 · 위젯 고객 선택 · 규칙 그룹 연결

- REQ: `docs/analysis/REQ-261024-Widget-Handoff-Consult-Category-Picker.md` (§6 추가 요구 포함)
- PLN: `docs/plan/PLN-261024-Widget-Handoff-Consult-Category-Picker.md` (D1~D8 권장안 승인)
- TCR: `docs/test/TCR-261024-Widget-Handoff-Consult-Category-Picker.md`

## 1. 변경 내용

| 항목 | 결과 |
|---|---|
| 명칭 | 콘솔 "카테고리" → "상담카테고리"(6개 언어). 규칙 제목 "배정 규칙 — 상담카테고리 × 업무" |
| 관리 | 노출함/노출 안 함 토글, 언어별 이름(6개 언어), 추가 줄 "고객에게 노출"(기본 켬), 사용처 = 규칙·팀·라벨 |
| 위젯 A 경로 | [상담원 연결] 버튼 · `agent_connect` 칩 · `connect_agent` 후처리 · 문의 카드 → 노출 상담카테고리가 있으면 선택 카드 → `POST /chat/escalate {category_code}` |
| 위젯 B 경로 | 인계된 턴(`escalate:true`) 뒤에 카드 → `POST /chat/consult-category`. 미수락 대기에서 첫 선택이면 재라우팅(`category_selected`)하고 이전 알림은 acked |
| 라우팅 | 규칙 상담카테고리 조건 = 고객 선택값만. 고객 정보에 `region`(권역) 조건 추가. 선택 시 직전 상담원 우선 생략. 보조 배정은 선택값·성·시 기준 |
| 연결 대상 | 맞은 규칙의 상담원 그룹(팀 × 라벨) + 개인 지정. 기존 그룹 resolver 사용 |
| 보안 | 노출 코드만 받는다(escalate는 그 밖의 값을 무시하고 기본 라우팅, consult-category는 E5109). 대화 소유 검사(404) |
| 콘솔 | 라이브챗 헤더 `상담: X` 배지, 시스템 줄, 알림 모달 재라우팅 문구, 규칙 칩 👁 |
| 데이터(D8) | go2joy 지역 카테고리 5개 삭제, 팀·라벨 담당 범위에서 제거. 기업 지역 필터는 고정 권역으로 복귀 |

PLN과 다른 점: `sendMessage` 응답에 `handedOff`를 새로 만들지 않았다. 기존 `escalate`가 "이번 턴에 인계됨"과 정확히 같아서 이를 쓰고, 계약 주석에 명시했다.

## 2. 파일
- **SQL**: `sql/261024-consult-category.sql`, `sql/artefacts.tsv`
- **types**
  - `routing-condition.ts`: `region` 필드
  - `widget.types.ts`: `consultCategories`, `escalate` 주석
- **API**
  - `routing-category/*`: visible·names·visibleFor·visibleRow·consultLabel, 기업 사용처 제거
  - `ai-engine/handoff-router.service.ts`(+spec), `tenant-ai-config.entity.ts`
  - `chat/chat.service.ts`(escalate·chooseConsultCategory·sysMsg), `chat.controller.ts`, `chat.request.ts`, `conversation.entity.ts`, `chat.module.ts`, 신규 spec
  - `agent/agent-alert.service.ts`(+spec), `agent-console.controller.ts`
  - `session/session.controller.ts`·`mapper`·`module`(+spec)
  - `company.request.ts`
- **Web**
  - `routing-categories/*`
  - `ai-settings/RoutingRulesEditor.tsx`, `HandoffSection.tsx`
  - `customers/CompaniesPanel.tsx`
  - `live-chat/LiveChatPage.tsx`, `EscalationAlarm.tsx`, `live-chat.service.ts`
  - i18n `aiSetting`·`users`·`livechat` ×6
- **Widget**
  - `ConsultCategoryCard.tsx`(신규)
  - `ChatTab.tsx`, `useChat.ts`, `chatService.ts`, `useSession.ts`, `widgetStore.ts`
  - locales ×6

## 3. 테스트
- api jest 258 suites / 2,598 tests 통과
- api·web·widget tsc, i18n:check, radius:check, CI 통과
- 로컬: SQL 전후, 실 HTTP 9개 시나리오, 콘솔·위젯 화면 6항목
- 실측 중 수정 1건: 알림 모달의 재라우팅 사유 문구

## 4. 배포

| 환경 | SQL | 코드 | 확인 |
|---|---|---|---|
| 스테이징 | 10/24 03:24 적용. 백업 `~/backups/staging/20261024-0324-pre-consult-category.sql`. 전: go2joy north~south 5행(name NULL) + bs·cs, 라벨 consult regions 5개 → 후: bs·cs만(visible 0), consult regions NULL, 새 컬럼 확인 | `d0f82399` ff, `deploy-staging.sh` | `successfully started`, ERROR 0, `/chat/consult-category` 400(검증 오류 = 배포됨), health 200, 위젯·콘솔 번들 확인 |
| 프로덕션 | 적용. 백업 `~/backups/sharptalk-production/20261024-0126-pre-consult-category.sql.gz`(파일명은 로컬 시각 기준). routing_categories 0행, 새 컬럼 확인 | `production` 2524bcc1..d0f82399, `deploy-self-hosted.sh` | `successfully started`, ERROR 0, 400, health 200, 위젯 번들 확인 |

- PR #729(squash `d0f82399`)
- 롤백
  - 코드를 되돌린 뒤 컬럼 4개를 DROP한다.
  - 삭제한 5행과 범위는 위 백업이나 `261024-routing-categories.sql`로 복구한다.

## 5. 후속
- **스테이징 go2joy의 `bs`(Business Support)와 `cs`(Customer Services)는 노출 안 함 상태다.** 운영자가 만들어 둔 것이다. 위젯에 보이려면 상담카테고리 관리에서 노출함으로 바꾸고, 필요하면 vi/en 이름을 넣는다.
- 지역 기준 배정은 규칙의 고객 정보 › 권역 조건으로 다시 설정한다(현재 지역 규칙 0건).
- 매뉴얼 갱신(상담원 연결 탭·상담카테고리)은 별도로 한다.
