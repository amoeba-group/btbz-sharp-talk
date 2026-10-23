# PLN-261023 — go2joy HA: 호텔 정보 → B2B 고객정보, 객실 유형 → 고객사별 상품정보

- 근거: [REQ-261023-Go2Joy-HA-Hotel-Profile-RoomTypes](../analysis/REQ-261023-Go2Joy-HA-Hotel-Profile-RoomTypes.md)
- 상태: **승인 대기** — 승인 전 구현하지 않습니다. §1 결정 3건.
- 스키마: 있음(`sql/261024-company-profile-products.sql`)

## 0. 요약
HA 서버가 호텔 정보와 객실 유형을 **서버 간 서명 요청**으로 SharpTalk에 보내면, SharpTalk이 B2B 고객사(`companies`)에 프로필을, 상품(`products_cache`)에 **고객사별 객실 상품**을 저장하고 콘솔 3곳(기업고객 상세·상품·라이브챗 고객 패널)에 보여 줍니다. Go2Joy 전송이 붙기 전에는 같은 API로 Lá Hotel(4118) 실화면 데이터를 스테이징에 넣어 화면을 검증합니다.

## 1. 결정 필요
| # | 결정 | 안 | 권장 |
|---|---|---|---|
| D1 | 데이터 원천 | **A. HA 서버 → SharpTalk 전송**(전 항목, 변경 즉시, Go2Joy 개발 필요) / B. SharpTalk이 Partner API로 조회(Go2Joy 개발 없음, **기업명·사업자번호·계약·결제·호텔 유형 없음**, HA 호텔이 피드에 없을 수 있음) | **A** (B는 객실·설명 보강용으로 나중에) |
| D2 | 객실 상태 | 7개 모두 저장 + HA 상태 표시(Active/Rejected/Draft/Stopped) / Active만 저장 | **모두 저장**, 목록 기본 필터 = 판매 중 |
| D3 | 요청 목록 밖 항목 | ★ 항목만 / ★ + 베트남어 설명·호텔 정책(VI/EN)·세금코드·계약 상태 | **★ + 설명·정책(VI/EN)** (AI 답변 근거로 쓸 수 있음). 세금코드·상태는 Go2Joy가 보내면 저장만 |

## 2. 설계
### 2.1 수신 API (D1-A)
`PUT /api/v1/public/partner/hotels/{hotelSn}` — `@Public()` + 서명 가드
- 헤더: `X-SharpTalk-Tenant: go2joy` · `X-SharpTalk-Timestamp: <unix초>`(±300초) · `X-SharpTalk-Signature: hex(HMAC-SHA256(embed_secret, timestamp + "\n" + 원문 본문))`
  - 키는 identify와 같은 **테넌트 embed secret**(Go2Joy 서버가 이미 보관). 새 비밀값 없음.
- 본문(snake_case):
```json
{ "hotel": { "name": "Lá Hotel Quận 10", "code": "HCM_010_004118-TC-005", "group_name": null,
    "phone": "0280886241062", "province": "Hồ Chí Minh", "district": "Quận 1", "region": "South",
    "address": "62 Đ. Ngô Quyền, Phường 6, Quận 10, Hồ Chí Minh, Vietnam",
    "flags": { "promotion": true, "hot": false, "new": false },
    "hours": { "hourly": "07:00~21:00", "overnight": "15:00~08:00", "daily": "10:00~12:00" },
    "contract": { "start": "2021-06-24", "end": null }, "payment": "Pay in advance & Pay at hotel",
    "hotel_type": "Couple & Travel", "enterprise_name": "Nguyễn Thị", "enterprise_reg_no": "24JH5858117",
    "extra_fee": true, "description": { "en": "…", "vi": "…" }, "policy": { "en": "…", "vi": "…" } },
  "room_types": [ { "sn": 101, "name": "Junior Room", "status": "active", "room_count": 30,
      "hourly": { "first_hours": 1, "first_price": 300000, "plus_hours": 1, "plus_price": 50000 },
      "overnight_price": 920000, "daily_price": null, "memo": "test 001", "currency": "VND" } ] }
```
- `room_types`는 **전체 목록**(보낸 목록에 없는 기존 객실 → `archived`). `room_types` 키를 빼면 객실은 건드리지 않음.
- 응답: `{ companyId, rooms: { upserted, archived } }`. 오류: 서명 E5110, 시각 초과 E5111, 테넌트 없음 E5112(새 Exxxx 블록), 검증 400.

### 2.2 스키마 (`sql/261024-company-profile-products.sql`)
```
companies         + code VARCHAR(64) NULL, phone VARCHAR(40) NULL, district VARCHAR(120) NULL,
                    address VARCHAR(500) NULL, profile JSON NULL, profile_synced_at DATETIME NULL
                    (profile = 그룹·플래그·영업시간·계약·결제·유형·기업명·등록번호·추가요금·설명·정책)
products_cache    + company_id BIGINT NULL, source VARCHAR(16) NULL, attributes JSON NULL
                    + INDEX idx_prdc_tenant_company (tenant_id, company_id)
```
- 객실 상품: `handle = hotel-{hotelSn}-rt-{roomSn}`, `title = 객실명`, `category = 'room_type'`, `currency = 'VND'`, `source = 'go2joy_ha'`,
  `price` = 대표가(시간제 첫 시간 → 숙박 → 1일 순서로 첫 값), `status` = Active→`active` / 그 외→`archived`,
  `attributes` = `{ haStatus, roomCount, hourly{…}, overnightPrice, dailyPrice, memo }`.
- `company_id IS NULL` = 기존 쇼핑몰 상품(동작 불변).

### 2.3 작업
| # | 작업 | 파일 |
|---|---|---|
| 1-1 | SQL + 엔티티(`Company`, `ProductCache`) — nullable 컬럼 `type` 명시, 부팅 확인 | `company.entity.ts`, `product-cache.entity.ts` |
| 1-2 | 서명 가드(테넌트 slug → embed secret, 시각창, `timingSafeEqual`), 4xx `logger.warn` | `partner/partner-signature.guard.ts` |
| 1-3 | `PartnerHotelService.upsert(tenant, hotelSn, dto)` — 고객사 upsert(hotel:{sn}) + 지역 정규화(identify와 같은 `storedIdentityAttributes` 규칙) + 객실 upsert/보관, 한 트랜잭션 | `partner/partner-hotel.service.ts` |
| 1-4 | 쇼핑몰 상품 동기화의 "안 보인 상품 보관" 단계가 `company_id IS NULL` 행만 건드리도록 가드 | `product-sync.service.ts` 외 동기화 4종 |
| 1-5 | 콘솔 API: `GET /companies/:id`에 `profile` + `rooms`, `GET /products?company_id=` 필터·응답에 `companyId/companyName/attributes`, 라이브챗 `GET /agent/conversations/:id`의 `company`에 요약(서명=company_id, claimed=속성 `hotel_id`로 **표시 전용 조회**, 미검증 표시) | `company.service.ts`, `product.service.ts`, `agent-console.controller.ts` |
| 1-6 | 화면 3곳(§3) + 6개 언어 | web |
| 1-7 | 스테이징 시드: Lá Hotel 4118(호텔 탭·객실 7개 실화면 값)을 1.1 API로 전송하는 스크립트(`scripts/go2joy/push-hotel-sample.mjs`, 시크릿은 env) | scripts |
| 1-8 | GUIDE: Go2Joy용 "호텔 정보 전송" 절(요청 예·서명·호출 시점: 호텔 정보 저장, 객실 생성/변경/상태 변경, 최초 전체 1회) — 연동 요청 체크리스트에 G-항목 추가 | docs/guide |

**범위 밖(다음 단계 제안)**: AI가 그 호텔 직원의 질문(“우리 호텔 숙박 요금?”)에 호텔 프로필·객실을 근거로 답하기 — 외부 AI 전송 시 기업명·등록번호·전화 제외.

## 3. 화면
### 3.1 고객 › 기업고객 › 호텔 상세(모달 확장)
```
┌ Lá Hotel Quận 10 ──────────────────────────────────────────── ✕ ┐
│ hotel:4118 · HCM_010_004118-TC-005 · South · Hồ Chí Minh / Quận 1 │
│ [기본 정보]  [객실 7]  [담당자 1]  [대화 3]                         │
│ ───────────────────────────────────────────────────────────────── │
│ 전화        0280886241062          호텔 유형   Couple & Travel     │
│ 주소        62 Đ. Ngô Quyền, Phường 6, Quận 10, Hồ Chí Minh        │
│ 영업시간    시간제 07:00~21:00 · 숙박 15:00~08:00 · 1일 10:00~12:00 │
│ 결제        Pay in advance & Pay at hotel     추가 요금  있음       │
│ 프로모션/인기/신규  예 / 아니오 / 아니오                            │
│ 계약일      2021-06-24 ~ (종료일 없음)                              │
│ 기업명      Nguyễn Thị            등록번호   24JH5858117           │
│ 고객 요건(EN) ✅ CCCD/ID 2인 · ✅ 18세 이상 · ✅ 1실 최대 2인        │
│                                   마지막 동기화 2026-10-24 10:12    │
└─────────────────────────────────────────────────────────────────┘
```
### 3.2 상품 — 고객사 필터
```
상품   [고객사: 전체 ▾ | Lá Hotel Quận 10 ]  [상태: 판매 중 ▾]  [검색…      ]
┌──────────────┬──────────────┬────────┬──────────────────────┬──────────┬────────┐
│ 상품          │ 고객사        │ 객실 수 │ 시간제(첫/추가)       │ 숙박      │ 상태    │
├──────────────┼──────────────┼────────┼──────────────────────┼──────────┼────────┤
│ Junior Room  │ Lá Hotel Q10 │ 30     │ 300.000đ / 50.000đ   │ 920.000đ │ 판매 중 │
│ Standard Room│ Lá Hotel Q10 │ 14     │ 50.000đ / 55.000đ    │ 230.000đ │ 판매 중 │
└──────────────┴──────────────┴────────┴──────────────────────┴──────────┴────────┘
(쇼핑몰 상품 테넌트는 고객사 필터·객실 열이 보이지 않음 — 지금과 같음)
```
### 3.3 라이브챗 고객 패널 — 호텔 카드
```
┌ 호텔 ─────────────────────────── [상세 ↗] ┐
│ Lá Hotel Quận 10  (⚠ 미검증: claimed)      │
│ 62 Đ. Ngô Quyền, P.6, Q.10, Hồ Chí Minh    │
│ ☎ 0280886241062 · Couple & Travel          │
│ 시간제 07–21 · 숙박 15–08 · 1일 10–12       │
│ 판매 중 객실 2: Junior 920k · Standard 230k │
└────────────────────────────────────────────┘
```

## 4. 부작용 분석
| 영역 | 영향 | 대응 |
|---|---|---|
| 쇼핑몰 상품(ivyusa 등) | 컬럼 추가만, `company_id NULL` 그대로. 동기화 보관 단계가 객실 행을 보관하면 안 됨 | 1-4 가드 + 스펙 |
| 고객사 생성 경로 | identify 외에 **서버 전송**으로도 생김 → 담당자 0명인 고객사가 목록에 보임 | 의도된 동작(전송 = 계약 호텔 목록) |
| claimed 세션 | 고객사와 **연결하지 않음**(기록 불변), 패널 표시만 hotel_id로 조회 + 미검증 표시 | 다른 호텔을 사칭해도 보이는 건 운영 정보뿐 |
| 서명 키 공유 | identify와 같은 embed secret — 재발급 시 두 경로 함께 갱신 | GUIDE 명시 |
| AI | 이번 범위에서 AI 입력에 넣지 않음 | 다음 단계 |
| 상품 KB(RAG) | 객실은 KB 문서로 만들지 않음 | 다음 단계 |

## 5. 테스트
- 단위: 서명(정상·변조·시각 초과·다른 테넌트), upsert(신규·갱신·객실 누락→보관·`room_types` 생략), 지역 정규화, 동기화 보관 가드, 대표가 선택
- 통합(스테이징): 1-7 스크립트로 4118 전송 → 기업고객 상세·상품 필터·HA 세션 패널 카드 확인, 재전송(객실 1개 뺌) → 보관 확인
- 엣지: 금액 0/N/A, 베트남어 NFD 입력, 아주 긴 설명(잘라 저장), 같은 hotelSn 동시 전송

## 6. 배포
SQL 선적용(스테이징→프로덕션) → 코드. 프로덕션에서는 Go2Joy 전송이 붙기 전까지 데이터 없음(동작 불변).

## 7. 일정
승인 후 1.5일: 1-1~1-5(백엔드) → 1-6(화면) → 1-7 스테이징 검증 → 1-8 GUIDE → TCR/RPT.
