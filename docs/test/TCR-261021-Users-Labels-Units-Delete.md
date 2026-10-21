# TCR-261021 — 라벨·팀(Unit) 삭제 기능

- PLN: `docs/plan/PLN-261021-Users-Labels-Units-Delete.md`
- 실행일: 2026-10-22 (로컬 API :3110 + 로컬 MySQL `db_sharptalk`, 콘솔 vite :5183)

## 1. 단위 테스트 — `apps/api/src/domain/user/user.service.org-delete.spec.ts`

| # | 케이스 | 결과 |
|---|---|---|
| U1 | 팀 삭제: 소속원 `unit_id=NULL` + 행 삭제가 한 트랜잭션, 감사 `unit.deleted`(released=2) | PASS |
| U2 | 타 테넌트/없는 팀 id → E2005 | PASS |
| U3 | 배정 규칙 그룹이 팀 참조(JSON 숫자 id vs 문자열 PK) → 409 E2007, 규칙 이름 trim·무명 규칙은 `Routing rule N` | PASS |
| U4 | 라벨 삭제: `user_job_labels` 링크 → 라벨 순서로 삭제, released=3 | PASS |
| U5 | consult / accounting / operations 삭제 → 409 E2006, 삭제 쿼리 없음 | PASS ×3 |
| U6 | 라벨이 그룹·라벨 필터·deny 규칙에서 참조 → 세 규칙 모두 이름 반환 | PASS |
| U7 | 타 테넌트 라벨 id → 404 E5002 RESOURCE_NOT_FOUND (기존 updateLabel과 동일) | PASS |
| U8 | 목록 memberCount: 라벨 보유자(String 키 조인)·팀 소속원 | PASS ×2 |

`npx jest src/domain/user` → 4 suites / 21 tests 통과 (기존 labels·units·temp-password 스펙 무회귀).

## 2. 통합 (실 HTTP, 로컬 DB)

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| I1 | `DELETE /job-labels/1` (consult) | 409 E2006 | 409 E2006 |
| I2 | `DELETE /units/9999` | 404 E2005 | 404 E2005 |
| I3 | 임시 팀·라벨 생성 → 사용자 2에 배정 → 목록 memberCount | 1 / 1 | 1 / 1 |
| I4 | 임시 팀 삭제 | 200 `{released:1}` | 일치 |
| I5 | 임시 라벨 삭제 | 200 `{released:1}` | 일치 |
| I6 | 사용자 2 조회 | unitId null, labelCodes [] | 일치 |
| I7 | 같은 코드 `tmp_del` 재생성 | 성공 (하드 삭제로 코드 재사용) | 성공 |
| I8 | 배정 규칙에 팀 추가(임시) 후 삭제 | 409 E2007 `details.rules=["Tmp HCM rule"]` | 일치 → handoff_config 원복 diff 0 |
| I9 | 기존 규칙(무명)이 쓰는 팀 5 삭제 | 409 `["Routing rule 1"]` | 일치 |
| I10 | API 실부팅 (UserModule에 TenantAiConfig 주입) | `Nest application successfully started` | 확인 |

## 3. 화면 (콘솔 /users → Labels & units)

| # | 확인 | 결과 |
|---|---|---|
| S1 | 라벨 탭: 권한 3종 휴지통 비활성, `qa` 활성, 보유 인원 표시 | 확인 |
| S2 | 팀 탭 휴지통 → 같은 모달 안 확인 패널(제목·해제 인원·되돌릴 수 없음) | 확인 |
| S3 | 규칙 참조 팀 삭제 → 오류 토스트(수동 닫기) "Used by routing rules: Routing rule 1 …" | 확인 |
| S4 | 임시 팀 삭제 → 성공 토스트 + 행 제거 | 확인 |

## 4. 정적 검사
- `apps/api` · `apps/web` `tsc --noEmit` 통과
- `npm run i18n:check` 6언어 complete
- `npm run radius:check` 통과

## 5. 엣지 / 미검증
- 동시성: 삭제와 동시에 같은 팀으로 사용자 이동 — 트랜잭션 내 UPDATE가 먼저 잡으므로 이후 이동은 E2005로 실패(정상).
- 스테이징 실측(배포 후)은 RPT에 기록.
