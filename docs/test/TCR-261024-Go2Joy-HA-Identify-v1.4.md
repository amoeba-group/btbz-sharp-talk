# TCR-261024 — go2joy HA 연동 규격 v1.4 수신 + 가이드 v1.4

- 근거: [PLN-261024](../plan/PLN-261024-Go2Joy-HA-Identify-v1.4.md) (D1~D7 권장안 승인 2026-10-24)

## 1. 단위 (API jest)
| # | 대상 | 케이스 | 파일 |
|---|---|---|---|
| U1 | 키 허용 | `province_sn` 숫자만 유지(숫자형·공백 포함 정리), `HCM` 같은 값은 키째 버림 | `embed/identity-attributes.spec.ts` |
| U2 | 서명 문자열 | `province_sn`이 `hotel_name`과 `role` 사이 | 〃 |
| U3 | 테스트 벡터 | 가이드 v1.4 T1 ~ T5 해시 고정, T6(분해형·NBSP 원값)은 정규화 전엔 불일치 | 〃 |
| U4 | 저장 값 | 번호 적중 → `province`(이름)·`region`, 출처 `province_sn` | 〃 |
| U5 | 충돌 | v1.3 `province`·`region`과 다르면 번호 우선 + `snMismatch`, 같은 값 다른 표기는 불일치 아님 | 〃 |
| U6 | 미지 번호·색인 없음 | v1.3 이름 규칙으로 / 권역 없음 | 〃 |
| U7 | 미정의 권역 | `region_10` 그대로 | 〃 |
| U8 | identify | 서명된 v1.4 패키지 → 세션에 이름·권역 채움, 설정 조회 | `embed/embed.service.spec.ts` |
| U9 | 색인 병합 | 피드 번호 덮어씀·기존 유지·NFC·잘못된 행 제외·권역 없는 행 | `go2joy/province-region.mapper.spec.ts` |
| U10 | 동기화 | `provinceIndex` 저장·`indexed` 건수·상태 응답 | `go2joy/province-region-sync.service.spec.ts` |

결과: API 259 suites / **2,623 tests 통과**, typecheck api·web 통과, CI 통과(#737), 실제 부팅 `successfully started`(DB_SYNCHRONIZE=false) + 401.

## 2. 교차 검증 — 테스트 벡터
| 방법 | 결과 |
|---|---|
| `node scripts/go2joy/identify-test-vectors.mjs`(서버와 같은 서명 문자열) | T1 ~ T6 출력, T6 = T3 |
| `scripts/go2joy/php/vectors.php`(PHP 8.3 + intl, Docker) | T1 ~ T6 해시가 Node와 모두 일치, T6 = T3 |
| API 스펙(서버 검증 코드) | T1 ~ T5 일치 |

## 3. 통합 (스테이징, 2026-10-24, go2joy tenant 4, 스테이징 embed secret으로 서명)
| # | 시나리오 | 결과 |
|---|---|---|
| I1 | [지역표 갱신](`POST /companies/province-regions/sync`) | `indexed 80`, DB `provinceIndex` 80 |
| I2 | v1.4 `province_sn=33` | verified, 세션 `province: Đà Nẵng`, `region: south_center`, 로그 `region province_sn` |
| I3 | `province_sn=1` + v1.3 `province: Hà Nội`, `region: north` | verified, `Hồ Chí Minh` · `south`, 경고 "differs … province_sn used" |
| I4 | 모르는 `province_sn=9999` | verified, 권역 없음, 경고 "not in the province index" |
| I5 | 전체 호텔(`role`만) | verified, 기업 없음 |
| I6 | 목록 밖 `district` 포함 서명 | 서명 불일치 → 스테이징 임시 허용으로 claimed(운영이면 401) |
| I7 | `province_sn: "HCM"` 포함 서명 | 키 제거 → 서명 불일치 → claimed(운영이면 401) |
| — | 테스트 데이터 | 세션 6 · 고객 521~526 · 기업 `hotel:990010` · 연락처 5 삭제 |
