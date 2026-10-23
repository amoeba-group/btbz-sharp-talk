# PLN-261023 — 라이브챗: 대화 내용 검색 · 상대방 IP · 세션번호 통일 · B2B 고객 연결

- REQ: `docs/analysis/REQ-261023-LiveChat-Search-IP-SessionNo-B2BLink.md`
- 상태: **승인됨 (2026-10-23, 권장안 D1~D4)**

## 결정 사항

| # | 결정 | 권장안 | 대안 |
|---|---|---|---|
| D1 | 검색 범위 | **목록(내용 일치 대화) + 대화방 안 찾기 둘 다** | 대화방 안 찾기만 |
| D2 | IP 노출 | **마스킹 기본(`203.0.113.***`), `customer.pii_reveal`(master·director)만 원문 + 감사 1행** | 상담원 전원 원문 |
| D3 | 통일 번호 | **대화 번호(목록·헤더·알림의 887) — 그룹 룸은 그 세션의 최신 대화 번호** | 세션 번호(20796)로 전부 변경 (알림 "대화 #887"과 어긋남) |
| D4 | 서명 없는(claimed) HA 사용자 | **unsigned 허용 테넌트(스테이징 전용)에서 claimed identify도 고객(B2B)·기업 연락처를 등록하고 대화에 연결, '미검증' 표시. 세션 `customer_id`는 비워 둠(주문 조회·AI 주문 문맥 등 고객 권한 기능은 계속 닫힘)** | 자동 연결 없이 상담원이 패널에서 [이 기업·사용자로 연결] 수동 버튼 |

D4 참고: 프로덕션은 unsigned 허용 테넌트가 없어 영향 없음. Go2Joy가 서명을 붙이면 같은 user_id로 같은 고객 행이 이어짐(`external_customer_id` 키 동일).

## 단계

### S1 — 대화 내용 검색 (스키마 변경 없음)
- API `apps/api/src/domain/agent/`
  - `POST /agent/sessions/search` body `{ q, status?, channel?, ai_agent_id?, page?, size? }` — `listSessions`와 같은 테넌트·스코프·ACL 조건 + `EXISTS (SELECT 1 FROM messages m WHERE m.tenant_id=? AND m.conversation_id=c.id AND m.body LIKE ?)`; 응답 행에 `matchSnippet`(일치 위치 ±40자), `matchCount`.
  - `POST /agent/conversations/:id/messages/search` body `{ q }` → `{ items: [{ id, createdAt, senderType, snippet }], total }` (최대 200건, 시간순).
  - `%`·`_`·`\` 이스케이프, 2자 미만 E-코드 거부, `CONVERSATION_HANDLE`.
  - 상한: 내용 검색은 최근 180일 대화로 제한(풀스캔 방지; 스테이징 2만 건 기준 측정 후 확정).
- 콘솔 `LiveChatPage.tsx`
  - 목록 검색창 옆 세그먼트 [고객 | 대화 내용]; 내용 모드면 행 아래 스니펫(일치어 `<mark>`).
  - 대화방 헤더 🔍 → 검색 바(n/총, ↑↓, Esc 닫기). 아직 로드 안 된 메시지면 `before_id`로 해당 지점까지 로드 후 스크롤·하이라이트.
  - i18n 6언어.

### S2 — 상대방 IP (스키마 변경 → SQL 선적용)
- `sql/261023-session-ip.sql`: `sessions` 에 `first_ip VARCHAR(45) NULL`, `last_ip VARCHAR(45) NULL`, `last_ip_at DATETIME NULL` (+ `migrations:manifest`, `init-sql` 재생성은 별건).
- 엔티티 `session.entity.ts` 컬럼 3개(`type` 명시 — 부팅 크래시 함정).
- `session.service.ts ensure`: `getRequestContext()?.ip` 기록 — 최초면 first, 바뀌었거나 1시간 경과 시 last 갱신(매 폴링 쓰기 방지).
- 대화 상세 응답 `ip: { masked, last, first?, at }` — 기본은 마스킹(IPv4 마지막 옥텟, IPv6 앞 4그룹만). `GET /agent/conversations/:id/ip/reveal`(`CUSTOMER_PII_REVEAL`, 분당 30회) → 원문 + 감사 `session.ip_revealed`.
- 개인정보 처리 문서(privacy 고지 문구 수집 항목)에 "접속 IP" 추가 여부 확인 — 기존 고지 버전 상승은 하지 않음(운영자 판단, 메모리 규칙).
- 콘솔 고객 패널에 IP 행 + [보기].

### S3 — 세션번호·이름 통일 (스키마 변경 없음)
- API `chat-group.service.ts detail`: 멤버마다 `latestConversationId`, `companyName`, claimed 이름·호텔 포함.
- 웹: 공용 `conversationLabel({ alias, customerName, companyName, identity, conversationId })` 하나로 목록·헤더·그룹 멤버·수신자 선택에 사용. `.slice(0, 6)` 제거.

### S4 — claimed HA 사용자 B2B 연결 (D4 권장안 기준, 스키마 변경 없음)
- `embed.service.ts claimIdentity`: unsigned 허용 테넌트에서 `upsertCustomer`(claimed user_id) + `registerAccount`(hotel_id → 기업 연락처) 호출, 결과를 **대화**(`conversations.customer_id/company_id`)와 `sessions.company_id`에 연결. `sessions.customer_id`는 NULL 유지.
- `agentService.customerContext`: 세션 고객이 없으면 대화의 `customer_id`로 패널 표시 + `verified:false` → '미검증' 배지.
- 고객 패널: 고객이 없을 때도 claimed 이름·역할·user_id를 '미검증'으로 표시.
- 스테이징 기존 claimed 대화 3건(882·883·887) 백필 스크립트 1회(드라이런 → 적용).

### S5 — 테스트·문서
- 단위: 검색 이스케이프·스코프·스니펫, IP 기록 주기·마스킹·감사, 그룹 라벨, claimed 연결(서명 없는 테넌트/허용 안 된 테넌트 거부 유지).
- 실측: 로컬 HTTP → 스테이징(go2joy 887 패널, 그룹 룸 번호, IP 표시) → TCR/RPT.

## 와이어프레임

```
┌ 실시간 상담 ───────────────────────────────────────────────────────────────────────┐
│ [고객|대화 내용▾] [환불            🔍]│ ADMIN123 / Lá Hotel Quận 10  세션 887  [🔍]  │
│ ─────────────────────────────────────│ ┌ 🔍 [환불        ]  2 / 3  [↑][↓] [✕] ┐    │
│ ● ADMIN123 / Lá Hotel Quận 10        │ └──────────────────────────────────────┘    │
│   세션 887 · 대기                     │  고객: … 예약 [환불]은 언제 …  ← 하이라이트  │
│   "…예약 ⟦환불⟧은 언제 되나요…"       │                                              │
│ ○ Nguyen / Hotel ABC                  │                                              │
│   세션 880 · 종료                     ├ 고객 ──────────────────────────────┐        │
│   "…⟦환불⟧ 규정 안내…"                 │ 이름   ADMIN123   [미검증]         │        │
│                                       │ 역할   Quản lý · laquan10          │        │
│                                       │ IP     203.0.113.***   [보기]      │        │
│                                       │ 유형   B2B · Lá Hotel Quận 10      │        │
│                                       │ [기존 고객 매칭] [신규 고객으로 저장]│        │
│                                       └────────────────────────────────────┘        │
└────────────────────────────────────────────────────────────────────────────────────┘

┌ 그룹 룸: 호치민 프로젝트 (3명) ─────────────────────────────┐
│ ADMIN123 / Lá Hotel Quận 10 · 세션 887 : 안녕하세요…        │  ← 목록과 같은 이름·번호
│ 받는 사람 [ADMIN123 / Lá Hotel Quận 10 · 세션 887 ▾]        │
└─────────────────────────────────────────────────────────────┘
```

## 부작용 분석

| 영역 | 영향 | 대응 |
|---|---|---|
| DB 부하 | 본문 LIKE 스캔 | tenant_id 인덱스 + 기간 상한, 실측 후 필요 시 ngram FULLTEXT 별건 |
| 개인정보 | 검색어·IP는 PII | 검색 POST body, IP 마스킹·공개 감사, 로그에 원문 IP·검색어 미기록 |
| 스키마 | `sessions` 3컬럼 | PR `## Migration`, 스테이징·프로덕션 SQL 선적용 후 코드 배포 |
| 세션 쓰기 | ensure마다 UPDATE 우려 | 변경 시·1시간 주기만 |
| 그룹 | 멤버 번호 바뀜(세션→대화) | 표시만 변경, 멤버십(세션 단위) 그대로 |
| 고객 권한 | claimed 고객이 주문·AI 주문 문맥 열람 | `sessions.customer_id` NULL 유지로 차단, 테스트로 고정 |
| 프로덕션 | unsigned 허용 없음 | S4는 동작 변화 없음 |
| 기존 데이터 | IP는 과거 대화 없음 | 배포 이후 접속분부터, 패널은 "—" |

## 배포
S2 SQL 스테이징 선적용 → 스테이징 배포 → 실측(S1~S4) → 프로덕션 백업 → SQL → production ff → 배포.
