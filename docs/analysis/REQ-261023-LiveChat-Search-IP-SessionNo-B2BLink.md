# REQ-261023 — 라이브챗: 대화 내용 검색 · 상대방 IP · 세션번호 통일 · B2B 고객 연결

- 요청: `https://shoptalk.amoeba.site/live-chat` (스테이징)
  1. 대화방 내용 검색 기능 필요
  2. 대화 상대방 IP 확인 기능 필요
  3. 실시간 상담의 세션번호와 그룹핑(타임라인/프로젝트) 세션방 이름·세션번호 통일 필요
  4. go2joy 실시간 상담 세션 887 — B2B 기업고객(Lá Hotel Quận 10, hotel:4118)으로 확인되나 오른쪽 '고객'의 기존 고객 매칭에 연결되어 있지 않음

## R1. 대화 내용 검색

**AS-IS**
- 목록 검색창(`LiveChatPage.tsx:629`)은 고객 이름·이메일만 대상 → `GET /agent/sessions?q=` → `searchByEmailOrName`(최근 고객 복호화 스캔) → 그 고객의 세션만.
- 메시지 본문 검색 UI·API 없음. 대화방 안에서도 찾기 불가(메시지는 페이지 단위 로드).
- `messages.body`는 `text` **평문** 저장(PII 마스킹은 AI 전송 사본에만). 인덱스 `idx_msg_tenant`·`idx_msg_conv`, FULLTEXT 없음.
- 스테이징 규모: 전체 20,643건(최대 테넌트 12,743건) — `tenant_id` 인덱스 + `LIKE`로 충분, FULLTEXT 마이그레이션 불요.

**TO-BE**
- (a) 목록: 검색 대상을 **고객 / 대화 내용** 중 선택 → 내용이 일치하는 대화만 목록에 표시 + 일치 문장 일부(스니펫).
- (b) 대화방 안: 검색 → 일치 메시지 n건, 이전/다음 이동, 하이라이트(아직 로드 안 된 과거 메시지도 서버가 찾아줌).

**제약**: 검색어에 고객 PII가 섞일 수 있음 → 기존 고객 검색처럼 **POST body**로 전송(URL·access log 미기록). `%`/`_` 이스케이프, 최소 2자, 테넌트 범위 + 상담원 가시 범위(ACL/스코프) 그대로.

## R2. 상대방 IP

**AS-IS**
- IP는 요청 컨텍스트(`request-context.middleware.ts:45` — XFF 첫 hop)로 읽어 **위젯 노출 제한 판정에만** 사용, 어디에도 저장 안 함. `audit_logs.ip`는 콘솔 사용자용.
- 따라서 기존 대화의 IP는 **복구 불가** — 배포 이후 접속분부터 보임.

**TO-BE**
- 위젯 세션 `ensure` 시 IP 기록(최초 IP + 최근 IP·시각). 콘솔 고객 패널에 표시.

**제약**: IP는 GDPR/CCPA상 개인정보 → 기존 PII 공개 흐름(마스킹 기본, `customer.pii_reveal` 권한자만 원문 + 감사 1행)에 맞춤. 스키마 변경(`sessions` 컬럼) → SQL 선적용 필요. 메신저(카카오 등 릴레이) 채널은 고객 IP를 받지 않으므로 "—".

## R3. 세션번호·이름 통일

**AS-IS** (같은 `sessionLabel` "세션 {{id}}" 문구에 서로 다른 id)

| 위치 | 번호 | 이름 |
|---|---|---|
| 목록 행·채팅 헤더 | `conversations.id` (예: 887) | alias → "고객 / 회사"(서명 없으면 HA가 보낸 이름·호텔) |
| 그룹 룸 멤버 라벨·수신자 선택 | `sessions.id` (예: 20796) | alias → 고객명만 |

- 두 경로 모두 `.slice(0, 6)` — 7자리부터 번호가 잘림.
- 그룹 멤버십은 의도적으로 **세션 단위**(대화가 새로 열려도 그룹 유지).

**TO-BE**: 그룹 룸에서도 목록과 같은 번호(그 세션의 **최신 대화 번호**)·같은 이름 규칙. 자르기 제거.

## R4. 세션 887 B2B 고객 미연결

**사실 (스테이징 DB 10/23)**
- 화면의 887 = `conversations.id` 887(tenant 4 go2joy, session 20796, status waiting, prev 883).
- session 20796: `identity_level = claimed`(**서명 없는 identify**), attrs `user_id=laquan10, name=ADMIN123, role=Quản lý, hotel_id=4118, province=Hồ Chí Minh`. `customer_id`·`company_id` NULL.
- `companies` id 4 = `hotel:4118` Lá Hotel Quận 10(파트너 피드 동기화로 생성) — 존재함. 연락처(company_contacts) 0건.
- tenant 4의 claimed 대화 3건(882·883·887) 전부 고객·기업 미연결.

**원인 — 결함이 아니라 설계된 경계**
- `EmbedService.claimIdentity`(PLN-261022 unsigned, 스테이징 전용 `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS`): 서명 없는 신원은 세션에만 'claimed'로 두고 **고객·기업·연락처를 만들지 않음**. 서명 identify만 `upsertCustomer` + `registerAccount`(기업 연락처) + 대화 연결.
- 호텔 카드는 `hotelSummary`가 hotel_id로 찾아 **미검증 표시**로 보여줌 → 화면엔 B2B로 보이지만 '고객' 칸은 "고객 정보가 없습니다".
- 기존 고객 매칭 모달은 고객(사람) 레코드를 이름·이메일로 찾음 — laquan10 고객 레코드가 없어 매칭 대상도 없음.
- **프로덕션**은 unsigned 허용 테넌트가 없어 서명 identify만 받음 → 정상 서명이면 자동 연결. 즉 이 현상은 Go2Joy 서명 구현 전 스테이징 UAT 경로에서만 발생.

**TO-BE**: claimed 사용자도 상담원이 고객·기업에 연결된 상태로 보고, 기업 이전 대화·고객 이력이 이어지게.

## 사용자 흐름

```
상담원 → /live-chat
  ├ 목록 검색 [고객|대화 내용] "환불" → 내용 일치 대화만 + 스니펫 → 클릭
  ├ 대화방 🔍 "환불" → 3건 중 1 ↑↓ → 해당 메시지로 스크롤·하이라이트
  ├ 고객 패널 → IP 203.0.113.*** (공개 권한자: [보기] → 원문 + 감사)
  ├ 그룹 룸 → 멤버 "ADMIN123 / Lá Hotel Quận 10 · 세션 887" (목록과 동일)
  └ claimed 대화 → 고객 패널에 HA 사용자·기업 연결 상태 표시
```
