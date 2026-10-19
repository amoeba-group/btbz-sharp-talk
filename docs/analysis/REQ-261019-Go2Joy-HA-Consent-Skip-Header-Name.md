# REQ-261019 — go2joy HA: 개인정보 안내 동의 절차 생략 · 헤더에 로그인 사용자 이름 노출

- 요청(2026-10-19): ① SharpTalk for go2joy-HA는 Go2Joy 약관에 동의하고 **로그인한 호텔 파트너만** 쓰므로
  채팅창의 개인정보 처리 안내(동의 배너)를 생략한다. ② 위젯 상단 로고 옆 "고객지원센터" 자리에
  `https://go2joy-ha-uat.go2joy.io/profile`의 **로그인 사용자 이름**을 노출한다.
- 첨부 문구(현재 배너): "개인정보 처리 안내 2026-07 — CCPA에 따라 … 수집 항목: 채팅 메시지, 요청하신 예약 조회
  내역, 기본 기기 정보 / 이용 목적: 문의 응대 및 숙박 이용 지원 / 보관 365일 / AI 처리: 미국 소재 제3자" =
  `privacy_profile = lodging`의 KO 기본 문구(PLN-261001 C).
- 조사 기준: main `abdac17` · 스테이징 테넌트 4 실측(2026-10-19) · PLN-261015 §10(D9) · 임베드 SDK 가이드 §3
- 관련: [PLN-261015 D9](../plan/PLN-261015-SharpTalk-for-Go2Joy-Project-Plan.md)(호스트 약관 동의, #642) ·
  [PLN-261019 Figma](../plan/PLN-261019-Go2Joy-Widget-Figma-Design.md)(`headerTitle`·`logo-title`, #650)

## 1. AS-IS

### 1-1. 동의 배너
| 항목 | 현재 |
|---|---|
| 테넌트 설정 | 테넌트 4 `consent_source = widget`(배너), `privacy_profile = lodging`, **정책 URL·고지 버전 NULL** |
| 이미 있는 장치 | **D9 "호스트 앱 약관" 모드**(`consent_source = host_terms`, #642): `identify`로 **서명 검증된** 사용자는 배너 없이 동의로 기록(동의 시각·고지 버전 저장, 위젯이 응답 즉시 배너 제거 `adoptSessionConsent`). 서명 없는 방문자는 배너 그대로. 위젯에서 거부한 기록은 덮어쓰지 않음 |
| 실데이터 | 스테이징 go2joy 세션 1,490건 중 `verified` **7건**(10/15 D9 테스트) — HA UAT 페이지는 아직 `identify`를 **호출하지 않음**(스니펫에 config만) |
| 왜 배너가 남았나 | PLN-261015 §10: "약관 문구 확정 전까지 스테이징은 위젯 배너 유지" + Hotel Admin 서명 구현(Go2Joy) 대기(M4) |

### 1-2. 헤더 이름
| 항목 | 현재 |
|---|---|
| 데이터 경로 | `ShopTalk.identify({ userId, hash, name })` → 세션의 고객 레코드 → `session/ensure`·`identify` 응답 `customerName` → 위젯 `customerName` |
| 헤더 렌더 | `customerName`이 있으면 제목 자리에 **인사말** `header.greeting`("Chào {name}" / "Hi, {name}" / "{name}님") — #650 이후 `logo-title` 레이아웃이면 로고 + 인사말 |
| 이름 갱신 규칙 | `name`은 서명 대상이 아니며 **비어 있는 항목만 채움**(가이드 §3.3) → HA에서 이름을 바꿔도 위젯은 처음 이름 유지 |
| HA 측 | `/profile`의 사용자 이름은 HA 앱만 안다 — `identify`의 `name`으로 넘겨야 위젯이 알 수 있음 |

## 2. TO-BE
```
HA 로그인 → HA 서버: hash = HMAC-SHA256(embed_secret, userId [+ 속성])
         → 페이지: ShopTalk.identify({ userId, hash, name: "<profile 이름>", attributes: {hotel_id, region, role} })
         → API: 서명 검증 → consent_source=host_terms → 동의 기록(배너 없음) + customerName = name
         → 위젯 헤더: [G2J] Nguyễn Văn A        (🌐VI)(⚙)(X)      ← 인사말 대신 이름만
                     (배너 없이 바로 인사 말풍선·시나리오)
```

## 3. 갭 분석
| # | 갭 | 판정 | 해소 |
|---|---|---|---|
| G1 | 배너 생략 | **설정** | 테넌트 4 `consent_source = host_terms`(콘솔 설정 › 개인정보 안내 "호스트 앱 약관"). 코드 없음 |
| G2 | 생략이 실제로 일어나려면 **서명 identify**가 와야 함 | **Go2Joy 통합** | HA 서버에서 HMAC 서명 → 로그인 후 `ShopTalk.identify(...)` 호출(가이드 §3.3/3.4). 임베드 시크릿은 스테이징에 발급돼 있음(`secrets/staging-server.md`) |
| G3 | 서명 없이도 전원 생략(임시) | 선택지 | 새 모드 `host_terms_unsigned`를 만들 수는 있으나 **누구나 스니펫만으로 동의를 건너뛰는 경로**가 됨(오리진 게이트는 관측 모드). → D1 |
| G4 | 헤더에 **이름만**(인사말 아님) | **코드(소)** | `widget_copy.headerGreeting` 6언어(`{name}` 자리표시자, 비면 내장 인사말) — go2joy는 `"{name}"`으로 설정 |
| G5 | HA 프로필 이름 변경이 위젯에 반영 | **코드(소)** | `identify`의 `name`이 비어 있지 않으면 고객 표시명을 **덮어씀**(HA가 자기 사용자의 원천). 이메일·전화는 현행(빈 칸만 채움) 유지 |
| G6 | 정책 URL·고지 버전 NULL | **운영** | host_terms여도 `consent_version`은 기록되므로 Go2Joy 약관 버전·URL을 설정(설정 › 개인정보 안내) |
| G7 | 미서명 방문자(로그인 전 랜딩 등) | 유지 | 배너 그대로 — 요구대로 "로그인한 사용자만" 생략 |

## 4. 제약·전제
| # | 내용 |
|---|---|
| C1 | 동의 생략은 **법적 근거가 Go2Joy 약관**에 있다는 전제(PLN-261015 §10 — 수탁자·국외 이전 고지 포함). SharpTalk은 세션마다 동의 시각·버전을 남겨 추적 가능하게 한다 |
| C2 | `name`은 서명되지 않으므로 **표시용**이다. 권한·배정은 서명된 `attributes`만 쓴다(현행) |
| C3 | 배너 생략은 **서명 검증이 통과한 세션**에만 일어난다. HA 페이지가 identify를 호출하지 않으면 설정을 바꿔도 화면은 그대로 — 통합 완료 전엔 변화 없음(안전) |
| C4 | 인사말 → 이름만 전환은 테넌트 문구 옵션이라 다른 테넌트 무변화 |
| C5 | 스키마 변경 없음(`widget_copy` JSON 키 추가, 고객 표시명 갱신은 기존 컬럼) |

## 5. 미결 결정
| # | 결정 | 선택지 | 제안 |
|---|---|---|---|
| **D1** | 생략 방식 | ⓐ **서명 identify(기존 D9)** / ⓑ 미서명 전원 생략 모드 신설 | **ⓐ** — ⓑ는 동의 우회 경로. Go2Joy 서명 구현(수 시간 분량, 가이드 §3.4 예시 코드)이 선행 |
| D2 | `name` 갱신 | 비어 있을 때만(현행) / **보낼 때마다 덮어씀** | **덮어씀** — HA가 원천 |
| D3 | 헤더 표기 | 인사말 유지 / **이름만**(`headerGreeting = "{name}"`) | **이름만**(요청대로), 문구 옵션이라 되돌리기 쉬움 |
| D4 | 서명 전 임시 조치 | 배너 유지 / ⓑ | **배너 유지** |
| D5 | 약관 URL·버전 | Go2Joy 제공 후 설정 | 제공 요청(HA 약관 페이지 URL, 버전 문자열) |

## 6. 범위 제안
| 단계 | 내용 | 코드 |
|---|---|---|
| P1 | 설정: 테넌트 4 `consent_source=host_terms`, 약관 URL·버전(D5 수령 후) | 없음 |
| P2 | `widget_copy.headerGreeting`(6언어, `{name}`) + 콘솔 문구 행 + 위젯 헤더 적용; `identify` `name` 덮어쓰기(D2) + 스펙 | 소 |
| P3 | Go2Joy 통합 안내: HA 로그인 후 `identify` 호출(서명 코드·`name`=프로필 이름·`attributes`) — 가이드 §3 링크 + go2joy 전용 예시 | 문서 |
| P4 | 검증: 스테이징 시크릿으로 서명한 identify를 로컬 점검 페이지에서 호출 → 배너 없음·헤더 이름·동의 기록(`consent via host terms`) 확인 → RPT | — |
