# PLN-261007 — AI 엔진 사용 상태 · 플랫폼 엔진 선택 · 연결 테스트/크레딧 부족 안내

- 근거: [REQ-261007-AI-Engine-Status](../analysis/REQ-261007-AI-Engine-Status.md)
- 범위: G1~G7. **UI 변경 있음**(§3 와이어프레임). **스키마 변경 있음**(§2 S1).
- 상태: **승인 대기** — 승인 전 구현하지 않는다.

---

## 1. 설계 요약

```
            ┌──────────── 실제 호출 (AiGatewayService.complete) ────────────┐
            │ 성공 → engine.last_ok_at   (엔진당 60초에 1회만 기록)          │
            │ 실패 → engine.last_error_at / reason / detail (항상 기록)       │
            │        reason = classifyFailure(provider error)  ← credit 추가 │
            └──────────────────────────────┬─────────────────────────────────┘
                                           │ (await 안 함, 실패 무시)
   연결 테스트(테넌트·어드민 공통) ────────┤ 결과도 같은 열에 기록
                                           ▼
                    ai_engines.last_* (S1)  +  ai_usage_daily(오늘 calls/failures)
                         │                                │
        ┌────────────────┴───────────┐        ┌──────────┴────────────────┐
        │ GET /tenants/me/ai-status   │        │ GET /ai-engines (어드민)    │
        │  기능별 실효 엔진+상태       │        │  엔진별 상태+테넌트+오늘 수   │
        └────────────────────────────┘        └───────────────────────────┘
```

상태 판정(순수 함수 `engineHealth`):

| 조건 | 상태 |
|---|---|
| provider = stub | `stub` (AI 꺼짐) |
| 키 없음 | `no_key` |
| last_error_at > last_ok_at | 그 실패의 `reason`: `credit` / `auth` / `model` / `rate_limit` / `unreachable` |
| last_ok_at 있음 | `ok` |
| 둘 다 없음 | `unknown` (아직 호출·테스트 없음) |

---

## 2. 단계별 작업

### S1 — 엔진 상태 열 (스키마)
- `sql/migration_ai_engine_health.sql`(멱등):
  `ai_engines` + `last_ok_at DATETIME NULL`, `last_error_at DATETIME NULL`, `last_error_reason VARCHAR(24) NULL`, `last_error_detail VARCHAR(255) NULL`
- 엔티티 `ai-engine.entity.ts`: nullable 열은 `type` 명시(부팅사 방지, A-1) → **로컬 실부팅 확인**
- `npm run migrations:manifest` 갱신. 스테이징은 **배포 전 SQL 선적용**(`DB_SYNCHRONIZE=false`)

### S2 — 실패 사유 분류 + 어댑터 오류 본문 (G2)
- `classifyTestFailure` → `classifyEngineFailure`로 일반화하고 **`credit`** 를 추가한다(가장 먼저 검사):
  `credit balance is too low` · `insufficient_quota` · `exceeded your current quota` · `billing`
- `AnthropicAdapter`/`OpenAiAdapter`: 던지는 오류를 `Anthropic API error 400: invalid_request_error — Your credit balance is too low…`로 바꾼다
  (`redactSecrets`, 200자). 로그는 지금처럼 남긴다.
- 테넌트 화면 `testFail.*`와 어드민에 `credit` 문구를 추가한다(6개 언어).

### S3 — 상태 기록 (G1)
- `EngineHealthService.record(engineId, outcome)`: 성공은 엔진당 60초 스로틀(메모리 Map), 실패는 항상 기록한다. `await` 없이 호출하고 오류는 삼킨다.
- 호출 지점: `AiGatewayService.complete()`의 성공/실패 분기(엔진 id가 있는 경우만, 스텁 제외) + 연결 테스트(테넌트·어드민).
- `engineHealth()` 순수 함수(§1 표).

### S4 — 어드민 API (G3)
- `GET /ai-engines` 응답 확장: `tenantId`, `tenantSlug`, `health`, `lastOkAt`, `lastErrorAt`, `lastErrorReason`, `lastErrorDetail`, `todayCalls`, `todayFailures`
- `POST /ai-engines/:id/test` (`@AdminOnly`) — 테넌트 테스트 로직을 엔진 단위로 추출해 공유. 플랫폼·테넌트 엔진 모두 테스트할 수 있다.
- 감사 로그: 어드민 테스트는 `AuditService.write`(타 테넌트 자원 접근).

### S5 — 테넌트 API (G4·G5)
- `GET /tenants/me/ai-status`: 기능별 `{func, engine{id,name,provider,model,owner}, source, health, lastErrorReason, lastErrorAt}` + 오늘 `calls/failures`
  (기존 `aiSettingService.list` + `resolveRouting` 재사용)
- `PUT /ai-settings` (일괄): `{engine_id}` → 6개 기능에 한 번에 적용(트랜잭션). 엔진 검증은 기존 upsert와 같다(내 엔진 또는 플랫폼, `status=enabled`, **스텁 거부**).
  개별 지정은 기존 `PUT /ai-settings/:function`을 그대로 쓴다.
- 선택 가능한 플랫폼 엔진: D1 결정에 따른다.

### S6 — 테넌트 화면 (G4·G5·G7) — `AiEngineCard` 재구성
- 상단 **사용 상태 요약** + **엔진 선택 적용** + 기능별 상세(접힘) — §3-1
- 내 엔진 행에 상태 배지, 플랫폼 엔진 행에 "선택" 버튼
- 크레딧 부족 안내 문장 + [플랫폼 엔진으로 전환] 바로가기
- 저장/적용/테스트 모두 토스트(성공 자동 닫힘, 오류 수동 닫힘)

### S7 — 어드민 화면 (G3) — `AiEnginesPage`
- 열 추가: 소유(플랫폼/테넌트명) · 상태 배지 · 마지막 성공/실패 · 오늘 호출/실패 · [연결 테스트]
- 상단 **크레딧 부족 배너**(해당 엔진 목록 + 조치 안내)
- 필터: 전체/플랫폼/테넌트, 이상만 보기 — §3-2

### S8 — 폼 방어 (G6)
- 키 입력: `autoComplete="new-password"` + `data-1p-ignore` / `data-lpignore="true"`. endpoint: `autoComplete="off"` + `type="url"`
- 서버 DTO: `endpoint`는 `@IsUrl({ require_protocol: true })`(빈 값 허용). 키는 프로바이더 접두 경고(`anthropic`→`sk-ant-`, `openai`→`sk-`)를 **경고만** 한다(차단 안 함 — 프록시 키 예외)

---

## 3. 와이어프레임

### 3-1. 테넌트 `/settings/basic` — AI 엔진 카드

```
┌─ AI 엔진 ─────────────────────────────────────────────────── [+ 엔진 추가] ┐
│                                                                            │
│ ┌ 현재 AI 사용 상태 ─────────────────────────────────────────────────────┐ │
│ │ ⚠ 크레딧 부족 — 고객 응답이 처리되지 않고 있습니다                       │ │
│ │   사용 중: Claude (go2joy) · 내 엔진 · anthropic / claude-opus-4-8      │ │
│ │   마지막 성공 10/06 13:03 · 마지막 실패 10/06 19:06                       │ │
│ │   오늘 호출 591 · 실패 365                                               │ │
│ │   Anthropic 계정 크레딧을 충전하거나(Plans & Billing ↗),                  │ │
│ │   아래에서 플랫폼 엔진으로 전환하세요.   [플랫폼 엔진으로 전환]           │ │
│ │                                                                          │ │
│ │   ▸ 기능별 상세                                                          │ │
│ │     고객 응답(chat)     Claude (go2joy)   내 엔진   ⚠ 크레딧 부족         │ │
│ │     지식 답변(rag)      Claude (go2joy)   내 엔진   ⚠ 크레딧 부족         │ │
│ │     모더레이션          Claude (go2joy)   내 엔진   ⚠ 크레딧 부족         │ │
│ │     요약 · 상담 보조 · 코칭 …                          [기능별 변경]      │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│ 사용할 엔진  [ Anthropic Claude · 플랫폼 · ● 정상        ▾ ]  [모든 기능에 적용] │
│              ├ Claude (go2joy) · 내 엔진 · ⚠ 크레딧 부족                      │
│              ├ Anthropic Claude · 플랫폼 · ● 정상                             │
│              └ chatGPT · 플랫폼 · ○ 미확인                                    │
│              ⓘ 플랫폼 엔진 사용료는 서비스 운영자 계정으로 청구됩니다(D1)        │
│                                                                            │
│ 내 엔진                                                                     │
│  Claude (go2joy)  anthropic / claude-opus-4-8  ⚠ 크레딧 부족  [기본값]        │
│                                         [연결 테스트] [편집] [삭제]            │
│ 플랫폼 제공                                                                  │
│  🔒 Anthropic Claude  anthropic / claude-opus-4-8  ● 정상          [선택]      │
│  🔒 chatGPT           openai / gpt-5               ○ 미확인        [선택]      │
└────────────────────────────────────────────────────────────────────────────┘

정상일 때 요약:  ● 정상 — 고객 응답: Anthropic Claude (플랫폼) · 오늘 호출 128 · 실패 0
스텁일 때 요약:  ○ AI 꺼짐 — 연결된 엔진이 없어 기본 응답만 나갑니다. 엔진을 선택하세요.
```

### 3-2. 어드민 `/admin/ai-engines`

```
┌ AI 엔진 ─────────────────────────────────────────────────────── [+ 엔진 추가] ┐
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ ⚠ 크레딧 부족 엔진 1개 — 해당 엔진을 쓰는 기능의 응답이 실패하고 있습니다  │ │
│ │   · Claude (go2joy) — 테넌트 go2joy — 마지막 실패 10/06 19:06            │ │
│ │   프로바이더 콘솔에서 충전하거나, 테넌트를 플랫폼 엔진으로 전환하세요.     │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ [전체 ▾] [플랫폼] [테넌트]   ☐ 이상만 보기                                    │
│                                                                              │
│ 이름              소유      프로바이더/모델            상태         마지막 성공   마지막 실패   오늘(호출/실패)        │
│ ───────────────── ───────── ────────────────────────── ──────────── ───────────── ───────────── ──────────── ───────── │
│ Anthropic Claude  플랫폼    anthropic/claude-opus-4-8  ● 정상       10/07 09:12   —             42 / 0   [테스트][편집][비활성] │
│ chatGPT           플랫폼    openai/gpt-5               ○ 미확인     —             —             0 / 0    [테스트][편집][비활성] │
│ Built-in Stub     플랫폼·기본 stub/stub-1              ◌ 스텁       —             —             —        [편집]            │
│ Claude (go2joy)   go2joy    anthropic/claude-opus-4-8  ⚠ 크레딧 부족 10/06 13:03   10/06 19:06   591 / 365 [테스트][편집][비활성] │
│    └ 사유: invalid_request_error — Your credit balance is too low…             │
│                                                                              │
│ 테스트 결과(토스트): ✓ 연결 성공 (412ms)  /  ⚠ 크레딧 부족 — 충전이 필요합니다   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 부작용·영향

| 영역 | 영향 | 대응 |
|---|---|---|
| 응답 지연 | 상태 기록 DB 쓰기 | 비동기·스로틀(성공 60초/엔진), 실패만 즉시 기록 |
| 스키마 | `ai_engines` 열 4개 추가 | 멱등 SQL, 스테이징·프로덕션 선적용, 롤백=열 DROP(코드 revert 후) |
| 시크릿 | 오류 요약이 화면에 나간다 | `redactSecrets` + 200자. 키는 응답에서 계속 `hasKey`만 |
| 비용 | 테넌트가 플랫폼 엔진을 고르면 Amoeba 과금 | D1 |
| 기존 연결 테스트 | 분류 함수 일반화 | 기존 스펙 유지 + `credit` 케이스 추가 |
| 테넌트 기능별 지정 | 일괄 적용이 기존 개별 지정을 덮어쓴다 | 확인 모달("6개 기능 모두 변경") |
| 어드민 테스트 | 테넌트 키로 호출(과금 1토큰) | 감사 로그 |

## 5. 테스트 계획 (TCR에서 상세화)
- 단위: `classifyEngineFailure`(credit 문구 4종·기존 4종), `engineHealth`(표 6행), 상태 기록 스로틀, 일괄 적용(스텁·비활성·타 테넌트 엔진 거부)
- 통합(스테이징): go2joy 엔진 5 = 크레딧 부족 실상태로 **어드민 배너·테넌트 요약에 `credit` 표시** 확인 → 플랫폼 엔진 일괄 적용 → 상태 `ok` 전환 확인
- 부팅: 엔티티 변경 후 로컬 실부팅 `successfully started`
- i18n: `npm run i18n:check`

## 6. 결정 필요
- **D1. 테넌트가 고를 수 있는 플랫폼 엔진** — 권장: 어드민 엔진에 **"테넌트 선택 허용"** 스위치를 추가한다(기본 꺼짐, 열 1개 추가).
  꺼진 엔진은 테넌트 목록에 "운영자 승인 필요"로만 보인다. 대안: 활성 플랫폼 엔진이면 모두 선택 가능(현재 API 동작, 과금 통제 없음).
- **D2. 크레딧 부족 알림** — 권장: 이번 범위는 화면 표시만. 이메일·Slack 알림은 후속(기존 알림 파이프라인 재사용).
- **D3. go2joy 즉시 복구** — 이 PLN과 별개로, 지금 엔진 5의 잘못된 endpoint와 키를 비울지, 플랫폼 엔진으로 임시 전환할지(과금 귀속).
- **D4. 범위 밖 FIX 병행** — 폴백 스텁 응답을 고객에게 보내지 않고 핸드오프 + 모더레이션 실패 시 차단. 권장: 이 PLN과 병행한다(별도 FIX 문서).

> 승인 후 S1→S8 순으로 구현한다. 예상 변경: API 8~10개 파일 + SQL 1, 웹 4~5개 파일 + 6개 언어 locale.
