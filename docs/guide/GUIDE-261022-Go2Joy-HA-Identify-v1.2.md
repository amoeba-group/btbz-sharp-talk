# Hotel Admin 로그인 사용자 연동 — 고객 등록 · 대화 연속성 · 지역 배정 (v1.2)

> 호텔 직원이 HA에 로그인한 상태로 위젯 채팅을 시작하면, HA가 직원·호텔·지역을 **서명된 패키지**로 넘기고
> SharpTalk은 이를 검증해 **기업고객(호텔)과 직원(연락처)으로 등록**합니다. 대화는 세션이 끝나도 **그 호텔 계정의 대화로 이어지며**,
> 사람이 필요하면 호텔 지역 팀 × 업무(CS / Sales)의 Go2Joy 상담원에게 배정됩니다.

| 항목 | 내용 |
|---|---|
| 수신 | Go2Joy Hotel Admin(HA) 개발팀 · Go2Joy 운영팀 |
| 발신 | SharpTalk (Amoeba) |
| 일자 / 버전 | 2026-10-22 · **v1.2** (v1.1: 2026-10-21, v1.0: 2026-10-20) |
| 범위 | 채널 구조의 **B2B `#Talk-4-Hotel`(HA Support)** — 파트너 호텔 직원 ↔ Go2Joy. B2C 에이전트(예약 전 `Go2Joy-#Talk-4-BookingClient`, 예약 후 `Hotel-#Talk-4-BookingClient`)는 별도 문서로 다룹니다 |
| 환경 | HA UAT `https://go2joy-ha-uat.go2joy.io` ↔ SharpTalk 스테이징 `https://shoptalk.amoeba.site` |
| 참고 | SharpTalk × Go2Joy 채널 구조(2026-10-21) · Go2Joy 지역표 `Khu vực và Tỉnh_ Thành phố.xlsx` · Go2Joy 파트너 API 문서 · SharpTalk REQ-261021 |

## v1.2 변경 사항 (v1.1 대비)
| # | 변경 | Go2Joy 영향 | 위치 |
|---|---|---|---|
| 1 | **고객 등록 모델 추가**: 호텔 = 기업고객(Company), 직원 = 연락처(Contact). B2B 고객 단위는 직원이 아니라 **호텔** | 없음(SharpTalk 처리) | 2.1 |
| 2 | **대화 연속성**: 세션이 끝나거나 다른 PC·다음 날 다시 로그인해도, 같은 호텔의 다른 직원이 문의해도 **호텔 계정의 대화로 이어짐** | 없음(SharpTalk 처리) | 2.2 |
| 3 | **B2B / B2C 구분**: 서명된 `hotel_id`가 있는 식별만 기업고객으로 등록. 부킹 고객(B2C)과 분리 | 없음 | 2.3 |
| 4 | **`userId` = `"ha:" + userSn`**(변하지 않는 번호). v1.1의 로그인 ID(`go2joysupport`)는 바뀔 수 있고 부킹 고객 ID와 겹칠 수 있음 | **변경** | 4, 5.2 |
| 5 | **`region` = 권역 코드** `north` · `north_center` · `south_center` · `south`(채널 구조 문서 기준). v1.1의 `North Center` 같은 텍스트도 받지만 코드를 권장 | **변경** | 4.1 |
| 6 | 테스트 벡터 갱신(T1~T5) | **변경** | 5.4 |
| 7 | UAT 체크리스트에 고객 등록·연속성·B2B 항목 추가 | 점검 | 8.2 |
| 8 | 호텔 주소·군(district)은 **2단계**(SharpTalk이 활성화를 알린 뒤 전송) | 이후 | 4.4 |

---

## 요약
- **미로그인**: 현재 스크립트 그대로. 위젯은 지금처럼 표시됩니다(게스트, 동의 안내 표시).
- **로그인**: HA 서버가 식별 패키지(직원 번호, 이름, 호텔, 성/시, 권역, 역할)를 만들고 **서명**합니다. HA FE가 `SharpTalk.identify(...)`로 위젯에 넘기면 SharpTalk이 서명을 다시 계산해 검증합니다.
- **등록**: 검증되면 SharpTalk은 호텔을 **기업고객**, 직원을 그 호텔의 **연락처**로 찾아 연결하고, 없으면 새로 등록합니다.
- **연속성**: 대화는 **호텔 계정 단위**로 이어집니다. 세션이 끝나도, 다른 직원이 문의해도 상담원과 AI는 같은 호텔의 이전 대화를 이어서 봅니다.
- **배정**: AI가 답하지 못해 이관하거나 직원이 "상담원 연결"을 요청하면, 호텔 **권역 → 지역 팀**, 요청 내용 → **업무(CS / Sales)** 로 담당 상담원을 정합니다.
- **Go2Joy 작업**: 서버 엔드포인트 1개(PHP 약 40줄) · FE JavaScript 약 15줄 · 로그아웃 시 `SharpTalk.logout()`. v1.1에서 바뀐 것은 `userId`와 `region` 값 두 가지입니다.

## 1. 배경

### 1.1 채널 구조에서 이 문서의 위치
SharpTalk은 Go2Joy 사용자를 세 AI 에이전트로 나눠 맡습니다. 모두 AI가 먼저 응대하고 사람은 이관할 때만 들어옵니다.

| 구분 | 에이전트 | 대상 | 진입 | 사람 이관 | 이 문서 |
|---|---|---|---|---|---|
| **B2B** | **#Talk-4-Hotel**(HA Support) | 파트너 호텔 직원 | **HA 로그인 후 위젯** | 호텔 지역 팀 × 업무(CS / Sales)의 Go2Joy 상담원 | **대상** |
| B2C 예약 전 | Go2Joy-#Talk-4-BookingClient | 예약 전 부킹 고객 | Go2Joy 앱·웹 | 지역·CS가 지정된 Go2Joy 상담원 | 별도 |
| B2C 예약 후 | Hotel-#Talk-4-BookingClient | 예약 후 부킹 고객 | 예약 완료 시 자동 이관 | 호텔 직원(확인 필요) | 별도 |

### 1.2 문제
지금 SharpTalk은 누가 채팅하는지 모릅니다. 그래서 모든 HA 사용자가 '게스트'입니다.
- 이미 Go2Joy 약관에 동의한 관리자에게도 데이터 처리 동의 안내가 나옵니다.
- 제목에 사용자 이름 대신 "Support center"가 나옵니다.
- 호텔·권역을 몰라 하노이 / 호찌민 팀으로 나눠 배정할 수 없습니다.
- 페이지를 새로 열 때마다 대화가 새로 시작되어, 직원도 상담원도 **이전 대화를 이어서 보지 못합니다**.
- 호텔 직원(B2B)과 부킹 고객(B2C)이 같은 '고객'으로 섞입니다.

### 1.3 왜 HA가 정보를 보내야 하는가
Go2Joy 파트너 API는 파트너 단위 인증(clientId + HMAC-SHA256 + IP 화이트리스트)이며 호텔 데이터만 제공합니다. "지금 HA에 로그인한 사용자"를 알려주는 엔드포인트는 없습니다. 또 2026-10-21 접속 테스트에서 UAT 테스트 호텔(1721)은 Hotel Feed에 없었고, `getHotelInfo`에는 성·권역 필드가 없었습니다. 따라서 **로그인 사용자와 그 호텔의 성·권역은 HA가 서명해서 보내야 합니다**.

## 2. SharpTalk이 로그인 정보로 하는 일

### 2.1 고객 등록 — 기업고객(호텔)과 연락처(직원)
B2B의 고객 단위는 직원 개인이 아니라 **소속 호텔**(회사)입니다. 서명이 검증되면 SharpTalk은 다음을 찾아 연결하고, 없으면 새로 등록합니다.

| SharpTalk 고객 모델 | 키 | 저장 항목 | 출처 |
|---|---|---|---|
| **기업고객(Company)** | `hotel:{hotel_id}` | 호텔명, 성/시, 권역 · (2단계) 주소, 군 | 서명 속성 `hotel_id`·`hotel_name`·`province`·`region` |
| **연락처(Contact)** | `ha:{userSn}` | 이름, 역할 · (선택) 이메일, 휴대폰 | `userId`, `name`, `attributes.role`, `email`, `phone` |
| 연결 | 기업고객 ↔ 연락처 | 역할, 마지막 접속 | 체인 운영자는 여러 호텔에 연결됨 |

- 같은 직원이 다시 로그인하면 **같은 연락처**로 수렴합니다(새 행이 생기지 않음). 이름은 보낼 때마다 갱신되고, 이메일·휴대폰은 비어 있을 때만 채웁니다.
- 체인 운영자가 호텔을 바꾸면, 다시 서명한 `hotel_id`의 기업고객으로 이후 대화가 이어집니다.
- 콘솔의 고객 메뉴에서 **기업고객**(호텔별 연락처·대화·권역)과 **부킹고객**을 나눠 봅니다.

### 2.2 대화 연속성 — 호텔 계정 단위
| 상황 | 결과 |
|---|---|
| 대화가 종료된 뒤(직접 종료·자동 종료) 다시 질문 | 같은 호텔 계정의 **새 대화**로 이어지며 직전 대화와 연결됩니다(위젯·상담원 화면에는 이어서 보입니다). 직전 대화가 끝난 지 **24시간 안**이고 그때 상담원이 배정 규칙의 후보에 있으면 **같은 상담원**에게 먼저 연결합니다(재개 창, Go2Joy 확인 필요) |
| 다음 날 / 다른 PC에서 다시 로그인 | identify 후 위젯에 **이전 대화가 구분선("이전 대화 · 날짜")과 함께** 표시되고, 새 메시지는 같은 계정 대화에 이어집니다 |
| 같은 호텔의 **다른 직원**이 문의 | 상담원과 AI는 **같은 호텔의 이전 대화**를 이어서 봅니다. 위젯 화면에 다른 직원의 대화까지 보일지는 Go2Joy와 결정합니다(10절 Q2) |
| 로그아웃 후 / 미로그인 | 게스트로 돌아가며 이전 대화는 보이지 않습니다(공용 PC 보호) |
| AI 응답 | 같은 계정의 직전 대화 요약을 맥락으로 써서 "지난번 문의"를 이어서 답합니다 |

> 이어 보기는 **서명이 검증된 세션만** 가능합니다. 서명이 없는 게스트 세션은 지금처럼 매번 새로 시작합니다.

### 2.3 B2B / B2C 구분
- **서명된 `hotel_id`가 있는 identify만 기업고객(B2B)** 으로 등록합니다. 위젯 설정의 `agent: "hotel-partner"`는 브라우저에서 바꿀 수 있는 값이라 판정 근거로 쓰지 않습니다.
- 호텔을 선택하지 않은 상태(체인 "전체 호텔")에서는 회사를 정할 수 없습니다. 이때 직원은 **연락처로만** 식별되고, 대화는 직원 계정으로 이어지며, 배정은 폴백 담당자에게 갑니다.
- 부킹 고객(B2C)은 Go2Joy 앱·웹 연동(별도 문서)에서 별도 유형으로 등록되며, 직원 ID(`ha:` 접두어)와 겹치지 않습니다.
- 콘솔 라이브챗에는 **"기업 · 호텔명 · 권역"** 배지가 붙고, 배정 규칙·통계에서도 B2B / B2C를 나눌 수 있습니다.

### 2.4 상담원 배정
배정은 채팅을 시작할 때가 아니라 **사람이 필요해지는 순간**에 실행됩니다.

| 트리거 | 예 |
|---|---|
| ① AI가 답할 수 없어 이관 | 지식에 근거가 없음, 신뢰도 미달, 정책상 사람이 답해야 하는 주제 |
| ② 직원이 상담원 연결을 요청 | 위젯의 "상담원 연결" 버튼·칩 |

호텔 **권역 → 지역 팀**, 요청 내용 → **업무(CS / Sales)** 로 담당 큐를 정하고, 큐 안에서 상담원을 고릅니다(4.2). 담당자가 없거나 근무시간이 아니면 대체 담당자 → 팀 큐 → 오프라인 메시지 순서로 넘깁니다(순서는 Go2Joy 확정 필요).

## 3. 통신 흐름
| 단계 | 주체 | 동작 |
|---|---|---|
| 1 | HA 사용자 → HA FE | 로그인(기존과 동일) |
| 2 | HA FE → HA 서버 | 식별 패키지 요청 |
| 3 | HA 서버 | 로그인 세션·DB로 payload 생성 → NFC 정규화 → secret으로 HMAC-SHA256 서명 |
| 4 | HA 서버 → HA FE | `{userId, hash, name, attributes}` 반환 |
| 5 | HA FE → SharpTalk 위젯(iframe) | `SharpTalk.identify(패키지)` — 값을 가공하지 않고 그대로 |
| 6 | 위젯 → SharpTalk API | `POST /api/v1/public/embed/identify` |
| 7 | SharpTalk API | 서명 검증 → **기업고객·연락처 찾기/등록** → 세션에 연결 → (일치하지 않으면 401 E5048, 게스트 유지) |
| 8 | SharpTalk API → 위젯 | 200: verified, 이름, 동의, **계정 대화 이어 보기** |
| 9 | 위젯 → HA FE | `identified` 이벤트 `{ok}` |

| 상황 | HA가 할 일 |
|---|---|
| 미로그인 | 없음(현재와 동일) |
| 로그인 직후 / 로그인 상태로 새로고침 | 로그인 상태가 확정되면 `SharpTalk.identify()` 1회 |
| 선택 호텔 변경 | 새 호텔로 다시 서명 → `identify` 재호출(이후 대화는 새 호텔 계정으로) |
| 호텔 미선택(체인 "전체 호텔") | 호텔 관련 속성(`hotel_id`·`hotel_name`·`province`·`region`)을 **빼고** 서명·전송 |
| 로그아웃 | `SharpTalk.logout()` — 다음 사용자가 이름·호텔·이전 대화를 이어받지 않도록 |
| 서명 오류 / 변조 | 할 일 없음. SharpTalk이 거부(401 E5048)하고 위젯은 게스트로 계속 동작 |

> 서명이 필요한 이유: 브라우저의 값은 누구나 DevTools로 고칠 수 있습니다. 서명이 없으면 다른 호텔을 사칭해 **그 호텔의 이전 대화를 보거나**, 다른 지역 팀으로 끼어들거나, 동의 절차를 건너뛸 수 있습니다. 대화 연속성이 생기면서 서명의 중요성이 더 커졌습니다.

## 4. 전달 데이터
**HA 서버는 브라우저가 아니라 자체 로그인 세션·DB에서 값을 가져와 서명해야 합니다.**

| 정보 | HA 내 출처 (UAT 예시) | SharpTalk 필드 | 서명 | 용도 |
|---|---|---|---|---|
| **직원 번호** | `userSn` (TRACKING_PROFILE / profile) | `userId` = **`"ha:" + userSn`** | 예 | 연락처 키, 대화 연속성 |
| 이름 | `profile.value.fullName` · `G2J SUPPORT` | `name` | 아니오 | 위젯 제목, 콘솔 |
| 이메일 | `profile.value.email` | `email` | 아니오 | 콘솔, 근무시간 외 회신(선택) |
| 휴대폰 | Mobile (My profile) | `phone` | 아니오 | 콘솔(선택) |
| 선택 호텔 | `hotelSn` · `1721` | `attributes.hotel_id` | 예 | **기업고객 키**, 배정 |
| 호텔명 | `hotelViewList[].name` · `A In Hotel Del Luna` | `attributes.hotel_name` | 예 | 기업고객 이름, 콘솔 |
| 성·시 | 호텔의 성 → 지역표 `NAME` · `Hồ Chí Minh` | `attributes.province` | 예 | 성·시 조건 배정 |
| **권역** | 성 → 지역표 `REGIONS` → 코드 · `south` | `attributes.region` | 예 | **지역 팀 배정** |
| 역할 | `roleName` · `Lễ tân` | `attributes.role` | 예 | 배정 조건, 콘솔 |
| 호텔 주소 | HA 설정 API `settingList.address` | (2단계) | — | 4.4 |
| 군(District) | `districtName` | (2단계) | — | 4.4 |

- `userId`에 로그인 ID 대신 `userSn`(변하지 않는 번호)을 쓰는 이유: 로그인 ID는 바뀔 수 있어서 바뀌면 이전 대화가 끊깁니다. 또 `ha:` 접두어로 부킹 고객 ID와 섞이지 않게 합니다.
- v1.1 기준으로 이미 개발했다면 `userId`만 `"ha:" + userSn`으로 바꾸면 됩니다.

### 4.1 권역(region) 코드
지역표의 `REGIONS` 숫자를 아래 코드로 바꿔 보냅니다. 지역표 63개 성은 Go2Joy 파트너 API Province Feed와 이름·권역이 모두 일치합니다(2026-10-21 대조).

| REGIONS | `region` 코드 | 지역표 텍스트 | 성 수 | 예 |
|---|---|---|---|---|
| 2 | `north` | North | 25 | Hà Nội, Hải Phòng, Quảng Ninh |
| 4 | `north_center` | North Center | 6 | Thanh Hóa, Nghệ An, Thừa Thiên Huế |
| 5 | `south_center` | South Center | 13 | Đà Nẵng, Khánh Hòa, Lâm Đồng |
| 1 | `south` | South | 19 | Hồ Chí Minh, Bình Dương, Cần Thơ |
| 3 | `central` | Central | 0 | (현재 쓰는 성 없음) |

- 전체 목록은 **부록 A**에 있습니다.
- v1.1처럼 텍스트(`North Center`)를 보내도 SharpTalk이 검증 뒤 `north_center`로 정규화합니다. 다만 **한 가지 표기를 일관되게** 쓰십시오(서명은 보낸 그대로 검증합니다).
- 권역을 계산할 수 없으면 `province`만 보내십시오. SharpTalk이 지역표로 권역을 채웁니다.

### 4.2 권역 → 상담팀 (Go2Joy 확정 필요)
| 순서 | 규칙 | 권역 | 업무 | 담당 큐 |
|---|---|---|---|---|
| 1 | 하노이 Sales | north, north_center | 정산·계약·수수료 등 영업 문의 | 하노이 팀 × Sales |
| 2 | 하노이 CS | north, north_center | 그 외 | 하노이 팀 × CS |
| 3 | 호찌민 Sales | south, south_center | 정산·계약·수수료 등 영업 문의 | 호찌민 팀 × Sales |
| 4 | 호찌민 CS | south, south_center | 그 외 | 호찌민 팀 × CS |
| 5 | 폴백 | (권역 없음) | — | 지정 담당자 |

### 4.3 중요 규칙
- `attributes`에는 `hotel_id`, `hotel_name`, `province`, `region`, `role` **5개 키만** 보냅니다. 모르는 키가 섞이면 SharpTalk이 서명 계산 전에 제거하므로 서명이 어긋나 **패키지 전체가 거부됩니다(401)**.
- 서명하지 않는 필드(`name`, `email`, `phone`)는 비어 있으면 빼십시오(`email`이 빈 값이거나 형식 오류이면 400).

### 4.4 2단계 필드 (지금은 보내지 마십시오)
채널 구조 문서의 기업고객 모델에는 **호텔 주소**(`settingList.address`)와 **군**(`districtName`)이 있습니다. SharpTalk이 수신 기능을 배포하고 **활성화를 알린 뒤** 추가합니다. 그 전에 보내면 주소는 무시되고, `district` 속성은 위 규칙에 따라 401이 됩니다.

## 5. 기술 사양

### 5.1 서명 문자열 (문자 단위로 정확히 일치해야 함)
```
no attributes   : userId
with attributes : userId + "\n" + key=value + "\n" + key=value ...   (keys in alphabetical order)

hash = hex( HMAC-SHA256( key = SHARPTALK_EMBED_SECRET, message = signing string as UTF-8 ) )
       → 64 lowercase hex characters

Example signing string (v1.2):
ha:1001
hotel_id=1721
hotel_name=A In Hotel Del Luna
province=Hồ Chí Minh
region=south
role=Lễ tân
```
- 값은 앞뒤 공백을 제거하고, 줄바꿈 없이, 최대 120자. 빈 값은 서명 문자열과 payload **모두에서** 뺍니다.
- 전송하는 값은 서명한 값과 **완전히 같아야** 합니다(공백, 대소문자, 성조 부호 포함).
- **유니코드 정규화(NFC)**: 같은 `Hồ Chí Minh`이라도 조합형(NFC)과 분해형(NFD)은 해시가 다릅니다. 서명 전에 NFC로 정규화하고, 정규화한 그 값을 그대로 보내십시오.
- **공백**: PHP `trim()`은 NBSP(U+00A0)를 지우지 않고 SharpTalk(JavaScript)은 지웁니다. 5.2처럼 유니코드 공백을 정리하십시오.
- 120자는 JavaScript 길이(UTF-16)로 셉니다. 이모지가 들어갈 수 있는 값은 100자 정도로 여유 있게 자르십시오.

### 5.2 Hotel Admin 서버 (PHP)
```php
<?php
// New endpoint on the HA server, e.g. GET /api/v1/staff/sharptalkIdentity
// — returned only to a signed-in session, over HTTPS, never logged.
// SHARPTALK_EMBED_SECRET: server-only environment variable. NEVER send it to the browser.
// $staff[...] / $hotel[...] names are illustrative — use HA's real data.
// $hotel['province_name'] / $hotel['region'] come from Go2Joy's province table
// (NAME / REGIONS, Appendix A). $hotel = null when no hotel is selected.

const SHARPTALK_REGION_CODE = [1 => 'south', 2 => 'north', 3 => 'central', 4 => 'north_center', 5 => 'south_center'];

function sharptalk_clean($v): string
{
    $s = (string) ($v ?? '');
    if (class_exists('Normalizer')) {                       // ext-intl (recommended)
        $s = Normalizer::normalize($s, Normalizer::FORM_C); // NFC before signing
    }
    // collapse ALL whitespace incl. NBSP (U+00A0) and ideographic space (U+3000)
    $s = preg_replace('/[\s\x{00A0}\x{2000}-\x{200B}\x{3000}]+/u', ' ', $s);
    return mb_substr(trim($s), 0, 120);
}

function sharptalk_identity(array $staff, ?array $hotel): array
{
    $attributes = array_filter([
        'hotel_id'   => sharptalk_clean($hotel['sn'] ?? ''),                              // "1721"
        'hotel_name' => sharptalk_clean($hotel['name'] ?? ''),                            // "A In Hotel Del Luna"
        'province'   => sharptalk_clean($hotel['province_name'] ?? ''),                   // "Hồ Chí Minh"
        'region'     => SHARPTALK_REGION_CODE[(int) ($hotel['region'] ?? 0)] ?? '',       // "south"
        'role'       => sharptalk_clean($staff['role_name'] ?? ''),                       // "Lễ tân"
    ], fn($v) => $v !== '');                 // drop empty values (signature + payload)
    ksort($attributes, SORT_STRING);         // keys in alphabetical order

    $userId = 'ha:' . sharptalk_clean($staff['user_sn']);  // "ha:1001" — immutable staff number
    $lines  = [$userId];
    foreach ($attributes as $k => $v) {
        $lines[] = $k . '=' . $v;
    }
    $hash = hash_hmac('sha256', implode("\n", $lines), getenv('SHARPTALK_EMBED_SECRET'));

    $payload = ['userId' => $userId, 'hash' => $hash];      // hash: lowercase hex, 64 chars
    $profile = [
        'name'  => sharptalk_clean($staff['full_name'] ?? ''),  // not signed — display
        'email' => trim((string) ($staff['email'] ?? '')),      // not signed
        'phone' => trim((string) ($staff['mobile'] ?? '')),     // not signed
    ];
    foreach ($profile as $k => $v) {
        if ($v !== '') $payload[$k] = $v;                     // omit empty fields
    }
    if ($attributes) {
        $payload['attributes'] = $attributes;                 // exactly the signed values
    }
    return $payload;
}
```
- NFC 정규화에는 PHP `intl`(`Normalizer`)이 필요합니다. 없으면 정규화를 건너뛰는데, 이때도 서명은 그대로 검증됩니다(SharpTalk은 받은 그대로 검증하고, 저장할 때 NFC로 바꿉니다). 그래도 `intl` 사용을 권장합니다.
- 이 코드는 PHP 8.3에서 실행해 5.4의 T1~T5 해시가 그대로 나오는 것을 확인했습니다.
- 응답 JSON은 `JSON_UNESCAPED_UNICODE`로 보내도 되고 기본 이스케이프(`\u1ed3` 형태)로 보내도 됩니다. **FE에서 값을 가공하지 마십시오.**

### 5.3 Hotel Admin FE
```html
<!-- (1) KEEP the current script (guests still get the chatbot); add locale + a queue -->
<script>
  window.SHARPTALK_WIDGET_CONFIG = {
    shop: "https://www.go2joy.vn",
    widgetUrl: "https://shoptalk.amoeba.site/widget",
    agent: "hotel-partner",
    locale: "vi"                      // current HA language: "vi" | "en"
  };
  // Queue: lets the page call SharpTalk.* before embed.js (defer) has loaded
  window.SharpTalk = window.SharpTalk || { q: [] };
  function sharptalkCall(method, arg) {
    if (typeof window.SharpTalk[method] === 'function') window.SharpTalk[method](arg);
    else window.SharpTalk.q.push([method, arg]);
  }
</script>
<script src="https://shoptalk.amoeba.site/widget/embed.js" defer></script>
```
```js
// (2) once the user is known to be signed in (just signed in, or page reloaded)
//     and AGAIN whenever the selected hotel changes (incl. "all hotels")
async function sharptalkSignIn() {
  const identity = await haApi.get('/staff/sharptalkIdentity'); // signed package (5.2)
  sharptalkCall('identify', identity);                          // pass it through UNCHANGED
}

// (3) on sign-out
function sharptalkSignOut() {
  sharptalkCall('logout');
}

// (Optional) verification result for HA-side logging
window.addEventListener('message', (e) => {
  if (e.origin !== 'https://shoptalk.amoeba.site' || !e.data || e.data.type !== 'ivy:event') return;
  if (e.data.event === 'identified') {
    console.info('[SharpTalk] identify', e.data.ok ? 'OK' : 'rejected — check signature/secret');
  }
});
```

**FE가 위젯에 넘기는 패키지 (v1.2)**
```json
{
  "userId": "ha:1001",
  "hash": "<64 hex chars computed by the HA server>",
  "name": "G2J SUPPORT",
  "email": "<email>",
  "phone": "<mobile>",
  "attributes": {
    "hotel_id": "1721",
    "hotel_name": "A In Hotel Del Luna",
    "province": "Hồ Chí Minh",
    "region": "south",
    "role": "Lễ tân"
  }
}
```

### 5.4 테스트 벡터 (v1.2)
테스트용 secret은 `test-secret-do-not-use`입니다(실제 secret 아님). 아래 해시는 SharpTalk 서버의 실제 검증 코드와 5.2의 PHP 코드로 각각 계산해 일치를 확인했습니다. `userSn`은 예시 값입니다.

| # | userId + attributes | 기대 해시 |
|---|---|---|
| T1 | `ha:1001` · (attributes 없음) | `244f6fa4c1c48d077d54bd632b0897042fa413e36d55921517c462e2af51e618` |
| T2 | `ha:1001` · hotel_id=`1721`, hotel_name=`A In Hotel Del Luna`, province=`Hồ Chí Minh`, region=`south`, role=`Lễ tân` | `6965b1eb09412033fa26782f43782021f7888addf9e493acb2dd212448667169` |
| T3 | `ha:2002` · hotel_id=`2001`, hotel_name=`Huế Garden Hotel`, province=`Thừa Thiên Huế`, region=`north_center`, role=`Chủ khách sạn` | `2a4997998a1edb97e90e7c306cbacd4ab79d6509bb6042c42401891d0b23f1d8` |
| T4 | `ha:3003` · hotel_id=`3001`, hotel_name=`Hạ Long Bay Hotel`, province=`Quảng Ninh`, role=`Lễ tân` (**region 없음** → SharpTalk이 지역표로 채움) | `64ec39ea09916f477ae469cee7331c64f65e81d1586c24c78b3693a5776985b0` |
| T5 | `ha:1001` · role=`Quản lý` (**호텔 미선택**) | `991931a386d1d47124162a1bf07a76d8f104e9e26964f8bfb328590c999c2a8d` |

- v1.0 / v1.1의 테스트 벡터는 **폐기**합니다.
- 분해형(NFD) 입력이나 끝에 NBSP가 붙은 입력도 5.2의 `sharptalk_clean()`(intl 사용)을 거치면 같은 해시가 나와야 합니다.

### 5.5 SharpTalk 응답
위젯이 `POST https://shoptalk.amoeba.site/api/v1/public/embed/identify`를 호출합니다. Go2Joy가 직접 호출할 필요는 없고, 점검할 때 DevTools › Network에서 볼 수 있습니다.

| 결과 | 의미 | 조치 |
|---|---|---|
| 200 | 검증 성공 — 세션 '검증됨', 기업고객·연락처 연결 | — |
| 401 · E5048 | 서명 불일치: 문자열 오류, secret·환경 불일치, 모르는 키, 120자 초과·줄바꿈, NFC/공백 차이 | 5.1과 비교, 5.4 재실행 |
| 400 | 형식 오류: email 빈 값·형식 오류, userId 길이 초과 등 | 빈 필드 제외, 형식 확인 |
| 404 | 채팅 세션 없음 | 위젯이 자동 처리, 페이지 새로고침 |

## 6. 동작 검증
| 일자 | 검증 | 결과 |
|---|---|---|
| 2026-10-19 | go2joy 테넌트 스테이징 secret으로 서명한 정상 흐름 | 세션 verified, HA 약관 기준 동의 기록, 동의 안내 없음, 제목에 이름, 이름 변경 반영, 미서명 세션은 게스트 유지 |
| 2026-10-20 | HA UAT 실제 페이지에서 가짜 해시로 identify | 1초 안에 `identified {ok:false}`, API 401 E5048 — 전달 경로 동작, 미서명 거부 |
| 2026-10-21 | 지역표 63행 ↔ 파트너 API Province Feed | 이름·권역 63/63 일치 |
| 2026-10-22 | v1.2 테스트 벡터 T1~T5 | SharpTalk 검증 코드로 계산해 일치 |

**v1.2에서 새로 추가되는 SharpTalk 동작**(기업고객 등록, 연속성, B2B 구분)은 9절 일정대로 스테이징에 배포한 뒤 8.2 체크리스트로 함께 검증합니다.

## 7. 보안 및 서명 키
| | **A — SharpTalk 발급 별도 secret(권장)** | B — Go2Joy client secret 사용 |
|---|---|---|
| identify 서명 키 | Go2Joy 전용 embed secret, 환경별 1개, 보안 채널로 전달 | Go2Joy가 SharpTalk에 발급한 client secret |
| 준비 상태 | 즉시 사용 가능(스테이징 사용 중) | SharpTalk에 "파트너 secret 입력" 기능 추가 필요(소규모) |
| 키 유출 시 | 채팅 식별에만 영향 | 채팅 식별 + 파트너 API 호출 권한 |
| 키 교체 | 독립적 | 양쪽 동시 갱신 필요(아니면 모든 identify 401) |

**일반 원칙**
- secret은 HA 서버 환경변수에만 둡니다. FE, 브라우저, 앱, 로그, 문서에 넣지 마십시오.
- 서명된 패키지는 로그인 세션에만 HTTPS로 반환하고 로그에 남기지 않습니다.
- **대화 연속성 때문에 패키지 유출의 영향이 커졌습니다.** 패키지를 손에 넣은 사람은 그 직원으로 채팅하고 그 호텔의 이전 대화를 볼 수 있습니다. 지금은 패키지에 유효기간이 없으며, SharpTalk은 **서명 시각(`ts`) 필드와 유효기간 추가를 권장**합니다(Go2Joy가 동의하면 v1.3에서 함께 적용).
- 로그아웃 시 반드시 `SharpTalk.logout()`을 호출하십시오(프런트 데스크 공용 PC).
- 스테이징과 프로덕션 secret은 다르며, SharpTalk이 별도 보안 채널로 전달합니다.

### 7.1 파트너 API 확인 요청 (v1.1에서 이어짐)
| # | 관찰(2026-10-21) | 요청 |
|---|---|---|
| P1 | 스테이징이 서명·timestamp·Authorization 헤더·IP를 검증하지 않음. clientId만 검증, 틀리면 `code 10`(문서상 8) | 서명을 검증하는 테스트 환경, 또는 기대 서명 샘플 |
| P2 | Hotel Feed `hotelSnList`에 피드에 있는 호텔이 하나도 없으면 필터가 무시되고 전체 반환 | 빈 목록을 반환하도록 수정 또는 동작 확인 |
| P3 | Hotel Feed에 호텔 13개뿐, UAT 테스트 호텔 1721 없음 | 피드 범위 |
| P4 | 운영 연동 | SharpTalk 서버 IP 화이트리스트, 운영 client key |

## 8. 구현 및 점검

### 8.1 역할 분담
| 주체 | 작업 | 비고 |
|---|---|---|
| Go2Joy HA | 서명 패키지 서버 엔드포인트(5.2) — **`userId = "ha:" + userSn`, `region` = 권역 코드**, NFC 정규화 | PHP 약 40줄 |
| Go2Joy HA | FE: 스크립트 교체, 로그인 후·호텔 변경 시 identify, 로그아웃 시 logout(5.3) | JS 약 15줄 |
| Go2Joy HA | 5.4 T1~T5 실행 결과 전달 | 연동 전 |
| Go2Joy | 서명 키 방안(7절), 서명 유효기간 적용 여부 | A 권장 |
| Go2Joy 운영 | 권역 → 팀 매핑, 팀별 상담원 계정, Sales 문의 기준, 폴백·부재 처리 순서(4.2, 2.4) | 배정 규칙 입력용 |
| Go2Joy | HA 약관 URL + 버전, 10절 결정 사항 | — |
| SharpTalk | 스테이징 secret 보안 채널 전달 | 방안 A |
| SharpTalk | 9절 작업 배포, 배정 규칙 입력 | — |

### 8.2 UAT 체크리스트
| 점검 | 기대 결과 |
|---|---|
| 미로그인 상태에서 위젯 열기 | 게스트, 동의 안내 표시(현재와 동일) |
| 로그인 후 위젯 열기 | 동의 안내 없음, 제목에 이름 |
| Network: `POST …/public/embed/identify` | 200, `consentState: "granted"` |
| **콘솔 › 고객 › 기업고객** | 호텔 1건(이름·성/시·권역), 연락처에 로그인한 직원 |
| 같은 직원으로 다시 로그인 | 연락처가 새로 생기지 않음 |
| **대화 종료 후 다시 질문** | 같은 호텔 계정 대화로 이어짐(24시간 안이면 같은 상담원) |
| **다른 PC·다음 날 로그인** | 위젯에 이전 대화가 구분선과 함께 표시 |
| **같은 호텔의 다른 직원으로 로그인** | 같은 기업고객에 연락처 추가, 상담원 화면에 호텔의 이전 대화 |
| 콘솔 라이브챗 | "기업 · 호텔명 · 권역" 배지 |
| AI가 답할 수 없는 질문 | AI 이관 → 권역에 맞는 팀 |
| "상담원 연결" 요청 | 권역에 맞는 팀 |
| 권역별 호텔로 각각 로그인(north / north_center / south_center / south) | 4.2에서 확정한 팀 |
| 호텔 미선택("전체 호텔") | 200, 연락처로만 식별, 폴백 담당자 |
| 성조 부호가 많은 호텔(예: Thừa Thiên Huế) | 401 없이 200, 표기 정상 |
| 로그아웃 후 위젯 열기 | 게스트, 이전 대화 보이지 않음 |
| 패키지 값 하나를 재서명 없이 수정 | 401 E5048, `ok: false`, 게스트 |

## 9. SharpTalk 측 작업 (v1.2)
| 단계 | 작업 | 상태 |
|---|---|---|
| 기존 | 서명 검증, host_terms 동의, 헤더 이름, 콘솔 배지, 지역 배정(AI 이관·직원 요청) | **완료** |
| 1단계 (UAT 최소) | 수신 값 NFC 정규화 · 권역 코드 정규화(`North Center` → `north_center`) · 성 → 권역 대체 매핑(지역표 63행) · 콘솔 권역 선택형 규칙 | 개발 예정 |
| 2단계 (고객·연속성) | 기업고객·연락처 등록과 B2B / B2C 고객 유형 · 대화를 계정(호텔)에 연결 · 위젯 이전 대화 이어 보기와 24시간 재개 · AI에 직전 대화 요약 · 콘솔 기업고객 화면·필터·배지 · 배정 조건·통계에 B2B / B2C | 개발 예정(스키마 변경 포함) |
| 3단계 | 호텔 주소·군 수신(4.4) · 서명 유효기간(`ts`, Go2Joy 동의 시) | Go2Joy 결정 후 |

일정은 Go2Joy의 10절 회신과 HA 서명 개발 일정에 맞춰 확정합니다. 1단계는 HA 서명 엔드포인트보다 먼저 스테이징에 올립니다.

## 10. Go2Joy 확인·결정 요청
| # | 질문 | SharpTalk 제안 |
|---|---|---|
| Q1 | 권역 → 팀: 하노이 / 호찌민 2팀인가, 권역별 4팀인가? `south_center`(다낭·중부 고원 13개 성)는 어느 팀인가? | north·north_center → 하노이, south·south_center → 호찌민 |
| Q2 | **위젯 화면에 같은 호텔 다른 직원의 대화도 보일까?** | 위젯은 본인 대화 + "이 호텔의 이전 문의 n건" 요약, 상담원·AI는 호텔 전체 |
| Q3 | 종료된 대화의 재개 창(같은 상담원 우선 배정) | 24시간 |
| Q4 | 상담원 부재·근무시간 외 순서 | 대체 담당자 → 팀 큐 → 오프라인 메시지 |
| Q5 | 역할에 따른 차이(예: Quản lý / Lễ tân)가 필요한가? | 처음에는 차이 없이 콘솔 표시와 배정 조건만 |
| Q6 | 호텔 주소·군을 기업고객 정보로 받을까? | 받음(3단계) |
| Q7 | 서명 유효기간(`ts`) 적용 | 적용 권장 |
| Q8 | 서명 키 방안 A / B | A |

---

## 부록 A. 지역표 (Go2Joy 제공 `Khu vực và Tỉnh_ Thành phố.xlsx`, 63개 성)
`province` = NAME, `region` = 코드. 2026-10-21 파트너 API Province Feed와 63/63 일치.

| REGIONS | region 코드 | province (NAME) |
|---|---|---|
| 2 | `north` | Hà Nội, Hà Giang, Cao Bằng, Bắc Kạn, Tuyên Quang, Lào Cai, Điện Biên, Lai Châu, Sơn La, Yên Bái, Hoà Bình, Thái Nguyên, Lạng Sơn, Quảng Ninh, Bắc Giang, Phú Thọ, Vĩnh Phúc, Bắc Ninh, Hải Dương, Hải Phòng, Hưng Yên, Thái Bình, Hà Nam, Nam Định, Ninh Bình |
| 4 | `north_center` | Thanh Hóa, Nghệ An, Hà Tĩnh, Quảng Bình, Quảng Trị, Thừa Thiên Huế |
| 5 | `south_center` | Đà Nẵng, Quảng Nam, Quảng Ngãi, Bình Định, Phú Yên, Khánh Hòa, Ninh Thuận, Bình Thuận, Kon Tum, Gia Lai, Đắk Lắk, Đắk Nông, Lâm Đồng |
| 1 | `south` | Hồ Chí Minh, Bình Phước, Tây Ninh, Bình Dương, Đồng Nai, Bà Rịa - Vũng Tàu, Long An, Tiền Giang, Bến Tre, Trà Vinh, Vĩnh Long, Đồng Tháp, An Giang, Kiên Giang, Cần Thơ, Hậu Giang, Sóc Trăng, Bạc Liêu, Cà Mau |

- 통폐합(2025-07, 63 → 34) 전 체계입니다. 채널 구조 문서에도 "신 명칭 보강 필요"로 남아 있습니다. Go2Joy가 신 명칭을 쓰기 시작하면 새 표를 전달해 주십시오.
- 필리핀(REGIONS 10)은 포함하지 않습니다.
