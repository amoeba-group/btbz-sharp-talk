# REQ-260920 — 콘솔 고객정보 마스킹 및 GDPR/CCPA 준수 점검

- 요청(2026-09-20): "https://shoptalk.amoeba.site/customers 고객 정보 PII — 고객정보 마스킹 처리되어야 함.
  GDPR, CCPA 등 개인정보 보호 기준 준수 여부를 shoptalk 전체 페이지 내 확인하고 조치해야 할 사항 정리 보고"
- 기준 문서: `reference/amoeba_privacy_compliance_v2.md`(PRV-001~042) · `CLAUDE.md` §2 · `SPEC.md` §8.4/8.5/§14
- 선행 작업: REQ/PLN/RPT-Privacy-Control-Gap-20260731 · RPT-Privacy-Control-Verification-20260802(PCV-01~16 / PCB-01~13)
- 실측 환경: 스테이징 `shoptalk.amoeba.site`(2026-09-20), 프로덕션 env 값은 서버에서 직접 확인

## 0. 요약

암호화·동의·DSAR·보존 같은 **기반 통제는 이미 갖춰져 있다**. 빠진 것은 **"사람이 보는 화면과 응답에서의 최소화"**다.
고객 PII는 DB에서 AES-256-GCM으로 암호화되지만 TypeORM 트랜스포머가 읽을 때 복호화하므로,
API 응답과 콘솔 화면에는 평문 그대로 나온다. 마스킹·열람 감사·열람 권한 분리가 세 축으로 비어 있다.

발견 10건 중 P0 3건(평문 반환·열람 무감사·라이브챗 검색 우회), P1 4건, P2 3건이다. 상세는 §3.

## 1. 실측 AS-IS — 고객 페이지

`GET /api/v1/customers` 실제 응답 필드:
`id, tenantId, shopifyCustomerId, email, name, phone, tier, shopifyTier, orders, totalSpent, currency, createdAt, updatedAt`

| 관찰 | 근거 |
|---|---|
| `email`·`name`·`phone`이 **평문**으로 반환된다 | 스테이징 실측 · `customer.mapper.ts:13-29` |
| 저장은 암호화돼 있다(varbinary + AES-256-GCM), 그러나 읽을 때 자동 복호화된다 | `customer.entity.ts:19-22,76-87` |
| 콘솔 표가 이름·이메일을 그대로 렌더한다(마스킹 0건) | `CustomersPage.tsx:72-100` |
| `phone`은 **화면에 쓰지 않으면서** 응답에 실려 나간다 | `customer.response.ts:2-16` vs `CustomersPage.tsx` |
| `PATCH /customers/:id`는 name·tier만 쓰는데 응답에 이메일·전화를 되돌려준다 | `customer.controller.ts:57-71` |
| 검색어(이메일 전체)가 **쿼리스트링**으로 오간다 | `CustomersPage.tsx:107-115` |
| 권한은 메뉴 게이트 + `CUSTOMER_MANAGE`(매니저 이상) 하나뿐, 필드 단위·직무 라벨 게이트 없음 | `customer.controller.ts:26,31` · `permission-matrix.ts:44-110` |
| 테넌트 격리는 정상 | 실측: 타 테넌트 id는 404 |
| 고객 목록·상세 조회는 **감사 로그에 남지 않는다** | 실측: 조회 13회 후 `/audit`에 관련 항목 0건 |

## 2. 전 화면 PII 노출 지도 (콘솔 30개 라우트 전수)

고객(정보주체) PII가 나타나는 화면만 추린 것이다. 임직원 계정 이메일(`/users`, `/admin/admins`)은
계정 관리에 필요한 범위라 대상에서 제외했다.

| 라우트 · 영역 | 노출 PII | 출처 | 현재 상태 |
|---|---|---|---|
| `/customers` | 이름, 이메일 (전화는 응답에만) | `GET /customers` | 마스킹 없음, 감사 없음 |
| `/live-chat` 세션 목록 | 고객명·이메일(별칭 없을 때 라벨) | `GET /agent/sessions` | 마스킹 없음 |
| `/live-chat` 대화 본문 | 메시지 원문, 발신자명, 첨부 파일 | `GET /agent/conversations/:id` | 마스킹 없음, **열람 감사 있음** |
| `/live-chat` 고객 패널 | 이름·이메일·전화·최근 주문 | 대화 응답의 `customer` | 마스킹 없음 |
| `/live-chat` 고객 검색 모달 | 이름·이메일·전화(검색 결과 전건) | `GET /agent/customers/search` | 마스킹 없음, 감사 없음, **스태프 접근 가능** |
| `/live-chat` 고객 생성(리드) | 이름·이메일·전화 입력 | `POST …/create-customer` | 해당 없음(입력) |
| `/live-chat` 에스컬레이션 알림 | 메시지 미리보기 | `GET /agent/alerts` | 마스킹 없음, 보존 미연결 |
| `/live-chat` 내부 코멘트·브리핑 | 상담원 메모, AI 요약(고객 정보 재진술 가능) | 코멘트·브리핑 API | 마스킹 없음 |
| `/issues` 보드·미리보기 | 세션 별칭, 메시지 미리보기, 최근 10건 원문 | 이슈 보드 · 대화 API | 열람 감사 있음 |
| `/history` 목록·전문 | 고객명, 대화 원문 전체, 본문 검색 | `GET /analytics/conversations` | 열람 감사 있음(`agent.transcript_viewed`), 마스킹 없음 |
| `/statistics` 만족도 | 응답자 고객명 | `GET /agent/csat/conversations` | 마스킹 없음 |
| `/statistics` 여정 리포트 | **대화 원문 인용 + "연락처" 섹션** | `journey` 모듈 | 마스킹 없음, **AI 전송 시 스크러빙 없음**(F-09) |
| `/knowledge` | 상담 내용을 KB로 담는 경로가 있어 본문에 PII가 섞일 수 있음 | 지식 캡처·문서 | 수집·표시 시 검사 없음(F-10) |
| `/reviews` | `customerId`(숫자)와 리뷰 본문 | `GET /reviews` | 식별자는 비공개 대상 아님 |
| `/orders` | **없음**(주문번호·금액·상태) | `GET /admin/orders` | 해당 없음 |
| `/admin/audit` · `/work-log` | 감사 대상 이메일(마스킹됨), **행위자 IP 평문** | `GET /audit` | 부분 충족 |
| `/users` · `/admin/*` 계정 화면 | 임직원 이메일, 1회성 임시 비밀번호 | 사용자 관리 | 대상 외(계정 관리 목적) |

첨부 파일: 고객이 채팅으로 올린 이미지·문서는 서명 URL로 원본 그대로 열람·다운로드된다(내용 검사 없음).
고객 본인 DSAR 내보내기(`GET /privacy/export`)는 설계상 평문이며 정상이다.

내보내기(CSV/XLSX/PDF): 고객 데이터 내보내기는 **존재하지 않는다**. 지식 KB 내보내기와 위젯 디자인
패키지 내보내기만 있고 둘 다 고객 PII를 담지 않는다(실측 grep).

### 설계상 평문으로 두기로 한 영역 (재확인)
`RPT-Security-Privacy-Performance-Review-20260718.md`는 메시지·알림·리뷰 본문을 평문으로 두는 것을
**의도된 절충**으로 기록한다(암호화하면 RAG 검색·모더레이션·보존 파기·상담원 가독성이 모두 깨진다).
이번 점검도 그 결정을 유지한다. 대신 본문이 아니라 **구조화된 식별자(이름·이메일·전화)**에 통제를 건다.

## 3. 발견 사항 (조치 대상)

심각도: **P0** = 지금 실제 데이터가 과다 노출됨 · **P1** = 기준 미충족이나 노출 범위 제한적 · **P2** = 위생·문서

| ID | 발견 | 근거 | 기준 | 심각도 |
|---|---|---|---|---|
| F-01 | 고객 목록·상세 API가 이름·이메일·전화를 **평문**으로 반환하고 콘솔이 그대로 렌더 | 실측 · `customer.mapper.ts` · `CustomersPage.tsx:72-100` | PRV-005(관리 화면 마스킹), PRV-002 | P0 |
| F-02 | 고객 PII **열람이 감사 로그에 남지 않음**(대화 열람은 남음 — `auditConversationView`) | 실측 `/audit` 0건 · `agent-console.controller.ts:470` 대비 | PRV-040 | P0 |
| F-03 | 라이브챗 고객 검색 `/agent/customers/search`가 `CONVERSATION_HANDLE`만 요구 → **스태프도 전체 고객 평문 열람·열거 가능**, 감사 없음 | `agent-console.controller.ts:446-451` · 실측 `q=a`에 13명 중 8명 반환 | PRV-005(최소권한), PRV-040 | P0 |
| F-04 | 화면에 쓰지 않는 `phone`까지 응답에 포함, 쓰기 응답도 전체 PII 반환 | `customer.response.ts` · `customer.controller.ts:57-71` | PRV-002 최소수집 | P1 |
| F-05 | 고객 검색어(이메일 전문)가 쿼리스트링으로 전송돼 **nginx 접근 로그에 평문 기록** | 실측: 컨테이너 로그에 `email=...@...` 그대로 남음 | PRV-005(로그 마스킹) | P1 |
| F-06 | `moderation_logs.excerpt`(최대 512자 대화 원문)·`agent_alerts.preview`가 평문 보존, 보존 주기 미연결 | `moderation.service.ts:190` · 데이터 인벤토리 G-1~G-7 | PRV-004 | P1 |
| F-07 | 감사 메타데이터에 원문 이메일을 쓰는 경로 1곳 | `knowledge/gdrive-credential.service.ts:71` | PRV-005 "never raw PII" | P2 |
| F-08 | 프로덕션 `MFA_ENFORCE_FROM`이 비어 있음(강제 미적용) | 서버 `.env.self-hosted` 실측 | PCB-04 | P2 |
| F-09 | **여정 리포트가 대화 원문을 스크러빙 없이 AI 제공자에 전송**하고, 결과에 "연락처" 섹션을 만들어 콘솔에 표시 | `journey-report.service.ts:288-292`(원문 `m.body` 그대로) · `journey-prompt.ts:26-31` · 다른 AI 경로는 `scrubPii` 적용 | PRV-002, PRV-031 | P1 |
| F-10 | 상담 내용을 지식 문서로 담는 경로가 있어 KB 본문·KB 내보내기(CSV/XLSX)에 고객 PII가 섞일 수 있음 | `KnowledgeCaptureModal.tsx` · `bulk-export.service.ts`(`content` 칼럼) | PRV-002 | P2 |

### 이미 충족된 항목 (재확인)

| 항목 | 상태 | 근거 |
|---|---|---|
| 전송 구간 TLS·보안 헤더·`no-store`·레이트리밋 | 충족 | 실측 응답 헤더(HSTS, nosniff, no-store, x-ratelimit 600) |
| 고객 식별자 저장 암호화(AES-256-GCM) + 블라인드 인덱스 | 충족 | `crypto.util.ts:40-67` · `customer.entity.ts` |
| 동의(CCPA) 수집·철회·버전 재동의, fail-closed 게이트 | 충족 | `session.service.ts` · `ConsentBanner.tsx` |
| DSAR 열람·삭제·판매거부 + Shopify 3종 웹훅(HMAC) | 충족 | `privacy.controller.ts:31-115` |
| 보존 파기 잡(기본 365일, 스테이징 90일) | 충족 | `retention.service.ts:39-180` · 서버 env 실측 |
| AI 전송본 PII 스크러빙 | 충족 | `pii-scrub.util.ts` |
| 로그 마스킹·감사 마스킹(`maskPii`) | 부분 충족 | 인증·사용자 경로는 적용, 고객 도메인은 미적용 |
| 테넌트 격리 | 충족 | 실측 404 |

## 4. 기준별 준수 현황 (PRV 매핑)

| 기준 | 요구 | 현재 | 판정 |
|---|---|---|---|
| PRV-001/020~022 | 동의·고지·판매거부 | 위젯 동의 배너(6언어), 버전 재동의, fail-closed, CCPA 판매거부 토글 | 충족 |
| PRV-002 | 최소수집 | AI 전송본은 스크러빙, **콘솔 응답은 과다**(F-01·F-04) | 미충족 |
| PRV-004 | 보존 제한 | 대화 365일(스테이징 90일) 파기 잡 동작, **모더레이션 발췌·알림 미리보기 미연결**(F-06) | 부분 |
| PRV-005 | 암호화·접근통제·**마스킹** | 저장 암호화·TLS·RBAC 충족, **관리 화면 마스킹 부재**(F-01), 스태프 우회(F-03) | 미충족 |
| PRV-010~017 | 정보주체 권리 | DSAR 열람·삭제·이동, 삭제 억제 목록, Shopify 3종 웹훅 | 충족 |
| PRV-030/031 | 수탁사 DPA·국외이전 | `PROCESSOR-REGISTER.md` 전 항목 "확인 필요"(PCB-01) | 미충족(법무) |
| PRV-040 | **PII 접근 감사** | 대화 열람은 기록, **고객 조회는 무기록**(F-02·F-03) | 미충족 |
| PRV-041/042 | 사고대응·DPIA | 런북·AI DPIA 게이트 문서 존재, 담당자·연락처 미기입(PCB-03) | 부분 |

## 5. TO-BE 사용자 흐름

```
매니저가 /customers 를 연다
  └ 서버가 마스킹된 값을 내려준다        홍*동 · ab***@shop.com · 전화 미포함
      └ 특정 고객 확인이 필요하면 [열람] 클릭
          └ 권한(CUSTOMER_PII_REVEAL) 확인 → 평문 1건 5분 표시
              └ 감사 로그에 1행: customer.pii_revealed · 대상 · 시각 · IP
상담원이 라이브챗에서 고객 패널을 본다
  └ 같은 규칙. 주문 조회는 마스킹 상태로도 가능(블라인드 인덱스 정확 일치)
```

## 6. 제약·전제
- 저장 암호화 방식·키(`CRED_ENC_KEY`)는 건드리지 않는다. 마스킹은 **응답 생성 시점**에만 적용한다.
- 대화 본문 평문 보존은 기존 결정을 유지한다(§2 말미).
- 수탁사 DPA·MFA 강제 적용 시점은 코드가 아니라 **결정·계약 사항**이라 별도 항목으로 남긴다.
- 프로덕션에는 실고객 데이터가 있다. 배포는 스테이징 검증 후.
