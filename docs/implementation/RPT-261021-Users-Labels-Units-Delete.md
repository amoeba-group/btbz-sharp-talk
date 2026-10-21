# RPT-261021 — 라벨·팀(Unit) 삭제 기능

- REQ `docs/analysis/REQ-261021-Users-Labels-Units-Delete.md` · PLN `docs/plan/PLN-261021-Users-Labels-Units-Delete.md` (권장안 D1~D4 승인 10/22) · TCR `docs/test/TCR-261021-Users-Labels-Units-Delete.md`

## 변경 요약
- `DELETE /job-labels/:id`, `DELETE /units/:id` (`LABEL_EDIT` = master)
- D1 권한 라벨 consult/accounting/operations 삭제 거부 **E2006**
- D2 배정 규칙(`assigneeUnitIds`·`assigneeLabelCodes`·`labels`)·deny 규칙(`label`)이 참조하면 거부 **E2007** + `details.rules`(규칙 이름)
- D3 삭제 시 소속 해제(팀=`users.unit_id` NULL, 라벨=`user_job_labels` 삭제)를 한 트랜잭션으로, 감사 `unit.deleted` / `label.deleted`(released 수)
- D4 하드 삭제 — 같은 코드 재생성 가능
- 목록 응답에 `memberCount` (확인 패널·행 인원 표시)
- 콘솔: 행 휴지통 버튼(권한 라벨 비활성+툴팁) → 모달 안 확인 패널 → 성공/오류 토스트, 6언어 i18n, codeHint 문구 갱신

## 파일
| 경로 | 내용 |
|---|---|
| `apps/api/src/global/constant/error-code.constant.ts` | E2006 LABEL_PROTECTED, E2007 ORG_IN_USE_BY_RULE |
| `apps/api/src/domain/user/user.service.ts` | deleteLabel·deleteUnit·refuseIfRuleUses, list memberCount, TenantAiConfig 리포지토리(생성자 끝) |
| `apps/api/src/domain/user/user.module.ts` | forFeature TenantAiConfig |
| `apps/api/src/domain/user/{unit,job-label}.controller.ts` | `@Delete(':id')` |
| `apps/api/src/domain/user/dto/response/user.response.ts` | memberCount |
| `apps/api/src/domain/user/entity/unit.entity.ts` | 주석(삭제 정책) |
| `apps/api/src/domain/user/user.service.org-delete.spec.ts` | 신규 스펙 13건 |
| `apps/web/src/domain/users/{LabelsUnitsModal.tsx,users.hooks.ts,users.service.ts}` | 삭제 UI·뮤테이션 |
| `apps/web/src/i18n/locales/{en,es,ko,vi,ja,zh}/users.json` | 키 11종 + codeHint |

## 테스트
jest user 도메인 21/21, tsc(api·web), i18n:check, radius:check 통과. 로컬 실 HTTP 10건·화면 4건 확인(TCR §2·§3). 로컬 handoff_config 임시 변경은 원복 diff 0.

## 배포 상태
- 스키마 변경 없음 → SQL 선적용 불필요
- PR: (작성 후 기입) · 커밋: (머지 SHA 기입)
- 스테이징: 대기 · 프로덕션: 대기
