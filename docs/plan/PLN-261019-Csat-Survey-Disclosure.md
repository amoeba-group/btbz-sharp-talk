# PLN-261019 — 만족도 3문항 설문 · AI 고지 하단 배치

- 근거: [REQ-261019-Csat-Survey-Disclosure](../analysis/REQ-261019-Csat-Survey-Disclosure.md)
- **UI 변경 있음**(§4). **스키마 변경 있음**(§1 P1 — `conversations` 3열, `tenants` 2열; SQL 선적용 필요)
- 전제 결정(REQ §5 제안): D1ⓑ · D2 고정 4종 · D3 rating ≤ 2 · D4 제출 버튼 · D5 디자인 옵션 · D6 `terms_url`
- 상태: **승인(2026-10-19 "진행") → 구현·배포 진행**

## 1. 단계

### P1 — 스키마·API·해결 정의
- `sql/261019-conv-csat-survey.sql`(멱등): `conversations` + `csat_resolved TINYINT NULL`, `csat_reason VARCHAR(32) NULL`, `csat_comment VARCHAR(80) NULL`; `tenants` + `csat_mode VARCHAR(8) NOT NULL DEFAULT 'rating'`, `terms_url VARCHAR(512) NULL`. `migrations:manifest` 갱신.
- 엔티티: nullable 열 전부 `type` 명시(부팅 크래시 함정). `CSAT_REASON = { UNCLEAR:'unclear', SLOW:'slow', NO_RESPONSE:'no_response', SOFTWARE_ERROR:'software_error', OTHER:'other' }`를 `packages/types`에.
- `RateChatRequest`: `resolved?: boolean`, `reason?: string(IsIn)`, `comment?: string(MaxLength 50)`. `ChatService.rate()`: 기존 검증 그대로 + 선택 필드 저장(코멘트는 `maskPii()` 후), 재제출 덮어쓰기.
- `resolution.util.classifyOutcome`: `csat_answered`는 `csatRating != null && csatResolved !== 0`. `csatResolved === 0`이면 **미해결 사유 `customer_unresolved`** 신설(UNRESOLVED_REASON) — 대시보드·여정·통계가 같은 함수를 쓰므로 한 곳 수정.
- 세션 `ensure` 응답에 `csatMode`, `termsUrl` 추가(위젯이 모드를 알아야 카드 종류를 고름).
- 테스트: rate() 선택 필드·마스킹·재제출, classifyOutcome 4케이스(응답+해결 / 응답+미해결 / rating 모드 응답 / 미응답), 분석 breakdown `byReason`에 새 사유.

### P2 — 위젯 설문 카드
- `CsatCard`를 두 모드로: `rating`(현행 그대로, 즉시 전송) / `survey`(Q1 라디오 → Q2 세그먼트 박스 + 라벨 → rating ≤ 2면 Q3 라디오 + "기타 사유" 텍스트영역 50자 카운터 → [제출]). 제출 성공 시 "감사합니다" 상태, 실패 시 에러 문구(현행 패턴).
- i18n 6언어: `csatSurvey.{title, q1, q1Resolved, q1Unresolved, q2, reasonTitle, reasons.unclear|slow|no_response|software_error, otherReason, otherPlaceholder, submit}`. `npm run i18n:check`.
- CSS 훅: `.st-csat` `.st-csat-option` 유지 + `.st-csat-submit`.
- 모바일·앱 모드 동일(카드 폭 100%).

### P3 — 콘솔
- 설정 > 위젯 설정(동작 카드): "만족도 설문" 라디오 `별점 1문항(기본) / 설문 3문항`, 약관 URL 입력(고지 링크용).
- 통계 > 만족도: 세션별 표에 **해결/사유/코멘트** 열, 상단에 **사유 분포** 카드(불만족 응답 중 비율). API `analytics/csat/*` 응답에 세 필드 추가(선택, 구 콘솔 무해).
- 라이브챗 대화 상세의 CSAT 표시(있으면) 사유 함께.

### P4 — AI 고지 하단 배치
- `WidgetDesign.disclosurePlacement?: 'top' | 'bottom'`(기본 top, 기본값 미저장 규칙 동일).
- `bottom`: 입력부 아래 한 줄 `chat.aiDisclosureShort`("AI가 응답하며 메시지는 {region}에서 처리됩니다 · 약관") + 링크(`termsUrl ?? privacyPolicyUrl`, 없으면 링크 없음) + 상담 중일 때 "상담 종료" 링크 우측. 상단 바는 숨김. `.st-disclosure` 훅.
- 편집기 필드 1개 + 매뉴얼 05 2.1 표 1행.

### P5 — go2joy 적용·검증·RPT
- 스테이징 SQL 선적용 → 배포 → go2joy `csat_mode=survey`, 디자인 #7 `disclosurePlacement=bottom`, `terms_url`(Go2Joy 제공) → 로컬 점검 페이지에서 설문 흐름(해결/미해결·불만족 사유·제출)·고지 줄 실측 → 통계 탭 열 확인 → RPT.

## 2. 사이드 임팩트
| 영역 | 영향 | 대응 |
|---|---|---|
| 해결률(D1ⓑ) | survey 모드 테넌트에서 "미해결" 응답이 해결에서 빠져 **해결률 하락**. rating 모드·과거 데이터 무변화(열이 NULL) | RPT에 go2joy 전후 수치 기록, 통계 탭 사유 `customer_unresolved` 노출 |
| 여정 리포트 | 해결 정의 문장(`journey-prompt.ts`)에 미해결 응답 사유 추가 | 프롬프트 1줄 + 스펙 |
| 스테이징 배포 | SQL 선적용 필수(새 코드 + 구 스키마 = 500) | `pre-deploy-check` |
| 위젯 구버전 캐시 | `csatMode`를 모르면 rating 카드 → 안전 | — |
| PII | 자유 코멘트 | 저장 전 마스킹, 로그 미기록 |

## 3. 리스크
- 설문이 길어져 응답률 하락 가능 → 통계 탭 응답률 카드로 모니터링, 기본은 rating 유지.
- 사유 라벨 번역 품질(VI 우선) → go2joy 측 검수 요청.

## 4. 와이어프레임

```
① 설문 카드 (csat_mode=survey)                 ② 불만족(≤2) 선택 시
┌──────────────────────────────────┐          ┌──────────────────────────────────┐
│ Khảo sát mức độ hài lòng      (X)│          │ … Q1 / Q2 동일 …                  │
│ Quý khách đã được hỗ trợ thành   │          │ [😣]  🤔   🙂   😃   🥰           │
│ công chưa?                       │          │ Rất không hài lòng               │
│ (●) Đã xử lý xong                │          │ Lý do Quý khách KHÔNG hài lòng…? │
│ ( ) Chưa được xử lý              │          │ ( ) Hướng dẫn khó hiểu, vòng vo  │
│ Quý khách có hài lòng về dịch vụ │          │ (●) Thời gian hỗ trợ lâu         │
│ hỗ trợ của Go2Joy không?         │          │ ( ) Không phản hồi               │
│ ┌────┬────┬────┬────┬────┐       │          │ ( ) Lỗi phần mềm                 │
│ │ 😣 │ 🤔 │[🙂]│ 😃 │ 🥰 │       │          │ Lý do khác                       │
│ └────┴────┴────┴────┴────┘       │          │ ┌──────────────────────────┐     │
│ Bình thường                      │          │ │ Nhập lý do          0/50 │     │
│ [        Gửi phản hồi        ]   │          │ └──────────────────────────┘     │
└──────────────────────────────────┘          │ [        Gửi phản hồi        ]   │
                                              └──────────────────────────────────┘
③ 고지 하단 배치 (disclosurePlacement=bottom)       현재(top)
┌──────────────────────────────────┐          ┌──────────────────────────────────┐
│ 헤더                              │          │ 헤더                              │
│ (상단 바 없음)                     │          │ ✦ 이 대화는 AI가… 미국 처리  상담 종료│
│ … 메시지 …                        │          │ … 메시지 …                        │
│ [🖼] (Nhập tin nhắn……) (➤)        │          │ [🖼] (Nhập tin nhắn……) (➤)        │
│  AI tạo, xử lý tại Hoa Kỳ · điều │          └──────────────────────────────────┘
│  khoản dịch vụ          Kết thúc │
└──────────────────────────────────┘
④ 콘솔 — 위젯 동작 카드                       ⑤ 콘솔 — 통계 > 만족도 (세션별 표 열 추가)
 만족도 설문  (●)별점 1문항(기본) ( )설문 3문항   | 종료 | 세션 | 상담원 | 채널 | 평점 | 해결 | 사유 | 코멘트 |
 약관 URL   [https://…           ]               + 카드 "불만족 사유 분포": 느림 40% · 안내 혼란 30% …
```

## 5. 승인 요청
- D1ⓑ(해결 정의에 Q1 반영)가 가장 큰 결정입니다 — survey 모드 테넌트의 해결률이 낮아질 수 있습니다.
- 약관 URL은 Go2Joy가 제공해야 링크가 붙습니다(없으면 개인정보 URL, 그것도 없으면 링크 없음).
