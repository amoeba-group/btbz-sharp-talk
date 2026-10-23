# REQ-261024 — go2joy HA 연동 규격 v1.4: 성 번호(`province_sn`)·역할 코드, 권역은 SharpTalk 산출

- 요청(2026-10-24): 작업요청서 v1.2(공유 페이지·`GUIDE-261023-Go2Joy-Work-Request.md` 1절)에 실린 **연동 규격 v1.4를 승인**. 작업요청서의 SharpTalk 작업 S-01(가이드 v1.4·테스트 벡터 배포, 10/26) · S-02(v1.4 수신, 10/27 스테이징)를 진행한다.
- 조사 기준: main `36dcec87` · HA UAT 임베드 코드 실측(10/23·10/24) · 스테이징 go2joy(tenant 4) DB · Partner API Province Feed 실측(80행, 10/23)
- 관련: [GUIDE v1.3](../guide/GUIDE-261022-Go2Joy-HA-Identify-v1.3.md) · [작업요청서 v1.2](../guide/GUIDE-261023-Go2Joy-Work-Request.md) · [PLN-261023 Partner 지역표](../plan/PLN-261023-Go2Joy-Partner-Province-Region-Hotel-Fields.md) · PLN-261024 상담카테고리

## 1. 승인된 규격 (작업요청서 1절)
| 항목 | v1.3 | **v1.4** |
|---|---|---|
| `userId` | `"ha:" + userSn` | 같음 |
| 서명 속성 키 | `hotel_id` · `hotel_name` · `province` · `region` · `role` | **`hotel_id` · `hotel_name` · `province_sn` · `role`** |
| 성 | `province` = 성 이름 | **`province_sn`** = Go2Joy `provinceSn`(Province Feed `sn`, 문자열) |
| 권역 | HA가 5코드 산출 | **보내지 않음** — SharpTalk이 Province Feed `region`(1 ~ 5)으로 산출 |
| 역할 | 표시명(`Lễ tân`) | **HA 역할 코드**(언어 무관), 코드표는 Go2Joy가 WR-01에서 회신 |
| 정규화 | trim · 120자 · NFC | 순서 고정 **NFC → 공백 정리 → trim → 120자(`mb_substr`)** |
| "전체 호텔" | 재호출만 | 호텔 키 3개를 빼고 `role`만 서명 → 기본 담당자 |
| 빈 값 | 빈 attributes·email 제외 | 빈 `name` · `email` · `phone`도 필드째 제외 |
| 테스트 벡터 | T1 ~ T5 | **T1 ~ T6**(T6 = 분해형 유니코드 입력) |
| 전환 기간 | — | SharpTalk은 v1.3 키(`province` · `region`)도 당분간 검증 통과, 배정에는 v1.4 값 우선 |

## 2. AS-IS
- **허용 키**: `IDENTITY_ATTRIBUTE_KEYS = hotel_id · hotel_name · region · province · role`(`embed/identity-attributes.ts`). 목록 밖 키는 서명 계산 전에 제거 → `province_sn`을 보내면 **401**.
- **권역 산출**: `storedIdentityAttributes`가 `region` → 정규화, 없으면 `province` **이름** → `handoff_config.provinceRegions`(성 이름 → 권역)로 채움. 10/23부터 `region` 자리의 성 이름도 교정.
- **지역표**: `provinceRegions`는 **이름 키만** 있다. Province Feed 동기화(PLN-261023 H1-a)가 `sn`을 받지만 저장하지 않는다 → `province_sn`으로 찾을 데이터가 없음.
- 스테이징 go2joy 지역표 80개(Partner 동기화), 프로덕션 go2joy 테넌트 없음(운영은 Go2Joy 서버 설치 S-07).
- **기업고객**: `upsertFromIdentity`가 `province`(이름)·`region`을 기업에 기록 → 콘솔·필터·보정이 이름 기준.
- **배정 조건**: 규칙 고객정보 조건 `region`(코드)·`province`(이름 포함)·`role`(값 일치). go2joy 규칙 4개는 `region`만 사용, `role` 조건 규칙 없음.
- **AI 신원 주입**(`caller-context.util.ts`): `Province:` 이름, `Role:` 값을 프롬프트에 넣음 → 역할이 코드면 AI가 코드만 봄.
- **HA 현재**(10/24): 브라우저 조립, `hash:"testing"`, 로그인 ID, 허용 외 키 5개, `region`=성 이름 — v1.0 기준.
- **가이드**: v1.3까지 저장소 md + PDF(ko/en/vi) + `/manual/go2joy` 연동 페이지. 테스트 벡터는 서버 검증 코드와 PHP로 교차 계산했었음(이번엔 로컬 PHP 없음).

## 3. TO-BE
| # | 항목 | 내용 |
|---|---|---|
| T1 | 키 허용 | `province_sn` 추가. v1.3 키(`province` · `region`)는 전환 기간 동안 계속 허용 |
| T2 | 성 번호 색인 | Province Feed 동기화가 `sn → {이름, 권역}`을 테넌트 설정에 함께 저장. Partner 자격증명이 없는 환경을 위해 **피드 스냅숏(80행) 투입 스크립트** |
| T3 | 저장 값 | 서명 검증 뒤 `province_sn`이 색인에 있으면 `province`(이름)·`region`(코드)을 채워 세션에 저장(기존 소비처 — 배정·기업·콘솔·AI — 무변경). v1.3 값과 다르면 v1.4 우선 + 경고 로그 |
| T4 | 모르는 번호 | 색인에 없으면 `province_sn`만 저장, 권역 비움 → 기본 담당자. 경고 로그 |
| T5 | 역할 코드 | 값 그대로 저장. 코드표 수령 전까지 콘솔·AI에 코드 표시(코드표는 WR-01 회신 후 별도 작업) |
| T6 | 가이드 v1.4 | 변경 이력, 패키지 표, 서명 문자열, PHP 예제(NFC 포함), 테스트 벡터 T1 ~ T6, 전환 기간, UAT 체크리스트 — KO·EN, 공유 페이지 |
| T7 | 작업요청서 | S-01 · S-02 상태 갱신 |

## 4. 갭
| 갭 | 원인 | 해결 |
|---|---|---|
| `province_sn` 401 | 허용 키 목록 | T1 |
| 번호 → 권역 불가 | 지역표가 이름 키 | T2 · T3 |
| 운영 서버 첫날 색인 없음 | Partner 운영 인증(WR-23)이 늦을 수 있음 | T2 스냅숏 |
| 역할 코드 가독성 | 코드표 미수령 | T5(후속) |
| 가이드 v1.3 이후 미배포 | — | T6 |

## 5. 사용자 흐름
1. HA 서버: `userId=ha:<userSn>`, `hotel_id` · `hotel_name` · `province_sn` · `role` 서명 → FE가 그대로 `identify`.
2. SharpTalk: 원값으로 서명 검증 → `province_sn` 색인 조회 → 세션에 `province`(이름) · `region` 저장 → 기업고객·연락처, 규칙 배정은 지금과 같음.
3. 콘솔: 기업고객 "Lá Hotel Quận 10 · Hồ Chí Minh · 남부", 연락처 역할 = 코드.

## 6. 제약
- 서명은 **보낸 원값**으로 검증(정규화는 HA 책임). 저장 단계 보강은 서명 뒤에만.
- 스키마 변경 없음 목표(JSON 설정 키 추가).
- 스테이징의 "서명 없는 로그인 임시 허용"은 이번 범위에서 유지(WR-01 · 04 완료 후 S-06).
- 로컬에 PHP가 없어 PHP 예제 검증은 Docker PHP(intl) 이미지로 한다.
