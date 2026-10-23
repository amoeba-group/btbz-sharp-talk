# PLN-261022 — go2joy HA: 서명 전 임시 신원 수신(미서명 identify → `claimed`)

- 근거: [REQ-261022-Go2Joy-HA-Unsigned-Identify](../analysis/REQ-261022-Go2Joy-HA-Unsigned-Identify.md) · 명세 [SPEC-261022](SPEC-261022-Go2Joy-HA-Unsigned-Identify.md)
- 기준: main `18559f08`, 브랜치 `feature/go2joy-ha-unsigned-identify`
- **UI 변경 있음**(§4 — 콘솔 "미검증" 배지, 세션 목록 이름 대체 표시, 라우팅 조건 선택지 1개). **스키마 변경 없음.**
- 전제 결정(REQ §5 제안): D1ⓐ 환경변수 허용 목록 · D2 고객 레코드 미연결 · D3 동의 배너 유지 · D4 미검증 지역으로 라우팅 · D5 위젯 헤더 이름 표시
- 상태: **승인(2026-10-22, 구현 착수 지시)**

## 1. 동작 정의

| 들어온 identify | 테넌트가 허용 목록에 있음 | 없음 |
|---|---|---|
| 서명 일치 | 현행 `verified`(고객 연결·host_terms 동의·속성) | 현행 |
| 서명 불일치 / 시크릿 없음, 세션이 `guest`·`claimed` | **200, `claimed`**: `identity_attributes` = 5키 + `user_id` + `name`, 고객 미연결, 동의 불변 | 현행 `401 E5048` |
| 서명 불일치, 세션이 이미 `verified` | 현행 `401` — 검증된 세션을 미검증으로 덮지 않음 | 현행 |

- `claimed`에서 이메일·전화는 버린다(REQ C6). `user_id`·`name`은 120자 상한, 개행 제거(기존 normalize 규칙).
- 로그: `identify claimed (unsigned) tenant 4, user go2***, attrs …` — `logger.warn`, 이름은 기록하지 않음.

## 2. 단계

### P1 — API (소)
- `packages/types`: `SESSION_IDENTITY.CLAIMED = 'claimed'`, `ROUTING_CONDITION_ENUM_VALUES.identity_level`에 `'claimed'`.
- `embed/identity-attributes.ts`: `claimedIdentity(userId, name, attributes)` — normalize된 5키 + `user_id`·`name`. 라우팅·콘솔이 읽는 키 목록은 그대로(5키)라 `user_id`·`name`은 라우팅에 영향 없음.
- `embed/embed.service.ts`: 시크릿 없음·서명 불일치 분기에서 `unsignedAllowed(tenantId)`(env `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS`, 쉼표 목록) && 세션이 `verified`가 아니면 `claimIdentity()`로 저장 후 반환(SPEC §3 J2). 속성은 1단계와 같은 `storedIdentityAttributes(…, provinceRegions)`로 정규화. `registerAccount`·`attachOpenConversation`·`upsertCustomer`·동의는 호출하지 않음. `verified` 세션이면 401(J3). 그 외는 현행 throw.
- `session/session.service.ts` `customerDisplayName`: 고객이 없고 `claimed`이면 `identity_attributes.name` → ensure·identify 응답 `customerName` → 위젯 헤더(`headerGreeting = "{name}"`).
- `SessionMapper.authenticated`는 그대로(`customerId` 없음 → false) — 알림·수신거부 등 고객 기능은 계속 잠김.
- 콘솔 API: `agent.service` 세션 상태 조회에 `identityLevel` 추가, `toIdentityResponse(attrs, level)` → `{ hotelId, hotelName, region, province, role, userId, name, verified }`.
- 스펙: `embed.service.spec` — ① 허용 테넌트+잘못된 hash → `claimed`·속성 저장·고객 미연결·동의 불변 ② 비허용 → 401(현행) ③ `verified` 세션+잘못된 hash → 401·불변 ④ `claimed` 후 올바른 서명 → `verified`·고객 연결 ⑤ 이메일·전화 미저장. `session.service` 표시 이름, `handoff-router` `identity_level=claimed` 조건.

### P2 — 콘솔 (소, UI)
- `IdentityBadges`: `verified === false`이면 주황 배지 **미검증** + 툴팁 "호스트가 서명하지 않은 정보 — 표시·라우팅에만 사용" (`livechat` `identity.unverified`·`identity.unverifiedHint`, 6언어).
- 세션 목록·상세 이름 대체 순서: `alias` → `customerName` → **`identity.name`** → `customerEmail` → "Session …".
- 라우팅 규칙 편집기: `identity_level` 선택지 `claimed` 라벨(6언어).
- `npm run i18n:check`.

### P3 — 설정·배포
- 스테이징 백엔드 env: `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS=4`. **프로덕션에는 넣지 않는다.** `CONFIG.md`에 변수·의미·"임시, Go2Joy 서명 후 제거" 기록.
- 스키마 변경 없음 → SQL 선적용 없음. 배포 후 부팅 로그·컨테이너 시각 확인(CLAUDE.md 배포 검증).

### P4 — Go2Joy 요청 (문서)
- REQ §6 내용을 짧은 안내로 전달: 로그인 상태에서만, 로그인 사용자 값으로(`userId = "ha:" + userSn`, 가이드 v1.3 규칙) payload 구성, `hash`는 임시 문자열 유지, 서명 준비 시 교체. 가이드 v1.3 담당(KimIgyong)과 문구를 맞춘다.

### P5 — 검증·TCR·RPT
- HA UAT(go2joysupport)에서: identify 200·`identityLevel=claimed`, 위젯 헤더 "G2J SUPPORT"(배너는 유지), 콘솔 세션 목록에 이름 + "A In Hotel Del Luna · 남부" + **미검증** 배지, 상담원 연결 시 `region=south` 규칙으로 라우팅(로그 `handoff routed by rule …`).
- 비허용 테넌트(ivyusa 등) 잘못된 hash → 401 불변. `claimed` 세션에서 알림·DSAR·`/chat/thread`(E5099)가 고객 데이터를 돌려주지 않음.
- 로그아웃 상태의 HA 로그인 페이지에서 identify가 호출되는지 확인(호출되면 Go2Joy에 수정 요청).
- TCR-261022 · RPT-261022.

### P6 — HA 로그인 → 작업 로그(Work log) 기록 (2026-10-22 추가 요청, **승인 — P7과 함께 진행 지시**)
- 요청: "HA 관리자가 로그인할 때 저장된 세션을 작업 로그에 올려, 콘솔에서 누가 언제 로그인했는지 보이게."
- 현재: 작업 로그(`/work-log`) = 감사 로그(`audit_logs`)에서 `agent.*`만 걸러 보는 화면. 행위자는 콘솔 사용자(`users`)뿐.
- 기록 시점: `identify`로 세션의 신원이 **새로 정해지거나 다른 사용자로 바뀔 때 1회**(guest → claimed/verified, 또는 `user_id` 변경). HA는 페이지마다 identify를 부르지만 같은 세션·같은 사용자면 기록하지 않음 → 새 기기·로그아웃 후 재로그인이 각각 1행.
- 감사 행: `action = host.user_signed_in`, `actor_type = host`, `actor_id = 세션 id`, `target = session:{id}`, `result = success`, `metadata = { level: claimed|verified, hotelId, region }` — **이름·이메일·userId는 저장하지 않음**(감사 메타데이터 PII 금지). 이름은 조회 시 세션에서 해석(claimed: `identity_attributes.name`, verified: 고객 이름). 기록 실패는 identify를 실패시키지 않음.
- 조회 API: `GET /audit`의 `action_prefix`가 쉼표 목록을 받음(`agent.,host.`). `withActorNames`가 `host` 행의 이름을 세션에서 채움.
- 작업 로그 화면: 기본 목록에 `host.*` 포함, 작업 필터에 "HA 사용자 로그인", 행위자 칸에 이름 + `HA` 배지(+ claimed면 `미검증`), 상담원 필터를 고르면 `actor_type=user`로 한정(세션 id와 사용자 id 충돌 방지). i18n 6언어.
- 플랫폼 감사 화면도 같은 테이블을 읽으므로 `host` 행이 보임(이름 해석 공유).
- 스키마 변경 없음(`actor_type` varchar(16)에 `host`). 테스트: 기록 1회·중복 없음·사용자 변경 시 재기록·메타데이터 PII 없음·이름 해석·접두사 목록 필터.

```
설정 › 작업 로그
┌ 기간 [2026-10-22]~[2026-10-22]  상담원 [전체 ▾]  작업 [전체 ▾ | HA 사용자 로그인]              ┐
├──────────────────┬──────────────────────────────┬──────────────────────┬───────────────┬──────┤
│ 시간             │ 행위자                        │ 작업                  │ 대상           │ 결과 │
├──────────────────┼──────────────────────────────┼──────────────────────┼───────────────┼──────┤
│ 10/22 14:05:12   │ G2J SUPPORT [HA] [미검증]     │ (HA 사용자 로그인)    │ session 18921  │ 성공 │
│ 10/22 14:06:40   │ Nguyễn An                     │ (대화 수락)           │ conversation 9 │ 성공 │
│ 10/22 14:07:02   │ Nguyễn An                     │ (답변 전송)           │ conversation 9 │ 성공 │
└──────────────────┴──────────────────────────────┴──────────────────────┴───────────────┴──────┘
```

### P7 — `claimed` 대화 연속성 (2026-10-22 추가 요청, **승인: 결정 D7ⓐ·D8ⓐ**)
- 요청: "identify 두 경로를 모두 살리고, 대화도 이어서 불러오게."
- 결정(사용자 선택 2026-10-22):
  - **D7ⓐ 별도 claimed 스레드** — 고객 레코드를 만들지 않고, 같은 테넌트의 `claimed` 세션 중 `identity_attributes.user_id`가 같은 세션들의 대화를 하나의 스레드로 본다. `claimed`는 `verified` 대화를 절대 보지 않는다. 범위는 **본인만**(호텔 단위·동료 건수 없음).
  - **D8ⓐ 승격 시 병합 안 함** — 나중에 서명이 붙어 `verified`가 되면 검증 스레드는 새로 시작. claimed 대화는 콘솔 이력에 그대로 남음.
- 동작: 새 대화에 `prev_conversation_id` = 같은 `user_id`의 직전 claimed 대화 → 기존 장치가 그대로 동작(AI 직전 대화 발췌 D14, 직전 상담원 우선 배정 D13). 위젯 `threadAvailable`·`GET /chat/thread`가 `claimed`도 허용(허용 목록 테넌트 + 연속성 스위치 켜짐 + `user_id` 있음).
- 조회 방식: 대화 행에는 `user_id`가 없으므로 `sessions`를 조인해 `identity_level='claimed'` + `JSON_EXTRACT(identity_attributes,'$.user_id')`로 찾는다. **스키마 변경 없음**(스테이징 규모에서 충분, 프로덕션 비활성).
- 전제·위험: Go2Joy가 지금처럼 고정 `go2joysupport`를 보내면 모든 HA 사용자가 서로의 대화를 본다 → **Go2Joy가 사용자별 `ha:{userSn}`을 보내기 전에는 스테이징 env를 켜지 않는다**(P3 순서 조정). 위조한 `user_id`로 그 사람의 claimed 대화를 볼 수 있음 — 스테이징 임시·미검증 표시로 감수(REQ C1).
- 테스트: claimed 계정 해석, 직전 대화 연결, 다른 `user_id`·verified 대화 미노출, 스위치 꺼짐·목록 밖 403, 매퍼 `threadAvailable`.

```
위젯(HA, claimed, 같은 ha:8818로 다시 로그인)
┌──────────────────────────────────┐
│ G2J G2J SUPPORT    (🌐EN)(⚙)(X)  │
│        [ 이전 대화 보기 ]          │ ← claimed도 표시(본인 대화만)
│ ── 2026-10-22 ──────────────────  │
│  나: Làm sao đổi giá phòng?       │ ← 직전 claimed 대화
│  JoyBot: …                         │
│ ── 오늘 ────────────────────────  │
│  JoyBot: Dear Hotel Partner~ …    │
└──────────────────────────────────┘
```

### P8 — AI에 "누가 묻는가" 주입 (2026-10-22 추가 요청, **승인 — D9 이름 포함**)
- 확인 결과(AS-IS): 신원은 라우팅·콘솔·위젯 헤더에만 쓰이고 **AI 프롬프트에는 없었다** — `rag.answer`(본 답변)와 `answerWithoutKnowledge`(인사·잡담) 모두 페르소나·규칙·이력·근거·주문·직전 대화만 받음. "우리 호텔"이 무엇인지 모르고 인사는 늘 "Dear Hotel Partner".
- 변경: 호스트가 identify한 세션(verified/claimed + 호스트 속성)에만 `CALLER_START … CALLER_END` 블록(이름·호텔(id)·성·권역·역할·`Verified: yes|no`)과 규칙(호칭·"내 호텔" 이해용, 지시 아님, 사실은 CONTEXT, `Verified: no`면 계정 관련 확인 금지)을 두 프롬프트에 넣는다. 검색어에는 넣지 않는다(직전 대화와 같은 원칙). Shopify 등 호스트 속성이 없는 세션은 변화 없음.
- **D9(사용자 선택 2026-10-22): 이름 포함.** 이름은 PII로 AI 제공자(미국)에 전달됨 → Go2Joy 개인정보 고지(G4·G5)에 "AI 처리에 사용자 표시 이름 포함"을 반영해야 함. `userId`는 넣지 않음.
- 프롬프트 주입 방어: 호스트 값(claimed는 누구나 조작 가능)은 한 줄·80자, 제어문자·`*_START/_END` 표식 제거 → 블록을 일찍 닫거나 새 블록을 열 수 없음.
- 답변 재사용 저장소: CALLER가 들어간 답변은 **저장하지 않음**(다른 호텔에 호텔명이 재생되는 것 방지). 기존 저장 답변의 재생은 유지(일반 답변).
- UI 영향 없음. 스키마 변경 없음.

## 3. 사이드 임팩트
| 영역 | 영향 | 대응 |
|---|---|---|
| 다른 테넌트 | 허용 목록 밖 → 코드 경로 동일(401) | 스펙 ② |
| 고객 데이터 기능(24개 도메인) | `customerId`를 만들지 않으므로 변화 없음 | 스펙 ①⑤, P5 확인 |
| 동의 | `claimed`는 동의를 주지 않음 → HA에서도 배너 유지 | 서명 후 자동 해소(현행 D9) |
| 라우팅 | `claimed` 세션의 region·province·hotel·role이 규칙에 쓰임 | 의도(D4). 위조 시 다른 팀으로 갈 뿐 |
| 기존 `verified` 세션 | 미서명 호출로 강등되지 않음 | 스펙 ③ |
| 2단계 기업·연속성(#689) | `claimed`는 고객·기업이 없으므로 기업 등록·`/chat/thread`·직전 대화 AI 주입·sticky 배정 대상이 아님(`threadAvailable` `verified` 전용 현행) | SPEC §8-1, U1·U9 |
| 1단계 지역 매칭(#687) | `claimed`도 같은 정규화로 저장 → 유닛·라벨 담당 지역 매칭이 동일하게 동작 | SPEC §8-6, U7 |
| Go2Joy 안내 문서 | 병행 브랜치 `KimIgyong/go2joy-HA`의 가이드 v1.3이 "서명 필수"로 안내 중 | 이 기능은 스테이징 임시·내부 수단으로만 쓰고, Go2Joy 안내는 v1.3 담당자와 맞춘 뒤 보냄 |
| 통계·분석 | `identity_level`에 새 값 `claimed` | 분석 쿼리가 `verified`만 세면 영향 없음, `guest` 비율 해석 시 주의 |

## 4. 와이어프레임
```
SharpTalk 콘솔 › 라이브챗
┌ 세션 목록 ──────────────────────────────┐   ┌ 대화 상세 헤더 ───────────────────────────────────────────┐
│ G2J SUPPORT                 Hotel Partner│   │ G2J SUPPORT   [호텔: A In Hotel Del Luna] [남부] [Lễ tân] │
│ A In Hotel Del Luna · 남부   (미검증)    │   │               [미검증] ← 주황, 툴팁: 호스트 미서명 정보   │
│ "Làm sao đổi giá phòng…"         11:42  │   └──────────────────────────────────────────────────────────┘
└──────────────────────────────────────────┘
위젯(HA, claimed)                           설정 › 라우팅 규칙 › 조건
┌──────────────────────────────────┐        ┌───────────────────────────────────────────┐
│ G2J G2J SUPPORT    (🌐EN)(⚙)(X)  │ ← 이름  │ 신원 수준  [guest] [verified] [claimed]   │ ← 선택지 추가
│ ┌ Privacy notice … [Accept][Decline]│ ← 유지 │ 지역 [south]  → 담당: CS 호찌민           │
└──────────────────────────────────┘        └───────────────────────────────────────────┘
```

## 5. 리스크·되돌리기
- 위조 가능한 정보가 콘솔에 보인다 → "미검증" 배지가 상담원 판단 기준. 스테이징 전용.
- Go2Joy가 고정 값을 계속 보내면 모든 HA 사용자가 같은 이름으로 보인다 → P4 요청, P5에서 다른 계정으로 교차 확인.
- 되돌리기: env 변수 삭제 + 재시작 → 즉시 현행(401). 이미 `claimed`로 남은 세션은 표시 정보만 가진 채 유지(무해). 코드는 서명 완료 후 별도 PR로 제거 가능.

## 6. 승인 요청
- D1~D5 제안대로 진행해도 될까요? 특히 **D2(고객 레코드 미연결)**: 콘솔의 고객 정보 패널(이메일·전화)은 비어 있고, 이름·호텔·지역은 세션 배지로 보입니다.
- 승인 시 P1·P2 구현 → PR(스키마 변경 없음) → 스테이징 env 설정·배포 → P5 검증 순으로 진행합니다. 예상 0.5일.
