# RPT-261024 — go2joy HA 연동 규격 v1.4 수신 + 가이드 v1.4

- REQ / PLN / TCR: `docs/{analysis,plan,test}/*-261024-Go2Joy-HA-Identify-v1.4.md` (규격 v1.4 승인, PLN D1~D7 권장안 승인 2026-10-24)
- 작업요청서 S-01(가이드) · S-02(수신) 완료 — 작업요청서 v1.3

## 1. 변경
| 항목 | 내용 |
|---|---|
| 수신 | `IDENTITY_ATTRIBUTE_KEYS` + `province_sn`(숫자만). 서명 검증 뒤 `handoff_config.provinceIndex`로 `province`(이름)·`region` 채움, v1.3 값과 다르면 번호 우선 + 경고, 모르는 번호는 v1.3 이름 규칙 → 없으면 권역 없음(기본 담당자) |
| 색인 | Province Feed 동기화가 `provinceIndex`(sn → {name, region}) 병합 저장, 상태 API `indexed` |
| 스크립트 | `scripts/go2joy/province-feed-snapshot.json`(80행) · `province-index-sql.mjs`(자격증명 없는 서버용) · `identify-test-vectors.mjs` · `php/sharptalk_identity.php`·`vectors.php` |
| 가이드 | `docs/guide/GUIDE-261024-Go2Joy-HA-Identify-v1.4(.en).md` — **HA 체크리스트 A~D**(백엔드 13 · FE 7 · UAT 2 · 운영 3) 맨 앞, 변경 이력, PHP·JS 예제, 테스트 벡터 T1~T6, UAT 표. 공유 페이지 https://claude.ai/artifact/2An9WPgY9oCcs3PugiqXf8 (체크 가능) |
| 작업요청서 | v1.3 — HA 체크리스트 요약 박스, S-01·S-02 완료, 가이드 링크. https://claude.ai/artifact/YXajSxYLdmHLgXnUQdVShz |

## 2. 테스트
TCR 참조 — 단위 2,623 통과, 벡터 Node = PHP(8.3 + intl) 일치, 스테이징 실측 I1~I7.

## 3. 배포
| 환경 | 상태 |
|---|---|
| PR | #737 → main `4e947d44`(코드 + 가이드 KO) · 문서 후속 PR(이 RPT·TCR·EN·작업요청서) |
| 스테이징 | 10/24 배포 `4e947d44`, healthy·부팅·ERROR 0. SQL 없음. go2joy `provinceIndex` 80(지역표 갱신) |
| 프로덕션 | **미배포**. 반영 시 코드만(go2joy 테넌트 없음 = 동작 불변). 운영 Go2Joy 서버 설치(S-07) 때 Partner 동기화 또는 `province-index-sql.mjs`로 색인 투입 |

## 4. 남은 것
- HA 작업(가이드 체크리스트 A~D) — Go2Joy
- 역할 코드표 수령 후 표시 이름 매핑(D5)
- HA v1.4 전환·UAT 통과 후 v1.3 키 허용 종료(D6), 스테이징 서명 없는 로그인 임시 허용 종료(S-06)
- 가이드 PDF·`/manual/go2joy`·베트남어판(요청 시)
