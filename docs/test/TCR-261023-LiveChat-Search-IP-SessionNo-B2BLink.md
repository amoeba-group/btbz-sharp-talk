# TCR-261023 — 라이브챗: 대화 내용 검색 · 상대방 IP · 세션번호 통일 · B2B 고객 연결

- PLN: `docs/plan/PLN-261023-LiveChat-Search-IP-SessionNo-B2BLink.md` (승인 D1~D4 권장안)
- 실행일: 2026-10-23 — 로컬 API :3110(`DB_SYNCHRONIZE=false`, SQL 수동 적용, `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS=1`) + 콘솔 vite :5183

## 1. 단위 테스트

신규 `apps/api/src/domain/agent/livechat-search-ip.spec.ts` (21건)

| # | 케이스 | 결과 |
|---|---|---|
| U1 | LIKE 와일드카드(`%` `_` `\`) 문자 그대로 이스케이프 | PASS |
| U2 | 2자 미만(공백 제외) 검색어 거부 | PASS |
| U3 | 스니펫: 대소문자·성조 무시로 위치 찾기(`hoan tien` → `HOÀN tiền`), 앞뒤 말줄임 | PASS ×2 |
| U4 | XFF 오른쪽부터 읽기 — 브라우저가 보낸 첫 hop(`6.6.6.6`) 무시 | PASS |
| U5 | 짧은 체인은 가장 왼쪽, 헤더 없으면 소켓, `::ffff:` 제거 | PASS |
| U6 | IP 마스킹 v4 `203.0.113.***` / v6 앞 4그룹 | PASS |
| U7 | ensure: 새 세션 first/last 기록 · 같은 IP 1시간 내 재기록 없음 · 변경 시 last만 · 기존 세션 first 채움 | PASS ×4 |
| U8 | 대화방 검색 E5103 · 타 테넌트 404 · 테넌트/대화 범위·이스케이프·오래된 순 | PASS ×3 |
| U9 | 상세 IP 마스킹+changed · 공개 시 감사 `session.ip_revealed`(IP 원문 미기록) | PASS ×2 |
| U10 | claimed 대화의 고객 패널 `unverified:true`, 세션 고객은 검증 그대로 | PASS ×2 |
| U11 | 그룹 멤버: 대화 번호(open→latest)·기업·호스트 이름·대화에 연결된 고객 | PASS |
| U12 | `ThreadService.claimedAttribution` 고객·기업 조회, claimed 아님/기록 없음 → null | PASS ×2 |

기존 스펙 갱신(의도된 동작 변경 D4)
- `embed.service.spec.ts`: claimed identify가 고객 행 생성(이름만, 이메일·전화 없음), 대화 연결, 세션 고객·기업 NULL 유지, 기업 생성·수정 안 함(`upsertFromIdentity` 미호출) + 신규 2건(기존 기업에 연락처 연결 / 기존 고객 이름·유형 덮어쓰지 않음)
- `thread.service.spec.ts`: claimed 스레드 필터 = claimed 세션 범위(대화의 `customer_id IS NULL` 조건 제거 — 검증 세션은 강등되지 않으므로 목록에 없음)
- `chat.service.thread.spec.ts`: 새 대화가 claimed 귀속(고객 100·기업 4)을 받음 + 비허용 테넌트는 조회 안 함

`npx jest src/domain` → **219 suites / 2,193 tests 통과**. `apps/api`·`apps/web` `tsc --noEmit` 통과, `npm run i18n:check` 6언어 complete, `npm run radius:check` 통과.

## 2. 통합 (실 HTTP, 로컬 DB)

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| I1 | `POST /agent/sessions/search {q:"a"}` / `{}` | 400 E5103 | 일치 |
| I2 | 목록 내용 검색 `Returns (U` | 4건 + 스니펫·count·messageId | 일치 |
| I3 | `đoi soat` / `ĐỐI SOÁT` (대화방) | `Đối soát tháng 9…` 1건 | 일치 (`doi`는 `đ`와 불일치 — DB 콜레이션상 별개 글자) |
| I4 | 종료 대화 검색 `status=ended` | 25·26 | 일치 |
| I5 | `50%` | 리터럴 `%` 포함 대화만(27) | 일치 |
| I6 | 다른 테넌트/없는 대화방 검색 | 404 | 404 |
| I7 | ensure + `XFF: 6.6.6.6, 203.0.113.45, 172.18.0.1` | first/last=203.0.113.45 | 일치(위조값 무시) |
| I8 | 같은 세션 다른 IP(198.51.100.7) | last만 갱신, 상세 `198.51.100.***`·changed | 일치 |
| I9 | `GET …/ip/reveal` | 원문 + 감사 `session.ip_revealed` metadata `{conversationId}` | 일치 |
| I10 | claimed identify(hotel_id=임시 기업, email 포함) | 세션 claimed·고객/기업 NULL, 대화 고객5·기업2, 고객 `b2b_contact`·email 없음, 연락처 role | 일치 |
| I11 | 대화 상세 | customer.unverified, hotel.verified=false, company 배지 | 일치 |
| I12 | 대화 종료 후 새 메시지 | 새 대화 고객5·기업2·prev=28 (claimed 스레드 연결 유지) | 일치 |
| I13 | 그룹 상세 | 멤버 targetConversationId 29·고객명·기업명 | 일치 |
| I14 | API 실부팅(엔티티 컬럼 3개) | `Nest application successfully started` | 확인 |

임시 데이터(세션 132·133, 대화 27~29, 고객 5, 기업 2, 그룹 6) 삭제 확인(잔여 0).

## 3. 화면 (콘솔 /live-chat)

| # | 확인 | 결과 |
|---|---|---|
| S1 | [고객/대화 내용] 토글 → `refund` → 일치 문장 하이라이트·"2건 일치" | 확인 |
| S2 | 결과 클릭 → 대화방 [찾기] 바가 같은 검색어로 열림 2/2, 일치 메시지 테두리(현재 강조) | 확인 |
| S3 | 고객 패널 IP `198.51.100.***` + "세션 시작 이후 바뀜" → 👁 → 원문 + "최초 접속 203.0.113.45" + 기록 안내 | 확인 |
| S4 | claimed 대화: "미검증 — 서명 없는 호스트 로그인" 배지, 이름, 헤더 "이 기업(호텔)의 이전 대화 1건" | 확인 |
| S5 | 그룹 방: "TMP ADMIN / TMP Claim Hotel · 세션 29" = 목록 "세션 29" | 확인 |

## 4. 엣지 / 미검증
- 로컬 접속(::1)은 마스킹이 `::1:***`로 보임 — 실제 공인 IPv6에는 앞 4그룹 규칙이 적용됨(표시만의 문제).
- 위젯 이전 대화(`GET /chat/thread`)는 로컬 테넌트 `thread_continuity=0`이라 E5099 — claimed 범위 변경은 단위 테스트(U·thread spec)로 확인, 스테이징 go2joy(=1)에서 실측 예정.
- 스테이징 기존 claimed 대화(882·883·887) 보정은 배포 후 `backfill-claimed-accounts.js --dry-run` → 적용, RPT에 기록.
