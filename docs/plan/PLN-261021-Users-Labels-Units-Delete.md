# PLN-261021 — 라벨·팀(Unit) 삭제 기능

- REQ: `docs/analysis/REQ-261021-Users-Labels-Units-Delete.md`
- 상태: **승인 대기** (승인 전 구현 착수 금지)

## 결정 사항 (승인 시 확정)

| # | 결정 | 권장안 | 대안 |
|---|---|---|---|
| D1 | 권한 라벨 3종 | **삭제 불가** (UI 비활성 + 서버 409) | — |
| D2 | 배정/deny 규칙이 참조 중 | **삭제 거부 409 + 규칙 이름 안내** | 규칙에서 자동 제거 (그룹이 비면 규칙이 조용히 무효화 → 비권장) |
| D3 | 소속원/보유자 있음 | **확인 후 소속 해제와 함께 삭제** | 소속원 0명일 때만 삭제 허용 (먼저 전원 이동 필요) |
| D4 | 삭제 방식 | **하드 삭제** (코드 재사용 가능, 감사 로그로 이력) | 소프트 삭제 (스키마 변경 필요) |

## 단계

### S1 — 백엔드 (`apps/api/src/domain/user/`)
- `error-code.constant.ts`: `E2006 ORG_LABEL_PROTECTED` (권한 라벨), `E2007 ORG_IN_USE_BY_RULE` (규칙 참조; `details.rules: string[]`)
- `user.service.ts`
  - `deleteLabel(tenantId, actorId, id)` / `deleteUnit(tenantId, actorId, id)`
    1. `id + tenantId` 조회, 없으면 404
    2. 라벨: `Object.values(JOB_LABEL)` 포함 → 409 E2006
    3. `tenant_ai_config.handoff_config` 읽어 `routingRules[].assigneeUnitIds/assigneeLabelCodes/labels`, `denyRules[].label` 검사 → 409 E2007 (규칙 이름 목록)
    4. 트랜잭션: 팀=`UPDATE users SET unit_id=NULL WHERE tenant_id=? AND unit_id=?`, 라벨=`DELETE user_job_labels WHERE job_label_id=?` → 본 행 삭제
    5. `AuditService.write` (`unit.deleted` / `label.deleted`, `released=N`)
  - `listLabels` / `listUnits` 응답에 `memberCount` (GROUP BY 1쿼리)
  - 거부 경로마다 `logger.warn`
- `job-label.controller.ts`, `unit.controller.ts`: `@Delete(':id') @RequireCapability(LABEL_EDIT)`
- 응답 매퍼 `memberCount` 추가, 엔티티/주석의 "nothing is deleted" 문구 갱신
- 규칙 검사 위치: `TenantAiConfig` 리포지토리를 UserModule에 주입(읽기 전용) — 순환 import 피하려 엔티티만 `forFeature`

### S2 — 콘솔 (`apps/web/src/domain/users/`)
- `users.service.ts` / `users.hooks.ts`: `deleteLabel`, `deleteUnit` 뮤테이션 (성공 시 labels·units·users 쿼리 무효화)
- `LabelsUnitsModal.tsx`: 행 끝에 삭제 버튼, 권한 라벨은 비활성+툴팁, 확인 다이얼로그(공용 Confirm 컴포넌트가 없으므로 `Modal` 기반)
- 오류 코드 E2006/E2007 → i18n 메시지(E2007은 규칙 이름 보간)
- i18n `users` 네임스페이스 6언어(en/es/ko/vi/ja/zh) 키: `delete`, `deleteConfirmTitle`, `deleteConfirmBody`, `deleteConfirmMembers`, `orgDeleted`, `permissionLabelNoDelete`, `orgInUseByRule`, `orgDeleteError` → `npm run i18n:check`

### S3 — 테스트·문서
- `user.service.units.spec.ts` / `user.service.labels.spec.ts`: 정상 삭제(소속 해제 수), 타 테넌트 404, 권한 라벨 409, 규칙 참조 409, bigint 문자열 id 픽스처
- TCR / RPT 작성, 사용자 매뉴얼 해당 절 갱신 여부 확인

## 와이어프레임 (Labels & units 모달)

```
┌─ Labels & units ─────────────────────────────────────────── ✕ ┐
│ [ Labels ] [ Units ]                                           │
│ ┌────────────┬──────────────────────┬──────────────────────┐   │
│ │ Code       │ Name                 │                      │   │
│ ├────────────┼──────────────────────┼──────────────────────┤   │
│ │ consult    │ [상담            ]   │ (권한 연결) [저장] [🗑]│ ← 🗑 비활성, 툴팁
│ │ hcm_cs     │ [HCM 상담        ]   │   3명      [저장] [🗑]│ ← 활성
│ ├────────────┼──────────────────────┼──────────────────────┤   │
│ │ [code    ] │ [name              ] │            [추가]    │   │
│ └────────────┴──────────────────────┴──────────────────────┘   │
│                                                     [닫기]     │
└────────────────────────────────────────────────────────────────┘

        ┌─ 'HCM 상담' 삭제 ─────────────────────────┐
        │ 이 라벨을 삭제합니다.                      │
        │ 보유자 3명에게서 라벨이 해제됩니다.         │
        │ 되돌릴 수 없습니다.                        │
        │                       [취소] [삭제(빨강)]  │
        └───────────────────────────────────────────┘

  규칙 참조 시 → 오류 토스트(수동 닫기):
  "배정 규칙 '호치민 CS'에서 사용 중입니다. 규칙에서 먼저 제거하세요."
```

## 부작용 분석

| 영역 | 영향 | 대응 |
|---|---|---|
| 권한(RBAC) | 권한 라벨 삭제 시 업무 권한 상실 | D1로 원천 차단 |
| 핸드오프 라우팅 | 그룹 0명 → 다음 규칙 조용히 폴백 | D2로 참조 시 거부 |
| 사용자 목록 | 해제된 사용자는 팀/라벨 없음으로 표시 | 뮤테이션 후 users 쿼리 무효화 |
| 이슈 `assignee_label` | 과거 이슈에 코드 문자열 잔존 | 이력이므로 유지 (표시는 코드) |
| 스키마 | 변경 없음 | SQL 선적용·Migration 섹션 불필요 |
| 플랫폼 어드민 | 조회 전용 | 영향 없음 |

## 배포
staging → 확인(삭제/거부 2경로 실측) → production. 스키마 변경 없음.
