# REQ-261023 — Go2Joy Support Assistant API 대조: 성·권역 자동 갱신, 호텔·객실 누락 필드

- 요청(2026-10-23): Go2Joy가 공개한 **API Integration Document (Support Assistant API)**
  (<https://dev.go2joy.vn/api-integration-document-support-assistant-api>)를 분석해, 현재 구현에서
  **사용자 인증 / 호텔 정보 연동**에 추가할 것이 있는지 검토 → 검토 결과 H1~H3 진행 지시("진행").
- 조사 기준: main `7c592142` · 문서 13쪽(`…/llms.txt` 기준 전체 수집) · 스테이징 Partner API 실호출(clientId 스테이징, 호텔 4118, 2026-10-23) ·
  스테이징 DB(tenant 4) 조회
- 관련: [REQ-261021](REQ-261021-Go2Joy-HA-Operator-Identity-Routing.md)(지역표 63개) ·
  [PLN-261022](../plan/PLN-261022-Go2Joy-HA-B2B-Identity-Continuity.md)(`provinceRegions`) ·
  [PLN-261023 호텔 프로필](../plan/PLN-261023-Go2Joy-HA-Hotel-Profile-RoomTypes.md)

## 1. 문서 요지

| 구분 | 내용 | 우리 구현 |
|---|---|---|
| 목적 | "채팅하는 사용자의 **호텔·역할 식별**, 호텔 **권역**별 CS/Sale Admin 배정, HA에서 고른 **언어**로 응답" | 같은 목적(PLN-261015/261022) |
| 인증 | POST · `Authorization = hex(HMAC-SHA256(secret, URL+"\|"+키 정렬 JSON))` · `clientId`·`timestamp`(5분) · `Localization` en/vi · IP 허용 | `partner-client.ts` 동일 |
| Feed | Province · District · Hotel · Room Type | Room Type(v1+v2)만 사용 |
| Hotel | Hotel List · Hotel Info · Room Type List | Hotel Info만 사용 |
| 사용자·역할 API | **없음** | identify(HA 서명 속성 `hotel_id`·`role`·`region`·`province`)로만 가능 — 현행 유지 |
| 운영 전환 | 예약 3건(시간·1박·1일) 생성으로 인증 — Affiliate 문서 복사로 보임 | 예약 API 미사용 → Go2Joy 확인(G18) |

**결론**: 사용자 인증은 추가 사항 없음. 호텔 정보는 아래 3건(H1~H3) 추가. 실시간 판매 현황(H4: Room Type List v2)은
AI 근거 답변 후속에서 설계(이번 범위 아님).

## 2. AS-IS (실측)

### 2.1 성 → 권역 지역표
- `tenant_ai_config.handoff_config.provinceRegions` = Go2Joy 엑셀(10/21) 기반 **63개 성, 정적** — SQL 스크립트
  `scripts/go2joy/province-regions-sql.mjs`로만 넣는다(스테이징 tenant 4 = 63, 갱신 수단·화면 없음).
- **Province Feed 실측(10/23): 80개 성.** 베트남 63 + **필리핀 메트로 마닐라 17개 시(권역 `10`)** — 권역 `10`은 문서
  enum(1 South · 2 North · 3 Central · 4 North Central · 5 South Center)에 없다. 2단계(필리핀) 배정에 필요한 행이 이미 API에 있다.
- 권역 코드 대응: `1→south`, `2→north`, `3→central`, `4→north_center`, `5→south_center`(우리 `REGION_CODES`와 1:1), `10→?`

### 2.2 HA가 `region`에 성 이름을 보냄 (G10 미해결)
스테이징 tenant 4 세션 `identity_attributes`:

| region(저장값) | province | 세션 |
|---|---|---|
| `hồ_chí_minh` | Hồ Chí Minh | **13** |
| south | Hồ Chí Minh | 3 |
| south_center | Đà Nẵng | 4 |
| north / south | — | 10 |

- `storedIdentityAttributes`는 **region이 있으면 서명된 값이 우선**(지역표와 다르면 경고만) → 성 이름이 권역 자리에 남는다.
  권역 담당자 규칙(`assigneeByRegion`)이 이 세션을 못 잡고, 콘솔 배지가 `hồ_chí_minh`로 보인다.
- 고객사 `hotel:4118`(Lá Hotel Quận 10): province `Hồ Chí Minh`, **region NULL**.

### 2.3 Hotel Info — 오는데 버리는 필드
실측 응답 키: `sn,name,firstHours,hourly,overnight,daily,`**`cancelBeforeHours`**`,startDaily,endDaily,startOvernight,endOvernight,startHourly,endHourly,`**`startRightNowTonight,endRightNowTonight`**`,cancellationPolicy`
- `cancelBeforeHours`(4118 = 1): 예약 시각 n시간 전까지 취소 가능(오류 130과 같은 규칙) — 미저장
- `startRightNowTonight`/`endRightNowTonight`(0/6): 1박 "지금·오늘 밤" 선택 가능 시간대 — 미저장

### 2.4 Room Type Feed v2 — `viewList` 미저장
실측: `{sn, name:"Hướng thành phố", nameEn:"City"}` 등(창문·도시·강·산·공항…). `facilityList`는 저장, `viewList`는 버림.

## 3. TO-BE

| # | 항목 | 내용 |
|---|---|---|
| H1-a | 지역표 자동 갱신 | Partner 자격증명이 있는 테넌트는 **Province Feed**로 `provinceRegions`를 채운다: 하루 1회(기존 호텔 동기화와 함께) + 연동 카드 [지역표 갱신]. 같은 성은 API 값으로 덮고, API에 없는 기존 항목은 유지 |
| H1-b | 권역 자리의 성 이름 교정 | `region` 값이 권역 코드가 아니고 지역표의 **성 이름과 같으면**(`_`/공백·대소문자·NFC 무시) 그 성으로 보고 권역을 지역표에서 채운다(서명·서명 없음 모두). 로그 `region map(province-in-region)` |
| H1-c | 고객사 권역 보충 | 고객사 region이 비어 있고 province가 지역표에 있으면 권역을 채운다(동기화·identify 시) + 기존 행 1회 보정 |
| H2 | 호텔 정보 필드 | `partnerInfo.cancelBeforeHours`, `partnerInfo.rightNowTonight{start,end}` 저장·표시(호텔 상세, 라이브챗 호텔 카드) |
| H3 | 객실 전망 | 객실 `attributes.views[{vi,en}]` 저장·표시(상품 상세) |

## 4. 갭

| 갭 | 원인 | 해결 |
|---|---|---|
| 필리핀 성 없음 / 갱신 수단 없음 | 정적 SQL | H1-a |
| `hồ_chí_minh` 권역 | HA 오전송 + 서명값 우선 규칙 | H1-b (G10 회신 전까지의 보정) |
| 고객사 권역 NULL | province만 들어온 경로 | H1-c |
| 취소 시한·지금/오늘 밤 시간 | mapper 미독 | H2 |
| 전망 | mapper 미독 | H3 |

## 5. 사용자 흐름
1. 운영자: 설정 › 연동 › Go2Joy Partner 카드 → [지역표 갱신] → "80개 성 반영(새 17)" 토스트. 이후 매일 자동.
2. HA 사용자 로그인(region=`Hồ Chí Minh`) → 세션 권역 `south` → 권역 담당자 배정·배지 "South".
3. 상담원: 호텔 상세/호텔 카드에 "취소: 예약 1시간 전까지 · 지금/오늘 밤 0–6시", 객실 상세에 "전망: City · Window".

## 6. 제약
- 권역 `10`의 이름·의미는 문서에 없음 → Go2Joy 확인(G19). 확인 전까지 코드 표기를 그대로 저장(PLN D1).
- Province Feed는 서명 대상(목록 Feed라도 POST + 서명). 호출 한도 250/분(스테이징) — 하루 1회 1건이라 무관.
- 프로덕션은 Partner 자격증명 미등록 → H1-a는 동작 안 함(정적 지역표 그대로). H1-b·c는 지역표만 있으면 동작.
- 스키마 변경 없음(JSON 필드 추가만).
