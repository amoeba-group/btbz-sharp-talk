# REQ-261022 — go2joy HA: 서명 전 임시 신원 수신(미서명 identify) — "누가 채팅하는지"부터 받기

- 요청(2026-10-22): "해시는 잠시 건너뛰고, 우선 데이터를 받아서 누가 채팅하는지 알 수 있게 연동하자."
- 조사 기준: main `1a3e884a` → **재스캔 `18559f08`**(§1-3) · HA UAT 실측(2026-10-22 오전·오후 2회, 계정 go2joysupport) · 스테이징 API 실측
- 명세: [SPEC-261022](../plan/SPEC-261022-Go2Joy-HA-Unsigned-Identify.md)
- 관련: [PLN-261015 D2/D9](../plan/PLN-261015-SharpTalk-for-Go2Joy-Project-Plan.md) · [REQ-261019](REQ-261019-Go2Joy-HA-Consent-Skip-Header-Name.md)(D1ⓐ 서명 identify) · Go2Joy 전달 문서 `docs/guide/GUIDE-261020-Go2Joy-HA-Login-Identify.{vi,ko}.pdf`

## 1. AS-IS

### 1-1. HA UAT 실측 (2026-10-22)
| 항목 | 관찰 |
|---|---|
| 스니펫 | `SHARPTALK_WIDGET_CONFIG`에 `locale`(HA 언어 연동) 추가, `SharpTalk.q`로 `identify` 대기열 사용, `logout` 처리 있음 — 형식은 가이드대로 |
| payload | `userId`·`name`·`email`·`phone`·`attributes`(5키) 형식 정확 |
| `hash` | `"testing"`(7자, hex 아님) → API `401 E5048`, 위젯 `identified ok:false`, 게스트 유지(배너·"Support center") |
| 데이터 출처 | `index.html` 인라인 스크립트에 **고정 문자열**(go2joysupport / G2J SUPPORT / 1721 / support@go2joy.vn / 012345678) — 실제 로그인 사용자와 무관. 실제 프로필 값은 FE `localStorage`(`profile`, `TRACKING_PROFILE`)에 있음 |
| `config.user` | HA가 `SHARPTALK_WIDGET_CONFIG.user`도 넣었으나 로더는 읽지 않음(무해) |

### 1-2. 서버 동작
| 항목 | 현재 |
|---|---|
| `EmbedService.identify` | 시크릿 없음·서명 불일치 → 즉시 `401 E5048`. 아무것도 저장하지 않음 |
| 저장 위치(검증 시) | `sessions.identity_level='verified'`, `sessions.identity_attributes`(5키), `customers`(external id = userId, name 덮어씀, email/phone 빈 칸만) |
| 활용 | 콘솔 `IdentityBadges`(호텔·지역·역할), 라우팅 규칙(`regions`, 조건 `hotel_id/hotel_name/province/role/identity_level`), host_terms 동의(D9), 위젯 헤더 이름(`customerName`) |
| `authenticated` | 세션 매퍼 `customerId != null` → 위젯 알림·마케팅 수신거부 조회를 연다 |
| 고객 연결의 무게 | `session.customerId`를 기준으로 동작하는 도메인이 **24개**(privacy DSAR 내보내기·삭제, notification, push, order, save, diary, review, inquiry, nudge, issue 등). 서버가 세션 토큰 → `customerId`로 권한을 판단 |
| 표시 이름 | `SessionService.customerDisplayName` = 연결된 고객의 `name`(ensure·identify 응답의 `customerName` → 위젯 헤더) |

### 1-3. 재스캔 — main `18559f08`에서 달라진 점 (같은 날 병행 작업)
| 항목 | 내용 | 이 요구에 주는 영향 |
|---|---|---|
| 1단계 지역 정규화 #687 | `storedIdentityAttributes`: 서명 검증 **뒤** NFC·`canonicalRegion`(north / north_center / central / south_center / south)·테넌트 지역표(`handoff_config.provinceRegions`, go2joy 63개 성)로 region 보정. 유닛·라벨 담당 지역 매칭 배정 | `claimed`도 같은 함수로 저장해야 지역 매칭이 같은 결과를 냄 |
| 2단계 B2B·연속성 #689 | 서명된 `hotel_id` → 고객 `b2b_contact`, 기업 `hotel:{id}`·연락처 등록, `sessions.company_id`, 대화 `customer_id`·`company_id`·`prev_conversation_id`, `threadAvailable`은 **`verified` 전용**, 직전 대화 6턴을 AI에 주입 | `claimed`는 기업·연락처·연속성 대상이 **아니어야** 함 — 미검증으로 다른 호텔의 이전 대화를 보는 경로 차단 |
| 세션 엔티티 주석 | DSAR 내보내기·삭제는 `verified` 필요(SEC-C3) | 고객 미연결과 이중 안전장치 |
| 병행 브랜치 `KimIgyong/go2joy-HA` | Go2Joy에 보낼 **HA 연동 가이드 v1.3**·요청 체크리스트(G10 서명, G11 임베드, G12 키 방안). `userId = "ha:" + userSn` 규칙, "서명 필수" 입장 | 이 임시 수용은 v1.3의 "서명 필수"와 **충돌하지 않도록 스테이징 한정·미검증 표시**로 둔다. Go2Joy에 보낼 문서는 v1.3이 기준(2026-10-20 PDF는 userId 규칙이 구판) |
| HA UAT 재실측(오후) | 변동 없음: 고정 값·`hash "testing"`, 스크립트 조건문은 `hotel` 존재 여부만 검사(로그인 여부 검사 없음). 이 계정 `userSn` = 8818 | Go2Joy에 "로그인 상태에서만 호출" + `ha:8818` 형식 요청 필요(§6) |

## 2. TO-BE
```
HA 로그인 → FE가 localStorage 프로필로 payload 구성(hash = 임시 문자열)
          → SharpTalk.identify(payload) → API: 서명 불일치
             ├ 테넌트가 "미서명 허용" 목록에 있음 → 200, identity_level='claimed'(미검증)
             │    · 세션: identity_attributes = 1단계 정규화(NFC·권역·지역표) + user_id·name → 콘솔 배지 + 지역 매칭 배정
             │    · 기업·연락처·대화 연속성: 하지 않음(verified 전용)
             │    · 고객 레코드는 연결하지 않음(세션에만 user_id·name 보관)
             │    · 위젯: 헤더에 이름, 동의 배너는 유지(미검증은 동의 대체 불가)
             └ 목록에 없음 → 현행 그대로 401
Go2Joy가 서명을 붙이는 순간 → 같은 userId로 'verified' 승격, 배너 생략(현행 경로)
```

## 3. 갭 분석
| # | 갭 | 판정 | 해소 |
|---|---|---|---|
| G1 | 서명 불일치 시 데이터 폐기 | **코드** | 허용 테넌트에 한해 `claimed`로 수용 |
| G2 | 미검증 표시 | **코드·UI** | `SESSION_IDENTITY.CLAIMED` 추가, 콘솔 배지 "미검증" + 툴팁 |
| G3 | 미검증 신원을 고객 레코드에 연결하면 24개 도메인의 권한이 열림(타인 DSAR·알림·주문) | **설계** | 연결하지 않는다. `user_id`·`name`은 세션 `identity_attributes`에만 보관 → `customerId` 기반 권한은 그대로 게스트 |
| G4 | 동의 | 유지 | `claimed`는 host_terms 동의를 주지 않음(REQ-261019 D1ⓐ 유지) |
| G5 | 라우팅 조건 `identity_level` | **코드(소)** | 선택지에 `claimed` 추가 |
| G6 | HA가 고정값을 보냄 | **Go2Joy** | FE `localStorage` 프로필에서 실제 값을 채우도록 요청(아래 §6) |
| G7 | 운영 노출 | 정책 | 스테이징 전용, 프로덕션은 설정하지 않음 |

## 4. 제약·전제
| # | 내용 |
|---|---|
| C1 | 미검증 데이터는 **누구나 위조 가능**(DevTools). 표시·라우팅용으로만 쓰고, 동의·주문 조회 같은 권한 판단에는 쓰지 않는다 |
| C2 | 허용은 **테넌트 단위 opt-in**. 다른 테넌트(Shopify·Cafe24 등)는 동작 불변 |
| C3 | 임시 조치 — Go2Joy 서명 완료 후 해제(설정 1줄 제거) |
| C4 | 스키마 변경 없음(`identity_level`은 varchar(16), `identity_attributes`는 기존 JSON) |
| C5 | 위조 시 콘솔에 잘못된 이름·호텔이 보일 수 있다 — 콘솔 "미검증" 배지로 상담원에게 알림. 고객 데이터 접근은 생기지 않음(G3) |
| C6 | 이메일·전화는 미검증 경로에서 **저장하지 않는다** — 고객 테이블은 PII 암호화 컬럼인데 세션 JSON은 평문. 누구인지 아는 데는 userId·이름·호텔로 충분 |

## 5. 미결 결정
| # | 결정 | 선택지 | 제안 |
|---|---|---|---|
| **D1** | 허용 스위치 | ⓐ **환경변수** `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS=4`(스테이징만) / ⓑ 테넌트 컬럼 + 콘솔 토글 | **ⓐ** — 스키마·UI 없음, 콘솔에서 실수로 켤 수 없음, 해제 = 변수 삭제 |
| D2 | 고객 연결 | 연결 / **세션에만 보관** | **세션에만** — 연결은 타인 데이터 접근 경로(G3). 서명이 붙으면 그때 같은 userId로 고객 레코드가 생김 |
| D3 | 동의 배너 | **유지** / 생략 | **유지** — 미검증 생략은 동의 우회 경로(REQ-261019 D1) |
| D4 | 라우팅에 미검증 지역 사용 | **사용** / 미사용 | **사용** — "지역별 지원팀"이 이번 목적. 위조 시 잘못된 팀으로 갈 뿐 |
| D5 | 위젯 헤더 이름 | **표시** / 미표시 | **표시** — 표시 전용 |

## 6. Go2Joy 요청 사항 (해시 없이 진행할 때)
- `index.html`의 고정 값 대신 로그인 사용자 값으로 payload 구성: `userId = "ha:" + userSn`(가이드 v1.3, UAT 계정 `ha:8818`), `name = fullName`, `profile.value.hotelSn`, `hotelViewList[].name`, `TRACKING_PROFILE.provinceName/roleName`, 권역 코드(north / north_center / central / south_center / south — 없으면 province만 보내도 지역표로 보정).
- **로그인 상태에서만** `identify` 호출(현재 스크립트에는 로그인 검사가 없음).
- `hash`는 당분간 비어 있지 않은 임시 문자열이면 됨(로더가 빈 hash 호출을 무시). 서명이 준비되면 실제 HMAC으로 교체.
- 로그인 후 1회 + 호텔 변경 시 재호출, 로그아웃 시 `logout()` — 현행 스니펫 유지.
