# RPT-261023 — go2joy HA UAT: 동의 생략 · 이름 인사말 · 칩 언어 · 세션 제목 고객/고객사

- 근거: [REQ-261023](../analysis/REQ-261023-Go2Joy-HA-UAT-Consent-Name-Language-Title.md) → [PLN-261023](../plan/PLN-261023-Go2Joy-HA-UAT-Consent-Name-Language-Title.md)(안 A 승인) → [TCR-261023](../test/TCR-261023-Go2Joy-HA-UAT-Consent-Name-Language-Title.md)
- 구현: PR #698 (squash `d834048b`) · 정정·문서 PR(이 문서)

## 1. 원인 (HA UAT 실측)
HA가 `hash:"testing"`(서명 아님)과 허용 외 키 5개, `region`=성 이름을 보냄 → identify 401 → 게스트(배너·이름 없음). 칩은 서버가 `en`을 "선호 없음"으로 보고 세션을 VI로 만든 데다 칩 캐시 키에 언어가 없어서 VI. 세션 제목에는 고객사명이 없었음.

## 2. 변경
| 영역 | 내용 | 파일 |
|---|---|---|
| 스키마 | `tenants.host_terms_trust` VARCHAR(16) DEFAULT 'signed' | `sql/261023-tenant-host-terms-trust.sql` |
| API 동의 | claimed identify + `host_terms_trust=claimed` + host_terms → 동의 granted(거절 존중). 공통 `grantHostTermsConsent()` | `embed.service.ts` |
| API 언어 | ensure `language_chosen` → 선택 언어(EN 포함) 그대로·잠금, 재개 세션도 이동 | `session.service.ts`, `session.request.ts`, `session.controller.ts` |
| API 칩 | `GET /ai-config/scenario?language=` 표시 언어 우선 | `ai-config.controller.ts`, `ai-config.service.ts` |
| API 제목 | 세션 목록 `companyName`, 대화 상세 `company.name` (`CompanyService.namesByIds`) | `agent-console.controller.ts`, `agent.mapper.ts`, `company.service.ts` |
| 로더 | `cfg.locale` 지정 시 `host_locale=1` | `apps/widget/public/embed.js` |
| 위젯 | 호스트 언어 1순위·선택 언어 전달, 칩 쿼리 키 언어, identify 응답 이름 반영, 첫 인사말 `{name}` 치환(`welcomeGreeting`) | `i18n.ts`, `useSession.ts`, `useScenario.ts`, `scenarioService.ts`, `sessionService.ts`, `useEmbedCommands.ts`, `copy.ts`, `ChatTab.tsx` |
| 콘솔 | 설정 › 개인정보 안내 체크박스(6개 언어), 라이브챗 제목 `고객 / 고객사`, 에이전트 인사말 도움말 `{name}` | `PrivacyNoticePage.tsx`, `LiveChatPage.tsx`, `session-title.ts`, locales |

## 3. 테스트
- API jest 2,481 통과(신규 9: claimed 동의 5, 선택 언어 4) · 위젯 node --test 51(신규 3) · typecheck·build·i18n:check · 로컬 부팅 `successfully started`
- CI(PR #698) 통과

## 4. 배포
| 환경 | 상태 |
|---|---|
| 스테이징 DB | SQL 선적용 10/23 14:23 KST, go2joy `host_terms_trust='claimed'` |
| 스테이징 env | `.env.staging`에 `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS=4` (백업 `~/.env.staging.bak-20261023-pre-unsigned`) |
| 스테이징 코드 | `d834048b` 배포, healthy·부팅 로그·`printenv`=4·embed.js `host_locale` 확인 |
| 프로덕션 | **미배포** (요구=스테이징만. 코드 배포 시 SQL 선적용 필요, 옵션 기본 `signed`라 동작 불변) |

## 5. 스테이징 실화면 검증 (HA UAT, Orca 내장 브라우저)
| TCR | 결과 |
|---|---|
| I1 | identify 201, 세션 20683 `claimed`·`consent_state=granted`(v2026-07), **배너 없음** ✅ |
| I2 | 헤더 `ADMIN123`, 첫 인사말 `Hi ADMIN123! Welcome back…` ✅ (에이전트 인사말 EN에 `(name}` 오타가 있어 `{name}` 치환 대신 기본 로그인 인사말이 쓰임 — 오타 수정은 운영자 확인 대기) |
| I3 | 세션 `language=EN`·잠금, 칩 4개 영어 ✅ |
| I5 | 라이브챗 `A******3 / Lá Hote…`(HA 실사용 세션 883) ✅ |
| I6 | 서명 세션 `T**t L* t*n 2****3 / SharpTalk Test Hotel` ✅ |

## 6. 정정 · 남은 일
- **정정**: PLN·콘솔 안내에 "이전 대화 연결도 서명 전용"이라고 썼으나, env를 켜면 PLN-261022 P7 설계대로 claimed user_id의 이전 대화 보기가 열린다(실화면 "Show earlier conversations"). 안내 문구·주석을 실제 동작에 맞게 수정. 서명 없는 값이라 user_id를 아는 사람은 그 id의 위젯 대화를 볼 수 있음 → **UAT 한정**, Go2Joy 서명 완료 시 env 제거.
- 스테이징 테스트 데이터: 고객 516·517, 고객사 2·3(`hotel:990001/990002`), 대화 세션 882(claimed)·884(서명) — 메시지 "SharpTalk test — session title check (please ignore)".
- Go2Joy 재요청(PLN §6): 서버 서명, 허용 키 5개, `region` 지역표 값, 빈 `phone` 제외.
