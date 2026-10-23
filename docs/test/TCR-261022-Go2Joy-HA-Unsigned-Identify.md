# TCR-261022 — go2joy HA: 미서명 identify 임시 수용(`claimed`) — 테스트 케이스·결과

- 근거: [SPEC-261022](../plan/SPEC-261022-Go2Joy-HA-Unsigned-Identify.md) §8–9 · [PLN-261022](../plan/PLN-261022-Go2Joy-HA-Unsigned-Identify.md)
- 브랜치: `feature/go2joy-ha-unsigned-identify` (base main `18559f08`)

## 1. 단위 테스트 (자동)
| ID | 파일 | 케이스 | 결과 |
|---|---|---|---|
| U1 | `embed/embed.service.spec.ts` | 허용 테넌트 + 잘못된 hash → `claimed`, 속성 정규화(`South`→`south`, NFC) + `user_id`·`name`, 고객·기업·대화 귀속 없음, 동의 `pending` 유지, 캐시 삭제 | ✅ |
| U2 | 〃 | 허용 테넌트 + 시크릿 없음 → `claimed`(`user_id`만) | ✅ |
| U3 | 〃 | `verified` 세션 + 잘못된 hash → 401, 세션 불변 | ✅ |
| U4 | 〃 | 비허용 테넌트(`2, 3`) → 401, `guest` 유지 / 목록 미설정 → 401 | ✅ |
| U5 | 〃 | email·phone은 어디에도 저장되지 않음 | ✅ |
| U6 | 〃 | `claimed` → 올바른 서명 → `verified`, 고객 `ha:8818` 생성, 속성은 서명 값으로 교체(`user_id`·`name` 제거), host_terms 동의 | ✅ |
| U7 | 〃 | province만 → 지역표로 region 보정(`Đà Nẵng`→`south_center`) | ✅ |
| U8 | `session/session.service.spec.ts` | `customerDisplayName`: 고객 이름 / `claimed` → `name`(고객 조회 없음) / `guest` → null | ✅ |
| U8b | 〃 | `requireCustomerId`: `claimed`(고객 없음) → 401 — 고객 데이터 게이트 그대로 | ✅ |
| U9 | `session/session.mapper.spec.ts` | `claimed` → `customerName` 표시, `authenticated=false`, `threadAvailable=false`(연속성 스위치 켜져 있어도) | ✅ |
| U10 | `agent/agent.service.listsessions.spec.ts` | `toSessionResponse` identity: `claimed` → `verified:false`·`userId`·`name`, `verified`/미지정 → `verified:true`, 속성 없음 → null | ✅ |
| U11 | `ai-engine/handoff-router.service.spec.ts` | `claimed` 세션이 region 규칙에 걸림, `identity_level in [claimed]` 조건 일치, `verified`에는 불일치 | ✅ |
| U12 | `agent/agent-alert-reminder.service.spec.ts` | 상담원 알림 메일: `claimed`면 `Hotel · Region · Unverified` | ✅ |
| U13 | `embed/unsigned-identify.spec.ts` | 허용 목록 파싱(공백·빈 값), `claimedUserId`, `threadEligible`(verified 항상 / claimed는 허용 테넌트일 때만, 목록에서 빠지면 닫힘) | ✅ |
| **P6** | | | |
| U14 | `embed/embed.service.spec.ts` | 같은 세션·같은 사용자 identify 3회 → 작업 로그 1행(`host.user_signed_in`, `actor_type=host`, `actor_id=세션`, `metadata={level,hotelId,region}`), 이름·이메일·userId 미기록 | ✅ |
| U15 | 〃 | 사용자 변경(ha:1→ha:2) → 재기록, claimed→verified 승격 → 재기록, 같은 verified 반복 → 미기록 | ✅ |
| U16 | 〃 | 감사 쓰기 실패해도 identify 성공 / 거부된 identify는 기록 없음 | ✅ |
| U17 | `audit/audit.service.spec.ts` | `action_prefix=agent., host.` → `(LIKE :prefix0 OR LIKE :prefix1)` | ✅ |
| U18 | 〃 | `host` 행 이름: claimed → `identity_attributes.name`, verified → 고객 이름, 세션 없음 → null | ✅ |
| **P7** | | | |
| U19 | `chat/thread.service.spec.ts` | `accountOf`: claimed → `claimedUserId`, `user_id` 없으면 guest, 고객이 있으면 고객 우선 | ✅ |
| U20 | 〃 | `previousOf`(claimed): 같은 `user_id`의 claimed 세션만, `customer_id IS NULL`인 대화만 / 세션 없으면 대화 조회 안 함 | ✅ |
| U21 | 〃 | 위젯 페이지(claimed): 본인 대화만, `colleagueCount=0`, `company` 범위 설정이어도 무시 | ✅ |
| U22 | `chat/chat.service.thread.spec.ts` | claimed 새 대화: 고객·기업 NULL, `prev_conversation_id` = 직전 claimed 대화 / 허용 목록에서 빠지면 연결 안 함 | ✅ |
| U23 | `session/session.mapper.spec.ts` | claimed + 허용 테넌트 + 연속성 켜짐 → `threadAvailable=true`, 스위치 꺼짐·목록 밖 → false, `authenticated`는 계속 false | ✅ |
| **P8** | | | |
| U24 | `chat/caller-context.util.spec.ts` | verified 블록 전체 형식 / claimed는 `Verified: no`, `user_id` 미포함 / 게스트·호스트 속성 없는 로그인 고객·속성 없는 claimed → 없음 | ✅ |
| U25 | 〃 | 주입 방어: 개행·`CALLER_END`·`CONTEXT_START`가 든 이름·호텔명 → 블록 5줄 유지, 종료 표식 1개, 80자 상한 | ✅ |
| U26 | `chat/rag.service.spec.ts` | `answer`에 caller → 블록·규칙 포함, CONTEXT 뒤 위치 / caller 없음 → `CALLER` 문자열 없음 / `answerWithoutKnowledge`도 포함 | ✅ |
| U27 | `chat/chat.service.memory.spec.ts` | claimed 세션 턴 → `rag.answer` 11번째 인자에 이름·호텔·`Verified: no`, 재사용 저장 안 함 / 인사 경로에도 전달 / 게스트는 undefined | ✅ |

## 2. 정적 검사·빌드
| 항목 | 결과 |
|---|---|
| `packages/types` build, `apps/api` `tsc --noEmit` | ✅ 오류 0 |
| `apps/web` `tsc --noEmit` | ✅ 오류 0 |
| `npm run i18n:check` | ✅ es/ko/vi/ja/zh complete |
| 영향 스위트(embed·session·agent·handoff-router) | ✅ 28 스위트 / 330개 |
| 영향 스위트 P6·P7(embed·session·thread·chat thread·audit·agent) | ✅ 31 스위트 / 325개 |
| 전체 `apps/api` 테스트 | ✅ 246 스위트 / 2,470개 (P6·P7·P8 포함) |
| `packages/types` 테스트 | ✅ 12 스위트 / 186개 |
| 전체 `npm run build`(turbo) | ✅ 6/6 (api·web·widget·pwa·types·common) |

## 3. 통합 시나리오 (스테이징 배포 후 — P5)
| ID | 시나리오 | 기대 |
|---|---|---|
| I-1 | HA UAT(go2joysupport) 로그인 → 위젯 | `POST /public/embed/identify` 200, 응답 `customerName`, 헤더에 이름, **동의 배너 유지**, API 로그 `identify claimed — unsigned` |
| I-2 | 콘솔 › 라이브챗 목록 | 이름(`G2J SUPPORT`) + `A In Hotel Del Luna · 남부` + **미검증** 배지 |
| I-3 | 콘솔 › 대화 상세 헤더 | 호텔·권역·역할 배지 + **미검증** 배지(툴팁) |
| I-4 | 위젯에서 상담원 연결 요청 | `region=south` 규칙으로 배정, 알림 메일 `· Unverified` |
| I-5 | `claimed` 세션 토큰으로 `/chat/thread` | (P7) 허용 테넌트 + 연속성 켜짐 → 200, 같은 `user_id`의 이전 claimed 대화만 / 그 외 403 `E5099` |
| I-6 | 같은 세션 토큰으로 알림·DSAR API | 401(고객 없음) |
| I-7 | 비허용 테넌트(ivyusa)에 잘못된 hash | 401 `E5048`, 동작 불변 |
| I-8 | 로그아웃 상태 HA 로그인 페이지 | identify 호출 여부 확인 — 호출되면 Go2Joy에 "로그인 상태에서만" 요청 |
| I-9 | 설정 › 라우팅 규칙 › 조건 | 신원 수준 선택지에 "미검증(서명 없음)" |
| I-10 | (P6) HA 로그인 → 콘솔 › 작업 로그 | `G2J SUPPORT [HA] [미검증]` · "HA 사용자 로그인" · `session N` 1행. 페이지 이동·새로고침으로 행이 늘지 않음 |
| I-11 | (P6) 작업 로그 › 상담원 필터 선택 | HA 행이 사라지고 그 상담원 행만 |
| I-12 | (P7) 대화 종료 → 같은 `ha:{userSn}`으로 새 세션 로그인 | 위젯 "이전 대화 보기"에 직전 대화, 새 대화 `prev_conversation_id` 설정, AI가 직전 대화 발췌를 받음 |
| I-13 | (P7) 다른 `userId`로 로그인 | 이전 대화 없음(다른 사용자 대화 미노출) |

## 4. 실행 기록
- 2026-10-22 로컬(Node 20.20.2, `npm ci`): §1·§2 전부 통과. 엔티티 변경은 **주석만**(데코레이터·컬럼 불변)이라 TypeORM 메타데이터 영향 없음 — 실제 부팅 확인은 스테이징 배포 시(`Nest application successfully started`).
- 2026-10-22 P6·P7 추가 후: §1·§2 재실행 전부 통과(전체 245 스위트 / 2,460개).
- 2026-10-22 P8 추가 후: 전체 246 스위트 / 2,470개, `npm run build` 6/6.
- §3 통합 시나리오: 스테이징 env `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS=4` 설정·배포 후 실행 예정. **P7 때문에 Go2Joy가 사용자별 `ha:{userSn}`을 보내기 전에는 env를 켜지 않는다**(고정 `go2joysupport`면 모든 HA 사용자가 서로의 대화를 봄).

## 5. 로컬 실연 (2026-10-22, 실제 API 프로세스 + MySQL/Redis/RabbitMQ/Qdrant)
- 환경: 격리 스택 `sharptalk-verify`(127.0.0.1 바인딩, 운영 스택과 별도 프로젝트·볼륨), `node apps/api/dist/main.js` 부팅 로그 `Nest application successfully started`, `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS=1`, 테넌트 연속성 켬. AI는 OpenAI 호환 **로컬 목 서버**(127.0.0.1:9911)로 연결해 실제 프롬프트를 기록.
- 결과: **25/25 통과** (`scratchpad/verify/e2e.py`)

| 영역 | 확인 내용 | 결과 |
|---|---|---|
| P1 | 미서명 identify → 201, `customerName=G2J SUPPORT`, `authenticated=false`, 동의 `pending`, DB `claimed`·고객 NULL·이메일/전화 미저장 | ✅ |
| P8 | 인사 경로 답변 "Chào G2J SUPPORT! …", RAG 프롬프트 CALLER 블록(CONTEXT 뒤)·규칙·내용, `ha:8818`·이메일·전화 미전송, 재사용 저장 0건 | ✅ |
| P7 | 새 대화 `prev_conversation_id` = 직전 claimed 대화·고객 NULL, AI에 직전 대화 발췌, `GET /chat/thread` 이전 claimed 대화 반환, 다른 `user_id`는 빈 목록, verified로 승격된 세션의 대화는 claimed 스레드에서 제외 | ✅ |
| P2 | 콘솔 `/agent/sessions` identity `{verified:false, name, userId, hotel…}` | ✅ |
| P6 | 작업 로그: 세션 3개 × 반복 identify → 3행, 행위자 이름 해석(마스킹), 메타데이터 PII 없음 / 승격 시 `verified` 1행 추가 | ✅ |
| 승격 | 서명 identify → verified·고객 연결·host_terms 동의 `granted`·속성은 서명 값만 / 이후 미서명 호출 401·강등 없음 | ✅ |

## 6. 로컬 화면 실연 (2026-10-22, 헤드리스 Chromium 130 + Vite 개발 서버)
- 구성: HA 모의 페이지(127.0.0.1:8081, Go2Joy UAT와 같은 스니펫·큐, `userId: ha:8818`, `hash: "testing"`) → 위젯(5174) → API(3000). 콘솔(5173)은 시드 마스터로 로그인(로컬 DB 전용 테스트 비밀번호). 캡처는 `docs/log/2026-10-22/verify-*.png`(gitignore).

| ID | 화면 | 결과 |
|---|---|---|
| UI-1 | 위젯 열기 | 헤더 "Hi, G2J SUPPORT", 동의 배너(Accept/Decline) 유지, "Show earlier conversations" 버튼 표시 | ✅ |
| UI-2 | "xin chào" 전송 | AI 답변 "Chào G2J SUPPORT! … A In Hotel Del Luna (id 1721), region south, vai trò Lễ tân, Verified: no." | ✅ |
| UI-3 | 이전 대화 보기 | "Earlier conversation · Oct 22, 2026" 구분선과 직전 claimed 대화 표시 | ✅ |
| UI-4 | 콘솔 라이브챗 | 목록·헤더 이름 마스킹 `G*J S*****T`, 헤더 `Hotel: A In Hotel Del Luna`·`South`·`Lễ tân`·`Unverified`, 목록 행은 주황 방패 아이콘 | ✅ |
| UI-5 | 콘솔 작업 로그 | `G*J S*****T [HA] [Unverified] · HA user signed in · session N`, 승격 세션은 `[HA]`만 | ✅ |

- 실연 중 발견·수정: ① claimed 이름이 콘솔 목록·헤더·작업 로그에서 **마스킹 없이** 보이던 것 → `maskName` 적용(다른 고객 이름과 동일 규칙), 스펙 기대값 갱신 ② 좁은 목록 행에서 "Unverified" 배지가 잘림 → 목록은 아이콘 + 툴팁
- 수정 후 API E2E 재실행 **25/25**
