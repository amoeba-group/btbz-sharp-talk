# PLN-261019 노션 소스 동기화 실패 — 500 제거 및 원인별 오류 응답

- 근거: `docs/analysis/REQ-261019-Notion-Sync-500-Error-Reporting.md`
- 범위: G1~G4·G6(P1·P2). G5(토큰 교체 후 소스 재검사)는 **제외**(별도 요구 시).
- 원칙: 스키마 변경 없음, 소스 행 표시(B1) 무수정, gdrive 어댑터도 같은 분류를 타되 동작 변화는 "상태코드·토스트"에 한정.

## 0. 설계 요약
```
어댑터 오류(Notion/Drive)  ──▶ KnowledgeService.syncSource catch
                               recordSyncState/recordAudit (현행)
                               classifySyncError(e)  ──▶ BusinessException(code, status, { reason:[msg] })
                                                         E5095 TARGET_UNREACHABLE  422  (404/object_not_found·휴지통·no usable target id)
                                                         E5096 CREDENTIAL_INVALID  422  (NotionAuthError/DriveAuthError·토큰 미등록)
                                                         E5097 SYNC_UPSTREAM_FAILED 502 (그 외 NotionRequestError/DriveRequestError·타임아웃)
                               그 외(프로그래밍 오류) → 그대로 throw (500 유지, 스택 로그 유지)
LoggingInterceptor: status = err instanceof HttpException ? err.getStatus() : 500
콘솔 api-client: wrapped.details 동봉 → useSyncSource.onError: t(`syncError.${code}`) + reason (+ E5095면 notionShareHint)
```

## 1. 단계별 계획

### S1 — 백엔드 (PR 1)
1. `global/constant/error-code.constant.ts` — `// E5095-E5097 — Knowledge source sync (PLN-261019)`
   - `KB_SOURCE_TARGET_UNREACHABLE: E5095 'The source target cannot be read — check that it is shared with the integration'`
   - `KB_SOURCE_CREDENTIAL_INVALID: E5096 'The source credential is missing or was rejected'`
   - `KB_SOURCE_UPSTREAM_FAILED: E5097 'The source provider did not respond'`
2. `domain/knowledge/sync-error.util.ts`(신규, 순수 함수) — `classifySyncError(e: unknown): BusinessException | null`
   - `NotionRequestError`: `status===404 || code==='object_not_found'` → E5095; 그 외 → E5097
   - `NotionAuthError` / `DriveAuthError` → E5096
   - `DriveRequestError`: 메시지에 `404|notFound|not found` → E5095, 그 외 E5097
   - 일반 `Error` 중 어댑터가 던지는 고정 문구(`no usable Notion target id`, `is in the trash`, `has no folderId`) → E5095, (`no Notion integration token`, `no Google service account key`) → E5096 — **문구 매칭이 아니라 어댑터가 전용 클래스로 던지게 수정**: `SourceTargetError`/`SourceCredentialError`(`source-adapter.interface.ts`에 export) 두 클래스를 추가하고 두 어댑터의 `throw new Error(...)` 5곳을 교체. 분류기는 클래스만 본다
   - `details = { reason: [원문 200자] }` — 소스 행에 저장되는 문자열과 동일
3. `knowledge.service.ts#syncSource` catch — 기록 후 `const biz = classifySyncError(e); if (biz) { this.logger.warn(\`source ${sourceId} sync failed: ${biz.errorCode} ${reason}\`); throw biz; } throw e;`
4. `global/interceptor/logging.interceptor.ts` — `err instanceof HttpException ? err.getStatus() : 500` (G3)
5. 테스트
   - `sync-error.util.spec.ts`: 분류 7케이스(404·object_not_found·400 validation·Auth·Drive 404·클래스 2종·미지 Error→null)
   - `knowledge.service.syncerror.spec.ts`: "keeps the original error propagating" → **"미공유 404는 E5095/422로, details.reason에 원문"** 으로 교체 + "미지 Error는 그대로 500" 유지 케이스 추가
   - `logging.interceptor.spec.ts`(신규 소형): 비-HttpException에 `status:404`가 있어도 500으로 기록

### S2 — 콘솔 (PR 1 동승)
1. `lib/api-client.ts` — `wrapped.details = envelope?.error?.details` 추가(타입 `Record<string,string[]>`). 기존 소비처 영향 없음(추가 필드).
2. `domain/knowledge/knowledge.hooks.ts#useSyncSource.onError`
   ```ts
   const code = err.code; const reason = err.details?.reason?.[0];
   const known = code && ['E5095','E5096','E5097'].includes(code);
   const body = [known ? t(`syncError.${code}`) : err.message, reason, code === 'E5095' ? t('notionShareHint') : null]
     .filter(Boolean).join('\n');
   toast.error(body);   // error = 수동 닫기(현행 toast-store)
   ```
   gdrive 소스의 E5095엔 `notionShareHint` 대신 `gdriveShareHint`(폴더를 서비스계정에 공유) — 소스 타입은 mutate 인자에 `{ id, type }`으로 전달(호출부 1곳 `syncSource.mutate(r.id)` → `mutate({ id: r.id, type: r.type })`).
3. 소스 추가 모달(G6) — Notion 대상 입력값이 `notion.site`를 포함하면 힌트 1줄 `notionPublishedHint`: "웹에 공개(Publish)된 페이지라도 통합에 연결해야 읽을 수 있습니다."
4. i18n 6언어(`knowledge.json`): `syncError.E5095/E5096/E5097`, `gdriveShareHint`, `notionPublishedHint` → `npm run i18n:check`.

### S3 — 검증·배포·문서 (PR 2 = docs)
- 로컬: 유닛 + `typecheck` + API 실부팅(엔티티 변경 없음이나 관례대로 `successfully started` 확인).
- 스테이징 배포(스키마 변경 없음 → SQL 없음). 검증: 소스 9 [동기화] → **422 + E5095** 응답, 토스트 3줄, 접근 로그 `-> 422`, `AllExceptionFilter` ERROR 스택 **없음**. 소스 7도 같은 결과(현 통합에 미공유).
- go2joy 공유 완료 후 재동기화 성공 확인(운영 조치는 코드와 무관하게 즉시 전달).
- TCR-261019 / RPT-261019 작성, 메모리 `kb-source-notion.md` 갱신(토큰 교체=가시 범위 재설정 함정).

## 2. UI 변경 — ASCII 와이어프레임

### 2.1 동기화 실패 토스트 (AS-IS → TO-BE)
```
AS-IS                                   TO-BE
┌──────────────────────────┐            ┌──────────────────────────────────────────────────┐
│ ⓧ Internal server error  │            │ ⓧ 노션 대상에 접근할 수 없습니다                   │
└──────────────────────────┘            │   Could not find page with ID: f0373763-…        │
                                        │   Make sure the relevant pages … "HA-UserGuide". │
                                        │   Notion에서 페이지 열기 → ⋯ → 연결(Connections) │
                                        │   → 통합 추가                                   [닫기]│
                                        └──────────────────────────────────────────────────┘
```
(에러 토스트는 수동 닫기 — 현행 정책 유지)

### 2.2 소스 행 (변경 없음 — B1 현행)
```
│ Go2Joy Hotel FAQ (Notion) │ notion │ 2026-10-19 01:11 (빨강)                       │ [동기화] │
│                           │        │ Could not find page with ID: f0373763-…        │          │
│                           │        │ The Notion page isn't shared with the integ…   │          │
```

### 2.3 소스 추가 모달 — Notion 대상 입력 (G6, 조건부 힌트 1줄 추가)
```
┌ 지식 소스 추가 ─────────────────────────────────────────────┐
│ 유형  (●) Notion  ( ) Google Drive  ( ) 보드               │
│ 이름  [ Go2Joy Hotel FAQ (Notion)                        ] │
│ 대상  [ https://hotel-go2joy.notion.site/FAQ-f0373763…   ] │
│       ⓘ Notion에서 페이지/DB → ⋯ → Connections → 통합 추가 │  ← 현행
│       ⓘ 웹에 공개(Publish)된 페이지라도 통합 연결이 필요합니다 │  ← 신규(notion.site 감지 시)
│                                   [연결 테스트] [취소] [저장] │
└─────────────────────────────────────────────────────────────┘
```

## 3. 측면 영향 분석

| 영역 | 영향 | 대응 |
|---|---|---|
| gdrive 동기화 실패 | 500 → 422/502로 바뀜 | 행 표시·기록 동일, 토스트만 개선. 콘솔 외 호출자 없음(수동 전용 라우트) |
| `syncSource` 호출자 | 컨트롤러 1곳 | 반환 계약 불변 |
| 접근 로그 | 다른 라우트에서 비-HttpException에 `status` 필드가 있던 경우도 500으로 교정 | 의도된 정정(실제 응답과 일치) |
| `AllExceptionFilter` | 무수정 | BusinessException 경로로 자연 진입 |
| 기존 스펙 | syncerror.spec 1케이스 계약 변경 | S1-5에 명시 |
| i18n | 신규 키 5종 × 6언어 | `i18n:check` 게이트 |
| 배포 | 스키마 없음, 환경변수 없음 | `## Migration` 섹션 불필요(엔티티 미변경) |

## 4. 제외·보류
- G5(자격증명 교체 시 소스 재검사)·공개 페이지 HTML 수집 — 미채택.
- 소스 행의 `object_not_found` 정규식 힌트 — 현행 유지(이미 동작).

## 5. 승인 후 산출물
- PR 1: `feat(knowledge): 소스 동기화 실패를 원인별 4xx/502 + 사유로 응답 (PLN-261019)` — 파일 ~12개, 테스트 3파일.
- PR 2: TCR/RPT + 메모리.

**이 PLN 승인 전 구현 착수하지 않음.**
