# PLN-261023 — go2joy HA: 호텔 정보 → B2B 고객정보, 객실 유형 → 고객사별 상품정보

- 근거: [REQ-261023-Go2Joy-HA-Hotel-Profile-RoomTypes](../analysis/REQ-261023-Go2Joy-HA-Hotel-Profile-RoomTypes.md) (§1.4 Partner API 실측)
- 상태: **v2 — 승인 대기**. 방식 결정(2026-10-23): **B(Partner API 조회) + 콘솔 직접 입력으로 시작, A(HA 서버 전송)는 나중에 추가**.
- 스키마: 있음(`sql/261024-company-profile-products.sql`)

## 0. 요약
| 데이터 | 1차(이번) | 나중(A) |
|---|---|---|
| 호텔명·영업시간·취소 정책 | **Partner API Hotel Info** 자동 | HA 전송 |
| 객실 유형(요금·상태·이미지·시설·침대·면적) | **Partner API Room Type Feed v1+v2** 자동 → 고객사별 상품 | HA 전송 |
| 코드·그룹·전화·주소·성/군·프로모션/인기/신규·계약일·결제·호텔 유형·기업명·등록번호·추가요금·설명·정책, 객실 수 | **콘솔 직접 입력** | HA 전송이 덮어씀 |

## 1. 결정 사항 (기본값 — 바꿀 수 있음)
| # | 결정 | 기본값 |
|---|---|---|
| D1 | 고객사가 생기는 경로 | ① 서명 identify(지금처럼) ② **HA 세션의 hotel_id(서명 없음 포함)를 Partner API가 확인하면** 고객사만 생성(담당자 연결·대화 기록 연결은 없음) ③ 콘솔 "호텔 추가"(hotelSn 입력) |
| D2 | 객실 상태 | 전부 저장, HA 상태 코드 그대로 보관 + 표시 이름(1=판매 중, 4=반려, 5=판매 중지, 그 외=코드 표시). 목록 기본 필터 = 판매 중 |
| D3 | 자동 값 vs 입력 값 | 자동(Partner) 항목은 콘솔에서 **읽기 전용**(출처 표시). 입력 항목만 편집. A가 붙으면 HA 값이 입력 값을 대체(마지막 출처·시각 기록) |
| D4 | 갱신 주기 | 고객사 생성 시 즉시 + **하루 1회** 전체 재조회 + 콘솔 "지금 동기화" 버튼 |
| D5 | 편집 권한 | `CUSTOMER_MANAGE` 보유자(마스터·디렉터·매니저) — 고객 화면과 같은 권한 |

## 2. 설계
### 2.1 Partner API 연동 (provider `go2joy_partner`)
- 테넌트 연동 자격증명(기존 per-tenant AES-256-GCM)에 `base_url`·`client_id`·`client_secret`. 플랫폼 연동 화면에 카드 + **연결 테스트**(Hotel Info 1회, 오류 코드 6 서명 / 8 IP / 10 clientId 구분).
- 서명: `hex(HMAC-SHA256(secret, URL + "|" + 키 정렬 JSON))`, 본문 `clientId`·`timestamp`, 헤더 `Localization`. 응답 `code≠1` → 실패로 기록.
- 호출: Hotel Info v2(`hotelSn`) · Room Type Feed v1(가격·상태) + v2(시설·이미지 목록)를 `sn`으로 병합. 호출 한도 고려해 호텔당 3회, 일 1회.
- 실패: 마지막 성공 값 유지 + `partner_sync_error` 기록, 콘솔에 표시.

### 2.2 스키마 (`sql/261024-company-profile-products.sql`)
```
companies       + code VARCHAR(64), phone VARCHAR(40), district VARCHAR(120), address VARCHAR(500)   (입력)
                + profile JSON          — 입력 항목(그룹·플래그·계약·결제·유형·기업명·등록번호·추가요금·설명·정책)
                + partner_info JSON     — Partner 자동 항목(영업시간·취소 정책·원문 이름)
                + partner_synced_at DATETIME, partner_sync_error VARCHAR(255), profile_updated_at DATETIME,
                  profile_updated_by BIGINT
products_cache  + company_id BIGINT, source VARCHAR(16), attributes JSON
                + INDEX idx_prdc_tenant_company (tenant_id, company_id)
```
- 객실 상품: `handle = hotel-{hotelSn}-rt-{roomSn}`, `title`, `category='room_type'`, `currency='VND'`, `source='go2joy_partner'`, `image_url`=대표 이미지, `price`=대표가(첫 시간→숙박→1일 첫 값), `status` 1→`active` / 그 외→`archived`, `attributes = { haStatus, firstHours, additionalHours, prices{firstHours, additional, overnight, oneDay}, extraFee, discount, flashSale, bedType, square, facilities[], images[], memo, roomCount(입력) }`.
- 피드에서 사라진 객실 → `archived`(삭제 안 함). `company_id IS NULL` 행(쇼핑몰 상품)은 건드리지 않음.

### 2.3 작업
| # | 작업 | 파일(예정) |
|---|---|---|
| 1 | SQL + 엔티티(`Company`, `ProductCache`), nullable `type` 명시, 실제 부팅 확인 | entity |
| 2 | `Go2JoyPartnerClient`(서명·타임아웃·오류 분류) + 연동 provider 등록·연결 테스트 | `domain/go2joy/partner-client.ts`, integration |
| 3 | `HotelSyncService.syncHotel(tenant, hotelSn)` — Hotel Info + Room Type Feed → 고객사 `partner_info` + 객실 upsert/보관(트랜잭션) | `domain/go2joy/hotel-sync.service.ts` |
| 4 | 고객사 생성 경로 ②: identify(서명·claimed)에서 hotel_id를 보면 비동기로 `ensureHotel()`(Partner 확인 후 생성/갱신, 실패는 무시·로그) · ③ 콘솔 "호텔 추가" | `embed.service.ts`, `company.controller.ts` |
| 5 | 일 1회 스케줄러(연동된 테넌트의 hotel:* 고객사) + "지금 동기화" | scheduler |
| 6 | 쇼핑몰 동기화 4종의 보관 단계에 `company_id IS NULL` 가드 | product-sync 외 |
| 7 | 콘솔 API: `PATCH /companies/:id/profile`(입력 항목, 감사 로그), `GET /companies/:id`에 profile·partner_info·rooms, `POST /companies`(hotelSn), `POST /companies/:id/sync`, `GET /products?company_id=&ha_status=`, `PATCH /products/:handle/room-count`, 라이브챗 `company` 요약(claimed는 hotel_id로 표시 전용 조회 + 미검증) | company / product / agent-console |
| 8 | 화면 4곳(§3) + 6개 언어 · 저장 토스트 | web |
| 9 | 스테이징: go2joy에 Partner 테스트 자격증명 등록 → 4118 동기화 → Lá Hotel 입력 항목은 HA 실화면 값으로 콘솔에서 입력해 검증 | 운영 |
| 10 | GUIDE·체크리스트: Go2Joy 확인 요청(상태 코드 의미, Partner 스테이징 DB≠HA UAT, 운영 IP 화이트리스트·자격증명, 피드 범위) + A(전송) 사양 초안은 다음 단계 | docs/guide |

**범위 밖(다음 단계)**: A(HA 서버 전송) · AI가 호텔 프로필·객실을 근거로 답하기(외부 AI엔 기업명·등록번호·전화 제외) · 객실을 KB 문서로 만들기.

## 3. 화면
### 3.1 고객 › 기업고객 › 호텔 상세 (모달 → 탭)
```
┌ Lá Hotel Quận 10 ─────────────────────────────── [지금 동기화] ✕ ┐
│ hotel:4118 · South · Go2Joy 동기화 2026-10-24 10:12 ✓             │
│ [기본 정보]  [객실 21]  [담당자 1]  [대화 3]                         │
│ ── Go2Joy에서 자동 (읽기 전용) ───────────────────────────────────── │
│ 영업시간   시간제 07–21 · 숙박 21–12 · 1일 14–12   첫 시간 1h        │
│ 취소 정책  시간제 60분 · 숙박 120분 · 1일 120분 · 예약 후 5분 무료    │
│ ── 직접 입력 ───────────────────────────────────────── [수정] ───── │
│ 코드 HCM_010_004118-TC-005   그룹 —        전화 0280886241062       │
│ 성/군 Hồ Chí Minh / Quận 1   주소 62 Đ. Ngô Quyền, P.6, Q.10, HCM    │
│ 프로모션/인기/신규 예/아니오/아니오   추가 요금 있음                    │
│ 계약 2021-06-24 ~ —   결제 Pay in advance & Pay at hotel            │
│ 호텔 유형 Couple & Travel   기업명 Nguyễn Thị   등록번호 24JH5858117 │
│ 설명(EN) ✅ CCCD/ID 2인 …   설명(VI) —   정책(EN/VI) —                │
│                              마지막 수정 2026-10-24 10:20 · smoke     │
└─────────────────────────────────────────────────────────────────┘
[수정] → 같은 자리에서 입력 필드(텍스트·날짜·예/아니오 토글·여러 줄) + [저장][취소], 저장 토스트
```
### 3.2 기업고객 목록 — 호텔 추가
```
[회사명 검색…        ] [지역 ▾]                          [+ 호텔 추가]
  └ 모달: Go2Joy 호텔 번호(hotelSn) [4118] → [확인] → "Lá Hotel Quận 10" 미리보기 → [추가]
```
### 3.3 상품 — 고객사 필터
```
상품  [고객사: 전체 ▾ | Lá Hotel Quận 10]  [상태: 판매 중 ▾]  [검색…   ]
┌───────────────┬──────────────┬───────┬──────────────────┬─────────┬─────────┬───────┐
│ 상품           │ 고객사        │객실 수│ 시간제(첫/추가)   │ 숙박     │ 1일      │ 상태   │
├───────────────┼──────────────┼───────┼──────────────────┼─────────┼─────────┼───────┤
│ [img] Standard │ Lá Hotel Q10 │ 14 ✎  │ 60.000đ/65.000đ  │340.000đ │450.000đ │판매 중 │
│ [img] Deluxe   │ Lá Hotel Q10 │ — ✎   │ …                │ …       │ …       │판매 중 │
└───────────────┴──────────────┴───────┴──────────────────┴─────────┴─────────┴───────┘
상세 모달: 이미지·침대·면적·시설 목록(VI/EN)·추가요금/할인/플래시세일·메모
(쇼핑몰 테넌트는 고객사 필터·객실 열이 보이지 않음 — 지금과 같음)
```
### 3.4 라이브챗 고객 패널 — 호텔 카드
```
┌ 호텔 ─────────────────────────── [상세 ↗] ┐
│ Lá Hotel Quận 10   (⚠ 미검증 로그인)       │
│ 62 Đ. Ngô Quyền, P.6, Q.10, Hồ Chí Minh    │
│ ☎ 0280886241062 · Couple & Travel          │
│ 시간제 07–21 · 숙박 21–12 · 1일 14–12       │
│ 판매 중 객실 18 · Standard 340k · Deluxe … │
└────────────────────────────────────────────┘
```
### 3.5 설정 › 연동 › 플랫폼 — Go2Joy Partner 카드
```
┌ Go2Joy Partner API ─────────────── 연결됨 ✓ ┐
│ 서버 https://staging-partner.go2joy.vn/      │
│ Client ID  c3e9…   Secret ••••••             │
│ [연결 테스트] [수정] [연결 해제]              │
└─────────────────────────────────────────────┘
```

## 4. 부작용 분석
| 영역 | 영향 | 대응 |
|---|---|---|
| 쇼핑몰 상품 | 컬럼 추가만. 동기화 보관 단계가 객실 행을 보관하면 안 됨 | 작업 6 가드 + 스펙 |
| 고객사 목록 | 담당자 0명인 호텔이 생김(서명 없는 세션·콘솔 추가) | 의도. 목록에 "담당자 0" 그대로 표시 |
| 서명 없는 hotel_id | Partner API가 존재를 확인한 호텔만 생성, 담당자·대화 연결 없음 | 다른 호텔을 지정해도 공개 운영 정보만 생김 |
| Partner 호출 한도 | identify마다 호출하지 않음(고객사가 이미 있고 24h 안이면 건너뜀) | 캐시 |
| 스테이징 데이터 | Partner 스테이징 ≠ HA UAT → 화면 값이 HA와 다르게 보임 | RPT·GUIDE에 명시, 운영 DB 동일 여부 Go2Joy 확인 |
| 개인정보 | 기업명(개인사업자 이름일 수 있음)·전화 — 콘솔은 평문(10/23 결정), 외부 AI 미전송 | 이번 범위에서 AI 입력 없음 |

## 5. 테스트
- 단위: 서명 문자열(문서 예시 벡터), 오류 코드 분류, 동기화 병합(v1+v2)·보관·대표가, 생성 경로 ②의 확인 실패 시 미생성, 보관 가드, 입력 PATCH 검증·감사
- 통합(스테이징): 자격증명 등록·연결 테스트 → HA UAT 세션(4118) → 고객사 생성·객실 21 → 콘솔 입력 → 상품 필터·패널 카드
- 엣지: 피드에 없는 호텔(T15: 필터 무시 응답 → `sn` 대조로 거름), `data:null`, 가격 0, 긴 이름

## 6. 배포
SQL 선적용 → 코드(스테이징 → 프로덕션). 프로덕션은 Partner 운영 자격증명·IP 화이트리스트 전까지 연동 미설정 = 동작 불변.

## 7. 일정
승인 후 약 2일: 1~7(백엔드) → 8(화면) → 9 스테이징 검증 → 10 문서 → TCR/RPT.
