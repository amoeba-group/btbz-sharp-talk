# TCR-261019 — go2joy HA 동의 배너 생략 · 헤더 로그인 사용자 이름 테스트 케이스

- 근거: [PLN-261019-Go2Joy-HA-Consent-Skip-Header-Name](../plan/PLN-261019-Go2Joy-HA-Consent-Skip-Header-Name.md) · 구현 PR #656 · 결과 [RPT](../implementation/RPT-261019-Go2Joy-HA-Consent-Skip-Header-Name.md)

## 1. 단위 테스트 (자동)
| ID | 대상 | 케이스 | 기대 | 파일 |
|---|---|---|---|---|
| U1 | `EmbedService.identify` | 같은 사용자 두 번, 이름 First→Second, 이메일 a→b | 이름 **Second**(덮어씀), 이메일 **a**(빈 칸만 채움) | `embed.service.spec.ts` |
| U2 | 〃 | 이름 공백 | 이전 이름 유지 | 〃 |
| U3 | `mergeWidgetCopy` | `header_greeting_vi: '{name}'` 저장·빈 값 삭제 | bag 저장/제거 | `tenant.service.spec.ts` |
| U4 | D9 host_terms(기존) | 서명 사용자 동의 기록·거부 유지·서명 실패 무동의 | 통과(변경 없음) | 〃 |

## 2. 통합 시나리오 (스테이징 go2joy)
| ID | 시나리오 | 기대 |
|---|---|---|
| I1 | `consent_source=host_terms` + 서명 identify(userId·attributes·name) | API 로그 `identify ok … consent via host terms`, 세션 verified·granted·버전·시각 |
| I2 | 위젯 열기 | 배너 없음, 헤더 `[G2J] <이름>`(headerGreeting `{name}`) |
| I3 | 이름 변경 재호출 | 헤더 갱신 |
| I4 | 미서명 새 세션 | `consentState: pending`(배너 유지) |
| I5 | 언어 전환 | 이름 유지, 제목 문구만 언어 변경 |

## 3. 엣지 케이스
| ID | 케이스 | 기대 |
|---|---|---|
| E1 | 서명 불일치 | 401 E5048, 게스트 유지, 배너 표시 |
| E2 | `headerGreeting` 비움 | 내장 "Hi, {name}" |
| E3 | 같은 브라우저 로그아웃 후 게스트 | 위젯 동의 재적용으로 배너 안 뜸(관찰 O2, 결정 대기) |
| E4 | `name`에 이메일 입력 | 그대로 표시(가이드에 "표시 이름" 명시) |
