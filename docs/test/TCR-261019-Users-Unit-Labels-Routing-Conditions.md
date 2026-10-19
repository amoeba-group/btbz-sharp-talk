# TCR-261019 — 사용자 팀(Unit) · 라벨/팀 관리 · 배정 규칙 고객정보 조건

- 근거: [PLN-261019-Users-Unit-Labels-Routing-Conditions](../plan/PLN-261019-Users-Unit-Labels-Routing-Conditions.md)
- 구현: PR #664(P1~P3) · PR-B(P4)
- 환경: 로컬(synchronize, 시드 ivyusa) · 스테이징 `shoptalk.amoeba.site`(테넌트 1 ivyusa · 4 go2joy · 16 zhangbayo)

## 1. 단위 테스트(jest)

| ID | 스펙 | 케이스 | 결과 |
|---|---|---|---|
| U-01 | `user.service.units.spec` | `listUsers`가 `unitName`을 String() 조인으로 매핑, 팀 없는 목록은 units 쿼리 0회 | 통과 |
| U-02 | 〃 | `updateUnit` 타 테넌트 팀 id → E2005, 사용자 row 저장 안 함, where에 tenantId 포함 | 통과 |
| U-03 | 〃 | `updateUnit(null)` → unitId/unitName null + 감사 `user.unit_changed` target `unit:-` | 통과 |
| U-04 | 〃 | `createUnit` 중복 코드 409 `DUPLICATE_RESOURCE`; 신규는 마지막 sort_order+10 | 통과 |
| U-05 | 〃 | `renameUnit` 이름만 변경, 코드 유지 | 통과 |
| U-06 | `tenant.service.*.spec`(기존 15 suites) | 생성자 끝 주입이라 위치 인자 스펙 무깨짐 | 통과 |
| R-01 | `handoff-router.service.spec` | 조건 전부 AND + 지역과 AND(언어 VI·호텔명 Hanoi·지역 north) | 통과 |
| R-02 | 〃 | enum 조건 정확 일치·대소문자 무시, 고객 없음(tier null)=불일치 | 통과 |
| R-03 | 〃 | text contains(방문 경로 부분 일치) vs in(역할 정확 일치) | 통과 |
| R-04 | 〃 | 조건 없는 기존 규칙은 종전과 동일 매칭 | 통과 |
| R-05 | 〃 | 빈 값 목록=전체, 카탈로그 밖 필드(`email`)=불일치 → 다음 규칙 | 통과 |
| R-06 | 〃 | `describeConditions` 로그 요약 `language=vi, hotel_name~Hanoi\|Ha Noi` | 통과 |
| 전체 | API jest | 234 suites · 2,319 tests | 통과 |

## 2. 통합 시나리오(로컬 API curl, 시드 master)

| ID | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| I-01 | 부팅 | `Nest application successfully started`, synchronize DDL == `sql/261019-units.sql` DDL | 통과 |
| I-02 | `GET /units` 무인증 | 401 | 통과 |
| I-03 | `GET /units` | 시드 cs/mkt/management (EN, 테넌트 언어 NULL) | 통과 |
| I-04 | `POST /units {north}` → 중복 재요청 | 201 sortOrder 40 → 409 E5004 | 통과 |
| I-05 | `POST /units {code:"North Team"}` | 400 E5003 코드 패턴 | 통과 |
| I-06 | `PATCH /units/4 {name:"Miền Bắc"}` | 코드 유지·이름 변경 | 통과 |
| I-07 | `PATCH /users/1/unit {4}` → `{999}` → `{null}` | unitName "Miền Bắc" → 404 E2005 → null | 통과 |
| I-08 | `POST /job-labels {qa}` · `PATCH /job-labels/1 {Counsels}` | 201 · 200 | 통과 |
| I-09 | 감사 로그 | `unit.created`, `unit.renamed`, `user.unit_changed`×2 | 통과 |
| I-10 | 시드 재실행 | units 3종 생성·master → management, 라벨 이름 언어별 | 통과 |

## 3. 콘솔 실측(로컬 vite + 로컬 API, 한국어)

| ID | 화면 | 확인 | 결과 |
|---|---|---|---|
| C-01 | `/users` | 팀 열 · master에게만 [라벨·팀 관리] 버튼 | 통과 |
| C-02 | 라벨·팀 관리 › 직무 라벨 | 코드 읽기 전용, 이름 인라인, 기본 3종 "권한 연결" 배지, 안내 2줄 | 통과 |
| C-03 | 라벨·팀 관리 › 팀 › 추가 `south_center`/South Center | 행 추가 + 토스트 "추가했습니다" | 통과 |
| C-04 | 사용자 편집 › 팀 Select "South Center" 저장 | 토스트 + 목록 팀 배지 | 통과 |
| C-05 | `/settings/basic` 배정 규칙 › 업무 칩 | 테넌트 라벨 이름(Counsels·회계·운영·QA) | 통과 |
| C-06 | 규칙 추가 › 고객 정보 › + 조건 추가 언어 → Español 칩, 호텔명 "Hanoi, Ha Noi" | 행 렌더·중복 필드 제외 | 통과 |
| C-07 | 담당자 선택 → 저장 → 새로고침 | 조건 그대로 복원(Español 선택·호텔명 텍스트) | 통과 |
| C-08 | `npm run i18n:check` | 6언어 complete | 통과 |

## 4. 스테이징

| ID | 항목 | 결과 |
|---|---|---|
| S-01 | SQL 선적용(utf8mb4, 백업 `~/backup-pre-units-20261019-163807.sql`) | units 16테넌트×3 + go2joy 4 = 52행, 라벨 영어화 45행(zhangbayo KO 제외), `job_labels_bak_261019` 48행 |
| S-02 | 배포 후 부팅·`/api/v1/units` 401 | 통과 — 커밋 `cdef289`, api 컨테이너 재생성(14s), `successfully started`, 스키마 오류 로그 0, 스웨거에 `/units`·`/units/{id}`·`/users/{id}/unit` |
| S-03 | go2joy 사용자 편집 팀 목록 7종 | DB 7행 확인(CS/MKT/Management/North/North Center/South/South Center) · 웹 번들에 모달 문구 포함 · **콘솔 클릭 실측은 사용자 확인 필요**(스테이징 로그인은 자동화 범위 밖) |
| S-04 | 규칙 조건 저장 라운드트립 | 로컬 실측 통과(C-07) · 스테이징 번들에 `routing.customer.*`·`hotel_name` 포함 · **콘솔 클릭 실측은 사용자 확인 필요** |

## 5. 엣지 케이스

| 케이스 | 처리 |
|---|---|
| 저장된 규칙 조건에 카탈로그 밖 필드 | 규칙 불일치(건너뜀) + `RoutingRules` warn; 콘솔은 "알 수 없는 필드 — 삭제하세요"로 표시해 제거 가능 |
| 조건 값을 하나도 안 고른 행 | 저장 시 제거(규칙에 아무것도 묻지 않음) |
| `customer_tier` 조건 규칙이 있고 세션 고객 row 없음 | tier null → 불일치, 고객 조회 예외는 삼킴 |
| 세션 미서명(호텔·지역·역할 없음) | 해당 조건 불일치 → 폴백 담당자 |
| 라벨 0건 테넌트 | 인계 섹션 deny 라벨 Select는 i18n 3종 폴백 |
| 팀 코드 대문자·공백 입력 | 콘솔 입력 시 소문자 trim, 서버 `^[a-z0-9_]{1,24}$` 400 |
| 마스터 외 사용자 | 관리 버튼 미노출, API는 `LABEL_EDIT` 403 |
