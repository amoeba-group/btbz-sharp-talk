# PLN-261023 — Go2Joy Partner: 성·권역 자동 갱신 + 권역 교정 + 호텔·객실 누락 필드

- 근거: [REQ-261023-Go2Joy-Partner-Province-Region-Hotel-Fields](../analysis/REQ-261023-Go2Joy-Partner-Province-Region-Hotel-Fields.md)
- 상태: **v1 — 승인 대기**
- 스키마: **없음**(JSON 필드 추가만: `handoff_config.provinceRegions*`, `companies.partner_info`, `products_cache.attributes`). 데이터 보정 1회(H1-c)는 스크립트.

## 0. 요약
| # | 작업 | 영향 |
|---|---|---|
| H1-a | Province Feed → `provinceRegions` 자동 갱신(일 1회 + 버튼) | 80개 성(필리핀 17 포함) |
| H1-b | `region`에 성 이름이 오면 성으로 보고 권역 채움 | `hồ_chí_minh` 13세션 유형 → `south` |
| H1-c | 고객사 권역 비어 있으면 성으로 채움 + 기존 행 보정 | `hotel:4118` region NULL → `south` |
| H2 | Hotel Info `cancelBeforeHours`·`startRightNowTonight/endRightNowTonight` | 호텔 상세·호텔 카드 1줄씩 |
| H3 | Room Type Feed v2 `viewList` | 상품 상세 "전망" 1줄 |

## 1. 결정 사항 (기본값 — 바꿀 수 있음)
| # | 결정 | 기본값(권장) | 대안 |
|---|---|---|---|
| D1 | 문서에 없는 권역 `10`(마닐라 17개 시) | **`region_10`으로 저장**(카탈로그 밖 값 — 규칙·담당 지역은 "기타" 칩으로 매칭, 화면엔 코드 표시). Go2Joy 회신(G19) 후 카탈로그 코드·번역 추가 | 지금 `metro_manila` 코드 신설 |
| D2 | 갱신 병합 | **API 성은 API 값으로 덮고, API에 없는 기존 항목은 유지**(운영자가 SQL로 넣은 것 보호). 성 이름 철자는 API 것 | API 결과로 전체 교체 |
| D3 | H1-b 적용 범위 | **서명·서명 없음 모두**. 권역 코드(카탈로그 + `region_n`)가 아닌 값이 지역표의 성과 같을 때만. province가 비어 있으면 그 성으로 채움 | 서명 없음만 |
| D4 | H1-c 보정 | 배포 후 CLI 1회(`backfill-company-regions`, dry-run 기본) — 세션 이력은 손대지 않음 | 하지 않음 |

## 2. 설계

### 2.1 H1-a 지역표 갱신 (`apps/api/src/domain/go2joy/`)
- `province-region.mapper.ts`(순수): `PARTNER_REGION = {1:'south',2:'north',3:'central',4:'north_center',5:'south_center'}`, 그 외 n → `region_${n}`;
  `mergeProvinceRegions(current, feed) → { map, added, changed, kept }`(키 비교 = `provinceKey`, 저장 키 = API 철자 NFC).
- `ProvinceRegionSyncService.syncTenant(tenantId)`: `partnerCall('api/v2/datafeed/getProvinceFeed', {})` → 병합 →
  `tenant_ai_config.handoff_config`에 `provinceRegions` + `provinceRegionsSyncedAt`(ISO) + `provinceRegionsSource:'go2joy_partner'`만 갱신(다른 handoff 키 불변, 행 없으면 생성하지 않음 → 건너뜀 로그).
  빈 목록·`code≠1`이면 **아무것도 쓰지 않음**(빈 목록 가드 — 연결 끊김이 지역표를 지우지 않게).
- 스케줄: 기존 `ScheduledHotelSyncService.runAll()` 앞에 테넌트별 `syncTenant` 1회(같은 주기 env).
- API: `POST /companies/province-regions/sync` (`@RequireCapability(CUSTOMER_MANAGE)`·테넌트 스코프) → `{ total, added, changed, kept, syncedAt }`; 감사 `go2joy.province_regions_synced`(건수만).
  `GET /companies/province-regions` → `{ total, syncedAt, source, regions: {code: count} }`(카드 표시용).
- 오류: 자격증명 없음 E5100, 실패 E5102(기존).

### 2.2 H1-b 권역 자리의 성 이름 (`identity-attributes.ts`)
- `storedIdentityAttributes`: `region` 정규화 후 **권역 코드도 `region_\d+`도 아니면** `provinceKey(region.replace(/_/g,' '))`로 지역표 조회 →
  맞으면 `province`(없을 때만) = 지역표 철자, `region` = 매핑 권역, `regionSource: 'province_in_region'`. 서명 검증은 원값으로 이미 끝난 뒤라 서명 문자열 영향 없음.
- `provinceKey`는 그대로(공유 함수 불변) — 밑줄 치환은 이 경로에서만.
- identify 로그에 `region province_in_region` 표기.

### 2.3 H1-c 고객사 권역 보충
- `CompanyService`가 identify 속성으로 고객사를 갱신하는 곳 + `HotelSyncService.upsertCompany`: `region` 비었고 `province`가 지역표에 있으면 채움(지역표 읽기 실패 = 무시).
- `apps/api/src/database/backfill-company-regions.ts`(`--apply` 없으면 dry-run): `region IS NULL OR region`이 권역 코드가 아닌 행 → 지역표로 교정, 결과 건수 출력.

### 2.4 H2 / H3 매퍼
- `PartnerHotelInfo` + `cancelBeforeHours`, `startRightNowTonight`, `endRightNowTonight` → `CompanyPartnerInfo.cancelBeforeHours: number|null`, `rightNowTonight: {start,end}|null`(둘 다 숫자일 때만). 기존 행은 다음 동기화 때 채워짐(타입은 optional — 구 JSON 읽기 안전).
- `PartnerRoomV2.viewList` → `RoomTypeAttributes.views: Array<{vi,en}>`(구 행은 `undefined` → 화면 "—").
- 응답 DTO·웹 타입 동기화.

## 3. 화면

### 3.1 설정 › 연동 › 플랫폼 — Go2Joy Partner 카드 (1줄 + 버튼 추가)
```
┌ Go2Joy Partner API ─────────────────────── 연결됨 ✓ ┐
│ 서버 https://staging-partner.go2joy.vn/             │
│ Client ID  c3e9…   Secret ••••••                    │
│ 지역표  80개 성 · 10/23 14:02 갱신 (Go2Joy)          │  ← 신규
│ [연결 테스트] [지역표 갱신] [수정] [연결 해제]       │  ← [지역표 갱신] 신규
└────────────────────────────────────────────────────┘
토스트(성공): "지역표 80개 성 반영 — 새 17 · 변경 0 · 유지 0"
토스트(실패): 기존 Partner 오류 문구(E5100/E5102)
```
권한 없는 사용자(CUSTOMER_MANAGE 없음)에겐 버튼 숨김. 지역표가 수동(SQL)뿐이면 "63개 성 · 수동 등록".

### 3.2 고객 › 기업고객 › 호텔 상세 — "Go2Joy 정보" (2줄 추가)
```
Go2Joy 정보
  영업시간    시간제 7–21 · 1박 21–12 · 1일 14–12   첫 1시간
  지금/오늘 밤 0–6시                                   ← 신규 (rightNowTonight)
  취소 정책   시간제 60분 · 1박 120분 · 1일 120분 · 예약 후 5분
  취소 시한   예약 시각 1시간 전까지                    ← 신규 (cancelBeforeHours)
```

### 3.3 라이브챗 고객 패널 — 호텔 카드 (취소 시한 1줄)
```
🏨 호텔                                   상세 ↗
Lá Hotel Quận 10 · South
시간제 7–21 · 1박 21–12 · 1일 14–12
취소: 예약 1시간 전까지                           ← 신규
판매 중 17 · Standard Room · Deluxe Room …
```

### 3.4 상품 › 객실 상세 (1줄 추가)
```
Go2Joy 객실
  고객사   Lá Hotel Quận 10
  침대/면적 Double · 20㎡
  전망     City · Window (Non-view)          ← 신규 (영문 우선, 없으면 vi)
  시설     Smart TV · Mineral water …
```

## 4. 부작용 분석
| 영역 | 영향 | 대응 |
|---|---|---|
| 권역 배정 규칙 | H1-b로 `hồ_chí_minh` 세션이 `south`로 저장 → **남부 담당자에게 배정되기 시작**(지금은 아무 권역 규칙에도 안 걸려 다음 규칙/기본으로 감) | 의도된 수정. 스테이징 go2joy 규칙·담당 지역 확인 후 배포, RPT에 명시 |
| 서명된 값 우선 원칙 | 성 이름이 권역 자리에 오면 서명값을 바꿔 저장 | 서명 검증은 원값으로 끝난 뒤, 권역 코드가 아닌 값에만 적용. 서명 문자열·검증 불변 |
| 지역표 덮어쓰기 | API 철자가 기존 키와 다르면(예: 대소문자) API 철자로 교체 | 비교는 `provinceKey`라 같은 성 판정, 유닛·라벨의 담당 성 목록은 provinceKey로 비교하므로 매칭 불변 |
| 연결 끊김 | 빈 목록·오류 시 지역표 삭제 위험 | 빈 목록 가드(쓰지 않음) |
| 권역 `region_10` | 콘솔 규칙 편집기 칩에 카탈로그 밖 값으로 표시 | 기존 "기타 칩 보존" 동작 사용, G19 후 카탈로그화 |
| 프로덕션 | Partner 자격증명 없음 → H1-a·H2·H3 동작 안 함. H1-b·c는 지역표가 있는 테넌트에서만 | 동작 불변 범위 RPT에 명시 |
| 구 JSON | `partnerInfo`·`attributes`에 새 키 없음 | optional 처리, 다음 동기화 때 채움 |

## 5. 테스트
- 단위: 권역 매핑(1~5·10·미지), 병합(added/changed/kept·API 철자·빈 목록 가드), H1-b(서명·서명 없음, `hồ_chí_minh`/`Hồ Chí Minh`/`HO CHI MINH`, 권역 코드는 불변, `region_10` 불변, 지역표 없음), H1-c(빈 region만), 매퍼 H2·H3(구 데이터 안전)
- 통합(스테이징): [지역표 갱신] → 80 · `region_10` 17 → HA UAT 로그인(4118) 세션 region `south` · 호텔 카드 취소 시한 · 객실 전망 → 보정 스크립트 dry-run/apply
- 엣지: Province Feed 0건, `code 2`, 철자만 다른 성, 지역표 행 없는 테넌트

## 6. 배포
SQL 없음. 스테이징 배포 → [지역표 갱신] → 보정 스크립트 → 확인. 프로덕션은 코드만(동작 불변 범위 확인) + 보정 스크립트 dry-run.

## 7. 일정
승인 후 약 반나절: 2.1~2.4 백엔드 → 3 화면·i18n 6개 언어 → 스테이징 검증 → TCR/RPT.
