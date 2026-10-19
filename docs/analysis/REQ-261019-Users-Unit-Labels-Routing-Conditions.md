# REQ-261019 — 사용자 팀(Unit) 속성 · 직무 라벨/팀 테넌트별 관리 · 배정 규칙 고객정보 조건

- 요청(2026-10-19):
  1. `/users` **사용자 편집**에 현재 직급(Rank)·직무 라벨(Job labels)·상태(Status) 외에 **팀(Unit)** 을 추가.
     직무 라벨과 팀은 **테넌트별로 추가 및 명칭 변경**이 가능해야 함.
     기본값 — 직무 라벨: Counsels(상담) · Accountant(회계) · Operation(운영) / 팀: CS(고객지원팀) · MKT(마케팅팀) · Management(운영팀).
     go2joy 테넌트는 팀에 **North · North Center · South · South Center** 추가.
  2. `/settings/basic` **상담원 인계(Agent handoff) → 규칙 추가(Add rule)** 에 현재 지역(Region) 조건 외에
     **채팅/세션 고객 정보를 조건으로 고르는 기능** 추가.
- 조사 기준: main `5d89b26`(2026-10-19) · 스테이징 `shoptalk.amoeba.site` 테넌트 1(ivyusa)·4(go2joy)
- 원칙: 기존 테넌트 동작 무변화(기본값은 현행과 동일하게 동작), 라벨 **코드**는 권한 축이므로 불변, 신규 데이터는 테넌트 스코프.

## 1. AS-IS

### 1-1. 사용자 편집 · 직무 라벨

| 영역 | 현재 |
|---|---|
| `/users` 목록 | 이메일 · 직급(배지) · 라벨(배지, 테넌트 `job_labels.name`) · 상태 · 생성일. 행 액션: 편집 · 임시 비밀번호 · MFA 리셋 |
| 사용자 편집 모달 | 직급 `Select`(master/director/manager/staff) · 직무 라벨 체크박스 · 상태 `Select`(active/suspended). 각 필드는 별도 API(`PATCH /users/:id/rank|labels|status`, RBAC 각각 `USER_RANK_ADJUST`/`LABEL_ASSIGN`/master·director) |
| 초대 모달 | 이메일 · 직급 · 직무 라벨 |
| 팀/부서 개념 | **없음**. `users` 테이블에 소속 컬럼 없음 |
| 직무 라벨 저장 | `job_labels(tenant_id, code VARCHAR24, name VARCHAR64)` + `user_job_labels(user_id, job_label_id)` N:M. 유니크 `(tenant_id, code)` |
| 직무 라벨 API | `GET /job-labels` · `POST /job-labels {code,name}` · `PATCH /job-labels/:id {name}` — **이미 존재**(`LABEL_EDIT` 권한=master, `@RequireMenu('users')`). 중복 코드는 E0xxx `DUPLICATE_RESOURCE` 409 |
| 직무 라벨 콘솔 UI | **없음** — API만 있고 추가·이름 변경 화면이 없음. 즉 "테넌트별 추가·명칭 변경"은 백엔드는 되고 콘솔이 빠진 상태 |
| 기본 라벨 | 신규 테넌트 생성 시 `tenant.service.ts DEFAULT_JOB_LABELS` = consult **상담** · accounting **회계** · operations **운영**(한국어 고정). 시드(`seed.runner.ts`)와 백필 SQL(`sql/260812-backfill-default-job-labels.sql`)도 동일. 테넌트 언어와 무관하게 한국어 이름 |
| 라벨 코드의 의미 | 코드 3종은 **권한 축**: `consult` → 라이브챗·이슈보드·히스토리·고객여정 메뉴 + `CONVERSATION_HANDLE/ASSIGN`, `operations` → 지식·상품·고객 메뉴 + `CAMPAIGN_SEND`, `accounting` → `MODULE_ACCOUNTING`(`permission-matrix.ts`, `menu.types.ts`). 코드가 아닌 **다른 코드로 만든 라벨은 권한을 부여하지 않음**(표시·분류용) |
| 라벨 이름 표시처 | `/users`는 테넌트 이름 사용. 그러나 `/settings/basic` 인계 섹션의 deny 규칙 라벨 `Select`와 배정 규칙의 업무 칩은 **고정 i18n**(`handoff.denyLabel.consult|accounting|operations`) → 테넌트가 이름을 바꿔도 반영되지 않음, 새 라벨은 안 보임 |

### 1-2. 상담원 인계 배정 규칙(PLN-261015 D3, PR #638)

| 영역 | 현재 |
|---|---|
| 위치 | `/settings/basic` → 상담원 인계 카드 → "배정 규칙 — 지역 × 업무"(`RoutingRulesEditor.tsx`) |
| 규칙 구조 | `tenant_ai_configs.handoff_config.routingRules[] = { name?, regions?[], keywords?[], labels?[], assigneeUserIds[], mode }` |
| 조건 | **지역**: 고정 칩 3종 `north/central/south`(Hotel Admin이 서명하는 `identity_attributes.region` 값). **업무**: 키워드(고객 메시지 부분 일치) + deny 규칙 라벨 스탬프 칩. 비운 조건=전체 |
| 판정 | `matchRoutingRule(rules, ctx)` — 위에서부터 조건이 모두 맞는 첫 규칙, 담당자 없는 규칙은 건너뜀. `ctx = { region, text, label }` |
| ctx 생성 | `chat.service.ts` 2곳(자동 인계 L1226 · 고객 수동 인계 L1327) — `session.identityAttributes.region`·미리보기 텍스트·deny 라벨만 넘김 |
| 인계 시점에 알 수 있는 고객 정보 | `sessions`: `language`(EN/ES/KO/VI/JA/ZH) · `identity_level`(guest/verified) · `identity_attributes`(서명: `hotel_id`·`hotel_name`·`region`·`province`·`role`) · `landing_path` · `channel`(widget/preview) / `customers`(세션에 연결 시): `tier`(guest/subscriber/regular) · name/email/phone(**PII, 마스킹 대상**) |

## 2. TO-BE

### 2-1. 팀(Unit) · 라벨/팀 테넌트별 관리

- `units(tenant_id, code, name, sort_order)` 테이블 + `users.unit_id`(NULL 허용, 1인 1팀). 사용자 편집·초대 모달에 **팀 선택**(없음 포함), 목록에 **팀 열**.
- `/users` 상단에 **[라벨·팀 관리]** 버튼 → 모달(탭: 직무 라벨 / 팀). 각 탭: 행별 이름 인라인 편집+저장, 하단 "추가(코드+이름)". 코드는 생성 후 불변, 삭제는 범위 밖(§4 C3).
- 기본값(신규 테넌트·기존 테넌트 백필): 팀 `cs`·`mkt`·`management`, 라벨 `consult`·`accounting`·`operations`. 이름은 테넌트 `default_language`가 KO면 한국어, 그 외 영어(§4 D2).
- go2joy(슬러그 `go2joy`): 팀 기본 3종 + `north`·`north_center`·`south`·`south_center`(North / North Center / South / South Center).
- 라벨 이름 표시처 통일: 인계 섹션의 deny 라벨 `Select`·배정 규칙 업무 칩이 테넌트 `job_labels` 이름을 쓰고 새 라벨도 노출.

### 2-2. 배정 규칙 고객정보 조건

- `RoutingRule.conditions?: Array<{ field, op, values[] }>` 추가. 모든 조건 AND, 기존 지역·업무 조건과도 AND. 비우면 전체(기존 규칙 무변화).
- 조건 필드 카탈로그(플랫폼 고정 allow-list, PII 제외):

| field | 출처 | 유형 | 값 |
|---|---|---|---|
| `language` | `sessions.language` | 열거(in) | 테넌트 제공 언어(`widget_languages`) |
| `identity_level` | `sessions.identity_level` | 열거(in) | guest / verified |
| `customer_tier` | `customers.tier` | 열거(in) | guest / subscriber / regular |
| `hotel_id` | `identity_attributes.hotel_id`(서명) | 텍스트(in) | 쉼표 구분, 정확 일치 |
| `hotel_name` | `identity_attributes.hotel_name` | 텍스트(contains) | 쉼표 구분, 하나라도 포함 |
| `province` | `identity_attributes.province` | 텍스트(contains) | 〃 |
| `role` | `identity_attributes.role` | 텍스트(in) | 〃 정확 일치 |
| `landing_path` | `sessions.landing_path` | 텍스트(contains) | 예: `/booking` |

- 규칙 카드에 **고객 정보** 행 신설: "+ 조건 추가" → 필드 선택 → 열거형은 칩 토글, 텍스트형은 쉼표 입력. 지역 행은 그대로 유지(요청: "Region 외에 별도").
- `chat.service` 두 인계 경로가 세션·고객 정보를 ctx로 넘김(`customer_tier` 조건이 있는 규칙이 하나라도 있을 때만 고객 1회 조회).

## 3. 갭 분석

| # | 갭 | 판정 | 필요한 것 |
|---|---|---|---|
| G1 | 팀(Unit) 데이터 | **신규 스키마** | `units` 테이블 + `users.unit_id` + 백필 SQL(`sql/`) + 신규 테넌트 기본 생성(`tenant.service`)·시드 |
| G2 | 팀 API | 신규 | `GET/POST/PATCH /units`(`LABEL_EDIT`, 메뉴 `users`) · `PATCH /users/:id/unit {unit_id\|null}`(`LABEL_ASSIGN`) · 사용자 응답에 `unitId`·`unitName` |
| G3 | 라벨 추가·이름 변경 콘솔 UI | **콘솔만 누락** | 관리 모달(라벨 탭은 기존 API 그대로 사용) |
| G4 | 기본 이름 언어 | 정책 | 기본 이름 테이블(KO/EN) + 백필 범위 결정(§4 D2) |
| G5 | go2joy 팀 4종 | 데이터 | 스테이징·프로덕션 SQL(테넌트 슬러그 기준, 멱등) |
| G6 | 라벨 이름 표시 불일치 | 결함 성격 | 인계 섹션 2곳을 테넌트 라벨 목록으로 교체(고정 코드 3종은 i18n 폴백) |
| G7 | 규칙 조건 확장 | 신규 | `conditions` 스키마(JSON, 마이그레이션 없음) + `matchRoutingRule` + ctx 확장 + 편집기 UI + 6언어 i18n + 단위 테스트 |
| G8 | 조건 값 소스 | 콘솔 | 언어 칩은 테넌트 제공 언어 재사용(PLN-261019 Widget-Language), 등급·인증 수준은 enum 상수 |

## 4. 결정 필요 사항(PLN 승인 시 확정)

| # | 항목 | 제안 | 대안 |
|---|---|---|---|
| D1 | 팀 소속 수 | **1인 1팀**(`users.unit_id`) — 지역 팀은 배타적이고 편집 UI가 단순 | N:M(라벨처럼) — 배정 규칙에서 팀을 담당자 그룹으로 쓰면 다중 소속이 모호해짐 |
| D2 | 기본 이름·백필 | 신규 테넌트: KO면 한국어, 그 외 영어. 기존 테넌트: **팀은 전부 백필**(없던 데이터), **라벨 이름은 시드 기본값(상담/회계/운영) 그대로이고 테넌트 언어가 KO가 아닌 행만** 영어로 갱신(ivyusa → Counsels/Accountant/Operation). 손댄 이름은 보존 | 라벨 이름은 건드리지 않고 콘솔에서 직접 변경 |
| D3 | EN 라벨 표기 | 요청 그대로 `Counsels` / `Accountant` / `Operation` | 문법상 `Counsel`(또는 `Counseling`) — 언제든 콘솔에서 변경 가능하므로 기본값만의 문제 |
| D4 | 코드·삭제 | 코드 불변·삭제 없음(라벨 코드=권한 축, 팀 삭제=소속 고아). 관리 모달에 "기본 3종 코드만 권한에 연결" 안내 | 사용자 0명인 팀 삭제 허용 |
| D5 | 조건 필드 | §2-2 표 8종(PII 제외) | `channel` 추가 — 현재 값이 widget/preview뿐이라 의미 없음, 제외 |
| D6 | 알 수 없는 필드 | 저장된 규칙에 카탈로그 밖 필드가 있으면 **그 규칙은 불일치**(건너뜀) + `logger.warn` | 조건 무시(의도보다 넓게 매칭될 위험) |
| D7 | (선택) 규칙 담당자에 **팀 단위 선택** | 이번 범위 밖으로 두되 go2joy 지역 팀과 궁합이 좋아 후속 제안 | 이번에 포함(규칙 `assigneeUnitIds` + 팬아웃 시 팀원 전개) |

## 5. 사용자 흐름

1. 마스터가 `/users` → [라벨·팀 관리] → 팀 탭에서 `north`/"North" 추가 → 토스트 → 편집 모달 팀 목록에 즉시 반영.
2. 사용자 편집 → 팀 "North" 선택 → 저장 → 목록 팀 열 갱신(`PATCH /users/:id/unit`).
3. 라벨 탭에서 `consult` 이름을 "Counsels"로 변경 → `/users`·인계 섹션 deny 라벨·규칙 업무 칩 모두 "Counsels"로 표시.
4. `/settings/basic` 인계 → 규칙 추가 → 지역 북부 + 고객 정보 "언어: VI" + "호텔명 포함: Hanoi" → 담당자 선택 → 저장.
5. 하노이 호텔의 VI 세션이 인계되면 그 규칙이 먼저 일치 → 담당자 호출(로그 `handoff routed by rule …`). 조건을 하나도 안 둔 기존 규칙은 종전과 동일.

## 6. 제약

- 스테이징·프로덕션은 `DB_SYNCHRONIZE=false` — `units`·`users.unit_id` SQL을 **코드 배포 전에 선적용**, `npm run migrations:manifest` 갱신, PR 본문 `## Migration` 필수.
- `routingRules`는 JSON 컬럼 안이라 조건 추가는 스키마 변경 없음. 구버전 코드가 `conditions`를 모르면 무시하고 매칭(넓게) → 배포 순서는 API 먼저.
- 라벨 이름은 단일 문자열(언어별 아님) — 콘솔 사용 언어와 무관하게 테넌트가 정한 이름 하나를 보여줌(현행과 동일).
- 브라우저 번들은 `@sharptalk/types` 값 import 불가 → 조건 카탈로그는 `packages/types/src/domain/…` 파일을 **딥 import**(언어 목록과 같은 방식).
- 새 메뉴 없음(기존 `users` 메뉴 게이트·`LABEL_EDIT`/`LABEL_ASSIGN` 권한 재사용) → menu-access 대응표 변경 없음.
