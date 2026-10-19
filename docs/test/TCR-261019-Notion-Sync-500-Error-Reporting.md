# TCR-261019 노션 소스 동기화 실패 — 원인별 오류 응답 테스트 케이스

- 근거: `docs/plan/PLN-261019-Notion-Sync-500-Error-Reporting.md`
- 대상: `sync-error.util.ts`, `knowledge.service.ts#syncSource`, `logging.interceptor.ts`, 콘솔 `useSyncSource` 토스트, 소스 추가 모달 힌트

## 1. 단위 테스트 (jest)

| ID | 파일 | 케이스 | 기대 | 결과 |
|---|---|---|---|---|
| U1 | `sync-error.util.spec.ts` | Notion 404 `object_not_found` | E5095 / 422 / `details.reason[0]`에 통합명 포함 | ✅ |
| U2 | 〃 | `object_not_found` + 다른 status | E5095 | ✅ |
| U3 | 〃 | Notion 400 `validation_error` | E5097 / 502 | ✅ |
| U4 | 〃 | `NotionAuthError`·`DriveAuthError`·`SourceCredentialError` | E5096 | ✅ |
| U5 | 〃 | `SourceTargetError`(휴지통·ID 없음) | E5095 | ✅ |
| U6 | 〃 | `DriveRequestError` `(404)` / `(503)` | E5095 / E5097 | ✅ |
| U7 | 〃 | 사유 500자 | 200자 절단(행 저장값과 동일) | ✅ |
| U8 | 〃 | `TypeError`·문자열 | `null`(분류 안 함 → 500 유지) | ✅ |
| U9 | `knowledge.service.syncerror.spec.ts` | 미공유 404 동기화 | `BusinessException` E5095/422, 행·감사·응답 사유 동일 | ✅ |
| U10 | 〃 | `TypeError` 동기화 | 원본 그대로 전파(500) + 행 사유 기록 | ✅ |
| U11 | 〃 | 기존 3케이스(200자 절단·감사 기록·이력 조회) | 무회귀 | ✅ |
| U12 | `logging.interceptor.spec.ts` | `HttpException`/`BusinessException` | `getStatus()` 값 | ✅ |
| U13 | 〃 | `status:404` 필드를 가진 일반 Error | **500** | ✅ |
| U14 | `adapters/*.spec.ts` | 어댑터 throw 클래스 교체 | 기존 스펙 무회귀 | ✅ |

실행: `npx jest` (apps/api) → **229 suites / 2,274 tests 통과**. `npm run typecheck` 9/9, `npm run i18n:check` 6언어 complete, `apps/web` vite build 통과.

## 2. 통합 시나리오 (스테이징)

| ID | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| I1 | 소스 9(FAQ, 미공유) [동기화] | HTTP **422**, `error.code=E5095`, `details.reason[0]`=Notion 원문 | ✅ 422 E5095 (10/19) |
| I2 | I1 접근 로그 | `POST …/sources/9/sync -> 422` (404 아님) | ✅ |
| I3 | I1 서버 로그 | `AllExceptionFilter` ERROR 스택 **없음**, `KnowledgeService` WARN 1줄 `E5095 — Could not find page…` | ✅ |
| I4 | I1 콘솔 토스트 | 3줄(제목 i18n / Notion 원문 / Connections 안내), 수동 닫기 | ✅ 3줄 확인 — 4초 자동 닫힘 → PR 2 sticky |
| I5 | I1 소스 행 | 빨간 시각 + 사유 + 힌트(현행 유지) | ✅ |
| I6 | 소스 7(현 통합에 미공유) [동기화] | I1과 동일 결과 — 과거 `ok`가 `failed`로 갱신 | ✅ |
| I7 | 소스 추가 모달에 `hotel-go2joy.notion.site/...` 입력 | 경고색 힌트 "웹 공개 ≠ API 접근" 표시, notion.so 입력 시 미표시 | ✅ |
| I8 | go2joy가 FAQ 페이지를 HA-UserGuide에 연결 후 [동기화] | 200, 문서 생성·임베딩 | ⏳ go2joy 조치 대기 |
| I9 | 기타 라우트 접근 로그 | 변화 없음(HttpException 경로 동일) | ✅ |

## 3. 엣지 케이스

| ID | 케이스 | 처리 |
|---|---|---|
| E1 | Notion 429 재시도 후에도 실패 | `NotionRequestError(429)` → E5097/502 — 운영자 조치 없음, 재시도 안내 |
| E2 | Notion 요청 타임아웃(`AbortSignal.timeout`) | `fetch`가 `DOMException`/`TypeError` → 분류 안 됨 → 500 유지(우리 쪽 재시도 대상). 후속 후보 |
| E3 | 토큰 복호화 불가(`CRED_ENC_KEY` 교체) | `credentials.load` 예외 → 현행대로 500 — 플랫폼 이슈이므로 의도적 유지 |
| E4 | gdrive 폴더 미공유 | Drive 404 → E5095 + `gdriveShareHint`(서비스 계정 이메일 공유) |
| E5 | `details` 없는 구버전 응답(배포 전 API + 신규 콘솔) | `reason` undefined → 제목만 표시, 예외 없음 |
| E6 | 단일 줄 토스트(다른 화면) | `whitespace-pre-line`은 `\n` 없는 문구에 영향 없음 |
