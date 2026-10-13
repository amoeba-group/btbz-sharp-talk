# AI 기능 영향평가 게이트 — AI DPIA Gate (Doc-D)

| 항목 | 내용 |
|---|---|
| 문서 ID | GUIDE-AI-DPIA-Gate-20260731 |
| 작성일 | 2026-07-31 |
| 범위 | SharpTalk의 현행 및 신규 AI 기능 전부(완성·임베딩·분류 등 AI 게이트웨이를 경유하는 모든 처리) |
| 기준 | `reference/amoeba_privacy_compliance_v2.md` PRV-006/PRV-042(DPIA, 고위험 처리) · GDPR Art.22(자동화 결정) · CCPA/CPRA ADMT 규정 방향 · REQ-Privacy-Control-Gap-20260731 #8, #16 |
| 소유자 | 개인정보 보호책임자(TBD/지정 필요) · 기술 확인: 개발팀 |

---

## 1. 현행 AI 사용 처리기록 (2026-07-31 코드 기준)

| # | 용도 | 코드 근거 | 입력 데이터 | 출력·효과 | 사람 개입 |
|---|---|---|---|---|---|
| 1 | RAG 지원 답변 | `apps/api/src/domain/chat/rag.service.ts` `answer()` — `AI_FUNCTION.RAG`, 시스템 프롬프트 "Answer ONLY from the context…" | 사용자 메시지 + KB 스니펫(테넌트 스코프) + 테넌트 페르소나/규칙 | 챗봇 답변 텍스트(+인용) | 모더레이션 게이트 통과 후에만 전달; 컨텍스트 불충분 시 상담원 연결 안내 |
| 2 | 의도 분류 | `rag.service.ts` `classifyIntent()` — `AI_FUNCTION.CHAT`, JSON `{intent, needsOrderData, confidence}` | 사용자 메시지 | 주문 데이터 필요 여부 판단 → 미인증 시 본인확인 안내(`chat.service.ts` FN-015) | 파싱 실패 시 보수적 기본값(`needsOrderData:false`) |
| 3 | 신뢰도 기반 상담원 이관 | `chat.service.ts` `ESCALATION_CONFIDENCE = 0.45` + `rag.service.confidence()`(voyage 유사도 또는 히트 수 기반) | 검색 유사도/문서 수 | confidence < 0.45 → `handoff()` — **사람(상담원)에게 이관** | 자동화의 결과가 곧 사람 개입 확대(고객 불이익 아님) |
| 4 | 모더레이션 분류·재작성 | `apps/api/src/domain/moderation/moderation.service.ts` — 규칙(word/phrase/regex) + LLM context 분류(`AI_FUNCTION.MODERATION`), rephrase | AI/상담원 발신 예정 텍스트 | 차단/마스킹/재작성. **fail-safe: 오류 시 차단** — 미검열 전달은 불가(FR-069/POL-020) | 차단 시 상담원 이관 경로로 전환(`moderation_blocked` handoff) |
| 5 | 임베딩(검색) | `voyage.adapter.ts` + `qdrant.service.ts` | KB 문서·사용자 질의 원문 | 유사도 검색(개인에 대한 결정 없음) | — |

### 1.1 `feature:` 값 전수 점검 — 2026-10-13 (PLN-261012 SG-70)

위 표는 5개 용도만 적었으나, AI 게이트웨이 호출에 붙는 `feature:` 라벨은 코드에 **9종**이 있다
(`grep "feature: '"` 기준; 사용량 집계 `ai_usage_daily`와 감사의 키이기도 하다). 아래가 전수이며,
신규 `feature:` 추가 시 이 표에 행을 더한다(§4-3).

| # | `feature:` | 게이트웨이 function | 코드 근거 | 모델 입력(개인정보 관점) | 외부 전송 전 PII 마스킹 | 결과·효과 | 전적 자동화 결정? |
|---|---|---|---|---|---|---|---|
| 1 | `chat_answer` | `rag` | `chat/rag.service.ts` `answer()` | 마스킹된 사용자 메시지 + 마스킹된 직전 대화 + KB 스니펫 + (로그인 시) 서명된 파트너 맥락 `PARTNER_CONTEXT`(호텔명·hotelSn/코드·역할) + 주문 컨텍스트(연락처 제외, 자체 구성) | 예 — `chat.service.ts` `scrubPii`, `conversation-history.util.ts` | 답변(모더레이션 통과 후) | 아니오 |
| 2 | `chat_rewrite` | `rag` / `chat` | `rag.service.ts` `answerWithoutKnowledge()`(인사·범위 밖 응답) **과** `classifyIntent()`(의도 JSON) — 두 용도가 같은 라벨을 공유함에 유의 | 마스킹된 메시지 + 대화 이력 | 예 | 짧은 응답 / 분류 라벨(사람 연결·주문 게이트·파트너 데이터 판단) | 아니오(분류 결과가 사람 연결을 **늘릴** 뿐) |
| 3 | `moderation` | `moderation` | `moderation/moderation.service.ts` `contextFlagged()` + `rephrase()` | **발신 예정 텍스트**(AI 답변은 마스킹된 입력에서 파생, 상담원 작성분은 원문) | LLM 호출 입력은 마스킹하지 않음(로그 excerpt만 마스킹) | 차단/재작성. 오류 시 차단(fail-safe) | 차단은 상담원 연결로 전환됨 |
| 4 | `agent_translate` | `assist` | `agent/agent.service.ts` (상담원이 고객 메시지 번역 요청) | **고객 메시지 원문**(상담원이 버튼을 눌렀을 때만) | **아니오 — 갭** | 번역문(Redis 24h 캐시) | 아니오 |
| 5 | `agent_briefing` | `assist` | `agent/briefing.service.ts` (상담원이 대화 요약 요청) | **대화 원문 전체(최근 구간)** | **아니오 — 갭** | 요약·의도·감정·권고 | 아니오 |
| 6 | `coaching` | `coach` | `ai-coach/ai-coach.service.ts` (콘솔 관리자의 AI 코칭 대화) | 관리자가 붙여넣은 텍스트(마스킹) + 질문·인용 | 예(`scrubPii`) | 코칭 답변·KB 개선 제안(승인 전엔 반영되지 않음) | 아니오 |
| 7 | `journey_report` | `summary` | `journey/journey-report.service.ts` | 지표 + **마스킹된** 발화 표본 | 예(`scrubPii`, 길이 절단) | 여정 분석 보고서(모더레이션 통과) | 아니오 |
| 8 | `knowledge_conflict` | `chat` | `knowledge/kb-conflict.service.ts` | KB 문서 2건 발췌(고객 데이터 아님) | 해당 없음 | 충돌/중복 판정 → 운영자 검토 큐 | 아니오 |
| 9 | `knowledge_ingest` | `summary` | `knowledge/knowledge-ingest.service.ts` | 운영자가 올린 원본 문서(고객 데이터 아님) | 해당 없음 | KB 문서 초안 → 운영자 승인 | 아니오 |

**판정 갱신(2026-10-13):** 9종 모두 §1 판정(전적으로 자동화된 중대영향 결정 없음)을 그대로 유지한다.
다만 다음을 **갭으로 기록**한다 — 4·5번(`agent_translate`, `agent_briefing`)은 상담원이 명시적으로
누를 때만 호출되지만 고객 메시지 **원문이 마스킹 없이** 외부 AI 처리자로 전송된다. 3번의 상담원 작성분도
같다. 베트남 PDPL 배포에서는 국외이전 고지(`vn_pdpl` 프로필 `aiProcessor`/`crossBorder`)가 "메시지가
AI 제공자로 전송된다"고 말하므로, 이 경로를 마스킹하거나(후속 작업) Go2Joy 법무가 현행 범위를 승인해야 한다
(체크리스트 GUIDE-261013-Go2Joy-PDPL-Checklist.md §B-6). 향후 파트너 데이터 조회·도구 호출 루프(SG-31/33)가
들어오면 새 `feature:` 라벨과 함께 본 게이트(§2 Q1–Q8)를 다시 통과해야 한다.

### 판정 기록 (2026-07-31)

> **현행 AI 기능 중 정보주체에게 법적 효력을 갖거나 그에 준하는 중대한 영향을 미치는
> "전적으로 자동화된 결정"(GDPR Art.22 유형)은 없다.**
>
> 근거: ① 모든 결정의 최종 효과가 "답변 제공" 또는 "사람(상담원)에게 넘김"이며, 거래 거부·
> 가격 차등·계정 제재 등 불이익 처분이 없다. ② 낮은 신뢰도·모더레이션 차단은 서비스 축소가
> 아니라 인간 상담으로의 전환이다. ③ 동의를 거부한 세션의 메시지는 AI에 전달되지 않는다
> (`chat.service.ts` PRV-M4 분기 — 저장·처리 모두 차단).
>
> 단, 잔여 리스크로 **채팅 원문이 마스킹 없이 Anthropic/Voyage로 전송**되는 데이터 최소화
> 갭(Doc-A G-9)이 있으며 이는 자동화 결정 이슈가 아닌 전송 통제 이슈로 Doc-B에서 관리한다.

본 판정은 AI 기능 추가/변경 시마다 §2 게이트로 재평가한다.

## 2. 신규 AI 기능 게이트 체크리스트

모든 신규(또는 동작이 변경되는) AI 기능은 PLN 단계에서 아래 질문에 답해야 한다.

### 2.1 자동화 결정 여부 판정 질문

| # | 질문 | 예 → |
|---|---|---|
| Q1 | 이 기능의 출력이 사람 검토 없이 정보주체에 대한 **조치를 확정**하는가? (안내문 표시가 아니라 상태 변경·거부·차단) | Q6로 |
| Q2 | 출력이 개인의 **접근·자격·가격·순서**를 달리 대우하는가? (예: 등급별 응대 차등, 대기열 우선순위) | Q6로 |
| Q3 | 출력이 **프로파일링**(행동·선호·신뢰도 등 개인 특성 평가)을 생성·저장하는가? | Q6로 |
| Q4 | 정보주체가 결과에 **이의를 제기하거나 사람을 요청할 경로가 없는** 구조인가? | 설계 수정 필수 |
| Q5 | 새로운 개인정보 항목 또는 새로운 외부 AI 처리자에게 데이터가 **추가로 전송**되는가? | Doc-B §2 절차 병행 |
| Q6 | (Q1–Q3 중 예가 있을 때) 그 효과가 아래 **중대영향 기준**에 해당하는가? | §3 필수 통제 적용 |
| Q7 | 민감정보(건강·아동·정밀 위치 등)가 입력·추론될 가능성이 있는가? | DPIA 문서화(PRV-042) |
| Q8 | 모델 출력 오류(환각)가 정보주체에게 금전적·법적 피해를 일으킬 수 있는가? | 사람 검토 게이트 설계 |

### 2.2 중대영향 기준

다음 중 하나에 해당하면 "중대영향 자동화 결정"으로 분류한다:

- **신용/여신** 판단 · **고용/평가**(상담원 성과 자동 평가 포함 — `agent_daily_stats` 활용 확장 시 주의)
- **가격 차별**·혜택 차등 · **계약 체결/거부**(주문·환불·계정의 자동 거부)
- **법적 지위**에 영향(권리 행사 제한, DSAR 자동 거절 등)

## 3. 중대영향 판정 시 필수 통제

| 통제 | 요구사항 |
|---|---|
| 사람 검토(Human-in-the-loop) | 확정 전 자격 있는 담당자의 검토·승인 단계를 강제(코드 레벨 게이트, 우회 불가 — 모더레이션 게이트와 동일한 non-bypassable 패턴) |
| Opt-out | 정보주체가 자동화 처리 대신 사람 처리를 선택할 수 있는 경로(위젯/콘솔 UI + `notification_prefs`류의 영속 상태) |
| 설명·이의제기 채널 | 결정 논리 요지 고지, 이의제기 접수 경로와 SLA(GDPR 1개월/CCPA 45일 준용), 처리 결과 통지 |
| DPIA 문서 | `docs/analysis/`에 DPIA 작성(처리 목적·필요성·비례성·리스크·완화책), 보호책임자 승인 후 구현 착수. 감사 추적을 위해 결정 로그(`audit_logs` 또는 전용 테이블) 필수 |

## 4. 운영 규칙 — PLN 문서 "AI DPIA 게이트" 섹션 필수화 (MUST)

1. AI 기능을 추가·변경하는 모든 **PLN 문서**(`docs/plan/PLN-{Topic}-{YYYYMMDD}.md`)는
   `## AI DPIA 게이트` 섹션을 **필수 포함**한다. 부재 시 PLN 승인 불가.
2. 섹션 최소 내용: §2.1 Q1–Q8 답변표 → 중대영향 판정 결과(해당/비해당 + 근거 1~3줄) →
   (해당 시) §3 통제 반영 계획 → (신규 처리자 시) Doc-B 등록 계획.
3. 판정 결과는 구현 후 **본 문서 §1 처리기록 표에 행 추가**로 반영한다(처리기록 최신성 유지, PRV-006).
4. AI와 무관한 PLN은 `## AI DPIA 게이트 — 해당 없음(AI 처리 변경 없음)` 한 줄로 명시한다
   (백엔드-only PLN의 "no UI impact" 규칙과 동일한 명시적 부정 표기 방식).
5. 게이트 승인자: 개인정보 보호책임자(TBD). 승인 전 구현 착수 금지 — 기존 "PLN 사용자 승인
   후 구현" 워크플로우(CLAUDE.md §7)에 통합되어 별도 절차를 추가하지 않는다.
