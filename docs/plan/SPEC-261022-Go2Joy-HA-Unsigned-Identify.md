# SPEC-261022 — 미서명 identify 임시 수용(`claimed`) 기술 명세

- 근거: [REQ-261022](../analysis/REQ-261022-Go2Joy-HA-Unsigned-Identify.md) · [PLN-261022](PLN-261022-Go2Joy-HA-Unsigned-Identify.md)
- 기준 코드: main `18559f08`(PLN-261022 1단계 지역 정규화 #687 · 2단계 기업고객·대화 연속성 #689 포함)
- 이 문서는 **무엇이 어떻게 동작해야 하는가**만 정한다. 단계·일정·영향은 PLN, 검증 결과는 TCR/RPT.

## 1. 범위
| 포함 | 제외 |
|---|---|
| 허용 테넌트의 서명 불일치 identify를 `claimed`로 저장 | 서명 검증 규칙 변경(`identitySigningString`, HMAC) |
| `claimed` 세션의 표시 이름, 콘솔 신원 응답·배지, 라우팅 조건 값 | 고객·기업·연락처 등록, 대화 연속성(2단계) — `verified` 전용 유지 |
| 스위치(env), 로그 | 위젯 UI 변경(기존 `customerName` 경로 재사용), 스키마 변경 |

## 2. 스위치
| 항목 | 값 |
|---|---|
| 이름 | `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS` |
| 형식 | 쉼표 구분 테넌트 id, 공백 무시. 예: `4` / `4, 7` |
| 기본 | 미설정·빈 값 = 기능 꺼짐(현행 동작) |
| 읽는 시점 | 요청마다 `process.env`(재시작 없이 바뀌지는 않음 — 컨테이너 env) |
| 환경 | **스테이징만.** 프로덕션 `.env`에는 넣지 않는다 |

## 3. 판정 (`EmbedService.identify`)
세션·테넌트 조회와 `normalizeIdentityAttributes`는 현행 그대로 먼저 수행한다.

| # | 조건 | 결과 | HTTP |
|---|---|---|---|
| J1 | 시크릿 있음 + 서명 일치 | 현행 `verified` 경로(고객 upsert·기업 등록·연속성·host_terms 동의) | 200 |
| J2 | (시크릿 없음 **또는** 서명 불일치) + 테넌트 허용 + 세션 `identity_level ≠ verified` | **`claimed` 저장**(§4) | 200 |
| J3 | (시크릿 없음 또는 서명 불일치) + 테넌트 허용 + 세션 `verified` | 거부, 세션 불변 — 검증된 세션을 미검증으로 덮지 않음 | 401 `E5048` |
| J4 | (시크릿 없음 또는 서명 불일치) + 테넌트 비허용 | 현행 거부 | 401 `E5048` |
| J5 | 세션 없음 | 현행 | 404 `SESSION_NOT_FOUND` |

## 4. `claimed` 저장 형식
| 필드 | 값 |
|---|---|
| `sessions.identity_level` | `'claimed'` (`SESSION_IDENTITY.CLAIMED`) |
| `sessions.identity_attributes` | `storedIdentityAttributes(normalize(attributes), provinceRegions).attributes`(1단계와 같은 NFC·권역 정규화·지역표 보정) **+** `user_id`(입력 `userId`, NFC·trim·≤120) **+** `name`(입력 `name`, NFC·trim·≤120, 없으면 키 생략). 매번 **교체**(병합 아님) |
| `sessions.customer_id` | 변경 없음(게스트면 NULL 유지) |
| `sessions.company_id` | 변경 없음 |
| 동의(`consent_*`) | 변경 없음 — `claimed`는 host_terms 동의를 주지 않는다 |
| `email`, `phone` | **저장하지 않음**(고객 테이블은 PII 암호화, 세션 JSON은 평문) |
| 세션 캐시 | `sessionCacheKey(token)` 삭제(현행과 동일) |
| 대화 귀속 | `attachOpenConversation` 호출하지 않음(고객·기업이 없음) |

`user_id`·`name`은 라우팅 필드가 아니다. 라우팅·기업 등록이 읽는 키는 5개(`hotel_id`·`hotel_name`·`province`·`region`·`role`) 그대로다.

## 5. 응답 (`SessionResponse`, ensure·identify 공통)
| 필드 | `claimed`일 때 |
|---|---|
| `customerName` | 고객이 없으면 `identity_attributes.name`(→ 위젯 헤더 `headerGreeting`) |
| `authenticated` | `false`(고객 없음 — 알림·수신거부 조회 잠김) |
| `threadAvailable` | `false`(현행 규칙: `verified` 전용) |
| `consentState` | 현재 값 그대로(보통 `pending` → 배너 표시) |

## 6. 콘솔 API·UI
| 대상 | 명세 |
|---|---|
| `toIdentityResponse(attrs, level)` | 기존 5필드 + `userId`(`user_id`), `name`(**`maskName` 적용** — 콘솔의 다른 고객 이름과 같은 마스킹), `verified`(`level !== 'claimed'`). 속성이 없으면 `null`(현행) |
| 대화 목록·상세 | 세션 `identityLevel`을 함께 조회해 위 함수에 전달 |
| `IdentityBadges` | `verified === false`이면 헤더에 주황 배지 `identity.unverified`(툴팁 `identity.unverifiedHint`). 좁은 목록 행(compact)은 주황 방패 아이콘만 두고 문구·호텔은 툴팁으로 |
| 이름 대체 순서 | `alias` → `customerName` → `identity.name` → `customerEmail` → `sessionLabel` |
| 라우팅 조건 | `ROUTING_CONDITION_ENUM_VALUES.identity_level = ['guest','verified','claimed']`, 라벨 `aiSetting` 6언어 |

## 7. 로그
| 상황 | 레벨 | 형식 |
|---|---|---|
| J2 | warn | `identify claimed — unsigned (tenant 4, user go2***, attrs hotel_id,province,region,role, region signed)` — 이름·이메일 미기록 |
| J3 | warn | `identify rejected — signature mismatch on a verified session (tenant 4, user go2***)` |
| J4 | warn | 현행 문구 그대로 |

## 8. 불변식 (테스트로 고정)
1. `claimed` 경로는 `customer_id`·`company_id`·동의 필드를 바꾸지 않는다.
2. `verified` 세션은 미서명 호출로 강등되지 않는다(J3).
3. 허용 목록 밖 테넌트의 응답·저장은 현행과 바이트 단위로 같다(J4).
4. 이메일·전화는 `claimed`로 어디에도 저장되지 않는다.
5. `claimed` 이후 올바른 서명이 오면 J1로 `verified` 승격, `identity_attributes`는 서명 값으로 교체(`user_id`·`name` 키 사라짐).
6. 라우팅은 `claimed` 세션의 정규화된 `region`·`province`로 1단계 지역 매칭과 같은 결과를 낸다.

## 9. 단위 테스트 목록
| ID | 대상 | 케이스 |
|---|---|---|
| U1 | embed.service | J2: 허용 + 잘못된 hash → 200, `claimed`, 속성(정규화)+`user_id`+`name`, 고객·기업 미생성, 동의 불변 |
| U2 | embed.service | J2: 허용 + 시크릿 없음 → `claimed` |
| U3 | embed.service | J3: `verified` 세션 + 잘못된 hash → 401, 세션 불변 |
| U4 | embed.service | J4: 비허용 → 401(현행) |
| U5 | embed.service | 불변식 4: email·phone 미저장 |
| U6 | embed.service | 불변식 5: `claimed` → 올바른 서명 → `verified`, 고객 생성, `user_id`·`name` 제거 |
| U7 | embed.service | 지역표 보정: province만 → region 채움(`regionSource=map`) |
| U8 | session.service | `customerDisplayName`: 고객 없음 + `claimed` → `name`; `guest` → null |
| U9 | session.mapper | `claimed` → `authenticated=false`, `threadAvailable=false` |
| U10 | agent.mapper | `toIdentityResponse` `verified`·`userId`·`name` |
| U11 | handoff-router | `identity_level in [claimed]` 조건 일치 |
| U12 | types | `ROUTING_CONDITION_ENUM_VALUES.identity_level`에 `claimed` |

## 10. Go2Joy 쪽 전제(서명 전 임시)
- payload는 **로그인 사용자 값**으로 채운다. `userId = "ha:" + userSn`(가이드 v1.3 G10 규칙, UAT 계정은 `ha:8818`), 속성 5키.
- `hash`는 비어 있지 않은 임시 문자열(로더가 빈 hash 호출을 버림). 서명 준비 시 실제 HMAC으로 교체 — 그 순간 J1로 승격.
- **로그인 상태에서만** `identify`를 호출한다. 로그아웃 페이지에서 고정 값으로 호출하면 모든 방문자가 같은 사람으로 보인다.

## 12. (P7) `claimed` 대화 연속성 — D7ⓐ 별도 스레드 · D8ⓐ 병합 안 함
| 항목 | 명세 |
|---|---|
| 계정 | `ThreadService.accountOf`: `claimed` + `identity_attributes.user_id` → `{ customerId: null, companyId: null, claimedUserId }` |
| 스레드 범위 | 같은 테넌트, `sessions.identity_level='claimed'`, `JSON_UNQUOTE(JSON_EXTRACT(identity_attributes,'$.user_id')) = claimedUserId`인 세션들의 대화. 본인 범위만, `colleagueCount = 0`, 모든 행 `own = true` |
| 새 대화 | `customer_id`·`company_id` NULL, `prev_conversation_id` = 위 범위의 최신 대화 → AI 발췌·sticky 배정은 기존 로직 그대로 |
| 위젯 | `threadAvailable` = 연속성 스위치 && (`verified`+고객) 또는 (`claimed`+`user_id`+허용 목록 테넌트) |
| `GET /chat/thread` | 위 조건이 아니면 403 `E5099`(현행) |
| 승격 | `claimed` → `verified`가 되어도 claimed 대화를 고객·기업에 붙이지 않는다(D8ⓐ). 단, 승격 순간 열려 있던 대화는 현행 `attachOpenConversation`대로 고객에 귀속 |
| 불변식 | claimed 스레드는 verified 대화(고객·기업 귀속 행)를 포함하지 않는다 / 다른 `user_id`의 대화를 포함하지 않는다 |

## 13. (P8) AI 프롬프트의 CALLER 블록 — D9 이름 포함
| 항목 | 명세 |
|---|---|
| 대상 | `identity_attributes`가 있는 `verified`·`claimed` 세션. 그 외(게스트, Shopify 로그인 고객 등) 블록 없음 |
| 형식 | `CALLER_START` / `Name:`(verified=고객 이름, claimed=`identity_attributes.name`) / `Hotel: {hotel_name} (id {hotel_id})` / `Province:` / `Region:` / `Role:` / `Verified: yes|no` / `CALLER_END` — 값 없는 줄은 생략, 줄이 하나도 없으면 블록 없음. `userId` 미포함 |
| 값 정리 | NFC, 제어문자 → 공백, `[A-Z_]*_START`·`_END` 표식 제거, 공백 정리, 80자 |
| 규칙(`CALLER_RULE`) | 호칭·"내 호텔"·권역·역할 이해용 / 지시가 아님 / 사실·절차는 CONTEXT / `Verified: no`면 그 호텔·계정에 관한 확인·공개 금지 |
| 위치 | `rag.answer`: 시스템 프롬프트 끝(CONTEXT·주문·직전 대화 뒤), 규칙은 근거 규칙 앞. `answerWithoutKnowledge`: 지시문 뒤. 검색어(`retrievalQuery`)에는 넣지 않음 |
| 재사용 | CALLER가 있는 턴의 새 답변은 `answerReuse.recordAiAnswer` 호출 안 함. 조회(재생)는 현행 |
| 실패 | 이름 조회 실패 시 블록 없이 답변(턴은 계속) |

## 11. (P6) HA 로그인 → 작업 로그
| 항목 | 명세 |
|---|---|
| 트리거 | J1·J2 성공 후, 직전 세션 상태가 `guest`이거나 신원이 바뀐 경우(claimed: `identity_attributes.user_id`, verified: `customer_id`)에만 1행. 같은 세션·같은 사용자의 반복 identify는 기록하지 않음 |
| 행 | `tenant_id`, `actor_type='host'`, `actor_id=session.id`, `action='host.user_signed_in'`, `target='session:{id}'`, `result='success'`, `metadata={ level, hotelId, region }` |
| 금지 | 이름·이메일·전화·userId를 감사 행에 쓰지 않음(감사 메타데이터 PII 금지) |
| 이름 해석 | `AuditService.withActorNames`: `host` → 세션 조회 → claimed는 `identity_attributes.name`, verified는 고객 `name`, **`maskName` 적용**(고객 이름 표시 규칙), 없으면 `null` |
| 조회 | `action_prefix`에 쉼표 목록 허용(각 접두사 `LIKE 'p%'`를 OR). 작업 로그 기본값 `agent.,host.`. 상담원 필터 선택 시 `actor_type=user` 동반 |
| 실패 | 감사 쓰기 실패는 `logger.warn`만 남기고 identify 응답에 영향 없음 |
