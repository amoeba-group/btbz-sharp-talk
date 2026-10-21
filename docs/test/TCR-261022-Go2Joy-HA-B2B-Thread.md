# TCR-261022 — go2joy HA 2단계: 기업고객·연락처 등록 · 계정 대화 연속성 · B2B/B2C 구분

- 근거: [PLN-261022 §3](../plan/PLN-261022-Go2Joy-HA-B2B-Identity-Continuity.md) (2A~2E)
- 브랜치: `session/go2joy-b2b-thread` (main `0b4b049` 기준)
- 실행 일시: 2026-10-22 (로컬)

## 1. 단위 테스트
| ID | 대상 | 케이스 | 결과 |
|---|---|---|---|
| U-1 | `CompanyService` | 키 `hotel:{id}`·hotel_id 없으면 null, 생성 시 서명 속성 반영, 기존 회사 갱신(빠진 필드는 유지), 동시 생성 경합 시 승자 재조회, 연락처 연결 멱등·역할 갱신, 다른 테넌트 id → E5098 | 통과 |
| U-2 | `ThreadService` | 계정 판정(회사 우선·고객·게스트 null), 직전 대화 조회 범위(회사/고객), sticky(창 안 활성 상담원 / 창 밖·정지 상담원·테넌트 꺼짐·0시간 → 없음), 위젯 목록 `self`(본인만 + 동료 건수)·`company`(전체)·게스트, AI 발췌(날짜·Customer/Support·전화번호 마스킹, 꺼짐·직전 없음·30일 초과 → 없음) | 통과 |
| U-3 | `ChatService` 스레드 | 새 대화에 테넌트·고객·회사·직전 대화 기록, 게스트는 계정 없음, 열린 대화 재사용, escalate sticky(규칙 후보에 있으면 직전 상담원만, 다른 사람만 고른 규칙이면 유지, broadcast면 직전 상담원, sticky 없으면 그대로) | 통과 |
| U-4 | `EmbedService.identify` | 서명된 hotel_id → 고객 `b2b_contact`·회사 upsert·연락처 연결·세션 회사·열린 대화 계정 기록, hotel_id 없음 → 회사 없음·유형 불변, 등록 실패해도 identify 성공 | 통과 |
| U-5 | `SessionMapper` | `threadAvailable` = 테넌트 켜짐 AND verified AND 고객 있음 | 통과 |
| U-6 | 라우터 | 조건 `customer_type` 매칭(b2b_contact/b2c/미상), 이 조건이 있으면 고객 행을 읽음 | 통과 |
| U-7 | `RagService.answer` | 이전 대화 블록·규칙 추가, 금지형 문구 없음(#597 교훈), 메시지 이력에는 섞이지 않음, 없으면 블록 없음 | 통과 |

**전체**: `apps/api` 244 스위트 / 2,428개 통과 · `packages/types` 186개 통과 · API `tsc`·`nest build`, web·widget `tsc`·`vite build` 통과 · `npm run i18n:check` 6개 언어 complete.

## 2. 로컬 통합 (API :3099 `DB_SYNCHRONIZE=false` + `sql/261022-b2b-company-thread.sql`, 테넌트 1 `thread_continuity=1` 임시)
| ID | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| I-1 | 엔티티 변경 후 실제 부팅 | `successfully started` | 통과 |
| I-2 | 직원 A(`ha:1001`, hotel 1721) identify | `authenticated`·`threadAvailable` true, 로그 `company 1` | 통과 |
| I-3 | A 대화 → 종료 → **새 세션(다른 PC)**에서 identify | `GET /chat/thread` = 직전 대화 1건(own, 메시지 2) | 통과 |
| I-4 | 새 세션에서 질문 | 새 대화 `customer_id 3 · company_id 1 · prev_conversation_id 25` | 통과 |
| I-5 | 새 대화에서 상담원 연결(직전 대화 담당 = 상담원 1) | 로그 `handoff sticky to agent 1 (conversation 26 continues 25)` | 통과 |
| I-6 | 같은 호텔 직원 B(`ha:1002`) identify → thread | 본인 대화 0, `colleagueCount 2` | 통과 |
| I-7 | 게스트 세션 thread | 403 `E5099` | 통과 |
| I-8 | `GET /companies`, `/companies/:id` | 회사 1건(남부, 연락처 2, 대화 2), 연락처 이름 마스킹·역할 | 통과 |
| I-9 | `GET /agent/conversations/26/company-conversations`, 상세 `company` | 다른 대화 1건(#25), `{id:1, otherConversations:1}` | 통과 |
| I-10 | `POST /customers/search {customer_type: b2b_contact}` | 직원 2명, 유형 `b2b_contact` | 통과 |
| I-11 | 위젯(로컬 점검 페이지 + embed.js + 서명 identify) | "이전 대화 보기" 노출 → 클릭 시 구분선 "Earlier conversation · 날짜"와 이전 메시지, 읽던 위치 유지 | 통과(캡처) |
| I-12 | 콘솔 고객 › 기업고객 탭·상세 모달, 라이브챗 헤더 "기업" 배지·"이 기업(호텔)의 이전 대화 1건" 목록 | 표시·클릭 이동 | 통과(캡처) |

로컬 데이터(테넌트 1 스위치·시크릿·테스트 회사/연락처/대화·고객 유형)는 검증 후 되돌렸다.

## 3. 스테이징 통합 (배포 후)
| ID | 시나리오 | 기대 |
|---|---|---|
| S-1 | SQL 선적용 → `check-migrations.sh` | 미적용 0 |
| S-2 | 배포 확인: 부팅 로그, `GET /companies` 401(미인증), 컨테이너 dist에 `ThreadService` | 배포됨 |
| S-3 | go2joy(테넌트 4) `thread_continuity=1` | HA 서명 전에는 화면 변화 없음(게스트는 대상 아님) |
| S-4 | 스테이징 시크릿 서명 identify로 I-2~I-10 재현 | 동일 |

## 4. 엣지 케이스 메모
- 서명에 `hotel_id`가 없으면(체인 "전체 호텔") 회사 없이 연락처만 등록된다. 이미 `b2b_contact`인 고객은 유형을 되돌리지 않는다.
- 호텔을 바꿔 다시 identify하면 세션 회사가 바뀌고, 이후 새 대화는 새 회사 스레드에 붙는다. 이미 열린 대화도 새 회사로 다시 기록된다(identify 시점 갱신).
- 종료된 대화 행은 다시 열지 않는다. 새 대화 + `prev_conversation_id` + sticky 배정으로 연속성을 만든다(PLN §3.1 D13).
- AI 이전 대화 발췌는 검색어(retrievalQuery)에 넣지 않는다 — 이전 주제가 새 질문의 검색을 끌고 가는 #597 사례 방지.
