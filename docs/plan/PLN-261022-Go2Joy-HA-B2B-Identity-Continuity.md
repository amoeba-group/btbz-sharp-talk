# PLN-261022 — go2joy HA: 지역 정규화(1단계) · 기업고객 등록과 대화 연속성(2단계)

- 근거: [REQ-261021 §0-5·§0-6](../analysis/REQ-261021-Go2Joy-HA-Operator-Identity-Routing.md) · [GUIDE-261022 v1.2](../guide/GUIDE-261022-Go2Joy-HA-Identify-v1.2.md) · `SharpTalk × Go2Joy 채널 구조.pdf`(2026-10-21)
- 기준: main `713af2f` + PR #684(문서) · 코드 조사 2026-10-22
- 상태: **승인 대기** — 승인 전에는 구현하지 않는다(CLAUDE.md §7)
- 범위: 채널 구조의 B2B `#Talk-4-Hotel`(HA 위젯). B2C 에이전트(예약 전·후)와 예약 완료 이관은 범위 밖

## 0. 요약
| 단계 | 목표 | 스키마 | 규모 | 선행 |
|---|---|---|---|---|
| **1단계** | 서명된 지역·성 값을 **정규화**해 저장하고, 권역 코드 4종으로 **배정 규칙을 만들 수 있게** 한다 | 없음(JSON 설정) | 소 (약 1일) | 없음 — HA 서명보다 먼저 배포 |
| **2단계** | HA 직원을 **기업고객(호텔)·연락처(직원)** 로 등록하고, 대화를 **계정 단위로 이어 보며**, B2B / B2C를 구분한다 | **있음**(테이블 2 + 컬럼 5) | 중~대 (약 5~6일) | 1단계, Go2Joy 결정 Q2·Q3(기본값으로 진행 가능) |

## 1. 현재 상태 (코드 확인)
| 영역 | 현재 | 위치 |
|---|---|---|
| 서명 속성 | 허용 키 5개, trim·120자·줄바꿈 제거만 함. **NFC 정규화 없음, region 값 그대로 저장** | `apps/api/src/domain/embed/identity-attributes.ts:11,21` |
| 규칙 지역 비교 | `trim().toLowerCase()` 정확 일치 | `apps/api/src/domain/ai-engine/handoff-router.service.ts:48,122` |
| **규칙 편집기 지역** | **고정 칩 `['north','central','south']`** — Go2Joy의 `north_center`·`south_center`를 고를 수 없음 | `apps/web/src/domain/ai-settings/RoutingRulesEditor.tsx:17,204` |
| 콘솔 배지 | `IdentityBadges`(i18n `identity.region.*`) — 목록 행·대화 헤더 | `apps/web/src/domain/live-chat/IdentityBadges.tsx:13`, `LiveChatPage.tsx:719,841` |
| 고객 | (tenant, `external_customer_id`)로 upsert. 회사·유형 없음(`tier`만) | `embed.service.ts:139`, `customer.entity.ts` |
| 세션 | 임베드는 페이지마다 새 세션, identify는 현재 세션에 customer만 붙임 | `useSession.ts:265`, `embed.service.ts:80` |
| 대화 | `session_id`만 있음. 위젯은 세션의 마지막 대화 1건. 종료 후 다시 열기 없음(새 대화) | `chat.service.ts:270,321,332` |
| AI 맥락 | 현재 대화 메시지 최대 12개 | `chat.service.ts:1049`, `conversation-history.util.ts:49` |
| 고객 콘솔 | 목록만(이메일 검색, tier 수정, reveal). 상세 없음 | `apps/web/src/domain/customers/CustomersPage.tsx`, `customer.controller.ts` |
| 에러 코드 | 마지막 할당 **E5097** | `error-code.constant.ts:271` |
| 마이그레이션 | `sql/YYMMDD-<설명>.sql` + `npm run migrations:manifest`(→ `sql/artefacts.tsv`) + 스테이징 선적용 + `docker/init-sql/01-schema.sql` 동기화 | `scripts/check-migrations.mjs` |

---

## 2. 1단계 — 지역·성 정규화와 권역 코드 (스키마 변경 없음)

### 2.1 작업
| # | 작업 | 파일 |
|---|---|---|
| 1-1 | **권역 카탈로그** `REGION_CODES = ['north','north_center','central','south_center','south']` + `canonicalRegion(v)`: trim → 소문자 → 공백·하이픈을 `_`로, 별칭(`north_central`→`north_center`, `south_central`→`south_center`). 모르는 값은 원문 소문자 그대로 둔다(규칙과 비교할 수 있게) | 신규 `packages/types/src/common/region.ts`(브라우저 딥 임포트, `language.ts`와 같은 방식) |
| 1-2 | **저장용 정규화**: 서명 검증은 지금처럼 받은 값 그대로 하고, 저장 직전에 ① 모든 값 NFC ② `region` = `canonicalRegion` ③ `region`이 없고 `province`가 있으면 테넌트 매핑으로 채움 → `region_source: 'map'`을 로그에 남김 ④ 둘 다 있는데 매핑과 다르면 서명 값 유지 + warn | `identity-attributes.ts`(새 함수 `storedIdentityAttributes`), `embed.service.ts:107` |
| 1-3 | **테넌트 성 → 권역 매핑**: `handoff_config.provinceRegions`(JSON, `{ "Hồ Chí Minh": "south", … }`). 키는 NFC·소문자로 비교. go2joy 스테이징에 지역표 63행 등록(SQL 아닌 설정 값 갱신 스크립트) | `tenant-ai-config` 타입, `scripts/go2joy/seed-province-regions.mjs`(신규, 지역표 → JSON) |
| 1-4 | **규칙 비교도 정규화**: 규칙의 `regions`와 세션 값 양쪽에 `canonicalRegion` → 기존 규칙 `north`·`south`는 그대로 맞고, `North Center` 텍스트도 `north_center`와 맞음 | `handoff-router.service.ts:114-123` |
| 1-5 | **규칙 편집기**: 고정 3칩 → 카탈로그 5칩(`north`·`north_center`·`central`·`south_center`·`south`), 저장된 값 중 카탈로그 밖 값은 "기타" 칩으로 보존(삭제하지 않음) | `RoutingRulesEditor.tsx:17,204-210` |
| 1-6 | **i18n** `identity.region.north_center` / `south_center` 6개 언어 + `npm run i18n:check` | `apps/web/src/i18n/locales/*/` |
| 1-7 | 테스트: 정규화(NFC·별칭·매핑·불일치 warn), 라우터 비교, 서명 검증 회귀(정규화가 서명에 영향 없음 — GUIDE v1.2 T1~T5 해시 고정 테스트) | `identity-attributes.spec.ts`(신규), `embed.service.spec.ts`, `handoff-router.service.spec.ts` |

### 2.2 화면 — 규칙 편집기 지역 칩 (1-5)
```
AS-IS                                              TO-BE
┌ 배정 규칙 #1  하노이 CS ───────────────┐          ┌ 배정 규칙 #1  하노이 CS ──────────────────────────────────┐
│ 지역  [north] [central] [south]        │          │ 지역  [■ North] [■ North Center] [□ Central]               │
│       (선택 없음 = 모든 지역)          │          │       [□ South Center] [□ South]   (선택 없음 = 모든 지역) │
│ 조건  + 조건 추가                      │   ──▶    │ 조건  + 조건 추가                                          │
│ 담당  팀 [Hanoi ▾] × 라벨 [CS ▾]       │          │ 담당  팀 [Hanoi ▾] × 라벨 [CS ▾]                           │
└────────────────────────────────────────┘          └───────────────────────────────────────────────────────────┘
                                                     저장된 값이 카탈로그 밖이면: [■ 기타: hn_old ✕]
```
콘솔 대화 헤더 배지(기존 `IdentityBadges`): `🏨 A In Hotel Del Luna · 남부(South) · Lễ tân` — 새 코드에 i18n 표시명만 추가한다.

### 2.3 부작용 분석
| 대상 | 영향 | 대응 |
|---|---|---|
| 서명 검증 | 없음 — 정규화는 검증 **뒤**, 저장할 값에만 | T1~T5 해시 고정 테스트 |
| 기존 규칙(`north`·`central`·`south`) | 그대로 맞음(정규화해도 동일) | 라우터 테스트 |
| 기존 세션의 `identity_attributes` | 소급 변경 없음. 새 identify부터 정규화 값 | — |
| 다른 테넌트 | `provinceRegions` 없으면 매핑 단계 생략. NFC는 무해(대부분 이미 NFC) | — |
| 콘솔 배지 | 미등록 코드는 원문 표시(기존 동작) | — |

---

## 3. 2단계 — 기업고객·연락처, 계정 대화 연속성, B2B / B2C

### 3.1 결정 기본값 (Go2Joy 회신 전 기본값으로 진행, 설정으로 바꿀 수 있게)
| # | 결정 | 기본값 | 바꾸는 곳 |
|---|---|---|---|
| D12 / Q2 | 위젯에 같은 호텔 다른 직원의 대화 | **본인 대화만 전문 표시 + "이 호텔의 이전 문의 n건" 요약 줄**. 상담원·AI는 호텔 전체 | 테넌트 설정 `thread_scope` (`self` / `company`) |
| D13 / Q3 | 종료 대화 재개 창 | **24시간** 안이면 직전 담당 상담원을 우선 배정(sticky) | 테넌트 설정 `thread_sticky_hours` |
| D14 | AI에 이전 대화 | **직전 대화의 마지막 6개 메시지 발췌(PII 치환)** — 요약 LLM 호출 없음(비용·지연) | 상수, 이후 요약으로 교체 가능 |
| D15 | 주소·군 | 3단계(이번 범위 밖) | — |
| D16 | 기업고객 화면 | 고객 메뉴 안 탭(새 메뉴 아님 → 메뉴 권한 매핑 변경 없음) | — |
| — | 기능 활성화 | **테넌트 스위치 `thread_continuity`(기본 꺼짐)** — go2joy만 켬. 다른 테넌트 동작 불변 | `tenants.thread_continuity` |

> D13 구현 방식: 종료된 대화 행을 다시 열지 않는다(대화는 `session_id`에 묶여 있고 콘솔 목록이 세션 기준이라 옛 행을 새 세션으로 옮기면 목록·통계가 꼬임). 대신 **새 대화를 만들고 `prev_conversation_id`로 직전 대화와 잇고, 재개 창 안이면 직전 상담원을 우선 배정**한다. 직원 입장에서는 같은 대화가 이어지는 것으로 보인다(위젯은 계정 스레드를 이어서 그림).

### 3.2 스키마 (`sql/261022-b2b-company-thread.sql`)
```sql
-- 기업고객(호텔). external_key = 'hotel:{hotel_id}'
CREATE TABLE companies (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  external_key VARCHAR(120) NOT NULL,
  name VARCHAR(200) NULL,
  province VARCHAR(120) NULL,
  region VARCHAR(32) NULL,
  last_seen_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_companies_tenant_key (tenant_id, external_key),
  KEY idx_companies_tenant_region (tenant_id, region)
) DEFAULT CHARSET=utf8mb4;

-- 기업고객 ↔ 연락처(직원). 체인 운영자는 여러 행
CREATE TABLE company_contacts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  company_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  `role` VARCHAR(120) NULL,
  last_seen_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_company_contacts (company_id, customer_id),
  KEY idx_company_contacts_customer (customer_id)
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE customers     ADD COLUMN customer_type VARCHAR(16) NOT NULL DEFAULT 'b2c';
ALTER TABLE sessions      ADD COLUMN company_id BIGINT NULL, ADD KEY idx_sessions_company (company_id);
ALTER TABLE conversations ADD COLUMN customer_id BIGINT NULL, ADD COLUMN company_id BIGINT NULL,
                          ADD COLUMN prev_conversation_id BIGINT NULL,
                          ADD KEY idx_conv_tenant_company (tenant_id, company_id, id),
                          ADD KEY idx_conv_tenant_customer (tenant_id, customer_id, id);
ALTER TABLE tenants       ADD COLUMN thread_continuity TINYINT(1) NOT NULL DEFAULT 0;

-- 백필: 기존 대화에 세션의 고객을 기록(이력 조회용, 위험 낮음)
UPDATE conversations c JOIN sessions s ON s.id = c.session_id
   SET c.customer_id = s.customer_id
 WHERE c.customer_id IS NULL AND s.customer_id IS NOT NULL;
```
- `thread_scope`·`thread_sticky_hours`는 컬럼을 늘리지 않고 `handoff_config` JSON에 둔다(기본값은 3.1).
- 엔티티: nullable 컬럼마다 `type` 명시(dev-kit A-1, 부팅 확인), BIGINT는 `bigintTransformer`, `` `role` `` 백틱.
- `npm run migrations:manifest` → `sql/artefacts.tsv`, `docker/init-sql/01-schema.sql` 동기화(261019 마이그레이션 3건 밀린 것까지 함께 재생성).

### 3.3 작업
| # | 작업 | 주요 파일 |
|---|---|---|
| **2-A 등록** | | |
| A1 | 엔티티 `Company`·`CompanyContact`, `Customer.customerType`, `Session.companyId`, `Conversation.customerId/companyId/prevConversationId`, `Tenant.threadContinuity` | `domain/company/entity/*`(신규 도메인 `company`), 기존 엔티티 |
| A2 | `CompanyService.upsertFromIdentity(tenantId, attrs)`: 서명된 `hotel_id`가 있을 때만 `hotel:{id}`로 upsert(이름·성·권역 갱신, 동시 요청은 고유 키 + 재조회 — `upsertCustomer` 패턴), `linkContact(company, customer, role)` | `domain/company/company.service.ts` |
| A3 | identify: 서명된 `hotel_id`가 있으면 customer `customer_type='b2b_contact'`, 회사 upsert·연결, `session.companyId` 설정. 없으면(호텔 미선택) 회사 없이 연락처만 — 이미 `b2b_contact`인 고객은 유형을 되돌리지 않음 | `embed.service.ts:104-109,139` |
| A4 | identify 시점에 **이미 열린 대화**(게스트로 먼저 채팅한 경우)에 `customer_id`·`company_id`를 채움 | `embed.service.ts` → `ChatService.attachAccount(sessionId, …)` |
| **2-B 스레드** | | |
| B1 | 대화 생성 시 세션의 `customer_id`·`company_id` 기록, 계정 스레드에 직전 대화가 있으면 `prev_conversation_id` | `chat.service.ts:270-294` |
| B2 | `ThreadService`: 스레드 키 = B2B면 `company_id`, 아니면 `customer_id`. `listPrevious(session, beforeConversationId, limit)` — `thread_scope=self`면 본인 대화만 전문, 회사 다른 직원 대화는 개수만 | `domain/chat/thread.service.ts`(신규) |
| B3 | 위젯 API `GET /chat/thread?before=<convId>&limit=3` — **verified 세션 + `thread_continuity` 켜진 테넌트만**, 아니면 403 `E5099` | `chat.controller.ts` |
| B4 | sticky 배정: 새 대화의 이관 시 `prev_conversation_id`의 담당 상담원이 재개 창 안이고 활성·온라인이면 그 상담원을 첫 후보로 | `chat.service.ts:1255-1265`, `handoff-router.service.ts` |
| B5 | AI 맥락: 직전 대화(스레드 기준, 30일 이내) 마지막 6개 메시지를 `PREVIOUS_CONVERSATION_START/END` 블록으로(PII 치환 `replacePiiTokens`, 길이 상한), 현재 대화 히스토리와 구분. 규칙 문구 "이전 대화는 참고용, 근거 아님"은 **반대해석 함정**(PR #597/#598: 규칙 문구가 맞는 답을 철회하게 만든 사례) 때문에 실측 후 확정 | `chat.service.ts:845-888`, `rag.service.ts:636-656` |
| **2-C 위젯** | | |
| C1 | identify 성공(+`threadAvailable: true` 응답 필드) 후 메시지 목록 맨 위에 "이전 대화 보기" → `GET /chat/thread`로 위로 붙이기(구분선 "이전 대화 · 10월 21일"), 회사 요약 줄 | `ChatTab.tsx:411`, `useChat.ts`, `chatService.ts`, `session.mapper.ts` |
| C2 | 로그아웃(`useEmbedCommands.ts:126`) 시 스레드 캐시 비우기 | `useEmbedCommands.ts`, `widgetStore.ts` |
| C3 | i18n(위젯 6개 언어): `chat.thread.loadPrevious`, `chat.thread.divider`, `chat.thread.companySummary` | `apps/widget/src/i18n/locales/*` |
| **2-D 콘솔** | | |
| D1 | 고객 화면 탭 `전체 / 기업고객 / 부킹고객`: 고객 목록에 `customer_type` 필터·열, **기업고객 탭 = 회사 목록**(이름·권역·성·연락처 수·대화 수·최근 활동) | `CustomersPage.tsx`, `customer.controller.ts`, `company.controller.ts`(신규 `GET /companies`, `GET /companies/:id`) |
| D2 | 회사 상세 드로어: 정보, 연락처(이름 마스킹 규칙 동일, reveal은 기존 권한·감사), 대화 목록(→ 기존 대화 상세 링크) | `apps/web/src/domain/customers/CompanyDrawer.tsx`(신규) |
| D3 | 라이브챗: 배지에 `기업` 표식, 헤더에 "이 호텔 이전 대화 n건" → 패널(같은 회사 대화 목록, 열면 읽기 전용 기록) | `IdentityBadges.tsx`, `LiveChatPage.tsx:811-841`, `agent.mapper.ts:235` |
| D4 | 배정 조건 카탈로그에 `customer_type`(enum `b2c`·`b2b_contact`, source customer) | `packages/types/src/common/routing-condition.ts`, `handoff-router.service.ts` |
| D5 | 대화 이력 검색에 B2B / B2C 필터 | `analytics.service.ts:298`, history 화면 |
| D6 | i18n(콘솔 6개 언어) + `npm run i18n:check`, 저장·실패 토스트 | `apps/web/src/i18n/locales/*` |
| **2-E 공통** | | |
| E1 | 에러 코드 `E5098 COMPANY_NOT_FOUND`(404), `E5099 THREAD_NOT_AVAILABLE`(403) — 블록 주석 `PLN-261022` | `error-code.constant.ts` |
| E2 | 권한: 회사 컨트롤러도 `@RequireMenu('customers')` + `@RequireCapability(CAPABILITY.CUSTOMER_MANAGE)`(고객 컨트롤러와 동일), 테넌트 스코프 필수 | `company.controller.ts` |

### 3.4 화면 (ASCII)

**위젯 — 이전 대화 이어 보기 (C1)**
```
┌ [G2J] G2J SUPPORT                (🌐VI)(⚙)(✕) ┐
│        ( 이전 대화 보기 ▲ )                    │   ← 누르면 이전 대화 3건씩 위로
│ ───── 이전 대화 · 10월 21일 ─────               │
│ 🧑 정산 보고서 기간을 바꾸고 싶어요            │
│ 🤖 정산 > 보고서 메뉴에서 ...                   │
│ 👩 (상담원 Linh) 확인해 보니 ...               │
│ ── 이 호텔의 이전 문의 2건(다른 직원) ──        │   ← thread_scope=self일 때 요약만
│ ───── 오늘 ─────                                │
│ 🤖 안녕하세요, 무엇을 도와드릴까요?             │
│ 🧑 지난번 정산 건 이어서 문의해요               │
│ [ 메시지 입력 ...                       ] (➤)  │
└────────────────────────────────────────────────┘
```

**콘솔 — 고객 › 기업고객 탭 (D1) + 회사 드로어 (D2)**
```
고객  [전체] [■ 기업고객] [부킹고객]          🔍 호텔명 검색        권역 [전체 ▾]
┌──────────────────────┬──────────┬──────────────┬────────┬────────┬────────────┐
│ 호텔                 │ 권역     │ 성/시        │ 연락처 │ 대화   │ 최근 활동  │
├──────────────────────┼──────────┼──────────────┼────────┼────────┼────────────┤
│ A In Hotel Del Luna  │ South    │ Hồ Chí Minh  │ 2      │ 7      │ 10-22 09:14│ ▶
│ Huế Garden Hotel     │ N.Center │ Thừa Thiên Huế│ 1     │ 1      │ 10-21 16:02│
└──────────────────────┴──────────┴──────────────┴────────┴────────┴────────────┘
                                   ┌ A In Hotel Del Luna ─────────────── ✕ ┐
                                   │ hotel:1721 · South · Hồ Chí Minh       │
                                   │ 연락처                                 │
                                   │  G2J SUP*** · Lễ tân · 10-22 09:14     │
                                   │  Ng*** · Quản lý · 10-20 11:30         │
                                   │ 대화 (7)                               │
                                   │  10-22 정산 보고서 문의   ● 상담 중    │
                                   │  10-21 객실 등록 오류     ✓ 종료  ▶    │
                                   └────────────────────────────────────────┘
```

**콘솔 — 라이브챗 대화 헤더 (D3)**
```
┌ G2J SUPPORT  [기업] 🏨 A In Hotel Del Luna · 남부(South) · Lễ tân        [상담원 ▾][종료] ┐
│ 이 호텔 이전 대화 6건 ▸        (재개: 10-21 담당 Linh 우선 배정)                           │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.5 부작용 분석
| 대상 | 영향 | 대응 |
|---|---|---|
| 다른 테넌트(ivyusa 등) | `customer_type` 기본 `b2c`, `thread_continuity` 기본 0 → 위젯·AI 동작 불변. 대화에 `customer_id`가 기록되는 것만 달라짐(백필 포함) | 스위치 꺼짐 테스트 |
| Shopify / Cafe24 인증 경로 | 세션 고객이 대화에 기록됨(이득). 스레드 UI는 스위치로만 | — |
| 개인정보 | 위젯 이전 대화는 **서명 검증 세션만**, 로그아웃 시 비움. 회사 다른 직원 대화는 기본 요약만(D12). 콘솔은 기존 마스킹·reveal 감사 유지 | 게스트 403 테스트 |
| 서명 패키지 유출 영향 | 이전 대화 열람이 가능해져 영향 증가 | GUIDE v1.2 7절 — 서명 유효기간(`ts`)은 3단계 |
| 콘솔 목록·통계 | 대화 행은 여전히 세션 기준 — 옛 행 이동 없음(3.1 D13 방식) | — |
| 유휴 종료 | 변경 없음(새 대화가 잇는 구조) | idle spec 회귀 |
| AI 품질 | 이전 대화 발췌가 현재 질문을 끌고 갈 수 있음(PR #597 보강 검색 사례) | 검색어에는 넣지 않고 답변 맥락에만, 주제 전환 실측 케이스 포함 |
| 성능 | 스레드 조회는 `(tenant, company/customer, id)` 인덱스, 위젯은 3건 단위 | — |
| 메뉴 권한 | 새 메뉴 없음(탭) → menu-access 매핑 변경 없음 | — |
| 마이그레이션 | 스테이징 `DB_SYNCHRONIZE=false` → **SQL 선적용 후 코드 배포**, 프로덕션도 동일(go2joy 테넌트는 없지만 스키마는 필요) | PR `## Migration` |

### 3.6 배포 순서
1. **1단계 PR**(스키마 없음) → 스테이징 배포 → go2joy `provinceRegions` 설정 → 규칙 편집기로 권역 규칙 작성 확인
2. **2단계 PR**: 스테이징 백업 → `sql/261022-b2b-company-thread.sql` 선적용(`--default-character-set=utf8mb4`) → `check-migrations.sh` → 코드 배포 → 부팅 로그 `successfully started`·새 라우트 401 확인 → go2joy `thread_continuity=1`
3. 프로덕션: SQL 선적용 → `production` ff → `deploy-self-hosted.sh`(스위치는 꺼진 채)

## 4. 테스트 계획 (TCR-261022에서 상세화)
| 구분 | 케이스 |
|---|---|
| 단위(1단계) | NFC·별칭·`North Center`→`north_center`, 매핑 채움·불일치 warn, 라우터 정규화 비교, **T1~T5 서명 해시 고정** |
| 단위(2단계) | 회사 upsert 동시성(고유 키 재조회), 서명된 hotel_id 없으면 B2B 아님, 호텔 미선택=연락처만, 게스트 채팅 후 identify 시 열린 대화에 계정 기록, 스레드 키(B2B=회사/B2C=고객), `thread_scope` self/company, 재개 창 안·밖 sticky, 스위치 꺼짐=403·UI 없음, AI 블록 PII 치환·길이 상한 |
| 통합(스테이징) | 서명 identify(T2 데이터) → 콘솔 기업고객 1건·연락처 1건 → 종료 → 재질문 sticky → 다른 브라우저 로그인 시 이전 대화 → 같은 호텔 다른 직원(`ha:1002`) → 상담원 화면 회사 이력 → 로그아웃 후 이전 대화 안 보임 → 권역별 배정(4권역) |
| 회귀 | 기존 `embed.service.spec`·`chat.service.*.spec`·idle·라우터, 다른 테넌트 위젯 |

## 5. 일정(제안)
| 단계 | 기간 | 산출물 |
|---|---|---|
| 1단계 | 1일 | PR + 스테이징 + go2joy 매핑 설정 |
| 2-A·2-B(API·스키마) | 2일 | 엔티티·서비스·스펙 |
| 2-C(위젯)·2-D(콘솔) | 2~3일 | 화면·i18n |
| 통합 검증·문서 | 1일 | TCR·RPT, GUIDE 상태 갱신 |

## 6. 범위 밖
- B2C 부킹 고객 연동(예약 전·후 에이전트, 예약 완료 이벤트, 예약별 스레드)
- 호텔 주소·군 수신, 서명 유효기간(`ts`) — 3단계(Go2Joy 결정 후)
- 회사 병합·분할 도구, 회사 단위 통계 대시보드
- HA 안 SharpTalk 메뉴(iframe Sub-portal, 리셉션 에이전트 신청·설정)

## 7. 승인 요청
- 1단계와 2단계를 **각각 별도 PR**로 진행한다.
- 3.1 기본값(D12 본인 + 요약, D13 24시간 sticky, D14 발췌 6개, 스위치 기본 꺼짐)으로 진행하고, Go2Joy 회신이 다르면 설정만 바꾼다.
