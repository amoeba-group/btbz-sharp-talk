# RPT-261007 — AI 엔진 사용 상태 · 플랫폼 엔진 선택 · 연결 테스트/크레딧 부족 안내

- [REQ](../analysis/REQ-261007-AI-Engine-Status.md) · [PLN](../plan/PLN-261007-AI-Engine-Status.md)(2026-10-07 승인, D1~D4 권장안) · [TCR](../test/TCR-261007-AI-Engine-Status.md)

## 1. 변경

| 단계 | 내용 |
|---|---|
| S1 | `ai_engines` +`last_ok_at`·`last_error_at`·`last_error_reason`·`last_error_detail`·`tenant_selectable` (`sql/261007-ai-engine-health.sql`) |
| S2 | `engine-health.ts`: 실패 분류에 **credit** 추가(credit 우선), 상태 판정 `engineHealth`, 어댑터(Anthropic/OpenAI)가 프로바이더 오류 `type: message`를 마스킹해 함께 던짐 |
| S3 | 게이트웨이 `recordHealth` — 실호출 성공(엔진당 60초 스로틀)/실패(항상)를 비동기 기록. 연결 테스트도 기록 |
| S4 | 어드민 `GET /ai-engines`: 소유(테넌트 slug)·상태·마지막 성공/실패·오늘 호출/실패. `POST /ai-engines/:id/test`(감사 `ai_engine.tested`) |
| S5 | 테넌트 `GET /tenants/me/ai-engines/status`(기능별 실효 엔진·상태·오늘 수), `PUT /ai-settings`(6개 기능 일괄). 선택 규칙 `assertSelectable`: 자기 엔진 또는 `tenant_selectable` 플랫폼 엔진·활성·스텁 불가 — 기능별 지정에도 적용 |
| S6 | 테넌트 `AiEngineCard`: 사용 상태 요약(고객 대면 기능 중 최악 상태)·조치 문구·[플랫폼 엔진으로 전환]·기능별 상세·엔진 선택 적용(확인)·행별 상태 배지·실패 사유 |
| S7 | 어드민 `AiEnginesPage`: 소유·상태·마지막 성공/실패·오늘 열, 연결 테스트, 크레딧 부족/응답 불가 배너, 필터(전체/플랫폼/테넌트/이상만), 플랫폼 엔진 "테넌트 선택 허용" 토글. 하드코딩 영문 토스트 → i18n |
| S8 | 엔진 폼 `autoComplete="new-password"`·`data-1p-ignore`·`data-lpignore`, endpoint `type=url` + 서버 `@IsUrl`, 키 접두 경고 |
| D4 | 게이트웨이 폴백 결과에 `degraded` → RAG 신뢰도 0(핸드오프)·비질문 답변 핸드오프·분류 fallback·**모더레이션 차단** |
| 공용 | `components/EngineHealthBadge.tsx`, 6개 언어 `settings.aiEngines.*`·`aiEngines.*` |

PLN과의 차이: 상태 API 경로를 `/tenants/me/ai-status` 대신 기존 컨트롤러 아래 `/tenants/me/ai-engines/status`로 두었다(권한·모듈 재사용).

## 2. 운영 조치 (D3)
- 2026-10-07 스테이징 go2joy 엔진 5: 브라우저 자동완성으로 들어간 `endpoint=fremd@naver.com`과 10자 키를 SQL로 비웠다.
  현재 `no_key` 상태다. 복구에는 go2joy의 실제 Anthropic 키 입력 + 크레딧 충전이 필요하다(go2joy 측 조치).
  키가 없는 동안 go2joy 대화는 D4에 따라 상담원 핸드오프로 간다.
- 플랫폼 엔진의 `tenant_selectable`은 전부 0(기본)이다. 테넌트 선택을 허용하려면 어드민 화면에서 켠다(과금 = 운영자 키).

## 3. 배포 상태

| 항목 | 상태 |
|---|---|
| PR | #593(REQ/PLN), #594(구현, squash `7905ef3`) |
| 스키마 | `sql/261007-ai-engine-health.sql` |
| 스테이징 | ✅ SQL 선적용 → 배포(2026-10-07 09:31 KST), 부팅 로그 정상, 신규 라우트 401, 상태 기록 동작 확인(TCR §2) |
| 프로덕션 | ✅ 2026-10-07 10:56 KST — SQL 선적용(열 5개 확인) → `production` ff `f47f0a4..bbdbea3` → `check-migrations` OK → `deploy-self-hosted.sh`. api/web/widget 재생성, 부팅 로그 정상(ERROR 0), 신규 라우트 401, dist에 `engine-health.js`, 공개 health 200. 프로덕션 Anthropic 엔진은 여전히 키가 없다(P3 미결) — 화면에는 `키 없음`으로 표시된다 |

## 4. 후속
- 화면 육안 확인(테넌트 카드·어드민 페이지) — 사람 확인 필요(TCR §3)
- D2 후속: 크레딧 부족·응답 불가 알림(이메일/Slack)
- 키 없는 테넌트 엔진이 env `ANTHROPIC_API_KEY`로 조용히 대체될 수 있는 기존 동작 점검(현재 스테이징·프로덕션 env 키는 비어 있어 미발생)
