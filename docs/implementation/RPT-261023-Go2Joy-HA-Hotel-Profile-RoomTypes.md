# RPT-261023 — go2joy HA 호텔 정보 → B2B 고객정보, 객실 유형 → 고객사별 상품

- 근거: [REQ](../analysis/REQ-261023-Go2Joy-HA-Hotel-Profile-RoomTypes.md) → [PLN v2](../plan/PLN-261023-Go2Joy-HA-Hotel-Profile-RoomTypes.md)(B + 콘솔 직접 입력, A는 다음 단계) → [TCR](../test/TCR-261023-Go2Joy-HA-Hotel-Profile-RoomTypes.md)
- 구현: PR #703 (squash `8ca1cfbe`) · 후속 표시 수정 + 이 문서

## 1. 변경
| 영역 | 내용 |
|---|---|
| 스키마 | `sql/261024-company-profile-products.sql` — companies 10컬럼(code·phone·district·address·profile·partner_info·partner_synced_at·partner_sync_error·profile_updated_at/by), products_cache 3컬럼(company_id·source·attributes)+인덱스 |
| Partner 연동 | provider `go2joy_partner`(base_url·client_id·client_secret) — 연동 카드·연결 테스트(없는 호텔 응답 = 자격 확인 완료, 서명/clientId 오류 구분) |
| 동기화 | `HotelSyncService`: Hotel Info v2 + Room Type Feed v1/v2 → 고객사 partner_info + 객실 상품. 빠진 객실 보관, 입력한 객실 수 유지, `sn` 대조. 로그인(서명·claimed) 시 백그라운드 `ensureHotel`(24h 이내면 생략) · 일 1회 `GO2JOY_HOTEL_SYNC_INTERVAL_MIN`(기본 1440) · 콘솔 "지금 동기화" |
| 콘솔 API | `POST /companies`(호텔 추가) · `POST /companies/:id/sync` · `PATCH /companies/:id/profile`(감사: 필드명만) · `GET /companies/:id`에 profile·partnerInfo·rooms · `GET /admin/products?company_id=` · `GET /admin/products/companies` · `PATCH /admin/products/:handle/room-count` · 대화 상세 `hotel` 요약 |
| 쇼핑몰 보호 | 상점 동기화 5종(Shopify·Cafe24·Woo·Odoo·Haravan)과 위젯 상품 목록·추천·카테고리는 `company_id IS NULL`만 |
| 화면 | 기업고객: 호텔 추가, 상세 탭(기본 정보 = Go2Joy 읽기 전용 + 직접 입력 편집 / 객실 / 담당자 / 대화), 링크 `?tab=b2b&company=` · 상품: 고객사 필터·객실 열·객실 수 ✎·상세 객실 정보 · 라이브챗: 호텔 카드(미검증 표시) · 설정: Go2Joy Partner 카드 — 6개 언어 |
| 오류 코드 | E5100 연동 없음 · E5101 Go2Joy에 없는 호텔 · E5102 Partner 요청 실패 |
| 문서 | GUIDE-261022 체크리스트 G18(운영 자격증명·IP·피드 범위)·G19(DB 일치·상태 코드·객실 수·A 일정) + HA `hash:"testing"` 메모 |

## 2. 테스트
- API jest 2,508 통과(신규: partner-client 12, mapper 4, hotel-sync 7, 프로필 3, 상점 동기화 가드 1, 상품 조회 기대값 갱신 5) · 위젯 51 · typecheck·build·i18n:check·env:check
- 로컬 API 부팅 `successfully started`, CI 통과

## 3. 배포
| 환경 | 상태 |
|---|---|
| 스테이징 DB | SQL 선적용 10/23 16:2x KST |
| 스테이징 코드 | `8ca1cfbe` 배포, healthy·부팅·새 경로 401 |
| 스테이징 설정 | go2joy에 Partner **테스트** 자격증명 등록(콘솔 API) → 연결 테스트 "Connected" |
| 프로덕션 | 10/23 16:44 KST 백업 `~/backups/sharptalk-production/20261023-1644-pre-261024` → SQL 선적용 → `c90cdb89` 배포(#702~#704), check-migrations OK·healthy·부팅·새 경로 401. Partner 자격증명 **미등록**(G18 대기) = 호텔 동기화 동작 없음 |

## 4. 스테이징 검증 (TCR §2)
| # | 결과 |
|---|---|
| I1 | 연결 테스트 Connected ✅ |
| I2 | HA UAT 새로고침 → claimed identify → `hotel synced (tenant 4, hotel 4118, company 4): 21 rooms` ✅ (담당자 연결 없음) |
| I3 | 기업고객 상세: 영업시간 시간제 7–21·숙박 21–12·1일 14–12, 무료 취소 60/120/120분·예약 후 5분, 객실 21 ✅ |
| I4 | HA 화면 값(코드·전화·성/군·주소·프로모션/인기/신규·계약일·결제·유형·기업명·등록번호·추가요금·영문 설명) 입력 → 저장, 수정자 표시 ✅ |
| I5 | 상품: 고객사 필터 "Lá Hotel Quận 10 (21)", 객실 열·요금, Standard 객실 수 14 저장 ✅ |
| I6 | 라이브챗 ADMIN123 세션: 제목 `ADMIN123 / Lá Hotel Quận 10`, 호텔 카드 + Details 링크 ✅ |
| I7 | 없는 호텔 번호 → E5101 "Go2Joy has no hotel with this number" ✅ |

## 5. 알려진 점·후속
- **Partner 스테이징 ≠ HA UAT DB**: 객실 21개(HA 7개), 요금·영업시간이 HA 화면과 다름 — 운영 일치 여부 G19.
- 시간제 요금이 없는 객실에 "0h first" 힌트가 보이던 표시를 수정(이 PR).
- HA가 `region`에 성 이름(`Hồ Chí Minh`)을 보내 지역 배지가 `hồ_chí_minh`로 보임 — G10(서명·`region` 지역표 값) 해결 시 사라짐.
- 서명 없는 로그인으로 생긴 고객사는 성·지역이 비어 있음(Partner Hotel Info에 없음) → 콘솔 입력 또는 서명 identify로 채워짐.
- 다음 단계: A(HA 서버 → SharpTalk 전송), AI가 호텔 프로필·객실을 근거로 답하기(외부 AI엔 기업명·등록번호·전화 제외).
- 스테이징 테스트 데이터: 고객사 4(Lá Hotel, 입력 값 = HA 화면 값), Standard 객실 수 14.
