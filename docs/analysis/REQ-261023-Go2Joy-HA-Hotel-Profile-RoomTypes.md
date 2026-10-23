# REQ-261023 — go2joy HA: 호텔 정보 → B2B 고객정보, 객실 유형 → 상품정보(고객사별)

- 요청(2026-10-23): 라이브챗 제목 `ADMIN123 / Lá Hotel Quận 10`처럼 HA 로그인 사용자는 이미 보인다. 이 사용자의 **호텔 정보**
  (HA `hotel-info-tabs?hotelSn=4118&tab=hotel`)를 **SharpTalk B2B 고객정보**에, **객실 유형**(`tab=room-type`)을
  **SharpTalk 상품정보**에 저장한다. 상품정보는 **B2B 고객(호텔)별로 구분**되어야 한다.
- 조사 기준: main `87defb9d`(프로덕션 동일) · HA UAT 실화면(Orca 내장 브라우저, ADMIN123, 2026-10-23) · Partner API 문서(10/21 수집) · REQ-261021 §2-1-1 실측

## 1. AS-IS

### 1.1 HA에 있는 것 (실화면)
**호텔 정보 탭** — 요청에 붙여 준 항목(★)과 그 밖의 항목
| 항목 | 예(4118) | 요청 |
|---|---|---|
| Hotel name / Code / Group | Lá Hotel Quận 10 (HCM_010_004118-TC-005) / 그룹 없음 | ★ |
| Phone | 0280886241062 | ★ |
| Promotion / Hot / New | Yes / No / No | ★ |
| Hourly / Overnight / Daily | 07:00~21:00 / 15:00~08:00 / 10:00~12:00 | ★ |
| Contract date / End | 2021-06-24 / — | ★ |
| Payment | Pay in advance & Pay at hotel | ★ |
| Hotel type | Couple & Travel | ★ |
| Province / District | Hồ Chí Minh / Quận 1 | ★ (⚠ 주소는 Quận 10 — HA 데이터 불일치) |
| Address | 62 Đ. Ngô Quyền, Phường 6, Quận 10, Hồ Chí Minh, Vietnam | ★ |
| Name of enterprise | Nguyễn Thị | ★ |
| Enterprise Registration Certificate No. | 24JH5858117 | ★ |
| Extra fee | Yes | ★ |
| English description (고객 요건) | CCCD/ID 2인, 18세 이상, 1실 최대 2인 | ★ |
| Tax code · Status(Contracted 15%) · 예약 알림 수단 · Room available · 리뷰 수·평점·좋아요 · Hash tag · 베트남어 설명 · 호텔 정책(VI/EN) | 223300015057 · … | 요청 목록에 없음 |

**객실 유형 탭** — 7개(Active 2 · Rejected 3 · Draft 1 · Stopped selling 1)
| 객실명 | 상태 | 객실 수 | 시간제(첫 시간 / 추가) | 숙박 | 1일 |
|---|---|---|---|---|---|
| Junior Room | Active | 30 | 300.000đ / 1h · 50.000đ / 1h | 920.000đ | N/A |
| Standard Room | Active | 14 | 50.000đ / 1h · 55.000đ / 1h | 230.000đ | N/A |
| Test003 · Test 002 · Phòng Test | Rejected | 4·14·9 | … | … | … |
| qưe / jhjh | Stopped / Draft | 100 | N/A | N/A | 123.000đ |
(호텔 탭 하단에도 활성 객실의 첫 시간·추가·숙박·1일 요금과 메모가 요약돼 있다.)

### 1.2 HA 데이터를 SharpTalk이 가져올 수 있는 길
| 경로 | 실측 / 근거 | 판정 |
|---|---|---|
| HA 백엔드 API (`go2joyserverphp-ha-uat…/api/v1/web/ha/home-hotel`, `/room-types/hotel`, `/roomType/getRoomTypeList`) | HA 직원 **로그인 토큰**으로만 응답. SharpTalk 서버에는 그 토큰이 없다 | ✗ 직접 호출 불가 |
| Go2Joy **Partner API** (서버 간 HMAC) | Hotel Info v2·Room Type List/Feed는 있음. 1721은 Hotel Info로 조회됨(T17). 그러나 **기업명·사업자등록번호·계약일·결제·호텔 유형 등 B2B 필드가 없고**, HA 호텔이 Hotel Feed에 없을 수 있음(T15~T17) | △ 객실·설명 일부만 |
| **HA 서버 → SharpTalk 서버 전송(push)** | HA가 이미 가진 데이터를 저장·변경 시 보냄. Go2Joy 개발 필요 | ○ 전 항목 가능 |
| HA 화면 → 위젯(identify에 실어 보냄) | 서명 밖 값 — 아무나 다른 호텔 정보를 덮어쓸 수 있음 | ✗ |

### 1.3 SharpTalk에 있는 것
- `companies`: `external_key=hotel:{id}`, `name`·`province`·`region`·`last_seen_at`만. **서명된 identify가 있어야 생긴다** → 지금 HA UAT(`hash:"testing"`, claimed)에서는 **Lá Hotel 고객사가 아직 없다**(제목의 호텔명은 claimed 속성에서 읽은 것).
- `products_cache`: 테넌트 단위 카탈로그(쇼핑몰 동기화). `(tenant_id, handle)` 유일, `price DECIMAL(10,2)`, 통화, 상태 active/archived, 카테고리·태그. **고객사 축 없음.**
- 콘솔: `/customers` 기업고객 탭(목록·상세 모달: 담당자·대화), `/products`(상품 목록·상세), 라이브챗 고객 패널.

## 2. TO-BE
| # | 기대 |
|---|---|
| T1 | B2B 고객(호텔)에 위 ★ 항목이 저장되고 콘솔 기업고객 상세에서 보인다 |
| T2 | 호텔의 객실 유형이 상품정보로 저장되고 `/products`에서 **고객사별로 필터**·표시된다(요금·객실 수·HA 상태 포함) |
| T3 | 라이브챗에서 HA 사용자와 대화할 때 그 호텔의 요약(주소·연락처·영업시간·객실)이 고객 패널에 보인다 |
| T4 | HA에서 정보가 바뀌면 SharpTalk에도 반영된다(최신성) |

## 3. 갭
| # | 갭 | 누가 |
|---|---|---|
| G-a | 호텔 정보·객실 유형을 SharpTalk으로 보내는 경로 | **Go2Joy**(전송) + SharpTalk(수신 API) |
| G-b | `companies`에 프로필 필드 없음 | SharpTalk |
| G-c | `products_cache`에 고객사 축·숙박 요금 구조 없음 | SharpTalk |
| G-d | 콘솔 기업고객 상세·상품 목록·고객 패널 표시 | SharpTalk |
| G-e | claimed 세션은 고객사와 연결되지 않음 → 패널에 호텔 정보 못 띄움 | SharpTalk(표시 전용 조회) |

## 4. 흐름 (TO-BE)
```
HA 호텔 정보 저장/객실 변경 ─▶ HA 서버 ─(HMAC)─▶ SharpTalk  PUT /partner/hotels/{hotelSn}
                                                    ├─ companies(hotel:4118) 생성/갱신 + profile
                                                    └─ products(company_id=…) 객실 upsert, 빠진 객실은 보관
라이브챗(HA 사용자, hotel_id=4118) ─▶ 고객 패널: 호텔 요약 + 객실 / 콘솔 /customers·/products 에서 열람
```

## 5. 제약
- 고객사·상품은 **서버 간 인증된 값**으로만 만든다(브라우저 값으로 다른 호텔을 덮어쓰지 못하게).
- 콘솔 표시는 마스킹하지 않는다(10/23 결정). **외부 AI로 보낼 때**는 기업명·사업자번호·전화를 빼고 운영 정보(주소·시간·객실·요금·고객 요건)만 쓴다.
- 금액은 VND 정수(DECIMAL(10,2)로 충분: 최대 99,999,999.99).
- 지역/성은 identify 서명값과 같은 정규화(NFC, 지역표)를 쓴다.
