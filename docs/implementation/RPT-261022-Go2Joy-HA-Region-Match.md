# RPT-261022 — go2joy HA 1단계: 유닛·라벨 담당 지역 · 지역 매칭 배정 · 지역/성 정규화

- 근거: [PLN-261022 §2](../plan/PLN-261022-Go2Joy-HA-B2B-Identity-Continuity.md) (2026-10-22 승인) · [TCR-261022](../test/TCR-261022-Go2Joy-HA-Region-Match.md)
- PR **#687** → main `d971556c` (squash)

## 1. 무엇이 바뀌었나
| 영역 | 변경 |
|---|---|
| 권역 카탈로그 | `packages/types/src/common/region.ts` — `north · north_center · central · south_center · south`. `canonicalRegion`이 `North Center`, `north_central` 같은 표기를 코드로 바꾸고, `provinceKey`는 NFC·대소문자를 무시하는 비교 키 |
| identify | 서명은 받은 값 그대로 검증한다. 저장할 때만 NFC로 바꾸고 권역을 코드로 정규화한다. 권역이 없으면 `handoff_config.provinceRegions`로 채우고, 매핑이 서명 권역과 다르면 서명 값을 유지하고 warn을 남긴다. 로그: `region signed / map / none` |
| 유닛·라벨 | `units`·`job_labels`에 `regions`·`provinces`(json) 추가. `PATCH /units/:id`·`/job-labels/:id`로 이름과 담당 지역을 수정한다. 카탈로그 밖 권역은 400, 성은 NFC로 바꾸고 중복을 없앤다. 변경은 감사 로그(`unit.scope_changed`·`label.scope_changed`)에 남는다 |
| 배정 | 규칙 `assigneeByRegion` 추가. 활성 상담원 중 **유닛 ∪ 보유 라벨**의 담당 지역이 세션의 **성(우선) → 권역**과 맞는 사람을 고른다. 유닛·라벨 선택은 추가 필터로 쓴다. 0명이면 다음 규칙. 규칙 지역도 정규화해 비교하고, 로그에 `match=province|region|none`을 남긴다 |
| 콘솔 | 라벨·팀 관리 모달 [지역 설정](권역 칩, 성 입력·자동완성). 규칙 편집기: 권역 칩 5개, 카탈로그 밖 저장 값은 "기타" 칩으로 보존(이전에는 불러올 때 버렸음), [지역 담당자에게 배정] 토글, 권역별 후보 미리보기와 0명 경고. i18n 6개 언어 |
| 도구 | `scripts/go2joy/province-regions-sql.mjs` + `vn-province-regions.json`(Go2Joy 지역표 63개 성) → `provinceRegions` SQL |

## 2. 파일
- API: `ai-engine/{handoff-router.service, routing-assignee.service, ai-engine.module, entity/tenant-ai-config.entity}.ts`, `embed/{embed.service, embed.module, identity-attributes}.ts`, `user/{user.service, unit.controller, job-label.controller}.ts`, `user/entity/{unit, job-label}.entity.ts`, `user/dto/{request/unit, request/job-label, response/user}.ts`
- 공용 타입: `packages/types/src/common/{region, routing-assignee}.ts`, `index.ts`
- 웹: `ai-settings/{RoutingRulesEditor, HandoffSection}.tsx`, `ai-settings.service.ts`, `users/{LabelsUnitsModal, RegionScopeEditor(신규)}.tsx`, `users.{service,hooks}.ts`, `i18n/locales/*/{aiSetting,livechat,users}.json`
- SQL: `sql/261022-unit-label-regions.sql`, `sql/artefacts.tsv`
- 테스트: `region.spec`, `routing-assignee.spec`, `routing-assignee.service.spec`, `handoff-router.service.spec`, `identity-attributes.spec`(신규 — GUIDE v1.2 서명 벡터 고정), `embed.service.spec`, `user.service.units.spec`

## 3. 테스트 결과
- `packages/types` 186개, `apps/api` 241 스위트 / 2,398개 모두 통과. web `tsc`·`vite build`, `i18n:check` complete. CI(typecheck·test·build) 통과
- 로컬 통합 TCR I-1~I-10 통과:
  - 실제 부팅 확인
  - 성만 서명 → `match=province`
  - `South` 텍스트 서명 → `match=region`
  - 담당 없는 권역 → 다음 규칙
  - 콘솔 화면 캡처 확인

## 4. 배포 상태
| 환경 | SQL | 코드 | 설정 | 비고 |
|---|---|---|---|---|
| **스테이징** | ✅ 2026-10-22 03:15(KST) 선적용(백업 `~/backups/pre-261022-unit-label-regions-20261022-0315.sql`), `check-migrations` 누락 0 | ✅ `d971556c` 배포. 컨테이너 재생성, 부팅 로그 `successfully started`, `PATCH /units/1` 401, 컨테이너 안 API·웹 번들에 새 코드 확인 | ✅ go2joy(테넌트 4) `provinceRegions` 63개 등록(이전 설정 백업 `~/backups/pre-261022-go2joy-handoff-config.tsv`) | 팀 담당 지역·지역 매칭 규칙은 **Go2Joy 팀 매핑 확정(G6) 후** 입력 |
| 프로덕션 | ✅ 2026-10-22 07:12 KST 선적용(백업 `~/backups/sharptalk-production/20261022-0712-pre-261022/db_sharptalk.sql`) | ✅ `production` ff `f194834e..23c0a2b1` → `deploy-self-hosted.sh`. API healthy·부팅 로그·마이그레이션 누락 0·`/units` 401 | — | go2joy 테넌트 없음(ivyusa만). 동작 변화 없음 |
| init-sql | ⬜ | — | — | `docker/init-sql/01-schema.sql`이 261019 마이그레이션 3건과 이번 건 뒤처짐 → 스테이징 실스키마로 재생성 필요 |

## 5. 남은 일
- 스테이징 통합 S-3~S-5:
  - 팀 North / North Center / South / South Center에 담당 권역 지정
  - 지역 매칭 규칙 작성
  - 서명 identify(T2·T3·성만)로 AI 이관·직원 요청 배정 실측

  실제 상담원에게 알림·메일이 가므로 Go2Joy 팀·상담원 확정 뒤 진행한다.
- ~~프로덕션 SQL 선적용·배포~~(10/22 완료), init-sql 재생성
- 2단계(기업고객·대화 연속성) 구현
