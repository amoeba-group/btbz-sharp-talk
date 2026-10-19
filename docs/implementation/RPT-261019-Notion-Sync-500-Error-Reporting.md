# RPT-261019 노션 소스 동기화 실패 — 500 제거 및 원인별 오류 응답 구현 보고

- 근거: `docs/analysis/REQ-261019-…` · `docs/plan/PLN-261019-…` · `docs/test/TCR-261019-…`
- 작성일: 2026-10-19

## 1. 요약

| 항목 | 내용 |
|---|---|
| 증상 | `POST /knowledge/sources/9/sync` 500, 토스트 "Internal server error" |
| 1차 원인(운영) | go2joy FAQ 노션 페이지가 통합 **"HA-UserGuide"**(workspace Go2Joy)에 미공유. 10/16 토큰 교체로 통합의 가시 범위가 페이지 1건으로 리셋됨. 소스 7·12도 동일 |
| 2차 원인(코드) | 어댑터 일반 `Error` → E9001/500; 접근 로그는 `err.status`(Notion 404)를 응답 상태로 오기록 |
| 조치 | E5095/E5096/E5097 분류(422/502) + `details.reason` + 토스트 3줄 + 인터셉터 정정 + 모달 힌트 |
| 운영 조치(미완, go2joy) | Notion에서 FAQ 페이지 ⋯ → Connections → HA-UserGuide 추가 → 재동기화. 소스 7은 같은 조치 또는 대상 ID를 `bfb56ba4…`로 수정 |

## 2. 변경 파일

**PR #648** (main `181b288`)
- `apps/api/src/global/constant/error-code.constant.ts` — E5095~E5097
- `apps/api/src/domain/knowledge/source-adapter.interface.ts` — `SourceTargetError`/`SourceCredentialError`
- `apps/api/src/domain/knowledge/adapters/{notion,gdrive}.adapter.ts` — throw 5곳 클래스 교체
- `apps/api/src/domain/knowledge/sync-error.util.ts` (+spec) — 분류기
- `apps/api/src/domain/knowledge/knowledge.service.ts` — catch에서 분류·warn·throw
- `apps/api/src/domain/knowledge/knowledge.service.syncerror.spec.ts` — 계약 갱신
- `apps/api/src/global/interceptor/logging.interceptor.ts` (+spec) — `HttpException`만 신뢰
- `apps/web/src/lib/{api-client,types}.ts` — `details` 전달
- `apps/web/src/domain/knowledge/knowledge.hooks.ts` — 토스트(코드별 제목·사유·공유 안내), mutate `{id,type}`
- `apps/web/src/domain/knowledge/KnowledgePage.tsx` — 호출부, notion.site 힌트
- `apps/web/src/components/Toast.tsx` — `whitespace-pre-line`
- `apps/web/src/i18n/locales/*/knowledge.json` ×6 — `syncError.E5095~97`, `gdriveShareHint`, `notionPublishedHint`
- docs: REQ/PLN/TCR-261019

**PR 2 (후속)** — `knowledge.hooks.ts` 동기화 실패 토스트 `sticky: true`(실측에서 4초 자동 닫힘 확인 → 에러는 수동 닫기 원칙), 본 RPT, TCR 결과 반영.

## 3. 테스트 결과

- 유닛: `npx jest` 229 suites / 2,274 tests ✅ (신규 13케이스 포함) · `npm run typecheck` 9/9 ✅ · `i18n:check` 6언어 ✅ · web build ✅ · CI(typecheck·test·build) ✅
- 스테이징 실측(2026-10-19, API `181b288`):

| ID | 결과 |
|---|---|
| I1 | 소스 9 sync → **HTTP 422** `{code:"E5095", details.reason[0]:"Could not find page with ID: f0373763-… shared with your integration \"HA-UserGuide\"."}` ✅ |
| I2 | 접근 로그 `POST /api/v1/knowledge/sources/9/sync -> 422` ✅ (이전 `-> 404`) |
| I3 | `AllExceptionFilter` ERROR 스택 없음, `KnowledgeService WARN source 9 (notion) sync failed: E5095 — …` 1줄 ✅ |
| I4 | 콘솔 토스트 3줄(제목 "소스 대상에 접근할 수 없습니다." / Notion 원문 / Connections 안내) + 닫기 버튼 ✅ — 단, 4초 자동 닫힘 → PR 2에서 sticky |
| I5 | 소스 행 빨간 시각 + 사유 + 힌트 ✅ (현행 유지) |
| I6 | 소스 7 sync → 422 E5095, 상태 `ok`→`failed` 갱신 ✅ |
| I7 | 소스 추가 모달에 `hotel-go2joy.notion.site/…` 입력 → 경고색 힌트 표시 ✅ |
| I8 | go2joy 공유 조치 대기 ⏳ |
| I9 | 다른 라우트 접근 로그 변화 없음 ✅ |

캡처: 토스트 `screenshot-1792374347761-1.png`, 모달 `screenshot-1792374377761-2.jpg` (로컬 임시 경로, 세션 로그 참조).

## 4. 배포 상태

| 환경 | 상태 |
|---|---|
| 스테이징 `shoptalk.amoeba.site` | PR #648 배포 완료 2026-10-19 (deploy-staging.sh, `successfully started` 1회, health ok). 마이그레이션 없음 |
| 프로덕션 `sharptalk.amoeba.site` | 미배포 — `production` 브랜치 반영 시 SQL 없음, 코드만 |

## 5. 교훈
- **토큰 교체 = 통합 가시 범위 리셋.** 기존 소스의 `ok`는 과거 토큰 기준이라 다음 동기화에서 전부 실패한다. 자격증명 교체 시 해당 provider 소스 재검사(G5)는 후속 후보.
- **웹 공개(notion.site) ≠ API 접근.** 운영자가 가장 자주 빠지는 함정이라 입력 시점에 힌트를 둔다.
- **외부 API의 상태코드를 우리 응답 상태로 로깅하지 말 것.** 로그 404·응답 500·스택 ERROR가 셋 다 달라 진단이 늦어졌다.
- 진단 요령: 컨테이너 안에서 `decryptSecret` + `/users/me` + `/search`로 통합의 워크스페이스·가시 페이지를 직접 확인하면 "미공유 vs 워크스페이스 불일치"가 1분에 갈린다.
