# 수탁자(처리자) 대장 — Processor / DPA Register (Doc-B)

| 항목 | 내용 |
|---|---|
| 문서 ID | GUIDE-Processor-Register-20260731 |
| 작성일 | 2026-07-31 |
| 범위 | SharpTalk이 개인정보 처리를 위탁하거나 개인정보가 전송되는 모든 외부 처리자(하위처리자 포함) |
| 기준 | `reference/amoeba_privacy_compliance_v2.md` §6 (PRV-030 DPA 체결, PRV-031 국외이전 근거) · REQ-Privacy-Control-Gap-20260731 #4 |
| 소유자 | 개인정보 보호책임자 — **임시 기본: Gray(개발 책임)**, 정식 지정 시 갱신 (2026-07-31) |

> 계약/DPA 상태는 **저장소에 증빙이 존재하지 않음이 확인된 사실**이므로 전 행 `TBD/확인 필요`로
> 기재한다. 계약 체결·확인 시 본 대장을 즉시 갱신한다(운영값 변경 즉시 반영 원칙).

---

## 1. 수탁자 대장

| # | 처리자 | 역할(하위처리 포함) | 처리 데이터 | 처리 국가 | 계약/DPA 상태 | SCC / CCPA service-provider 조항 | 만료/갱신일 | 담당자 |
|---|---|---|---|---|---|---|---|---|
| 1 | Shopify Inc. | 커머스 플랫폼 — 주문·고객 데이터의 원천이자 수신자(Admin API GraphQL, 앱 프록시, GDPR 웹훅). 자체 클라우드 하위처리자 보유 | 고객 email/이름/주문·배송 정보(Protected Customer Data) | 캐나다/미국(리전 TBD/확인 필요) | **표준 DPA 공개 제공**(Shopify Data Processing Addendum, 약관 편입형) — 파트너/앱 계정에의 적용·PCD 승인 상태 **확인 필요** | 약관 편입형 — 조항 확인 필요 | 약관 갱신 추적 | Gray(기본) |
| 2 | Anthropic PBC | AI 완성 API(RAG 답변·의도분류·모더레이션 분류·rephrase). 하위처리: 클라우드 인프라(TBD) | **채팅 원문 — 단, 2026-07-31부터 email/전화/카드/주문번호/주소는 송신 전 마스킹**(`pii-scrub`, PR #42; Doc-A G-9 부분 해소) + KB 컨텍스트 + 프롬프트 | 미국 | **표준 DPA 공개 제공**(Commercial Terms 부속 Data Processing Addendum; API 입력은 기본 미학습) — 계정에의 적용·보존(ZDR) 조건 **확인 필요** | 약관 편입형 — 조항 확인 필요 | 약관 갱신 추적 | Gray(기본) |
| 3 | Voyage AI | 임베딩 API(`voyage-4`) — KB 문서 배치 임베딩 + 라이브 질의 임베딩 | KB 문서 텍스트, 사용자 질의(**2026-07-31부터 chat 경유 질의는 마스킹 후 전달**) | 미국 | **TBD/확인 필요** — 약관 내 DPA 제공 여부 확인 필요 | TBD/확인 필요 | TBD | Gray(기본) |
| 4 | 스테이징 호스팅 사업자 (`211.110.140.172` / `shoptalk.amoeba.site`) | 인프라 호스팅 — MySQL/Redis/RabbitMQ/Qdrant 도커 볼륨이 이 호스트에 존재(공유 호스트) | 표 1 전체(스테이징 데이터셋) | 대한민국(추정 — **사업자·계약 형태 TBD/확인 필요**) | **TBD/확인 필요** | TBD/확인 필요 | TBD | Gray(기본) |
| 5 | 이메일/SMS 발송 제공자 | **미정** — 현재 고객 대상 외부 발송은 mock(코드상 미전송). 상담원 알림용 SMTP/Slack은 환경변수 설정 시에만 활성 | (도입 시) 고객 email/전화번호, 알림 내용; (알림용) 대화 preview 300자 | TBD | **해당 없음(미계약)** — 도입 전 §2 절차 필수 | — | — | Gray(기본) |
| 6 | Google LLC (GA4) | 위젯 전환/UTM 분석(consent-gated 설계). 본 브랜치 코드에는 래퍼 부재 — 배포 브랜치 확인 필요 | 이벤트·전환 데이터(쿠키/클라이언트 ID; Consent Mode v2 게이팅 전제) | 미국 | **표준 약관 존재**(Google Ads Data Processing Terms — GA4 관리 콘솔에서 수락) — 수락 여부 **확인 필요** | 약관 편입형 — 확인 필요 | 약관 갱신 추적 | Gray(기본) |
| 7 | Notion Labs, Inc. | **지식(KB) 소스 — 유입 방향만.** `knowledge/notion.client.ts`는 운영자가 연결한 페이지·DB를 **읽는** 호출(`GET`/`POST …/query`)만 한다. 고객 대화·고객 개인정보는 Notion으로 **전송되지 않는다**(코드로 확인, 2026-10-13) | 운영자 Notion 통합 토큰(`integration_credentials`, AES-256-GCM) · 읽어 온 페이지 본문(KB 텍스트) | 미국(추정 — **TBD/확인 필요**) | **TBD/확인 필요** — 운영자 자체 Notion 계약이 적용될 수 있음 | TBD/확인 필요 | TBD | Gray(기본) |
| 8 | AmoebaTalk 허브 (`api-talk.amoeba.site`) | 메신저 릴레이 채널(`messenger/adapter/amoeba-talk-hub.adapter.ts`, 기본 `DEFAULT_BASE_URL`) — 채널을 연결한 테넌트에서만. 허브가 외부 메신저(카카오·LINE 등)와 SharpTalk 사이를 중계 | 해당 채널의 고객 이름·메시지 본문·대화 ID(양방향), 허브 로그인 자격증명 | 대한민국(Amoeba 운영 — **TBD/확인 필요**) | **내부 계열 서비스 — 처리 계약 형태 TBD/확인 필요** (Go2Joy 배포에서 이 채널을 켜면 Go2Joy ↔ Amoeba 처리 관계 명문화 필요) | TBD/확인 필요 | TBD | Gray(기본) |
| 9 | SMTP 제공자 (`SMTP_HOST` — **미정**) | `infrastructure/external/mailer.service.ts`: ① 근무시간 외 상담 답변을 **고객 이메일**로 발송(`reply_channel=email`) ② 상담원 에스컬레이션 알림 메일 ③ 직원 계정 메일(비밀번호 복구·초대). env 미설정 시 비활성 | 고객 이메일 주소·답변 본문, 알림 본문(대화 preview ≤300자), 직원 이메일 | TBD(제공자 선정 시 확정) | **미계약** — 활성화 전 §2 절차 필수(행 5와 동일 규칙) | — | — | Gray(기본) |
| 10 | jsDelivr (Cloudflare·Fastly 등 CDN) | **위젯 iframe이 브라우저에서 직접 로드**하는 Pretendard 폰트 CSS(`apps/widget/index.html`). 앱 데이터는 보내지 않으나 방문자 **IP·User-Agent·Referer**가 CDN에 노출됨. 오프라인 호스팅으로 제거 가능(`WIDGET_FONT_CSS_URL`, GUIDE-261013-Go2Joy-HotelAdmin-CSP-CORS.md §5) | 방문자 IP/UA(폰트 요청 시) | 전 세계(CDN) | 해당 없음(처리 위탁 아님 — 자체 호스팅 시 행 삭제) | — | — | Gray(기본) |
| 11 | Go2Joy 자체 호스팅 인프라 (**TBD**) | Go2Joy가 SharpTalk을 자체 인프라에 설치할 때의 호스트(`docker/self-hosted`) — MySQL·Redis·RabbitMQ·Qdrant·업로드 볼륨이 이 호스트에 존재. 이 배포에서 **Go2Joy가 처리자이자(또는) 관리자**이며 Amoeba는 지원 시에만 접근 | 표 1 전체(Go2Joy 데이터셋) | **TBD/확인 필요**(국내 베트남 내 호스팅 여부 — 국외이전 고지·영향평가 입력값) | **TBD/확인 필요** — Go2Joy ↔ Amoeba 지원 접근 조건(운영 매뉴얼 §지원) | TBD/확인 필요 | TBD | Go2Joy(지정 필요) |

부속 메모:
- Slack(에스컬레이션 웹훅)·SMTP 제공자는 운영 환경변수(`SLACK_WEBHOOK_URL`, `SMTP_HOST`)가 설정되는 순간 실질적 수탁자가 된다. 설정 전에 본 대장에 행을 추가할 것.
  (SMTP는 2026-10-13 행 9로 추가. Slack은 에스컬레이션 알림에 대화 preview가 실리므로 사용 시 행을 추가한다.)
- **2026-10-13 갱신(PLN-261012 SG-70):** 행 7–11 추가. 신규 행의 계약/DPA 상태는 전부 **TBD/확인 필요**이며
  저장소에 증빙이 없다. 행 7(Notion)은 개인정보가 나가지 않는 **유입 전용** 연동이라 `vn_pdpl` 고지의
  수신자 목록에 넣지 않았다(사실과 다른 고지를 피하기 위함). 행 2·3(Anthropic·Voyage)은 고지에 "미국 —
  `AI_PROCESSING_REGION`"으로 표기된다.
- Qdrant는 자체 호스팅(스테이징 compose 내부)이므로 수탁자가 아니며, 행 4(호스팅)의 범위에 포함된다.

## 2. 신규 연동 승인 절차 (MUST)

**DPA/보안 검토 완료 전에는 운영 환경에서 신규 외부 연동을 활성화할 수 없다.**
(환경변수 투입·API 키 발급·webhook 등록 모두 "활성화"로 본다.)

### 2.1 사전 체크리스트 — 전 항목 통과 후 활성화

| # | 확인 항목 | 통과 기준 |
|---|---|---|
| 1 | 전송 데이터 정의 | 어떤 필드가 나가는지 코드 수준으로 특정(Doc-A 표 3 갱신 포함) |
| 2 | 최소 수집(PRV-002) | 목적에 불필요한 필드 제거·마스킹 적용 여부 검토 |
| 3 | DPA 체결(PRV-030) | 서명본 확보, 하위처리자 목록 수령 |
| 4 | 국외 이전 근거(PRV-031) | SCC 또는 동등 장치 + 고지문 반영 |
| 5 | CCPA service-provider 조항 | "판매/공유" 아님을 계약으로 담보(PRV-013 연계) |
| 6 | 보안 검토 | 전송 TLS 1.2+, 자격증명 저장은 `integration_credentials`(AES-256-GCM) 또는 env-secret, 키 회전 절차 확인 |
| 7 | 데이터 보존 | 상대측 보존기간·삭제 SLA 확인(가능하면 ZDR) |
| 8 | 사고 통지 조항 | 상대측 침해 발생 시 통지 기한 계약 반영(Doc-C 연계) |
| 9 | AI 기능 여부 | AI 처리를 수반하면 **AI DPIA 게이트(Doc-D)** 병행 통과 |
| 10 | 대장 등록 | 본 문서 §1에 행 추가 + 담당자 지정 |

### 2.2 승인 주체

| 단계 | 승인자 |
|---|---|
| 기술 검토(#1,2,6,7) | 개발 책임 — **Gray(기본)** |
| 계약 검토(#3,4,5,8) | 법무/계약 담당(**미지정 — 외부 자문 필요, TBD**) |
| 최종 활성화 승인 | 개인정보 보호책임자 — **임시 기본: Gray**, 정식 지정 시 갱신 |

> 남은 법무 액션(우선순위순): ① Shopify 파트너 계정에 DPA 적용·PCD 승인 상태 확인
> ② Anthropic 계정의 DPA 적용·보존(ZDR) 조건 확인 ③ Voyage DPA 제공 여부 확인
> ④ 호스팅 사업자·계약 형태 확인 ⑤ GA4 Data Processing Terms 수락 확인(래퍼 배포 시).
> 각 확인 완료 시 §1의 해당 행을 즉시 갱신한다.

## 3. 갱신 규칙

- 반기 1회 전 행 재검증(계약 만료일·하위처리자 변경 확인) — Doc-C의 반기 tabletop과 같은 주기로 수행.
- 연동 해지 시 행을 삭제하지 않고 상태를 `해지(일자)`로 남긴다(책임추적, PRV-006).
