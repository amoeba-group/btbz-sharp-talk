# RPT-261019 — go2joy HA: 동의 배너 생략(호스트 약관) · 헤더 로그인 사용자 이름 — 구현·스테이징 결과

- 근거: [REQ](../analysis/REQ-261019-Go2Joy-HA-Consent-Skip-Header-Name.md) · [PLN](../plan/PLN-261019-Go2Joy-HA-Consent-Skip-Header-Name.md)(2026-10-19 승인, D1ⓐ·D2·D3·D4) · 가이드 [GUIDE-261019-Go2Joy-HA-Identify](../guide/GUIDE-261019-Go2Joy-HA-Identify.md)
- 캡처: `docs/log/2026-10-19/staging-signed-identify-*.{jpg,png}`

## 1. 배포 상태
| 항목 | 값 |
|---|---|
| PR | **#656** `feat(widget): 헤더 로그인 사용자 인사말 문구(headerGreeting) + identify 이름 갱신` — squash merge, main **`4edfe8a`** (docs #655 선행) |
| CI | 통과 |
| 스테이징 | 2026-10-19 12:17(KST) `deploy-staging.sh` — `Nest application successfully started`, api/web/widget Up |
| 스키마 | 변경 없음 |
| go2joy 설정(P1) | 테넌트 4 `consent_source = host_terms`(2026-10-19, SQL), `widget_copy.headerGreeting = {VI,EN,KO: "{name}"}`(SQL) — 콘솔 로그인 없이 적용해 **감사 로그 없음** |
| 프로덕션 | 대상 없음(go2joy 프로덕션 테넌트 미생성) |

## 2. 변경 내용
| 영역 | 내용 |
|---|---|
| types/API | `WidgetCopy.headerGreeting`(6언어, `{name}`) — 엔티티·DTO `header_greeting_{6}`·`mergeWidgetCopy`·매퍼·세션 `widgetCopy` |
| API `EmbedService.identify` | 서명된 호스트의 `name`은 공백이 아니면 표시명 **덮어씀**(이메일·전화는 빈 칸만 채움 유지) |
| 위젯 `WidgetPanel` | `customerName`이 있을 때 `headerGreeting[lang]`을 `{name}` 치환해 제목 자리에; 없으면 내장 "Hi, {name}" |
| 콘솔 | 위젯 문구 카드 "로그인 사용자 인사말(헤더)" 행 + i18n 6언어 |
| 문서 | Go2Joy HA 통합 가이드(서버 서명 예시·페이지 호출·확인 표) |
| 테스트 | API embed/tenant/session 131 통과(+2) · build 6/6 · i18n:check |

## 3. 실측 (스테이징, 로컬 점검 페이지 = go2joy 스니펫 + 스테이징 시크릿으로 서명한 `identify`)
| # | 시나리오 | 결과 |
|---|---|---|
| V1 | 서명 identify(userId `ha-uat-1001`, attributes hotel_id/hotel_name/region=south/role, name "Nguyễn Văn A") | API 로그 `identify ok … consent via host terms v2026-07`; 세션 `verified · granted · 2026-07 · consent_at` 기록 ✓ |
| V2 | 위젯 열기(배포 전, P1만) | **배너 없음**, 헤더 "Hi, Nguyễn Văn A"(현행 인사말) ✓ (`staging-signed-identify-before-deploy.jpg`) |
| V3 | 배포 후 같은 페이지 | 헤더 **`[G2J] Nguyễn Văn A`**(이름만) ✓ (`staging-signed-identify-header-name.png`), 세션 응답 `headerGreeting` 전달 ✓ |
| V4 | `name`을 "Nguyễn Văn B"로 바꿔 재호출 | 헤더 "Nguyễn Văn B" — 프로필 변경 반영 ✓ |
| V5 | 미서명 새 세션(curl `session/ensure`) | `consentState: pending`, `customerName: null` — 서버는 미서명에 동의를 주지 않음 ✓ |
| V6 | 같은 브라우저에서 `logout()` 후 미서명 페이지 | 배너 **안 뜸** — 위젯의 기존 **동의 재적용(replay)** 이 저장된 동의(호스트 약관 경유)를 새 게스트 세션에 다시 보냄(세션 18878 `guest · granted`). 서버 규칙 위반은 아니나 §5 D-후속 |

## 4. 결함·관찰
| # | 내용 | 처리 |
|---|---|---|
| O1 | 로그인 인사 말풍선의 `{shop}`이 에이전트 `display_name`("Hotel Partner")로 치환돼 "Welcome back to Hotel Partner" | 기존 동작(세션 displayName 우선순위). Go2Joy 문구 확정 시 `loginGreeting` 또는 에이전트 표시명 조정 |
| O2 | 호스트 약관 동의가 브라우저에 저장돼 **같은 PC의 다음 게스트**에게 재적용됨(V6) | 결정 필요: 호스트 경유 동의는 재적용 저장에서 제외할지(코드 소). 공용 PC가 드문 HA 환경이면 현행 유지 가능 |
| O3 | 네트워크 추적 도구가 iframe 요청을 못 잡음 | DB·API 로그로 대체 확인 |

## 5. 남은 일
- **Go2Joy**: HA 서버 서명 + 로그인 후 `identify` 호출(가이드 전달). 호출 전까지 UAT 화면은 배너·"Trung tâm hỗ trợ" 그대로(설계대로).
- **Go2Joy**: 약관 URL·버전 문자열 → 설정 › 개인정보 안내.
- O2 결정(호스트 경유 동의의 브라우저 재적용 여부).
- 감사 로그: 콘솔에서 동의 방식·문구를 한 번 저장해 정규 기록 남기기.
