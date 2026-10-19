# REQ-261019 노션 소스 동기화 500 — 원인 진단 및 오류 보고 개선 분석서

- 작성일: 2026-10-19
- 요청: `https://shoptalk.amoeba.site/knowledge` 에서 `POST /api/v1/knowledge/sources/9/sync` 가
  **500 (Internal Server Error)** 를 반환하고, 소스 행에는 "The Notion page isn't shared with the
  integration — open the page in Notion, ⋯ → Connections, and add the integration." 가 표시됨.
- 조사 방법: 스테이징 API 로그(10/16·10/19)·`knowledge_sources`/`integration_credentials` 실측,
  **tenant 4 토큰으로 Notion API 직접 프로브**(컨테이너 내부, 읽기 전용), 코드 전수 추적
  (어댑터→클라이언트→서비스→예외 필터→로깅 인터셉터→콘솔 훅).
- 선행 문서: `REQ-260828-Go2Joy-Notion-KB-Analysis.md`(B1 실패 사유 표시), `FIX-260828-Notion-Page-Probe-Fallback.md`.

## 1. 결론 요약

| 질문 | 답 |
|---|---|
| 왜 동기화가 실패하는가? | **코드 결함 아님 — 노션 측 공유 누락.** 소스 9의 대상 페이지 `f0373763…`(hotel-go2joy.notion.site/FAQ)가 go2joy의 현재 통합 **"HA-UserGuide"** 에 연결(Connections)되어 있지 않다. 통합이 볼 수 있는 페이지는 **1건뿐**("Hướng dẫn sử dụng Hotel Admin" `bfb56ba4…`)임을 실측 |
| 왜 500인가? | 어댑터가 던진 **일반 `Error`가 그대로 전파**되어 `AllExceptionFilter`가 E9001/500으로 포장. 사용자가 노션에서 고칠 수 있는 조건인데 "Internal server error" 토스트가 뜨고, 서버 로그엔 스택트레이스가 쌓인다 |
| 로그는 왜 404로 찍히는가? | `LoggingInterceptor`가 **예외 객체의 `status`(Notion 응답 404)** 를 HTTP 상태로 오기록. 실제 응답은 500 — "로그 404 ≠ 응답 500" 불일치 |
| 지금 해야 할 일 | ① 운영: go2joy가 FAQ 페이지를 HA-UserGuide 통합에 연결 → 재동기화. ② 코드: 동기화 실패를 **4xx/502 + 에러코드 + 사유** 로 응답하고 토스트가 사유를 보이게(§5) |

## 2. AS-IS — 실측 (스테이징 2026-10-19)

### 2.1 소스·자격증명
| 항목 | 실측 |
|---|---|
| 테넌트 | 4 `go2joy` |
| 소스 9 | `Go2Joy Hotel FAQ (Notion)`, 생성 10/06, `targetId=https://hotel-go2joy.notion.site/FAQ-f03737634c3848339910d50f7e77bf7b` (ID 추출 정상 `f0373763-4c38-4833-9910-d50f7e77bf7b`) |
| 소스 7 | `Hướng dẫn sử dụng Hotel Admin`, `targetId=…8968fee0bb548347a35e01756b4cc89c`, `last_sync_status=ok`(8/28 기록) |
| 자격증명 | `integration_credentials` id 15, provider notion, **10/16 교체**(로그: 10/16 07:21 credential PUT + test 200) |
| 통합 정체 | `/users/me` → bot **"HA-UserGuide"**, workspace **"Go2Joy"**, owner workspace |
| 통합 가시 범위 | `/search` → **1건**: page `bfb56ba4-89b9-429f-ba70-6ed8f96bedde` "Hướng dẫn sử dụng Hotel Admin" |
| 대상 프로브 | `/pages/f0373763…` → **404 object_not_found** ("Make sure … shared with your integration") / `/pages/8968fee0…` → **404** (소스 7의 대상도 현 통합엔 안 보임) |

### 2.2 동기화 호출 흐름
```
콘솔 [동기화] → POST sources/9/sync
  → NotionAdapter.fetchAll → NotionClient.retrieveTarget
    → GET /databases/{id} 404 → GET /pages/{id} 404 → throw NotionRequestError(404, object_not_found)
  → KnowledgeService.syncSource catch:
      recordSyncState(failed, error=메시지 200자)  ← 소스 행 빨간 사유 (REQ-260828 B1) ✅
      recordAudit(failed)                          ← 실행 이력 ✅
      throw e                                      ← 일반 Error 그대로
  → AllExceptionFilter: BusinessException/HttpException 아님 → 500 E9001 "Internal server error" + 스택 로그
  → LoggingInterceptor: err.status(404) 로 "-> 404" 기록   ← 응답(500)과 불일치
콘솔 useSyncSource.onError → toast.error("Internal server error")
콘솔 소스 행 → error 텍스트 + (object_not_found 매치) notionShareHint
```
로그 실측: 10/19 01:09:22, 01:11:41 `POST …/sources/9/sync -> 404` + `ERROR [AllExceptionFilter] Error: Could not find page with ID: f0373763-… shared with your integration "HA-UserGuide"`.

### 2.3 사용자가 본 것
- 브라우저 콘솔: `500 (Internal Server Error)` — 서버 내부 오류로 읽힘.
- 토스트: "Internal server error" (E9001 메시지) — **조치 불가 문구**.
- 소스 행(한 줄 아래): Notion 원문 + Connections 안내 — 실제 조치는 여기에만 있음.

## 3. 원인 판정

| 층 | 판정 |
|---|---|
| 운영(1차 원인) | **FAQ 페이지 미공유.** 10/16 토큰이 "HA-UserGuide" 통합으로 교체되었고, 이 통합엔 페이지 1건만 연결됨. hotel-go2joy.notion.site 는 *웹 공개(Publish)* 페이지인데, **웹 공개는 API 접근 권한을 주지 않는다** — 통합 연결(Connections)이 별도로 필요 |
| 코드(2차 — 보고 품질) | 어댑터의 사용자 조치형 실패(미공유·휴지통·토큰 거부·토큰 미등록)가 **500으로 분류**됨. 2026-08-28 B1은 "행에 사유 저장"만 했고 **HTTP 응답/토스트는 손대지 않았다** |
| 코드(3차 — 관측) | 로깅 인터셉터가 `err.status`를 신뢰 → 외부 API 상태코드가 우리 응답 상태로 둔갑. "4xx는 서버 로그 미기록"(CLAUDE.md) 원칙과 결합하면 "로그엔 404, 응답은 500, 스택은 ERROR"로 세 군데가 다 다르게 말함 |

**부수 발견**: 소스 7(`8968fee0…`)은 상태가 `ok`지만 현 통합으로는 404 → 다음 동기화 때 실패 예정.
현 통합에 보이는 `bfb56ba4…`가 같은 제목의 페이지라 **대상이 이동/복제되었거나 공유가 그 페이지에만 된 것**으로 보임.
토큰 교체가 기존 소스의 접근성을 깨뜨려도 콘솔은 과거의 `ok`를 보여준다(§6 선택 항목).

## 4. TO-BE

1. **운영**: go2joy → Notion에서 FAQ 페이지(및 하위 페이지가 대상이면 상위에서) ⋯ → Connections → "HA-UserGuide" 추가 → 콘솔 [동기화]. 소스 7도 같은 조치 또는 대상 ID를 `bfb56ba4…`로 수정.
2. **API**: 동기화 실패를 **원인별 에러코드 + HTTP 상태**로 응답. 사유(Notion/Drive 원문)는 `details.reason`으로 동봉.
3. **콘솔**: 토스트가 에러코드로 로컬라이즈된 제목 + 사유를 보임(수동 닫기). 미공유 코드에는 Connections 안내를 병기. 소스 행 표시는 현행 유지.
4. **로그**: 접근 로그의 상태 = 실제 응답 상태. 사용자 조치형 실패는 `warn` 1줄(스택 없음).

## 5. 갭 분석

| # | 갭 | 현재 | 목표 | 우선 |
|---|---|---|---|---|
| G1 | 사용자 조치형 실패가 500 | 일반 Error → E9001/500 | `BusinessException`(E5095~E5097) + 422/502 | **P1** |
| G2 | 토스트가 "Internal server error" | 에러코드 미활용 | 코드별 i18n 제목 + `details.reason` 사유 + 미공유 시 Connections 안내 | **P1** |
| G3 | 접근 로그 상태 오기록 | `err.status` 신뢰 | `HttpException.getStatus()` 외엔 500 | **P1**(동반 소수정) |
| G4 | 실패마다 ERROR 스택 | 필터 else 분기 | G1로 자동 해소(HttpException 경로) — 추가로 `syncSource`에서 `warn` 1줄 | P2 |
| G5 | 토큰 교체 후 기존 소스 상태 stale | 없음 | (선택) 자격증명 저장 시 해당 provider 소스 재검사·표시 | P3 — 본 건 범위 밖, 기록만 |
| G6 | 웹 공개 페이지=API 접근 아님을 모름 | 소스 추가 모달 콜아웃에 없음 | 모달 힌트 한 줄 추가(notion.site 주소 감지 시) | P2 |

## 6. 제약·전제

- Notion API는 통합에 **명시적으로 연결된** 페이지/DB만 노출한다. 웹 공개(notion.site)·링크 공유는 무관. 공개 페이지를 HTML로 긁는 대안은 구조 불안정·약관 문제로 **채택하지 않음**.
- 스키마 변경 없음. 에러코드는 `E5095`부터 순차 할당(현재 마지막 E5094).
- 기존 테스트 `knowledge.service.syncerror.spec.ts`의 "원래 에러를 그대로 전파" 케이스는 **BusinessException + details.reason 보존**으로 계약이 바뀐다 — PLN에서 명시.
- 콘솔 `api-client` 래핑 에러는 `status`/`code`만 싣고 `details`는 버린다 → 사유 전달에 `details` 노출 필요.

## 7. 사용자 플로우 (TO-BE)
```
[동기화] 클릭
  ├─ 성공 → 초록 토스트(현행)
  ├─ 미공유/휴지통/ID 불일치 → 422 E5095
  │     빨간 토스트: "노션 대상에 접근할 수 없습니다" + 사유 원문 + "Notion ⋯ → Connections → 통합 추가"
  ├─ 토큰 거부/미등록        → 422 E5096  토스트: "연동 자격증명이 유효하지 않습니다" + 사유
  └─ 429 초과/타임아웃/5xx   → 502 E5097  토스트: "외부 서비스가 응답하지 않습니다" + 사유
소스 행: 빨간 시각 + 사유 + 안내(현행 유지)
```
