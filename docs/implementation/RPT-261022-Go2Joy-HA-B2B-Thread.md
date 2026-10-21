# RPT-261022 — go2joy HA 2단계: 기업고객·연락처 등록 · 계정 대화 연속성 · B2B/B2C 구분

- 근거: [PLN-261022 §3](../plan/PLN-261022-Go2Joy-HA-B2B-Identity-Continuity.md) · [TCR-261022-B2B-Thread](../test/TCR-261022-Go2Joy-HA-B2B-Thread.md)
- PR **#689** → main `053810ec` (squash)

## 1. 무엇이 바뀌었나
| 영역 | 변경 |
|---|---|
| 스키마 | `companies`, `company_contacts`, `customers.customer_type`(기본 `b2c`), `sessions.company_id`, `conversations.customer_id`·`company_id`·`prev_conversation_id`, `tenants.thread_continuity`(기본 0), 인덱스 3개. 백필 `conversations.customer_id ← sessions.customer_id` |
| 등록 | identify에 서명된 `hotel_id`가 있으면 고객을 `b2b_contact`로 바꾸고, 기업 `hotel:{id}`를 upsert하고(이름·성·권역 갱신), 연락처를 연결하고(역할·최근 접속), 세션에 회사를 기록한다. 이미 열린 대화에도 계정을 기록한다. 등록에 실패해도 identify는 성공한다 |
| 연속성 | 새 대화에 계정과 직전 대화를 연결한다. 종료된 행은 다시 열지 않는다. 이관 시 직전 상담원을 먼저 배정한다(sticky: `handoff_config.thread.stickyHours` 기본 24h, 규칙 후보 안 또는 broadcast일 때만, 활성 상담원만) |
| AI | 직전 대화 마지막 6턴 발췌(고객·상담원 발화 PII 치환, 30일 이내)를 `PREVIOUS_CONVERSATION` 블록으로 넣는다. 검색어에는 넣지 않는다 |
| 위젯 | `GET /chat/thread`(검증 세션 + 스위치 켜짐, 아니면 403 `E5099`)와 세션 응답 `threadAvailable`. "이전 대화 보기"(3건씩), 날짜 구분선, 읽던 위치 유지. `scope=self`면 동료 대화는 건수만. 로그아웃 시 초기화. i18n 6개 언어 |
| 콘솔 | 고객 탭(전체/기업고객/부킹고객)·유형 열, 기업 목록(이름·권역·성·연락처·대화·최근 활동, 검색·권역 필터), 기업 상세(연락처 마스킹·대화 열람). 라이브챗 "기업" 배지와 "이 기업(호텔)의 이전 대화 n건" 목록, 대화 이력 B2B/B2C 필터, 배정 조건 `customer_type`. i18n 6개 언어 |
| API | `GET /companies`, `GET /companies/:id`(`E5098`), `GET /agent/conversations/:id/company-conversations`, 고객 목록 `customer_type` 필터, 이력 `segment` 필터 |

## 2. 파일
- API 신규: `domain/company/{company.module, company.service, company.controller, company.mapper}.ts`, `entity/{company, company-contact}.entity.ts`, `dto/*`, `domain/chat/thread.service.ts`
- API 수정: `embed/{embed.service, embed.module}`, `chat/{chat.service, chat.controller, chat.mapper, chat.module, rag.service, scenario.service, entity/conversation.entity}`, `session/{session.service, session.mapper, entity/session.entity}`, `customer/{customer.service, customer.controller, customer.mapper, entity, dto}`, `agent/{agent-console.controller, agent.mapper, agent.module}`, `analytics/{analytics.service, analytics.controller, dto}`, `ai-engine/{handoff-router.service, entity/tenant-ai-config.entity}`, `tenant/entity/tenant.entity`, `global/constant/error-code.constant`(E5098·E5099), `app.module`
- 공용 타입: `api/widget.types.ts`(ThreadResponse·threadAvailable), `common/enum.types.ts`(CUSTOMER_TYPE), `common/routing-condition.ts`(customer_type)
- 위젯: `components/chat/{EarlierConversations(신규), ChatTab}.tsx`, `services/chatService.ts`, `store/widgetStore.ts`, `hooks/{useSession, useEmbedCommands}.ts`, `lib/types.ts`, `i18n/locales/*`
- 웹: `customers/{CompaniesPanel(신규), CustomersPage, customers.service, customers.hooks}`, `live-chat/{CompanyThreadButton(신규), LiveChatPage, live-chat.service}`, `history/{HistoryPage, history.service}`, `i18n/locales/*/{customers, history, livechat, aiSetting}.json`
- SQL: `sql/261022-b2b-company-thread.sql`, `sql/artefacts.tsv`

## 3. 테스트 결과
- `apps/api` 244 스위트 / 2,428개 통과, `packages/types` 186개 통과, web·widget `tsc`·`vite build`, `i18n:check` complete. CI 통과
- 로컬 통합 TCR I-1~I-12 통과:
  - 다른 PC에서 재로그인 → 이전 대화 표시
  - 직전 대화 연결, sticky 배정 로그
  - 같은 호텔 직원 B는 동료 건수만 봄
  - 게스트는 E5099
  - 콘솔·위젯 캡처 확인
- **스테이징 실측(2026-10-22 03:5x KST, go2joy 테넌트 4, 테스트 호텔 `hotel:990001`)**:
  - 서명 identify에서 지역표로 권역을 채움(`Đà Nẵng → south_center`, 로그 `region map`) → 기업·연락처 등록
  - 대화 869 종료 → 새 세션 identify → `/chat/thread` = 869(본인) → 새 대화 870 `prev_conversation_id 869`
  - 상담원 연결은 실제 상담원 호출이 되므로 하지 않았다(sticky는 로컬 실측)
  - 테스트 기업·연락처는 삭제했고, 테스트 대화 2건은 종료 상태로 둠

## 4. 배포 상태
| 환경 | SQL | 코드 | 설정 | 비고 |
|---|---|---|---|---|
| **스테이징** | ✅ 2026-10-22 03:46 선적용(전체 백업 `~/backups/pre-261022-b2b-thread-20261022-0346.sql.gz`), `check-migrations` 누락 0, 백필 64건 | ✅ `053810ec` 배포. 컨테이너 재생성, 부팅 로그 정상, `/companies`·`/chat/thread` 401, dist에 company 모듈 확인 | ✅ go2joy(테넌트 4) `thread_continuity=1` | HA 서명이 붙기 전에는 화면 변화 없음(게스트는 대상 아님) |
| 프로덕션 | ⬜ 미적용 | ⬜ 미배포 | — | 1단계 SQL(261022-unit-label-regions)과 함께 선적용 필요 |
| init-sql | ⬜ | — | — | 261019 3건 + 261022 2건 밀림 → 스테이징 실스키마로 재생성 필요 |

## 5. 남은 일
- 프로덕션: SQL 2건(1·2단계) 선적용 → 배포. 스위치는 꺼진 채 둔다
- init-sql 재생성
- GUIDE v1.2 문구 맞추기: "24시간 안이면 직전 대화를 다시 열어" → "새 대화로 이어지며 직전 상담원이 우선 배정"
- Go2Joy 회신 반영: 위젯 노출 범위(Q2, 현재 `self`), 재개 창(Q3, 24h), 팀 매핑(G6) → 팀 담당 지역·배정 규칙 입력
- 후속 후보: 회사 병합·분할 도구, 회사 단위 통계, 호텔 주소·군(3단계), 서명 유효기간(`ts`)
