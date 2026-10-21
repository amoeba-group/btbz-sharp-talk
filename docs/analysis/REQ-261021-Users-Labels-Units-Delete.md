# REQ-261021 — 라벨·팀(Unit) 삭제 기능

- 요청: `https://shoptalk.amoeba.site/users` → **Labels & units** 모달에 수정 기능만 있음 → 삭제 기능 추가
- 선행: PLN-261019-Users-Unit-Labels-Routing-Conditions (P1 units, P2 관리 모달, P3 배정 규칙 그룹)
- 관련 PLN: `docs/plan/PLN-261021-Users-Labels-Units-Delete.md`

## 1. AS-IS

| 구분 | 백엔드 | 콘솔 |
|---|---|---|
| 라벨 `job_labels` | `GET/POST/PATCH /job-labels` — 삭제 라우트 없음 | 모달 "라벨" 탭: 이름 수정·추가 |
| 팀 `units` | `GET/POST/PATCH /units` — 삭제 라우트 없음 | 모달 "팀" 탭: 이름 수정·추가 |

삭제가 없는 것은 **의도된 설계**였음 (`unit.entity.ts`, `LabelsUnitsModal.tsx` 주석):
- 라벨 코드 `consult / accounting / operations` = 권한 매트릭스 축 (`permission-matrix.ts` `CAP_REQUIRED_LABEL`, `menu-access.ts` `REQUIRED_LABEL`)
- 팀은 소속원이 있음 — 삭제하면 `users.unit_id`가 고아가 됨

### 참조 지점 (삭제 시 영향)

| 참조 | 저장 위치 | 키 | 삭제 후 현재 동작 |
|---|---|---|---|
| 사용자↔라벨 | `user_job_labels` (FK 없음) | `job_label_id` | 고아 링크 행 (코드 조회 시 누락되어 무해하나 쓰레기 데이터) |
| 사용자↔팀 | `users.unit_id` (FK 없음) | unit id | 목록에서 팀 표시 없음, 값은 남음 |
| 배정 규칙 그룹 | `tenant_ai_config.handoff_config.routingRules[].assigneeUnitIds / assigneeLabelCodes` (JSON) | unit id / label code | 그룹 해석 0명 → **조용히 다음 규칙으로 폴백** (invisible fallback) |
| deny 규칙 라벨 스탬프 | `handoff_config.denyRules[].label`, `routingRules[].labels` | label code | 매칭 대상 라벨이 사라짐 |
| 이슈 담당 라벨 | `issues.assignee_label` (문자열) | label code | 이력 문자열, 표시만 코드로 |
| 권한 | 코드 상수 | 3개 고정 코드 | **삭제 시 해당 업무 권한 전원 상실** |

## 2. TO-BE

1. 모달 각 행에 **삭제** 버튼 → 확인 다이얼로그(영향 요약) → 삭제 → 토스트.
2. **권한 라벨 3종(consult/accounting/operations)은 삭제 불가** — 버튼 비활성 + 툴팁. 서버도 거부.
3. **배정 규칙이 참조 중이면 삭제 거부** — 어떤 규칙이 쓰는지 이름을 보여주고 "규칙에서 먼저 빼세요" 안내 (조용한 폴백 방지).
4. 소속원/보유자가 있으면 확인 창에 인원수 표시 → 확인 시 **소속 해제**(팀: `unit_id=NULL`, 라벨: 링크 삭제)와 함께 삭제. 한 트랜잭션.
5. 삭제는 감사 로그(`unit.deleted` / `label.deleted`, 해제 인원 포함).
6. 하드 삭제 → 같은 코드 재사용 가능 (`uk_*_tenant_code` 유니크와 충돌 없음).

## 3. 갭

| # | 갭 | 조치 |
|---|---|---|
| G1 | DELETE 라우트 없음 | `DELETE /job-labels/:id`, `DELETE /units/:id` (`LABEL_EDIT` 권한) |
| G2 | 참조 검사 없음 | 서비스에서 routingRules·denyRules 검사 → 409 + 규칙 이름 |
| G3 | 권한 라벨 보호 없음 | `JOB_LABEL` 값이면 409 |
| G4 | 사전 영향 조회 없음 | 목록 응답에 `memberCount` 추가 (확인 창 인원수용) |
| G5 | 라벨 생성/수정에 감사 로그 없음 (팀은 있음) | 삭제만 추가 (생성/수정은 범위 밖) |
| G6 | UI 삭제 버튼·확인 창·i18n 6언어 | 모달 수정 |

## 4. 사용자 흐름

```
Users → [Labels & units] → 행의 🗑 클릭
   ├─ 권한 라벨 → 버튼 비활성 (툴팁: 권한과 연결된 라벨은 삭제할 수 없음)
   └─ 확인 창: "'{name}' 삭제? 소속 N명은 소속이 해제됩니다"
         ├─ 취소
         └─ 삭제 → 서버
               ├─ 200 → 행 제거 + 성공 토스트 + 사용자 목록 갱신
               └─ 409 규칙 참조 → 오류 토스트(수동 닫기): "배정 규칙 '…'에서 사용 중"
```

## 5. 제약

- 스키마 변경 없음 (테이블·컬럼 추가 없음) → SQL 선적용 불필요.
- 테넌트 격리: `id + tenant_id`로 조회, 타 테넌트 id는 404.
- 4xx 거부 시 `logger.warn` (dev-kit: 4xx는 기본 미로깅).
- 플랫폼 어드민 화면(`admin-tenant-user.controller`)은 조회 전용 — 범위 밖.
