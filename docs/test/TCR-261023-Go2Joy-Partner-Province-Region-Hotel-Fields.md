# TCR-261023 — Go2Joy Partner: 성·권역 자동 갱신 + 권역 교정 + 호텔·객실 누락 필드

- 근거: [PLN-261023](../plan/PLN-261023-Go2Joy-Partner-Province-Region-Hotel-Fields.md) (D1~D4 권장안, 2026-10-23 승인)

## 1. 단위 (API jest)
| # | 대상 | 케이스 | 파일 |
|---|---|---|---|
| U1 | 권역 번호 | 1~5 → south·north·central·north_center·south_center, 10 → `region_10`, null·0 → 없음 | `go2joy/province-region.mapper.spec.ts` |
| U2 | 병합 | 같은 성(NFC·대소문자 무시) API 값으로 덮음·철자 교체, 새 성 추가, API에 없는 기존 항목 유지, 이름·권역 없는 행 무시, 건수(added/changed/kept/total) | 〃 |
| U3 | 동기화 | `getProvinceFeed` 호출 → `provinceRegions`·`SyncedAt`·`Source`만 변경, 다른 handoff 키(`assigneeUserIds`) 불변 | `go2joy/province-region-sync.service.spec.ts` |
| U4 | 빈 목록 가드 | 피드 0건 → 저장 안 함(E5102) · 호출 실패 → 저장 안 함(E5102) · 자격증명 없음 E5100 · AI 설정 행 없음 → 만들지 않음 | 〃 |
| U5 | 상태·스윕 | 권역별 개수·출처 null(수동), 일일 스윕은 실패해도 throw 안 함 | 〃 |
| U6 | 권역 자리의 성 이름 | `region=province="Hồ Chí Minh"` → `south`, 출처 `province_in_region`, 경고 없음 · `hồ_chí_minh`/대문자/NFD → province 채움 | `embed/identity-attributes.spec.ts` |
| U7 | | 진짜 권역(`south`)·`region_10`은 불변, 지역표에 없는 값은 접힌 원값 유지, 지역표 없으면 불변 | 〃 |
| U8 | identify | 서명된 `region:"Hồ Chí Minh"` → 세션 `{province, region:south}`, 지역표 조회함 · 권역 코드만 오면 지역표 조회 안 함(기존) | `embed/embed.service.spec.ts` |
| U9 | 고객사 권역 | 성만 있고 권역 비면 지역표로 채움, 이미 있는 권역은 그대로 | `company/company.service.spec.ts` |
| U10 | 매핑 H2·H3 | `cancelBeforeHours`·`rightNowTonight{0,6}`, 빠지면 null · `viewList` → `views`, 빈 시설 행 제거, v2 없으면 `views: []` | `go2joy/room-type.mapper.spec.ts` |

결과(로컬): API 252 suites / **2,547 tests 통과**, typecheck(api·web) 통과, `i18n:check` 6개 언어 complete,
실제 부팅 `Nest application successfully started`(DB_SYNCHRONIZE=false, :3099) + 새 경로 `GET /companies/province-regions`·`POST /companies/province-regions/sync` 401.

## 2. 통합 (스테이징)
| # | 시나리오 | 기대 |
|---|---|---|
| I1 | 설정 › 연동 › 플랫폼 › Go2Joy Partner 카드 | "지역표: 63개 성 · 수동 등록" + [지역표 갱신] |
| I2 | [지역표 갱신] | 토스트 "80개 성 반영 — 새 17 · …", 카드 "80개 성 · 시각 갱신 (Go2Joy)", DB `provinceRegions` 80·`region_10` 17, 다른 handoff 키 불변 |
| I3 | 보정 스크립트 dry-run → `--apply` | `hotel:4118` region NULL → `south`(성 Hồ Chí Minh), 테스트 고객사 2·3 불변 |
| I4 | HA UAT(ADMIN123, 4118) 위젯 다시 열기 | 새 세션 `identity_attributes.region = south`, identify 로그 `region province_in_region`, 라이브챗 배지 "South" |
| I5 | 고객사 4118 [지금 동기화] → 상세 | "지금/오늘 밤 0–6시", "취소 시한 예약 1시간 전까지" |
| I6 | 라이브챗 4118 대화 호텔 카드 | "취소: 예약 1시간 전까지" |
| I7 | 상품 › 4118 객실 상세 | "전망: City · Window (Non-view)" 등(viewList 있는 객실) |

## 3. 엣지
| # | 상황 | 기대 |
|---|---|---|
| E1 | Partner 자격증명 없는 테넌트(프로덕션 전부) | 카드 없음/버튼 E5100, 지역표·동작 불변 |
| E2 | 권한 없는 사용자(CUSTOMER_MANAGE 없음) | 카드에 지역표 줄·버튼 숨김, API 403 |
| E3 | 콘솔 [AI 설정 › 인계] 저장이 갱신 직전 화면 상태로 덮음 | 지역표는 저장 시점 값으로 돌아갈 수 있음 → 다음 일일 동기화가 복구(RPT 명시) |
| E4 | 이전에 동기화된 호텔·객실(새 키 없음) | 화면 해당 줄 생략·"—", 다음 동기화에 채워짐 |
