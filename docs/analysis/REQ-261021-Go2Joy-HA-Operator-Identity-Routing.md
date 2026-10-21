# REQ-261021 — go2joy HA: 로그인 호텔 운영자 정보 수신 · Go2Joy API로 호텔·지역 조회 · 상담원 배정

- 요청(2026-10-21): `https://go2joy-ha-uat.go2joy.io/profile`(Go2Joy Hotel Admin, 이하 HA)에서 위젯 채팅을
  시작하면 **HA에 로그인한 호텔 운영자 정보**를 받아야 한다. **Go2Joy가 제공하는 API**로 운영자 이름·호텔 이름·
  호텔 지역을 받고 **agent handoff 규칙**에 따라 상담원을 배정한다. → 필요 사항 조사·분석, 요구사항 1차 정리.
- 추가 요구(2026-10-21): 상담원 배정은 ① **AI 에이전트가 답변할 수 없어 상담원에게 이관**할 때, ② **호텔 어드민 직원이
  상담원 연결을 요청**했을 때 일어난다(§2-5). Go2Joy 테스트 자격증명으로 API 접속 테스트를 했다(§2-1-1).
- Go2Joy 제공 문서: **API Integration Document (Support Assistant API)** —
  https://dev.go2joy.vn/api-integration-document-support-assistant-api (2026-10-21 수집, GitBook `llms-full.txt`)
- 조사 기준: main `713af2f` · HA UAT 공개 페이지/번들 `app-v24.3.0`(로그인 없이 볼 수 있는 범위) ·
  PLN-261015 D2/D3/D9 · PLN-261019 배정 조건/담당자 그룹 · GUIDE-261019-Go2Joy-HA-Identify
- 상태: **1차 정리(분석)** — PLN 전에 Go2Joy 확인(§7)과 결정(§8)이 필요함

## 1. 요약
| 구분 | 결론 |
|---|---|
| Go2Joy API가 주는 것 | 서버 간 HMAC 인증(Partner API). **Province Feed에 `region`(1 South · 2 North · 3 Central · 4 North Central · 5 South Center)** 이 있고, Hotel Feed는 호텔 → `provinceSn`·`districtSn`·이름·주소를 준다. → **"호텔 이름·호텔 지역"은 Go2Joy API로 해결된다** |
| Go2Joy API가 주지 않는 것 | **로그인한 운영자**(누구인지, 이름, 역할, HA 언어, 지금 보고 있는 호텔)를 조회하는 API가 없다. 문서 개요에는 "identify the hotel and role of the user who is chatting", "reply in the language the user selected on HA"라고 적혀 있지만 해당 엔드포인트는 없다 → **Go2Joy에 확인할 1순위 항목** |
| 배정(handoff) 쪽 | **대부분 이미 있음**: 서명 속성 `hotel_id·hotel_name·region·province·role` → `sessions.identity_attributes` → 규칙 `regions` + 조건 8종 + 담당자 팀×라벨(#637·#638·#664~#667). go2joy 팀에 North/North Center/South/South Center가 있다 — **Go2Joy region enum과 거의 1:1**(Central이 없으므로 확인 필요) |
| 권장 방식 | **HA 페이지가 "누가·어느 호텔"을 서명해서 보내고(identify, 현행 방식을 축소해 사용) → SharpTalk 서버가 Partner API로 호텔 이름·성·지역을 채운다(enrich)**. Go2Joy가 운영자 API를 추가하면 운영자 정보도 서버에서 가져오도록 확장한다 |
| 배정 시점 | 두 경로 모두 **이미 있고 같은 배정 규칙을 탄다**: AI 자동 이관 `handoff()`(신뢰도 미달·모더레이션 차단·정책) / 직원의 연결 요청 `escalate()`(`user_request`). 필요한 것은 **두 경로가 실행되기 전에 운영자·호텔·지역이 세션에 들어가 있는 것**이다 |
| API 접속 테스트(10/21) | 스테이징 `staging-partner.go2joy.vn` **접속 성공**(Province·District·Hotel Feed·Hotel Info, 140~250ms). 성 80개(VN 63 + PH 17), VN 성마다 region이 붙어 있다. `provinceSn=0, districtSn=0, hotelSnList=[sn]`이면 **hotelSn만으로 호텔 조회가 된다**(문서에 없는 동작). ⚠️ 스테이징은 **서명·timestamp·IP를 검증하지 않는다**(clientId만 확인) → 서명 구현 검증은 운영 전 별도로 필요 |
| 선행 조건 | Go2Joy: 운영자 정보 전달 방식 합의, 운영 자격증명·**IP 화이트리스트**, 서명 검증이 켜진 환경 제공(§7) |

## 2. AS-IS

### 2-1. Go2Joy Support Assistant API (제공 문서)
| 항목 | 내용 |
|---|---|
| 목적(문서 개요) | 승인된 파트너(AI 챗봇 업체)가 HA 사용자를 지원하기 위한 컨텍스트 조회: ① 대화 중인 사용자의 **호텔과 역할** 식별 ② 호텔 **지역**에 따라 Go2Joy 팀(**Customer Service** 또는 **Sale Admin**)으로 라우팅 ③ 사용자가 **HA에서 선택한 언어**로 답변 |
| 환경 | Staging `https://staging-partner.go2joy.vn`(~250 req/분) · Production `https://partner.go2joy.vn`(~500 req/분) |
| 인증 | 모두 **POST**, 본문 필수 `clientId`·`timestamp`(유효 5분), 헤더 `Authorization` = `hex(HMAC-SHA256(secret, URL + "|" + 키 정렬 JSON 본문))`, **IP 화이트리스트**, 헤더 `Localization: en|vi` |
| 응답 | `{code: 1 성공 / 2 실패 / 0 서버오류, message, error, data, timestamp}` · 오류 코드 3 헤더 없음 · 4 파라미터 · 5 타임아웃 · 6 서명 · 8 clientId/IP · 10 권한 · 11 리소스 없음 · 12 호출 과다 |
| **Province Feed** `/api/v2/datafeed/getProvinceFeed` | `sn`, `name`, `code`, `countrySn`, `areaCode`, 좌표, **`region`** (enum 1~5) — 선택 파라미터 `provinceSn` |
| District Feed `/api/v2/datafeed/getDistrictFeed` | `sn`, `provinceSn`, `name`, `code` (`provinceSn` 필수) |
| **Hotel Feed** `/api/v2/datafeed/getHotelFeed` | `sn`, `name`, `address`, `provinceSn`, `districtSn`, 좌표, 설명(VI/EN), 평점·리뷰 수, 이미지 — 요청에 **`provinceSn`·`districtSn` 필수**, `hotelSnList` 선택 |
| Room Type Feed `api/v1/datafeed/getRoomTypeFeed` | 객실 타입·시설·뷰(이번 범위 밖) |
| Hotel APIs `/api/v2/hotel/getHotelList·getHotelInfo·getRoomTypeList` | 판매가·재고·예약 시간 정책 등 **예약 지향** 데이터(이번 범위 밖, 향후 AI 답변 근거 후보) |
| **없는 것** | 운영자(staff) 조회, HA 세션/토큰 검증, 운영자의 담당 호텔 목록, HA 언어, 역할 코드표 |

#### 2-1-1. 접속 테스트 결과 (2026-10-21, 스테이징, 테스트 clientId)
테스트 스크립트는 스크래치패드의 Node `fetch`다(문서 규약대로 키 정렬 JSON, `URL|본문` HMAC-SHA256 hex). 자격증명은 저장소에 넣지 않았다.

| # | 호출 | 결과 | 의미 |
|---|---|---|---|
| T1 | Province Feed `{}` | HTTP 200 · `code 1` · 244ms · **80개 성** | 접속·자격증명 정상 |
| T2 | 성 → region 분포 | `1` South **19**(HCM·Bình Dương·Cần Thơ…) · `2` North **25**(Hà Nội·Hải Phòng…) · `4` North Central **6**(Thanh Hóa~Thừa Thiên Huế) · `5` South Center **13**(Đà Nẵng·Khánh Hòa·Lâm Đồng·Tây Nguyên…) · **`3` Central 0개** · **`10` 17개 = 필리핀 Metro Manila**(`countrySn 2`, 문서에 없는 값) | VN은 **4개 지역**으로 나뉘고 go2joy 팀 North / North Center / South / South Center와 정확히 맞는다. 성 체계는 **통폐합 전 63개** |
| T3 | District Feed `provinceSn 1` | HCM 군 24개 | — |
| T4 | Hotel Feed `hotelSnList:[227]`만 | HTTP 400 · `code 4` "provinceSn / districtSn field is required" | 문서대로 필수 |
| T5 | Hotel Feed `provinceSn:0, districtSn:0, hotelSnList:[227]` | `code 1` · Khôi Hotel(성 1, 군 2) | **0이 와일드카드로 동작 → hotelSn 단독 조회 가능**(문서에 없는 동작, Go2Joy 보증 필요) |
| T6 | Hotel Feed `0,0,[227,110,467]` | 2건(467은 결과 없음) | 여러 건을 한 번에 조회 가능, 없는 호텔은 빠짐(오류 아님) |
| T7 | Hotel Feed `0,0` 전체 | **13개 호텔** | 스테이징 데이터가 아주 적다 — HA UAT의 hotelSn과 같은 DB인지 확인 필요 |
| T8 | Hotel Feed `1,3,[227]`(군 불일치) | `code 1` · `data: null` | 조건이 맞지 않으면 **성공 코드에 data null** → 클라이언트가 null을 "없음"으로 처리해야 한다 |
| T9 | Hotel Info v2 `hotelSn 227` | `code 1` · 시간 정책 + `cancellationPolicy`(문서에 없는 필드) | 경로는 v2 `getHotelInfo`가 맞다 |
| T10 | **틀린 secret으로 서명** | `code 1` 성공 | ⚠️ **스테이징은 서명을 검증하지 않는다** |
| T11 | **Authorization 헤더 없음** | `code 1` 성공 | ⚠️ 헤더 검증 없음(문서의 오류 코드 3이 나오지 않음) |
| T12 | **timestamp 1시간 전** | `code 1` 성공 | ⚠️ 5분 만료를 검증하지 않음 |
| T13 | 틀린 clientId | HTTP 400 · `code 10` Permission denied | clientId만 검증한다. 문서상으로는 8(Unauthorized)인데 실제로는 10 |
| T14 | IP | 개발 PC(IPv6)에서 호출해도 성공 | 스테이징은 IP 화이트리스트를 적용하지 않음 |

→ **스테이징 통과가 운영 통과를 뜻하지 않는다.** 서명 문자열(JSON 이스케이프 방식, 예: PHP `json_encode`는 `/`를 `\/`로 바꿈)이 틀려도 스테이징은 성공을 돌려준다. 서명을 검증하는 환경(또는 Go2Joy가 계산한 기대 서명 샘플)으로 별도 확인해야 한다.

문서 자체의 불일치(확인 필요):
- Hotel Feed가 `provinceSn`·`districtSn`을 **필수**로 요구한다 → 실측으로는 `0`을 넣으면 hotelSn만으로 조회되지만(T5) 문서에 없는 동작이다.
- 경로 표기가 섞여 있음: `getHotelnfo`(오타) / `getHotelInfo`, 서명 예시 `v1/hotel/getHotelInfo`·`getHotelDetail`, Room Type Feed만 `v1`.
- PHP 예시가 `CURLOPT_POSTFIELDS`에 배열을 넣어 **form 인코딩으로 전송**하면서 서명은 JSON 문자열로 만든다 → 실제 전송 형식(JSON 본문)과 "raw body must be encoded"의 의미(`json_encode` 기본 이스케이프 `\/`·`\uXXXX` 포함 여부) 확인 필요.
- "Go live" 절차가 예약 3건 생성(Affiliate API 문서 복사로 보임) — Support Assistant 용도의 인증 절차 확인.

### 2-2. HA(Go2Joy) 웹 — 공개 번들에서 확인한 사실
| 항목 | 확인 내용 |
|---|---|
| 위젯 설치 | `SHARPTALK_WIDGET_CONFIG = { shop: "https://www.go2joy.vn", widgetUrl: "https://shoptalk.amoeba.site/widget", agent: "hotel-partner" }` + 스테이징 `embed.js`. **`identify` 호출 없음** |
| 운영자 정보 | `GET profile` → `userId`(로그인 ID), `fullName`, `roleSn`, `hotelGroupSn`, `permissions` |
| 운영 호텔 | `GET staffs/getHotelList` → 운영자 1명이 **여러 호텔**(체인=`hotelGroupSn`)을 볼 수 있음, 상단 필터로 현재 호텔 선택 |
| 이미 모아 둔 프로필 | localStorage `TRACKING_PROFILE`(Amplitude/Sentry용): `userSn`, `userId`, `roleName`, `hotelSn`, `hotelName`, `hotelCode`, `hotelGroupSn`, `provinceName`, `districtName` — **HA 프런트가 필요한 값을 이미 다 갖고 있다** |
| 언어 | HA는 en / vi / ph(필리핀) 언어 리소스를 보유 |
| 참고 패턴 | Sendbird 채팅용 `v1/hotelChat/getWebViewToken → exchangeWebViewToken`(HA 로그인 → 단기 토큰 → 서버 교환) — Go2Joy가 운영자 API를 만든다면 재사용하기 좋은 구조 |

> ⚠️ 로그인이 필요한 응답 본문은 실측하지 못했다. 번들에서 쓰는 필드명으로 추정한 것이다.

### 2-3. SharpTalk — 이미 있는 것
| 기능 | 현재 |
|---|---|
| 서명 신원 | `POST /public/embed/identify {userId, hash, name, attributes}`: HMAC(`embed_secret`, `userId\nkey=value…`), 위조 시 401 `E5048` |
| 속성 허용 키 | `hotel_id · hotel_name · region · province · role` → `sessions.identity_attributes` |
| 이름 | `name`은 표시용(서명 제외), 보낼 때마다 덮어씀 → 헤더 `{name}`(#656) |
| 동의 | `consent_source = host_terms` + 서명 세션 → 배너 없이 동의 기록(D9 #642) |
| 배정 | `handoff_config.routingRules`: `regions`(정확 일치) × 키워드 × deny 라벨 × 조건(`hotel_id in`·`hotel_name contains`·`province contains`·`role in`·`language` 등) → 담당자(개별 / 팀×라벨 그룹), 0명이면 다음 규칙 |
| 팀 | go2joy units: North / North Center / South / South Center 외 |
| 외부 API 연동 틀 | per-tenant 자격증명(AES-GCM) · 연결 테스트 · 상태 카드(Cafe24/Odoo 등) — Go2Joy Partner API 자격증명도 같은 방식으로 저장 가능 |

### 2-4. 왜 지금 동작하지 않는가
1. HA가 `identify`를 호출하지 않는다 → 모든 세션이 게스트이고 `identity_attributes`가 비어 있다 → 지역 규칙이 하나도 맞지 않아 폴백으로 배정된다.
2. 기존 가이드(GUIDE-261019)는 HA가 `region`까지 계산해 서명하도록 요구한다. 그런데 HA 프런트에는 region이 없고(province만 있음), region은 Partner API에만 있다.
3. SharpTalk에는 Go2Joy Partner API 클라이언트(서명·피드 캐시)가 없다.

### 2-5. 상담원 배정 시점 (추가 요구)
배정은 대화가 시작될 때가 아니라 **이관이 일어날 때** 한 번 실행된다. 이관 경로는 두 가지이고 둘 다 이미 구현되어 있으며, 같은 배정 규칙을 탄다.

| 트리거 | 현재 구현 | 이관 사유(`EscalationReason`) | 배정 입력 |
|---|---|---|---|
| ① **AI가 답할 수 없어 이관** | `ChatService.handoff()` — 근거 부족·신뢰도 미달, 모더레이션 차단, 정책(deny-list `handoff` 모드·인계 키워드) | `low_confidence` · `moderation_blocked` · `policy` | `handoffRouter.route(tenant, language, routingContext(session, 직전 고객 발화, deny 라벨))` |
| ② **호텔 어드민 직원이 상담원 연결 요청** | `ChatService.escalate()` — 위젯 "상담원 연결" 버튼/칩, 시나리오 버튼 | `user_request` | 같은 `route()` + `routingContext(session, 마지막 고객 메시지)` |

- 두 경로 모두 `routingContext()`가 **`sessions.identity_attributes`**(region·hotel·province·role)를 읽는다. 따라서 이번 기능의 핵심 요구는 **"어느 트리거든 실행되는 순간에 세션에 운영자·호텔·지역이 들어 있어야 한다"** 는 것이다.
- 배정 결과(규칙 이름, 지역, 담당자 수)는 이미 로그에 남는다(`handoff routed by rule …`). 콘솔 대화 헤더에도 이관 사유를 함께 보여줄지 결정해야 한다 — PLN-261015에서 미구현으로 남은 "D5 이관 사유 표시".
- 업무 시간 밖이면 현행대로 메일로 넘어간다(`route.mode = email`). HA 직원은 연락처 메일이 필요할 수 있으므로, Go2Joy가 운영자 이메일도 넘길지 결정해야 한다(D11).
- 배정이 실행되지 **않는** 경우: AI가 답을 마친 대화, 미리보기(`channel=preview`) 세션.

## 3. TO-BE (권장안: 서명 identify 축소 + Partner API 보강)
```
[HA 브라우저]                          [HA 서버]                [SharpTalk API]                         [Go2Joy Partner API]
 로그인 + 현재 호텔 선택
 ① 위젯 로드 시 HA 서버에서 서명 받기 ─▶ hash = HMAC(embed_secret,
                                         userSn\nhotel_id=…\nrole=…)
 ② SharpTalk.identify({ userId: userSn, hash, name: fullName,
      attributes: { hotel_id, role }, locale: HA 언어 }) ──▶ 서명 검증(현행)
                                                          ③ 보강(enrich): hotel_id →
                                                             호텔 캐시 조회 / 없으면 ───────────▶ Hotel Feed (hotelSn)
                                                             provinceSn → 성 캐시(일 1회) ──────▶ Province Feed (region 포함)
                                                          ④ identity_attributes 완성:
                                                             hotel_id · hotel_name · province ·
                                                             district · region(=enum 매핑) · role
                                                          ⑤ 세션 verified + host_terms 동의 +
                                                             헤더 이름 + 언어(vi/en)
 ⑥ 상담원 연결 요청 / AI 이관 ─────────────────────────▶ routingRules: region × 조건 × 팀
                                                             → 상담원 배정·알림
```
- **신뢰 경계**: 누가 어느 호텔로 문의하는지는 HA 서버의 **서명**이 보증한다. 호텔 이름·성·지역은 **Go2Joy 서버 API**가 원천이다. 브라우저가 조작할 수 있는 값(`name`)은 표시용으로만 쓴다.
- HA의 부담이 줄어든다: region·hotel_name·province를 계산하거나 서명할 필요가 없고, `userSn·hotel_id·role` 세 값만 서명하면 된다.
- 서명에 `hotel_id`가 들어 있지 않으면 보강하지 않는다. 서명 없이 온 `hotel_id`로 다른 지역 팀에 배정되는 것을 막기 위해서다.
- 보강이 실패해도(타임아웃, 코드 ≠ 1) **채팅은 계속된다**. 서명된 `hotel_id`·`role`만으로 세션을 확정하고, `region`이 없으면 폴백 규칙으로 배정하며 warn 로그를 남긴다.

### 3-1. 방식 비교
| 안 | 운영자(누구·어느 호텔) | 호텔·지역 | 장점 | 단점 | 판정 |
|---|---|---|---|---|---|
| A. 현행 서명 push 그대로 | HA 서명 | HA가 계산해서 서명 | SharpTalk 변경 0 | HA에 region이 없음 → Go2Joy가 Partner API를 직접 호출해야 하고, 요청 의도(Go2Joy API로 받기)와 어긋남 | 기각 |
| **B. 서명 축소 + Partner API 보강** | HA 서명(userSn·hotel_id·role) | **SharpTalk이 Partner API로 조회** | 제공된 API를 그대로 사용, HA 개발 부담 최소(서명 1개), 지역 원천이 Go2Joy | HA 서버 서명은 여전히 필요 | **권장(즉시 가능)** |
| C. 운영자 API(토큰 교환) + Partner API | Go2Joy 신규 API(HA 토큰 → 운영자·호텔·역할·언어) | Partner API | 서명 코드조차 필요 없음, 모든 정보의 원천이 Go2Joy 서버 | **문서에 없음** — Go2Joy 신규 개발 필요 | Go2Joy가 제공하면 전환(문서 개요가 이 방향을 암시) |
| D. 서명 없이 hotelSn만 전달 | 브라우저 값 | Partner API | HA 서버 작업 0 | 누구나 임의의 호텔·지역으로 사칭할 수 있음, 동의 생략(host_terms) 불가 | 기각(UAT 데모 한정으로만 검토) |
| E. HA `access_token` 전달 | 전 권한 토큰을 제3자에 넘김 | — | — | 보안상 불가 | 기각 |

## 4. 데이터 매핑
| SharpTalk | 원천 | 경로 | 비고 |
|---|---|---|---|
| `customers.external_customer_id` | HA `userSn` | 서명 `userId` | `userId`(로그인 ID)는 바뀔 수 있으므로 `userSn` 권장 |
| `customers.name`·헤더 | HA `fullName` | `identify.name`(표시용) | PII, 로그 마스킹 |
| `identity_attributes.hotel_id` | HA 현재 `hotelSn` | **서명** 속성 | 체인 운영자는 §5-2 |
| `identity_attributes.role` | HA `roleSn`/`roleName` | **서명** 속성 | 코드값 권장(Go2Joy 코드표 필요) |
| `identity_attributes.hotel_name` | Hotel Feed `name` | Partner API | 캐시(TTL 1일 제안) |
| `identity_attributes.province` | Province Feed `name`(`Localization`=vi 원문) | Partner API | `provinceSn`도 저장(신규 키 `province_id`) |
| `identity_attributes.district` | District Feed `name` | Partner API | 신규 키(선택, D6) |
| **`identity_attributes.region`** | Province Feed **`region` enum** | Partner API | 1→`south`, 2→`north`, 3→`central`(실측 0개), 4→`north_central`, 5→`south_center`, 10→`ph_metro_manila`(문서에 없음). 코드값을 고정 저장하고, 표시명은 i18n으로 처리 |
| 세션 언어 | HA 언어(vi/en/ph) | `identify`/config `locale` | 문서 목적 ③. go2joy `widget_languages`=vi/en, ph는 미제공 → EN |

## 5. 세부 요구·이슈

### 5-1. 지역(region) — Partner API로 해결
- 실측(T2)으로 보면 VN 63개 성이 **4개 지역**(South 19 · North 25 · North Central 6 · South Center 13)으로 나뉘고, go2joy 팀 North / North Center / South / South Center와 정확히 맞는다. Central(3)은 쓰이지 않는다. 남은 일은 문서의 "Customer Service / Sale Admin" 두 업무 구분을 Go2Joy와 맞추는 것이다. 예: 4개 지역 × 2개 업무 = 규칙 8개, 담당은 팀(지역) × 라벨(업무) 그룹 + 폴백 1개.
- 규칙의 `regions`는 위 **고정 코드값**으로 저장한다. 콘솔에서는 자유 입력 대신 enum 선택으로 바꿀지 결정해야 한다(D8).
- 성 체계: 스테이징은 **통폐합 전 63개 성**이다(2025-07 통폐합으로 34개가 된 체계가 아님). SharpTalk은 이름이 아니라 **`provinceSn` → region**으로 판정하므로, Go2Joy가 나중에 체계를 바꿔도 피드만 다시 읽으면 된다.
- 캐시: Province Feed는 80행이므로 **하루 1회 + 처음 사용할 때** 전량 캐시한다. Hotel은 `hotelSn` 단위로 캐시한다(TTL 1일, 실패 시 마지막 값 사용). 호출 한도(staging 250/분)를 고려하면 세션마다 호출하지 않는다.
- **hotelSn → 호텔 조회**: 문서상으로는 `provinceSn`·`districtSn`이 필수이지만(T4), 실측으로는 `0, 0, hotelSnList:[sn]`이면 조회된다(T5). 이 동작을 Go2Joy가 **공식으로 보증**하면 그대로 쓴다. 보증하지 않으면 ⓐ hotelSn 단독 조회 API를 요청하거나 ⓑ HA가 `province_id`도 서명해 보내게 한다. 조건이 맞지 않을 때는 `code 1 · data null`이 오므로(T8) "호텔 없음"으로 처리한다.

### 5-2. 다중 호텔(체인) 운영자
- 배정은 "지금 어느 호텔 일로 문의하는가"가 기준이다. HA 상단에서 **현재 선택된 `hotelSn`** 을 서명한다.
- "전체 호텔"을 보는 상태라면 `hotel_id`를 생략한다 → 지역 없음 → 체인/폴백 규칙(D4).
- 대화 중에 호텔을 바꾸면 HA가 identify를 다시 호출해 속성을 갱신한다. **이미 배정된 상담원은 유지**하고, 다음 이관부터 새 지역을 적용한다(D5).

### 5-3. 타이밍 — "채팅 시작 시 수신" + "이관 시 배정"
- **수신**: 운영자 정보는 채팅을 시작할 때(위젯 로드 직후 `identify`) 받아 세션에 저장한다. 헤더 이름·동의 생략·언어는 이 시점에 적용된다.
- **배정**: §2-5의 두 트리거(AI 이관 / 직원 요청) 중 하나가 실행될 때, 저장해 둔 속성으로 규칙을 평가한다.
- 보강은 identify 요청 안에서 동기로 처리한다(캐시 적중 시 ~0ms, 미적중 시 Partner API 1~2회 — 실측 140~250ms, 타임아웃 3초 제안).
- **안전망**: 이관 시점에 `hotel_id`는 있는데 `region`이 비어 있으면(보강 실패, 캐시 만료) `routingContext()`에서 **한 번 더 보강을 시도**하고 규칙을 평가한다(D9). 그래도 실패하면 폴백 규칙으로 배정한다. 직원이 "상담원 연결"을 누르자마자 이관되는 경우(첫 메시지가 없을 수 있음)도 같은 경로로 처리한다.

### 5-4. 보안·운영
| 항목 | 요구 |
|---|---|
| 자격증명 | `clientId`·`client secret`을 테넌트 연동 자격증명으로 AES-256-GCM 저장(마스터만 편집), 환경별로 분리(staging-partner / partner) |
| IP 화이트리스트 | SharpTalk **서버 출구 IP**를 Go2Joy에 등록해야 한다 — 스테이징 호스트 211.110.140.172(실제 출구 IP는 `curl ifconfig.me`로 확인 필요), 운영 호스트(Go2Joy 전용 배포 `sharptalk.go2joy.vn` 예정)는 확정 후 |
| 서명 | `URL|정렬된 JSON` HMAC-SHA256 hex. 스테이징은 서명을 검증하지 않으므로(T10~T12), 중첩 객체 정렬과 JSON 이스케이프 방식(PHP `json_encode` 호환)은 **Go2Joy가 계산한 기대 서명 샘플**이나 서명을 검증하는 환경으로 확정해야 한다 |
| 시계 | `timestamp` 유효 5분 → 서버 NTP 동기화 전제 |
| 연결 테스트 | 콘솔 연동 카드에 "연결 테스트"(Province Feed 1회 호출). 코드 6 → 서명 오류, 8 → IP 오류, **10 → clientId 오류**(실측 T13)로 구분해 표시 — `fail-classification-copy` 원칙 |
| 자격증명 보관 | 테스트 clientId/secret은 저장소에 커밋하지 않는다. `secrets/`(gitignored) 또는 콘솔 연동 설정에만 둔다 |
| 장애 | 코드 0/5/12 또는 타임아웃이면 캐시 사용 → 캐시도 없으면 region 없이 진행 |
| PII | 운영자 이름만 받는다(전화·이메일 받지 않음). Partner API 응답에는 PII가 없다 |
| 감사 | 자격증명 변경을 감사 로그에 남긴다 |

### 5-5. 배정 규칙 운영(Go2Joy 입력 필요)
- 지역(5) × 업무(CS / Sale Admin)별 담당 상담원·팀 명단, 규칙 우선순위, 폴백 담당. PLN-261015의 선행 항목 "지역·업무·담당자 명단"으로 아직 받지 못했다.
- 업무 구분 기준(어떤 문의가 Sale Admin인가)은 현재 키워드·deny 라벨로 표현한다(PLN v1.1 D-12).

## 6. 갭 분석
| # | 갭 | 판정 | 해소 방향 | 담당 |
|---|---|---|---|---|
| G1 | **Go2Joy Partner API 클라이언트**(서명·POST·응답 코드 처리·속도 제한) | SharpTalk 코드(중) | 새 `go2joy` 연동 모듈(Cafe24/Odoo 연동과 같은 구조) | SharpTalk |
| G2 | 테넌트 연동 설정: base URL·clientId·secret·연결 테스트 | SharpTalk 코드(소)+SQL? | 기존 per-tenant 자격증명 재사용(새 provider `go2joy`) | SharpTalk |
| G3 | 성(region 포함)·호텔 **캐시**와 갱신 | SharpTalk 코드(소~중) | Redis 또는 테이블(결정 D10) | SharpTalk |
| G4 | identify 후 **보강(enrich)** → `identity_attributes`에 hotel_name·province·region 채우기, 서명된 값은 덮어쓰지 않음 | SharpTalk 코드(소) | embed.service 후처리 훅(go2joy 연동이 켜진 테넌트만) | SharpTalk |
| G5 | region enum → 규칙 코드값, 콘솔 지역 선택 UI | SharpTalk 코드(소) | 카탈로그 상수 + 규칙 편집기 선택형(D8) | SharpTalk |
| G6 | 속성 키 확장 `province_id`·`district`·`hotel_group_id` + 조건 카탈로그 | SharpTalk 코드(소) | D6 | SharpTalk |
| G7 | **운영자 정보 전달**(userSn·hotel_id·role 서명 + name + 언어) | **Go2Joy 개발(소)** | GUIDE-261019 개정(서명 키 축소, region 제거) | Go2Joy |
| G8 | 운영자 조회 API(안 C) | Go2Joy 개발(중) | 문서 개요와 실제 API 불일치 — 의향 확인 | Go2Joy |
| G9 | HA 언어 → 세션 언어 | 대부분 있음 | `identify`/config `locale` 전달(ph→en) | Go2Joy+SharpTalk |
| G10 | 자격증명 발급·IP 화이트리스트·인증 절차 | 운영 | §7 | Go2Joy |
| G11 | 지역×업무 규칙·담당자 입력 | 운영 | 콘솔 설정 | Go2Joy+운영 |

## 7. Go2Joy 확인·요청 사항 (PLN 전 필수)
1. **운영자 식별**: 문서 개요의 "identify the hotel and role of the user who is chatting"을 어느 API로 하는가? 운영자/HA 세션 조회 API(안 C)를 제공할 계획이 있는가, 아니면 HA 페이지 서명(안 B)으로 갈 것인가?
2. **Hotel Feed `provinceSn:0, districtSn:0, hotelSnList:[sn]`** 으로 hotelSn만 넣어 조회하는 방식(실측 T5)을 운영에서도 공식으로 지원하는가?
3. **region ↔ 상담팀**: 실측 VN 4개 지역(1·2·4·5)이 상담팀 4개와 맞는지, Central(3)을 앞으로 쓸 계획이 있는지, 문서에 없는 `region 10`(필리핀) 처리, Customer Service / Sale Admin 구분 기준, 지역×업무별 담당자 명단.
4. **역할 코드표**(`roleSn`/`roleName`), 불변 운영자 식별자(`userSn`).
5. **스테이징 서명 검증이 꺼져 있음**(T10~T12): 서명·timestamp·IP를 검증하는 테스트 환경을 제공하거나, 고정 본문에 대한 **기대 서명 샘플**을 줄 수 있는가? 운영 clientId/secret, **IP 화이트리스트**(스테이징·운영 출구 IP 전달), 인증(certification) 절차 — 문서의 "예약 3건 생성"이 이 용도에도 적용되는지.
6. 서명 세부: 실제 본문 전송 형식(JSON), JSON 이스케이프 규칙, 중첩 객체 정렬. 오류 코드도 문서와 실제가 다르다(틀린 clientId는 문서상 8이지만 실제는 10).
7. **HA UAT의 hotelSn과 staging-partner의 hotelSn이 같은 DB인가?** 스테이징 피드에는 호텔이 13개뿐이라 HA UAT 테스트 계정의 호텔이 있어야 E2E 테스트를 할 수 있다. 필리핀(ph) HA도 대상인지.
8. HA 언어 값(en/vi/ph) 전달 방식.
9. 업무 시간 밖 메일 응답용으로 운영자 이메일도 넘길지(D11).

## 8. 미결 결정
| # | 결정 | 선택지 | 제안 |
|---|---|---|---|
| D1 | 운영자 식별 방식 | **B 서명 축소** / C Go2Joy 운영자 API | **B로 시작**, C가 제공되면 전환(저장 경로 공용) |
| D2 | 보강 실패 시 | 채팅 차단 / **region 없이 진행** | 진행 + 폴백 규칙 + warn |
| D3 | region 원천 | **Province Feed `region`** / SharpTalk 매핑표 | Province Feed(매핑표 불필요) |
| D4 | 체인 "전체 호텔" 상태 | 대표 호텔 / **hotel_id 생략** | 생략 → 체인/폴백 규칙 |
| D5 | 대화 중 호텔 전환 | 재배정 / **담당 유지, 속성만 갱신** | 유지 |
| D6 | 속성 키 확장 | 현행 5개 / **+province_id·district·hotel_group_id** | 확장 |
| D7 | 동의 처리 | 서명 세션 → `host_terms` 동의 | 현행대로 |
| D8 | 규칙 지역 입력 | 자유 문자열(현행) / **enum 선택** | enum 선택(오타로 규칙이 어긋나는 것 방지) |
| D9 | 보강 시점 | **identify 동기(타임아웃 3초) + 이관 직전 재시도** / 이관 시점만 | 동기 + 재시도 |
| D10 | 캐시 저장소 | **Redis(TTL 1일)** / 테이블 | Redis(스키마 변경 없음) |
| D11 | 업무 시간 밖 이관 | 메일 회신(운영자 이메일 필요) / **다음 업무 시간 대기열 + 위젯 회신** | HA 직원은 다시 접속하므로 대기열 + 위젯 회신을 제안한다. 메일이 필요하면 Go2Joy가 이메일을 넘긴다 |

## 9. 제약·전제
| # | 내용 |
|---|---|
| C1 | Partner API 자격증명과 IP 화이트리스트가 준비되기 전에는 실연동이 불가하다 — 목(mock) 서버(문서 예시 응답)로 선개발·테스트한다 |
| C2 | 배정 엔진·조건·팀 그룹은 기존 것을 쓴다. 이번에 추가하는 것은 보강 경로뿐이다 |
| C3 | 배정 근거는 서명된 값과 Go2Joy 서버 응답뿐이다. 브라우저 값은 표시용으로만 쓴다 |
| C4 | Redis 캐시와 기존 자격증명 저장을 쓰면 스키마 변경이 없을 수 있다. 테이블 방식이나 provider 등록에 SQL이 필요하면 스테이징 SQL을 먼저 적용하고 PR에 `## Migration`을 넣는다 |
| C5 | go2joy 테넌트는 스테이징에만 있다. 운영은 Go2Joy 전용 배포 일정에 맞춘다 |
| C6 | Partner API 속도 제한(staging 250/분) 안에서 동작해야 한다 → 캐시 필수 |

## 10. 사용자 흐름
1. 호텔 운영자가 HA에 로그인하고 상단에서 호텔 A(Hồ Chí Minh)를 선택한다.
2. 위젯이 뜨면 HA가 서명한 `identify({userSn, hotel_id: A, role})`를 보낸다. SharpTalk은 Hotel Feed로 A의 `provinceSn`=1을, Province Feed로 `region`=1(South)을 조회한다. 헤더에 `[G2J] Nguyễn Văn A`가 표시되고, 배너는 없으며 언어는 vi다.
3. AI가 FAQ로 답한다. 이관은 둘 중 하나로 일어난다: ⓐ AI가 근거를 찾지 못해 스스로 이관(`low_confidence`)하거나 ⓑ 직원이 "상담원 연결"을 누른다(`user_request`).
4. 규칙 `region=south` × 업무(예: 정산·계약 키워드 → Sale Admin) → 팀 South × 라벨 중 least_loaded 상담원에게 배정되고, 알림과 개인 메일이 간다.
5. 상담원 콘솔 대화 헤더에 운영자 이름 · 호텔 A · Hồ Chí Minh · South · 역할이 표시된다.
6. (실패 경로) Partner API가 오류를 내면 캐시를 쓰고, 캐시도 없으면 region 없이 진행해 폴백 담당자에게 배정한다. 연동 카드에 오류 상태를 표시한다.

## 11. 범위 제안 (PLN 단계 후보)
| 단계 | 내용 | 규모 |
|---|---|---|
| P0 | Go2Joy와 §7 확인, 테스트 자격증명·IP 등록 | 협의 |
| P1 | Go2Joy Partner API 클라이언트(서명·오류 분류) + 테넌트 연동 카드(자격증명·연결 테스트) + 목 서버 | 중 |
| P2 | 성·호텔 캐시 + identify 보강(hotel_name·province·region) + region enum 카탈로그 + 속성 키 확장 | 소~중 |
| P3 | 규칙 편집기 지역 enum 선택, 상담원 화면 표시 보강 | 소 |
| P4 | GUIDE-261019 개정(서명 키 `userSn·hotel_id·role`, `name`, `locale`, 로그아웃) — Go2Joy 전달 | 문서 |
| P5 | 스테이징 E2E: 지역 5종 배정·체인 전체 보기·API 장애 폴백·서명 위조 → TCR/RPT | 검증 |
| (후속) | 안 C(운영자 API) 전환 / Hotel APIs로 AI 답변 근거 확장(예약 정책·객실) | 별도 REQ |
