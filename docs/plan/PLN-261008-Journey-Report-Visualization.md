# PLN-261008 — 고객여정 리포트 시각화

- 근거: `docs/analysis/REQ-261008-Journey-Report-Visualization.md` (시안 A·B·C 분석, F1~F8)
- 상태: **승인 대기** — 승인 전 구현 착수 금지
- 관련: PLN-260825 고객여정분석 리포트, PLN-261006 고객여정관리(할 일·5A 단계)

## 1. 결정 (REQ §6 권장안 — 이견 있으면 이 표만 고치면 됨)

| # | 결정 | 내용 |
|---|------|------|
| D1 | 구조화 방식 | 모델이 **JSON**을 반환, 코드가 스키마 검증. 실패 시 1회 재시도 → 그래도 실패면 Markdown 본문만 저장(`ready`, 구조 없음) |
| D2 | 시안 A 위치 | 테넌트 메인 대시보드 아님 — **리포트 모달 상단 요약** (리포트는 그룹 단위) |
| D3 | 값 상태 | 4종: `measured` · `not_applicable`(분모 0) · `not_measured`(계측 없음) · `not_observable`(채널상 관측 불가) — **코드가 판정** |
| D4 | 감정 곡선 | 제외 |
| D5 | Appeal | 위젯 Browse 이벤트가 있으면 "이벤트 N건 관측", 상담 발화로는 판정 안 함 |
| D6 | 단계 | P1 정정+숫자 렌더 → P2 구조화+본문 → P3 여정 맵+인쇄 (각 단계 독립 PR·배포 가능) |
| D7 | 비교 리포트 | 범위 밖 — Markdown 유지(이제 렌더링은 됨) |

## 2. 단계

### P1 — 결함 정정 + 숫자 요약 (백엔드 소폭, SQL 0건)

이미 API로 내려오는 `metrics`를 화면에 그린다. 시안 A의 대부분이 이 단계에서 나온다.

**백엔드**
1. `JourneyMetrics` 정정
   - `agentMessages` → `aiMessages` + `humanMessages` 분리(F6). 기존 필드는 합계로 유지(과거 리포트·프롬프트 호환)
   - `avgLoops`: 대화 0건이면 `null`(F7)
   - `stages5a`: 6단계→5A 대응표로 재집계(T10) — 대응표는 `journey-stage-map.ts` 한 곳.
     Awareness→aware, Browse→appeal, Inquiry→ask, Purchase·Delivery→act, Post→advocate(후보 — 리뷰 작성은 옹호의
     **신호**이지 판정이 아니므로 화면에 "후보"로 표기)
2. **값 상태 판정** `journey-value-state.ts` — 매퍼가 응답에 `metricStates: Record<key, state>`를 붙인다(저장 안 함 → 과거 리포트에도 적용).
   예: `medianResolutionMinutes=null ∧ resolved=0` → `not_applicable`, `resolved>0 ∧ 전부 ended_at 없음` → `not_measured`,
   `csatResponses=0` → `not_applicable`, Aware 단계 → `not_observable`
3. 인용 잘림 표시(F2): `sampleUtterances()`가 자를 때 `…` 부착 + 프롬프트에 "`…`로 끝나는 인용은 잘린 것 — 문장 완결로 쓰지 말 것"
4. 칩·시나리오 턴 CJM Inquiry 발행(F3/T11): `ScenarioService.handle()`의 고객 턴 저장 지점에서 `ChatService`와 같은 페이로드 발행.
   릴레이 인바운드 경로는 조사만 하고 결과를 RPT에 기록(누락이 확인되면 같은 방식)
5. `GROUND_RULES` 문구: "Aware and Appeal are not observable from support **conversations alone**" + Browse 이벤트는 METRICS로 전달

**프런트**
6. 본문 Markdown 렌더링: `MDEditor.Markdown`(이미 의존성 있음) — `whitespace-pre-wrap` 텍스트 출력 대체
7. 모달 상단 요약 `JourneyReportSummary` — KPI 타일 6개 + 해결 상태 바 + 메시지 구성 바 + 5A 띠

```
┌─ 고객여정분석 리포트 ──────────────────────────────────────────── [인쇄] [×] ┐
│ 기간 2026-08-25~08-26 · 세션 2 · 기준 v1 · claude-…                          │
│ ┌────────┬────────┬────────┬────────┬────────┬────────────┐                  │
│ │ 대화   │ 메시지  │ 해결률  │ 평균루프│ 핸드오프│ 해결 중앙값 │                  │
│ │   2    │   5    │  0%    │  1.5   │   0    │    —       │                  │
│ │ 위젯100%│고객2·AI2│ 미해결2 │        │        │[해당 없음]  │ ← 상태칩          │
│ │        │ ·사람1  │        │        │        │ 해결 0건    │   (tooltip=사유)  │
│ └────────┴────────┴────────┴────────┴────────┴────────────┘                  │
│ 해결 상태  ██████████████████████ 미해결 2  (열림 2)                          │
│ 5A  [인지 관측불가][호감 관측불가][문의 ●2][행동 근거없음][추천 근거없음]       │
│ ───────────────────────────────────────────────────────────────────────── │
│ (본문 Markdown 렌더링 — P2에서 구조화 본문으로 교체)                           │
└──────────────────────────────────────────────────────────────────────────────┘
```
상태칩 4색: 측정(없음 — 값만), 해당 없음(회색), 미측정(주황), 관측 불가(점선 회색). 0은 숫자 0으로, null은 반드시 칩으로.

### P2 — 리포트 구조화 + 진단 본문 (SQL 1건)

**데이터**
- `journey_reports.content_json JSON NULL` 추가 — `sql/2610xx-journey-report-content.sql`, 엔티티 `@Column({ name: 'content_json', type: 'json', nullable: true })`.
  NULL = 구조 없는 리포트(과거분·구조화 실패분) → 화면은 Markdown 폴백
- 스키마(`journey-report-content.ts`, 수동 검증 함수 — 의존성 추가 없음):

```ts
{
  headline: string;                    // 결론 한 문장
  subline?: string;                    // 우선순위·판단 불가 항목
  questions: { text: string; count: number; quoteIds: number[]; answered: 'answered'|'unanswered'|'escalated' }[];
  quotes: { id: number; sampleIndex: number; text: string; who: 'user'|'ai'|'agent'; at: string; truncated: boolean }[];
  stages: { key: 'aware'|'appeal'|'ask'|'act'|'advocate'; customer?: string; response?: string; pain?: string; opportunity?: string }[];
  hypotheses: { layer: string; quoteId: number; hypothesis: string; disproveIf: string }[];
  dataFlags: { text: string; section: string }[];
  actions: { title: string; successCriterion: string; section: string; urgency: 'now'|'week'|'improve' }[];
}
```
- 값·상태는 JSON에 넣지 않는다 — 숫자는 `metrics_json`, 상태는 P1 판정기. 모델은 문장만.

**생성 파이프라인** (`journey-report.service.ts`)
1. 프롬프트: 기존 섹션 지시 + "다음 JSON 스키마로만 응답" + SAMPLES에 **번호** 부여(`[#12]`) → 모델은 인용을 `sampleIndex`로 지목
2. **근거 검증(코드)**: `quotes[].text`는 `samples[sampleIndex].text`로 **덮어씀**(모델이 옮겨 쓴 문장을 믿지 않음),
   범위 밖 index·없는 quoteId를 참조하는 항목은 제거하고 `dropped` 수를 metrics 옆에 기록.
   `questions[].count`는 SAMPLES 안 정규화 문장 일치 수로 **코드가 다시 셈**(모델 값 무시) — 화면 표기는 "샘플 내 N회"
3. 모더레이션: JSON의 **문자열 필드마다** `moderate()` — 하나라도 BLOCKED면 리포트 실패(현행과 동일 원칙), 마스킹된 텍스트는 그 필드에 반영
4. `body_md`는 계속 생성(JSON → Markdown 직렬화) — 비교 리포트·과거 호환·내보내기 원천
5. `maxTokens` 4000 → 실측 후 결정(첫 3건 사용량을 RPT에 기록)

**화면** — P1 요약 아래 진단 본문(시안 C)

```
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ 질문에는 답했지만, 대화 2건 모두 닫히지 않았고 같은 배송 질문이 하루 뒤    │ │
│ │ 다시 들어왔습니다.                                                         │ │
│ │ 대화 종료와 반복 원인 확인이 우선입니다.                       (headline)  │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ 질문과 응답                                                                   │
│  ▸ How long does shipping take?   샘플 내 2회 · 답변함                       │
│    ┃ "Orders ship within 1–2 business days, and standard US…" [잘림] AI·08-25 │
│ 니즈 가설 (단정하지 않음)                                                     │
│  ┌ 가설 1 ───────────────┐ ┌ 가설 2 ───────────────┐                         │
│  │ 근거  "How long…"      │ │ 근거  (상담 발화)      │                         │
│  │ 가설  수령 시점 확실성 │ │ 가설  도착 시간 유연성 │                         │
│  │ 반증  대기 주문 없음   │ │ 반증  필수 요건이었다면│                         │
│  └───────────────────────┘ └───────────────────────┘                         │
│ 데이터 품질 플래그                                                            │
│  ① 칩으로 보낸 질문이 문의 단계로 기록되지 않음 (§경로)                      │
│ 다음 조치                                                                     │
│  01 미해결 2건 배정·종료   성공: open 0   §해결   [긴급]   [+ 할 일]          │
│  02 반복 질문 고객 식별    성공: 동일/신규 판별 §질문 [이번 주] [+ 할 일]     │
│ ── 원문 보기 ▾ (body_md 접힘) ──                                             │
```
- [+ 할 일] → 기존 `addTask({ title, source: 'report', report_id })` 재사용, 성공/실패 토스트. 이미 추가된 조치는 [추가됨] 비활성
  (같은 report_id·title 할 일 존재 여부로 판정 — 별도 컬럼 없음). 드래그 선택 방식은 "원문 보기"에서 유지
- 검증에서 제거된 항목이 있으면 헤드라인 아래 회색 한 줄: "근거를 확인할 수 없는 항목 N개를 표시하지 않았습니다"

### P3 — 여정 맵 탭 + 인쇄 (SQL 0건)

- 모달에 탭 [리포트 | 여정 맵]. 여정 맵 = `stages[]` + `metrics.stages5a` + 값 상태로 그린 5A × 레인 표(시안 B, 감정 곡선 제외)

```
┌───────────┬──────────┬──────────┬─────────────────────┬──────────┬──────────┐
│           │ 인지      │ 호감      │ 문의 ●               │ 행동      │ 추천      │
├───────────┼──────────┼──────────┼─────────────────────┼──────────┼──────────┤
│ 관측 상태  │[관측 불가]│[관측 불가]│ 이벤트 2 · 인용 2    │[근거 없음]│[근거 없음]│
│ 고객 발화  │    —     │    —     │ "How long does…" ×2 │    —     │    —     │
│ 응답       │    —     │    —     │ 출고 1–2영업일 …     │    —     │    —     │
│ 니즈 가설  │    —     │    —     │ 수령 시점 확실성     │    —     │    —     │
│ 페인/기회  │ 유입 태깅 │    —     │ 답변 후 미종료        │ 구매 연동 │ CSAT 수집│
└───────────┴──────────┴──────────┴─────────────────────┴──────────┴──────────┘
  좁은 화면(<640px): 단계별 세로 카드로 전환
```
- 인쇄: [인쇄] 버튼 → `window.print()` + `@media print` 스타일(모달 크롬·버튼 숨김, 리포트 탭 C 레이아웃, 표 페이지 분할 방지).
  PDF 라이브러리 도입 없음 — 브라우저 "PDF로 저장"
- 공통 컴포넌트 `apps/web/src/domain/journey/report/`: `KpiTile`, `ValueStateChip`, `StageStrip`, `QuoteCard`, `HypothesisCard`, `ActionItem`, `JourneyMapTable` — 차트 라이브러리 없이 Tailwind/SVG

## 3. 영향 분석

| 영역 | 영향 | 대응 |
|------|------|------|
| 과거 리포트(스테이징 7건, 프로덕션) | P1 상태칩·5A 띠는 저장된 `metrics_json`으로 즉시 적용(단 `aiMessages`·`stages5a` 없음 → 합계·6단계에서 매퍼가 파생). 본문은 `content_json` NULL → Markdown | 매퍼 폴백 + 스펙 |
| 비교 리포트 | 입력 `metrics`에 새 필드가 생김 — 프롬프트는 JSON 그대로 전달하므로 무해 | 회귀 스펙 1건 |
| 프롬프트 규칙 테스트(`journey-prompt.spec`) | 문구 변경(GROUND_RULES·JSON 지시) | 스펙 갱신 — 규칙 문장 존재를 검증하는 기존 방식 유지 |
| `ScenarioService` CJM 발행 | 칩 탭마다 cjm_events 1행 증가. 통계·고객 다이어리(`/me/journey`)에 Inquiry가 더 보임 — **정정 방향** | 통계 Inquiry 수치가 배포일 기준 계단 상승 → RPT에 명시 |
| 모더레이션 | 리포트 1건당 moderate 호출 1회 → 필드 수(~20~40)회. 규칙 기반이면 비용 미미, AI 모더레이션 테넌트는 호출 증가 | 문자열 필드를 **한 번에 묶어 1회** 검사 후 필드별 마스킹 매핑이 가능한지 P2 착수 시 확인 — 불가하면 필드별 |
| AI 토큰 | JSON 출력으로 증가 | 첫 3건 실측 → `maxTokens` 결정 |
| DB | P2에서 `content_json` 1컬럼(nullable) | `sql/` 선적용(스테이징→프로덕션), `migrations:manifest`, PR `## Migration` |
| i18n | `journey` 네임스페이스 키 추가(상태칩 4·레인 5·섹션명·인쇄·조치 긴급도) × 6개 언어 | `npm run i18n:check` |
| 권한 | 기존 리포트 열람 권한 그대로, 새 API 없음(P2 할 일은 기존 API) | — |
| 오류 코드 | 신규 없음 예상(구조화 실패는 폴백이지 오류 아님). 필요 시 E5095~ | — |

## 4. 테스트 계획 (TCR에서 상세화)

- 값 상태 판정기: null/0/분모 0/ended_at 없음/Aware·Appeal 각 경우 → 기대 상태 (단위)
- 5A 대응표: 6단계 전부 매핑, 미지 단계는 무시(단위)
- 근거 검증: 범위 밖 sampleIndex 제거, 모델이 바꿔 쓴 인용 → 원문으로 덮어씀, count는 코드 재계산(단위 — **바꿔 쓴 문장으로** 테스트, 원문 복사로는 결함이 통과함)
- JSON 파싱 실패 → 재시도 → Markdown 폴백, 모더레이션 BLOCKED 필드 → 리포트 failed
- 시나리오 턴 → cjm_events Inquiry 1행(단위 + 스테이징 실측)
- 화면: 과거 리포트(구조 없음) / 신규 리포트 / 실패 리포트, 좁은 화면, 인쇄 미리보기
- 스테이징 실측: go2joy 그룹 9(세션 2005·2581)로 재생성 → 해결 중앙값이 "해당 없음", 메시지 "AI 2·사람 1", 인용 잘림 표시 확인

## 5. 일정 감

P1 0.5일 · P2 1~1.5일 · P3 0.5일 (+ 각 단계 스테이징 배포·실측)

## 6. 범위 밖 / 후속

- 테넌트 전체 고객여정 대시보드(시안 A의 "콘솔 메인" 해석) — 별도 요청
- 비교 리포트 구조화
- 감정 곡선·감성 분석
- 상위 질문의 전체 대화 기준 빈도(현재는 샘플 내 빈도) — 질문 군집화가 필요해 별도
- 릴레이 채널 Inquiry 누락 수정 — P1에서 조사 결과에 따라 별도 FIX 가능
