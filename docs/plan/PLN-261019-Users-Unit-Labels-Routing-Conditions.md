# PLN-261019 — 사용자 팀(Unit) · 직무 라벨/팀 관리 · 배정 규칙 고객정보 조건

- 근거: [REQ-261019-Users-Unit-Labels-Routing-Conditions](../analysis/REQ-261019-Users-Unit-Labels-Routing-Conditions.md)
- 기준: main `5d89b26` · 승인 후 `feature/261019-users-unit-labels-routing-conditions` 브랜치, PR 2개로 분할(P1~P3 / P4)
- 상태: **승인 대기** — 구현은 승인 뒤 시작

## 1. 단계

### P1 — 팀(Unit) 스키마 · API (backend)
| 항목 | 내용 |
|---|---|
| 엔티티 | `apps/api/src/domain/user/entity/unit.entity.ts` — `units(id BIGINT PK, tenant_id BIGINT NOT NULL, code VARCHAR(24), name VARCHAR(64), sort_order INT DEFAULT 0, created_at)` · `@Unique('uk_unit_tenant_code',[tenantId,code])`. `user.entity.ts`에 `unitId: number \| null`(`type:'bigint'`, `bigintTransformer`, 명시 type — 부팅 크래시 방지) |
| SQL | `sql/261019-units.sql`: CREATE TABLE `units` · ALTER `users` ADD `unit_id` + 인덱스 · 기본 팀 3종 백필(모든 테넌트, 0건인 테넌트만, 이름은 `tenants.default_language='KO'`면 한국어 아니면 영어) · go2joy 슬러그 테넌트에 `north`·`north_center`·`south`·`south_center` INSERT(멱등 `NOT EXISTS`) · (D2 승인 시) 라벨 이름 영어화 UPDATE(시드 기본값 그대로 + 언어≠KO 행만). `npm run migrations:manifest` 갱신 |
| 기본값 코드 | `tenant.service.ts` `DEFAULT_UNITS` + `DEFAULT_JOB_LABELS`를 언어별 이름 테이블로(`defaultNames(lang)`), 테넌트 생성 시 둘 다 보장. `seed.runner.ts`도 동일(ivyusa) |
| API | `UnitController`(`/units`, `@RequireMenu('users')`): `GET`(`@Auth`) · `POST {code,name}`(`LABEL_EDIT`) · `PATCH /:id {name}`(`LABEL_EDIT`). `UserController`: `PATCH /users/:id/unit {unit_id: number\|null}`(`LABEL_ASSIGN`) — 다른 테넌트 팀 id는 E2005. 사용자 목록/응답 `unitId`·`unitName` 추가(`UserMapper`, 팀 1회 조회로 N+1 없음). 초대 요청 `unit_id?` 선택 |
| 에러 코드 | `UNIT_NOT_FOUND: E2005`(E2xxx 사용자 블록 다음 번호). 중복 코드는 기존 `DUPLICATE_RESOURCE` 409 재사용 |
| 감사 | 팀 생성·이름 변경·사용자 팀 변경은 `AuditService.write`(라벨과 동일 수준) |
| 테스트 | `user.service.units.spec.ts`: 교차 테넌트 팀 거부·중복 코드·NULL 해제·목록 `unitName` 매핑(bigint PK는 문자열 픽스처) |

### P2 — 콘솔 `/users` (web)
| 항목 | 내용 |
|---|---|
| 목록 | 팀 열 추가(배지, 없으면 `—`) |
| 편집·초대 모달 | 직급 아래… 직무 라벨 다음에 **팀 `Select`**(`(없음)` + 테넌트 팀). 변경 시에만 `PATCH /users/:id/unit`(기존 필드별 호출 패턴 유지) |
| 관리 모달 | 헤더 `[라벨·팀 관리]` 버튼(`LABEL_EDIT` 보유자=master만 노출) → `LabelsUnitsModal`: 탭 2개. 행=코드(읽기)·이름 `Input`·[저장]. 하단 추가 폼(코드 `^[a-z0-9_]{1,24}$`, 이름 1~64). 기본 3종 라벨 행에 "권한 연결" 배지 + 안내문. 성공/실패 토스트 필수 |
| 훅/서비스 | `useUnits`·`useCreateUnit`·`useUpdateUnit`·`useCreateJobLabel`·`useUpdateJobLabel`(query key에 `tenantId`), 저장 후 `users`/`job-labels`/`units` invalidate |
| i18n | `users.json` 6언어: `unit`, `unitNone`, `manageLabelsUnits`, `tabLabels`, `tabUnits`, `code`, `name`, `add`, `codeHint`, `permissionLinked`, `permissionHint`, `saved`, `saveError`, `created`, `createError` 등. `npm run i18n:check` |

### P3 — 라벨 이름 표시처 통일 (web, 소규모)
- `HandoffSection` deny 라벨 `Select`·`RoutingRulesEditor` 업무 칩: `useJobLabels()` 결과를 사용(이름=테넌트 값, 목록=테넌트 라벨 전부). 로딩 전·미존재 코드는 `denyLabel.*` i18n 폴백. 저장 형식(코드) 불변.

### P4 — 배정 규칙 고객정보 조건 (backend + web)
| 항목 | 내용 |
|---|---|
| 카탈로그 | `packages/types/src/domain/routing-condition.ts`: `ROUTING_CONDITION_FIELDS` 8종 `{ field, kind:'enum'\|'text', op:'in'\|'contains', source }` + `RoutingCondition` 타입. 웹은 딥 import(값 import 제약) |
| 엔티티 | `RoutingRule.conditions?: RoutingCondition[]`(JSON, 스키마 변경 없음) |
| 판정 | `handoff-router.service.ts` `RoutingContext`에 `language`·`identityLevel`·`customerTier`·`identityAttributes`·`landingPath` 추가. `matchRoutingRule`: 조건 전부 AND, 값 정규화(trim+lower), `in`=정확 일치, `contains`=부분 일치, 값 비면 통과, **카탈로그 밖 필드=불일치 + warn**(D6). 순수 함수 단위 테스트 10케이스(기존 규칙 무조건 통과 포함) |
| ctx 생성 | `chat.service.ts` 인계 2곳을 `buildRoutingContext(session, preview, stamp)` 하나로 모아 세션 필드 전달. `customer_tier` 조건을 가진 규칙이 있고 `session.customerId`가 있을 때만 `customers` 1회 조회 |
| 편집기 | `RoutingRulesEditor` 규칙 카드에 **고객 정보** 행: 조건 목록(필드 라벨 + 칩 또는 쉼표 입력 + ×) · `[+ 조건 추가 ▾]`(필드 드롭다운, 이미 쓴 필드는 제외). 언어 칩=테넌트 제공 언어(`widget_languages`, 기본 EN), 인증 수준·고객 등급 칩=enum 상수. `HandoffSection` 직렬화/역직렬화에 `conditions` 추가(빈 조건은 저장 생략) |
| i18n | `aiSetting.json` `handoff.routing.customer.*`(제목·조건 추가·필드 8종 라벨·값 라벨·힌트) 6언어 |
| 로그 | `handoff routed by rule …` 로그에 일치한 조건 요약(`language=vi, hotel_name~hanoi`) 추가 — PII 필드는 카탈로그에 없으므로 마스킹 불요 |

### P5 — 스테이징 적용 · 실측 · 문서
1. 스테이징 MySQL에 `sql/261019-units.sql` **선적용**(`pre-deploy-check` 스킬) → PR 머지 → 배포 → 부팅 로그 `successfully started` · `GET /api/v1/units` **401**(배포 확인) · 컨테이너 age.
2. 실측: go2joy 팀 목록 7종 · 사용자 팀 저장 · 라벨 이름 변경이 인계 섹션에 반영 · 규칙(지역 북부 + 언어 VI + 호텔명 포함) 인계 라우팅 로그 · 조건 없는 기존 규칙 회귀 없음.
3. `TCR-261019-Users-Unit-Labels-Routing-Conditions.md` · `RPT-261019-…`(PR#, SHA, 환경별 SQL/배포 상태). 프로덕션은 별도 지시 시.

## 2. 사이드 임팩트

| 대상 | 영향 | 대응 |
|---|---|---|
| `users` 응답 모양(`unitId`·`unitName` 추가) | 어드민 테넌트 사용자 화면(`admin-tenant-user.controller`)도 같은 매퍼 | 필드 추가만, 기존 소비처 무영향 |
| `job_labels` 이름 영어화 백필(D2) | ivyusa 등 KO 아닌 테넌트의 `/users` 배지 글자가 바뀜 | 시드 기본값과 정확히 같은 행만, 변경 전 백업 |
| 인계 섹션 라벨 소스 교체(P3) | 테넌트 라벨이 0건이면 deny 라벨 `Select`가 빔 | i18n 폴백 3종 유지(현행과 동일) |
| `routingRules` JSON에 `conditions` 추가 | 구버전 API는 조건을 무시하고 매칭 | API 먼저 배포, 웹은 뒤(같은 배포 스크립트면 문제 없음) |
| `chat.service` 인계 경로 2곳 리팩터 | 자동·수동 인계 모두 거침 | ctx 빌더 단위 테스트 + 스테이징 실측 IT |
| go2joy Android SDK/Hotel Admin 서명 속성 | `hotel_id`·`province`·`role` 조건은 서명 속성이 와야 의미 있음 | 미서명 세션은 해당 조건 불일치(폴백 담당자) — 힌트 문구로 안내 |
| menu-access 대응표 | 새 메뉴 없음 | 변경 없음 |

## 3. 리스크

- **권한 오해**: 새 라벨 코드가 권한을 주는 것으로 기대할 수 있음 → 관리 모달 안내문 + "권한 연결" 배지로 기본 3종만 표시.
- **팀 삭제 부재**: 잘못 만든 팀을 지울 수 없음 → 이름 변경으로 재활용, 삭제는 후속(D4).
- **조건 과다 매칭/미매칭 디버깅**: 로그에 일치 조건 요약을 남겨 "왜 이 담당자인가"를 추적 가능하게.
- **SQL 순서**: 스테이징 `DB_SYNCHRONIZE=false` — 선적용 누락 시 `Unknown column unit_id` 500. PR `## Migration` 체크리스트.

## 4. 와이어프레임

### 4-1. `/users` 목록 (팀 열 · 관리 버튼)
```
┌ 사용자 ───────────────────────────────────────────────────────────────────┐
│ 팀원과 접근 권한을 관리하세요.                   [라벨·팀 관리] [사용자 초대] │
├──────────────┬────────┬────────────────┬────────────┬─────────┬──────────┤
│ 이메일        │ 직급   │ 라벨            │ 팀          │ 상태    │ 생성일   │
├──────────────┼────────┼────────────────┼────────────┼─────────┼──────────┤
│ dev@…        │ master │ 상담 회계 운영   │ Management │ active  │ 08-01    │
│ cs1@…        │ staff  │ 상담            │ North      │ active  │ 10-19    │
│ mk@…         │ staff  │ 운영            │ —          │ invited │ 10-19    │
└──────────────┴────────┴────────────────┴────────────┴─────────┴──────────┘
```

### 4-2. 사용자 편집 모달 (팀 추가)
```
┌ 사용자 편집 ───────────────────────────┐
│ 직급        [staff                 ▾] │
│ 직무 라벨    ☑ 상담  ☐ 회계  ☐ 운영     │
│ 팀          [North                 ▾] │   ← 신규: (없음) / CS / MKT / Management / North …
│ 상태        [active                ▾] │
│                          [취소] [저장] │
└────────────────────────────────────────┘
```
초대 모달도 같은 위치에 팀 `Select`(기본 `(없음)`).

### 4-3. 라벨·팀 관리 모달
```
┌ 라벨·팀 관리 ──────────────────────────────────────────────────┐
│ [ 직무 라벨 ] [ 팀 ]                                            │
│                                                                │
│ 코드          이름                                              │
│ consult       [Counsels            ] [저장]   ⬤ 권한 연결       │
│ accounting    [Accountant          ] [저장]   ⬤ 권한 연결       │
│ operations    [Operation           ] [저장]   ⬤ 권한 연결       │
│ qa            [QA                  ] [저장]                     │
│ ──────────────────────────────────────────────────────────────  │
│ 추가   코드 [________]  이름 [__________________]  [추가]        │
│ ⓘ 코드는 영문 소문자·숫자·_ 1~24자, 만든 뒤 바꿀 수 없습니다.     │
│   권한(메뉴·상담 처리)은 기본 3종 코드에만 연결됩니다.            │
│                                                       [닫기]   │
└────────────────────────────────────────────────────────────────┘
팀 탭: 같은 표(권한 배지 없음). go2joy 예: cs / mkt / management / north / north_center / south / south_center
```

### 4-4. 배정 규칙 카드 (고객 정보 행 추가) — `/settings/basic` 상담원 인계
```
┌ #1 [북부 · 하노이 예약          ] [접속 중인 상담원 중 가장 한가한 1명 ▾]  ↑ ↓ 삭제 ┐
│ 지역      (북부)● (중부) (남부)                                                      │
│ 업무      [키워드, 쉼표 구분                     ] (Counsels)● (Accountant) (Operation) │
│ 고객 정보  언어        (EN) (VI)● (KO)                                        [×]    │   ← 신규
│           호텔명 포함  [Hanoi, Ha Noi                       ]                 [×]    │
│           [+ 조건 추가 ▾]  언어 · 인증 수준 · 고객 등급 · 호텔 ID · 호텔명 · 지역(성) · 역할 · 방문 경로 │
│           ⓘ 호텔·지역(성)·역할은 호스트가 서명해 보낸 값일 때만 맞습니다. 비우면 전체.   │
│ 담당자    (cs1@…)● (cs2@…)● (mk@…)                                                   │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                                                    [규칙 추가]
```
열거형(언어·인증 수준·고객 등급)은 칩 토글, 텍스트형은 쉼표 입력. 같은 필드는 한 번만 추가 가능.

## 5. 마이그레이션 (PR 본문 `## Migration`)
- SQL: `sql/261019-units.sql` — 스테이징 ☐ / 프로덕션 ☐ (코드 배포 **전** 적용)
- 롤백: `ALTER TABLE users DROP COLUMN unit_id; DROP TABLE units;` (라벨 이름 UPDATE는 백업 테이블 `job_labels_bak_261019`에서 복원)
- P4는 JSON 컬럼만 사용 — SQL 없음

## 6. 승인 요청
1. D1 1인 1팀(`users.unit_id`)로 진행
2. D2 기본 이름 언어 정책 + 기존 테넌트 라벨 이름 영어화 백필(시드 기본값 그대로인 KO 아닌 테넌트만)
3. D3 EN 표기 `Counsels` 그대로 (또는 `Counsel`)
4. D4 코드 불변·삭제 없음
5. D5 조건 필드 8종(PII 제외) · D6 알 수 없는 필드=불일치
6. D7 규칙 담당자에 팀 단위 선택 — 이번 범위 **제외**(후속 제안) / 포함 중 택일
7. PR 분할: PR-A(P1~P3, SQL 동반) · PR-B(P4)
