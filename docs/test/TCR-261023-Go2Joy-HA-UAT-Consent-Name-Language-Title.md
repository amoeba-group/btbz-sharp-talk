# TCR-261023 — go2joy HA UAT: 동의 생략 · 이름 인사말 · 칩 언어 · 세션 제목

- 근거: [PLN-261023](../plan/PLN-261023-Go2Joy-HA-UAT-Consent-Name-Language-Title.md) (안 A 승인 2026-10-23)

## 1. 단위
| # | 대상 | 케이스 | 파일 |
|---|---|---|---|
| U1 | claimed 동의 | trust=claimed → granted·버전·시각, 고객·고객사 미생성 | `embed.service.spec.ts` |
| U2 | | trust=signed(기본) → pending 유지 | 〃 |
| U3 | | 위젯에서 거절한 세션은 덮어쓰지 않음 | 〃 |
| U4 | | consent_source=widget이면 무변화 | 〃 |
| U5 | | 서명 없는 identify 비허용 테넌트는 여전히 401 | 〃 |
| U6 | 선택 언어 | 호스트/방문자가 고른 EN → 새 세션 EN + 잠금 | `session.service.languages.spec.ts` |
| U7 | | 플래그 없음 → EN은 "선호 없음"(테넌트 기본 VI, 기존 동작) | 〃 |
| U8 | | 제공하지 않는 언어 선택 → 기존 감지로 폴백 | 〃 |
| U9 | | 재개 세션도 선택 언어로 이동·잠금 | 〃 |
| U10 | 인사말 | `{name}` 있는 첫 인사말에 이름 치환 | `apps/widget/test/welcome-greeting.test.mjs` |
| U11 | | 이름 없으면 토큰과 앞 공백 제거 | 〃 |
| U12 | | `{name}` 없는 문구 + 이름 → 로그인 인사말(기존 동작) | 〃 |

## 2. 통합 (스테이징 · HA UAT 실화면)
| # | 시나리오 | 기대 |
|---|---|---|
| I1 | HA UAT 로그인 상태에서 위젯 열기 (`hash:"testing"`) | 배너 없음, 세션 `identity_level=claimed`, `consent_state=granted` |
| I2 | 같은 화면 | 헤더·첫 인사말에 `ADMIN123` |
| I3 | HA 언어 EN | 인사말·칩 영어, 세션 `language=EN` |
| I4 | 위젯 언어 전환 VI | 칩 즉시 베트남어 |
| I5 | 콘솔 라이브챗 | 제목 `A****23 / Lá Hotel Quận 10`(claimed → hotel_name) |
| I6 | 서명된 identify(스크립트) | 제목 `고객 / 고객사`(companies.name), 기존 동작 유지 |
| I7 | 콘솔 설정 › 개인정보 안내 | host_terms일 때만 체크박스, 저장·재조회 유지 |

## 3. 엣지
- ivyusa 등 `cfg.locale` 없는 설치: `host_locale` 미전송 → 서버 동작 불변.
- 다른 테넌트에서 저장된 `ivy_lang`: 이제 선택으로 전달되어 세션도 그 언어(화면과 일치) — 의도된 변화.
- 프로덕션: `host_terms_trust` 기본 `signed`, 서명 없는 identify 비허용 → 동작 불변.
