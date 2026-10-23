# PLN-261024 — go2joy HA 연동 규격 v1.4 수신 + 가이드 v1.4 배포

- 근거: [REQ-261024-Go2Joy-HA-Identify-v1.4](../analysis/REQ-261024-Go2Joy-HA-Identify-v1.4.md) — 규격 자체는 2026-10-24 승인
- 상태: **v1 — 승인 대기**
- 스키마: **없음**(`handoff_config` JSON 키 추가)
- UI 영향: **없음**. 콘솔은 지금처럼 성 이름·권역을 보여주고, 역할은 받은 값(코드)을 그대로 보여줍니다. 화면 변경은 코드표 수령 뒤 별도 작업입니다.

## 0. 요약
| # | 작업 | 산출물 | 기한 |
|---|---|---|---|
| 1 | `province_sn` 허용 + 성 번호 색인으로 성 이름·권역 채움(v1.3 키 병행) | API | 10/27 스테이징 |
| 2 | Province Feed 동기화가 번호 색인도 저장 + 피드 스냅숏 투입 스크립트 | API · 스크립트 | 10/27 |
| 3 | 가이드 v1.4(KO·EN) + 테스트 벡터 T1 ~ T6 + PHP 예제 검증 | 문서 · 공유 페이지 | 10/26 |
| 4 | 작업요청서 S-01 · S-02 상태 갱신 | 문서 | 배포 후 |

## 1. 결정 사항 (기본값 — 바꿀 수 있음)
| # | 결정 | 기본값(권장) | 대안 |
|---|---|---|---|
| D1 | 성 번호 색인 위치 | `handoff_config.provinceIndex` = `{ "<sn>": { "name": "Hồ Chí Minh", "region": "south" } }`. 기존 `provinceRegions`(이름 → 권역)는 그대로 두고 같은 동기화가 둘 다 채움 | 새 테이블 |
| D2 | 색인 원천 | ① Partner 자격증명이 있으면 Province Feed 동기화(일 1회·[지역표 갱신])가 채움 ② 없으면 저장소의 **피드 스냅숏**(`scripts/go2joy/province-feed-snapshot.json`, 10/24 스테이징 피드 80행)을 SQL 스크립트로 투입 — 운영 서버 설치(S-07) 첫날용 | 스냅숏 없이 Partner만 |
| D3 | v1.3 값과 충돌 | `province_sn`이 색인에 있으면 **그 이름·권역이 우선**(보낸 `province` · `region`은 무시하고 다르면 경고 로그) | 서명된 region 우선(v1.3 규칙) |
| D4 | 색인에 없는 번호 | `province_sn`만 저장, 권역·성 이름 비움(보낸 `province`가 있으면 기존 이름 → 권역 규칙으로 채움) → 기본 담당자. 경고 로그 | 401 거부 |
| D5 | 역할 코드 | 값 그대로 저장·표시. 코드표(WR-01) 수령 후 `handoff_config.roleLabels`로 표시 이름 매핑을 별도 PLN | 지금 매핑 키만 만들어 둠 |
| D6 | 전환 기간 종료 | 기한 없음. HA가 v1.4로 전환하고 UAT를 통과하면 별도 PR로 `province` · `region` 키 허용을 끝냄(작업요청서에 날짜 기록) | 환경변수 스위치 |
| D7 | 가이드 형식 | 저장소 `GUIDE-261024-Go2Joy-HA-Identify-v1.4.md`(KO) + `.en.md`, 공유 페이지 1개(KO/EN 탭). PDF·`/manual/go2joy` 갱신과 베트남어판은 요청 시 | v1.3처럼 PDF 3종 + manual |

## 2. 설계

### 2.1 수신 (`apps/api/src/domain/embed/identity-attributes.ts`)
- `IDENTITY_ATTRIBUTE_KEYS`에 `province_sn` 추가(값 검증 `^\d{1,10}$`, 아니면 키째 버림 — 버린 값은 서명에 안 들어가므로 HA가 잘못 보내면 401로 드러남).
- `storedIdentityAttributes(attributes, maps)` — 두 번째 인자를 `{ provinceRegions, provinceIndex }`로 확장(기존 호출부 호환을 위해 레코드도 받음).
  1. NFC 정규화(기존)
  2. `province_sn` 있고 색인 적중 → `province` = 색인 이름, `region` = 색인 권역, `regionSource: 'province_sn'`, 보낸 값과 다르면 `mismatch`
  3. 아니면 기존 규칙(region 정규화 → region 자리의 성 이름 교정 → 이름 → 권역)
- `embed.service.ts provinceRegions()` → `provinceMaps()`: `province_sn`이 오면 설정을 읽음(지금은 province·이름형 region일 때만 읽음). identify 로그 `region province_sn`.
- 서명 검증은 지금처럼 **보낸 원값**(`identitySigningString`)으로 — 정렬 순서상 `province_sn`은 `hotel_name` 다음, `role` 앞.

### 2.2 색인 (`apps/api/src/domain/go2joy/`)
- `province-region.mapper.ts`: `provinceIndexFromFeed(feed)` → `{ sn: { name(NFC), region } }`, `mergeProvinceRegions` 결과와 함께 반환.
- `ProvinceRegionSyncService.syncTenant`: `provinceIndex`도 저장(피드에 있는 번호는 피드 값으로 덮고, 없는 번호는 유지). 상태 API에 `indexed` 건수 추가.
- `scripts/go2joy/province-feed-snapshot.json`(80행: sn·name·region 번호) + `scripts/go2joy/province-index-sql.mjs <tenant_id>` → `provinceRegions`와 `provinceIndex`를 함께 넣는 `JSON_SET` SQL(다른 handoff 키 보존, 재실행 안전, 롤백 문 포함). 기존 `province-regions-sql.mjs`(63개 엑셀)는 대체 안내만 남김.
- 스테이징 go2joy: [지역표 갱신] 1회로 색인 채움.

### 2.3 가이드 v1.4 (`docs/guide/GUIDE-261024-Go2Joy-HA-Identify-v1.4(.en).md`)
- 구성: v1.4 변경 사항(v1.0 · v1.3 대비 표 — 작업요청서 1절과 동일) · 요약 · 전달 데이터(4개 키) · 권역 산출(Province Feed 1 ~ 5, `10` 미정) · 서명 문자열 · **PHP 예제**(`Normalizer::FORM_C` → 공백 정리 → trim → `mb_substr`, 빈 값 제외, 전체 호텔 처리) · FE 예제(서버 응답 그대로 전달, 호텔·언어 변경 시 재호출, 로그아웃 3경우) · **테스트 벡터 T1 ~ T6** · 응답 코드 · 보안·키 · UAT 체크리스트 · 전환 기간.
- 테스트 벡터: 테스트 secret `test-secret-do-not-use`로 **SharpTalk 검증 코드**(`EmbedService.sign`)와 **PHP 예제**(Docker `php:8.3-cli` + `intl`)로 각각 계산해 일치 확인. T6은 분해형(NFD)·NBSP 입력이 PHP 정규화 후 T2와 같은 해시가 되는지.
- 공유 페이지: 작업요청서와 같은 형식(KO/EN 탭), 작업요청서에서 링크.

### 2.4 작업
1. types/api: 키 추가, 저장 로직, 서비스 맵 읽기, 로그(+spec)
2. go2joy: 색인 매퍼·동기화·상태(+spec)
3. 스냅숏 JSON·SQL 스크립트
4. 테스트 벡터 계산 스크립트(`scripts/go2joy/identify-test-vectors.mjs` — 서버 코드와 같은 서명 함수로 T1 ~ T6 출력) + Docker PHP 교차 검증
5. 가이드 v1.4 KO·EN + 공유 페이지
6. 스테이징 배포 → [지역표 갱신] → v1.4 패키지 실측(테스트 secret 아님, 스테이징 embed secret으로 서명한 identify: 번호만으로 이름·권역 채움, 모르는 번호, v1.3 패키지 병행) → 테스트 데이터 정리
7. 작업요청서 S-01 · S-02 갱신, TCR · RPT

## 3. 부작용 분석
| 영역 | 영향 | 대응 |
|---|---|---|
| 기존 HA(v1.0 형태, 서명 없음) | 변화 없음 — 서명 없는 임시 허용 경로도 같은 저장 로직을 탐 | 스펙 회귀 |
| v1.3 서명 패키지 | 그대로 통과(D6) | 회귀 스펙 |
| 배정 규칙 | 저장되는 `province`(이름)·`region`(코드)이 지금과 같은 형태 → 규칙·기업·콘솔·AI 무변경 | — |
| 역할 조건 규칙 | 역할 값이 표시명 → 코드로 바뀜. 현재 go2joy에 역할 조건 규칙 없음 | 가이드·작업요청서에 명시 |
| AI 신원 주입 | 역할이 코드로 보임 | D5 후속 |
| 색인 없는 테넌트 | `province_sn`만 오면 권역 없음 → 기본 담당자 | 운영 설치 시 스냅숏 투입(S-07 절차) |
| 정규화 책임 | HA가 NFC를 빠뜨리면 401 | T6 벡터로 사전 검증 |

## 4. 테스트
- 단위: 키 허용·형식, 번호 적중 → 이름·권역·출처, v1.3 값 충돌 시 v1.4 우선·mismatch, 모르는 번호, 번호 + 이름 혼합, 색인 없음, 서명 문자열 순서(`province_sn` 위치), 색인 매퍼·동기화 병합·빈 피드 가드, 스냅숏 SQL 생성
- 교차: T1 ~ T6 해시 — 서버 코드 = PHP 예제
- 통합(스테이징): 위 2.4-6

## 5. 배포
SQL 없음. 스테이징 → 실측. 프로덕션은 코드만(go2joy 테넌트 없음 = 동작 불변).

## 6. 일정
승인 후: 10/25 ~ 26 구현·가이드(S-01 10/26) → 10/27 스테이징 실측(S-02) → TCR · RPT.
