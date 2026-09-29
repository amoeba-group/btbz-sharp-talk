# FIX-260930 — 빈 환경변수가 0으로 읽힘 + 임베딩 실패 시 신뢰도 부풀림

- 발단: RPT-260929(AI 대화 기억) 후속 "`RAG_MIN_SIMILARITY` 0.5가 정답 문서를 찾은 답변까지 핸드오프시킨다" 점검
- 결론: **임계값 자체는 문제가 아니었다.** 점검 과정에서 더 큰 결함 두 개가 나왔다.

---

## 1. 임계값 실측 (변경 없음의 근거)

스테이징 API 컨테이너 안에서 Voyage(voyage-4) 임베딩과 Qdrant 검색을 직접 호출했다(LLM 없음, top-1 유사도).

| 분류 | n | top-1 유사도 |
|---|---|---|
| 답이 KB에 있는 질문 (ivyusa 10, skyliving 5) | 15 | 0.36 · **0.44** · 0.51 · 0.53 · 0.535 · 0.55 · 0.56 · 0.58 · 0.58 · 0.61 · 0.61 · 0.62 · 0.63 · 0.70 · 0.71 |
| 범위 밖 질문 (날씨·월드컵·환율·코드·타이어·주식·자동차 수리·비트코인·피자) | 10 | 0.22 ~ **0.40** |
| 릴레이 잡음 (관세청 문자·"새 메시지 확인 중"·WhatsApp 안내·"chào abnj") | 4 | 0.24 ~ **0.42** |

- 두 분포 사이의 틈은 0.40~0.44다. 스테이징의 `0.45`는 그 틈 안에 있어 맞는 값이다.
  0.42로 낮추면 "How do I start a return?"(0.44) 한 건을 살리지만, 잡음 최댓값(0.418)과의 차이가 0.002다. n=35로 정할 폭이 아니다.
- 최근 30일 `low_confidence` 핸드오프 33건: 대부분 릴레이 알림·테스트·인증번호(핸드오프가 맞음).
  실제 질문으로 보이는 건 중 tenant 14 "배송 며칠 걸리나요?"(지금 0.65)는 질문 **2시간 뒤에** KB 문서가 생성됐다. 당시 핸드오프는 정상이었다.
- → **임계값 유지. 코드 기본값만 0.5 → 0.45**(스테이징 설정·실측과 일치)로 바꿨다.

---

## 2. 결함 D1 — 빈 환경변수 = 0 (프로덕션)

**현상**: 프로덕션 컨테이너 `RAG_MIN_SIMILARITY=`(빈 값). 코드는 `Number(process.env.RAG_MIN_SIMILARITY ?? '0.5')`인데,
`??`는 `undefined`만 잡고 `''`는 통과시킨다. `Number('') === 0`이 되어 **유사도 하한이 0** →
"모르면 사람에게"(`low_confidence` 핸드오프)가 프로덕션에서 **한 번도 발동할 수 없는 상태**였다.

**같은 패턴 18개 키 전수 조사**: 프로덕션에서 빈 값인 것은 3개가 더 있었다.

| 키 | 코드 기본값 | 프로덕션 실제값 | 영향 |
|---|---|---|---|
| `RAG_MIN_SIMILARITY` | 0.5 | **0** | 저신뢰 핸드오프 불능 |
| `ANSWER_REUSE_THRESHOLD` | 0.92 | **0** | 저장된 답변이 **아무 질문에나** 매칭 |
| `ANSWER_REUSE_TTL_DAYS` | 30 | **0** | 매칭 즉시 만료 처리 → 저장→첫 조회에 비활성화(재사용 사실상 고장) |
| `ANSWER_REUSE_MIN_CONFIDENCE` | 0.75 | **0** | 인용만 있으면 모든 답변 저장 |

- 원인: 배포 템플릿(`docker/self-hosted/.env.self-hosted.example`, `deploy/profiles/*/.env.*.example`)이 키를 빈 값으로 싣는다.
  스테이징은 값을 우연히 채워 두어 드러나지 않았다.
- 실피해: **없음** — 프로덕션은 테넌트 1개, 대화 0건, `answer_reuse` 0행(2026-09-30 확인). 고객 트래픽 전에 잡혔다.
- 수정: `global/util/env-number.util.ts` `envNumber(name, fallback)` — 없음·공백·비숫자면 기본값. **명시적 `0`은 그대로 존중**
  (동기화 주기 0 = 끔 같은 의미 보존). `Number(process.env.X ?? d)` 20곳(15개 파일)을 전부 교체했다.

## 3. 결함 D2 — 임베딩 실패 시 신뢰도 0.95

**현상**: 2026-09-29 ivyusa 턴 17740 "What is your return policy?" → "정보가 없다", 인용 0건, **conf 0.95**, 핸드오프 없음.
Voyage 경로에서 0.95가 나오려면 유사도가 0.95 이상이어야 하므로 불가능하다. 이 값은 개수 기반 공식(`0.5 + 6×0.12`, 상한 0.95)에서만 나온다.

**경로**: Voyage 임베딩 실패 → `AiGatewayService.embed()`가 **스텁 임베딩으로 폴백** → 스텁 벡터로 Voyage 컬렉션 검색(무의미)
→ `provider='stub'`이라 `confidence()`가 개수 공식으로 → 전문검색 결과 6건 = 0.95.
전문검색만으로는 이 질문에 상품 문서가 상위를 차지한다(SQL로 재현: 1·2·4~8위가 상품, 정책은 3위 "7.5 B2B Returns" 하나).
스테이징 3주간 RAG 답변 70건 중 5건이 이 경로였다.

**수정**: `RagService.confidence()` — Voyage 키가 설정돼 있고 Qdrant도 켜져 있는데 이번 턴의 provider가 `voyage`가 아니면
**0.2(핸드오프 기준 미만)**를 반환하고 경고 로그를 남긴다. Qdrant가 꺼진 개발 환경과 키가 없는 스텁 환경은 기존 개수 공식을 유지한다.
- 트레이드오프: Voyage 장애 동안에는 지식 기반 답변이 전부 상담원 핸드오프로 간다. 정책 §0.4("모르면 사람에게")에 맞는 쪽을 택했다.
  근거 없는 확신 답변보다 낫다. 답변 재사용은 이미 스텁일 때 조회하지 않는다.

## 4. 미확인 — 단건 임베딩 429 재시도 없음

`VoyageAdapter`는 429 재시도를 배치(`texts.length > 1`)에만 한다(15/30/60초). 채팅의 단건 질의는 재시도 없이 즉시 실패한다.
9/29 실패가 429였는지는 컨테이너 재생성으로 로그가 사라져 **확인하지 못했다.** 오늘 6연속 호출에서는 실패 0건.
추측으로 고치지 않는다. D2 이후에는 실패 시 게이트웨이 경고와 `vector leg degraded` 경고가 남으므로 다음 발생 때 원인을 확정한다.

## 5. RPT-260929 S9 기술 정정

RPT-260929는 S9(그룹 선호 보존)가 "return policy 무응답"을 고쳤다고 기록했다. 그 "변경 전" 측정(`group=product` → 출처 0건·conf 0.95)은
**D2 경로(임베딩 실패)**였다. 순수 그룹 가산 효과가 아니었다. S9의 원리(0.002 가산 ≈ RRF 인접 간격의 약 7배)는 유효하고 해가 없어서 유지한다.
다만 그 사례를 고친 것은 이번 D2다. RPT에 정정 주석을 달았다.

---

## 6. 재발 방지 패턴

- **환경변수 숫자는 `envNumber()`로만 읽는다.** `Number(process.env.X ?? d)` 금지 — 빈 줄이 0이 된다.
- **폴백 경로의 점수는 정상 경로와 같은 척도가 아니다.** 신뢰도·점수를 쓰는 곳은 "이번 결과가 어느 경로에서 나왔는가"를 먼저 본다.
  폴백은 조용하되, 판단 신호(신뢰도)까지 폴백 척도로 부풀리면 안 된다(메모리 `invisible-fallback-trap`과 같은 계열).
- **스테이징 설정 ≠ 프로덕션 설정**: 템플릿에서 새로 만든 환경은 빈 값이 기본이다. 배포 검증에 "핵심 튜닝 키가 비어 있지 않은가"를 넣는다.

## 7. 변경 파일

- `apps/api/src/global/util/env-number.util.ts` (+spec) — 신규
- `apps/api/src/domain/chat/rag.service.ts` — `envNumber`, 기본 0.45, `DEGRADED_CONFIDENCE`
- `apps/api/src/domain/chat/rag-confidence-degraded.spec.ts` — 신규
- `envNumber` 교체: `answer-reuse.service`, `idle-conversation.service`(4), `scheduled-{shopify,woocommerce,haravan,odoo}-sync`, `product-sync`, `push`, `messenger-{outbox.worker,sync}`, `knowledge-gap`, `database/{data-source,backfill-relay-subchannel,migrate-data-uri-attachments}`

## 8. 테스트·배포

- API 전체 203 suites / 2037 tests 통과, `tsc` 통과
- 배포 상태는 PR 본문과 이 문서 하단에 추가한다
