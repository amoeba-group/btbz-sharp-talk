# RPT-261019 — 위젯 언어 선택 준수 — 구현·스테이징 결과

- 근거: [REQ](../analysis/REQ-261019-Widget-Language-Follow-Selection.md) · [PLN](../plan/PLN-261019-Widget-Language-Follow-Selection.md)(2026-10-19 "권장안대로 진행" 승인, D1~D7 권장안) · [TCR](../test/TCR-261019-Widget-Language-Follow-Selection.md)
- 캡처: `docs/log/2026-10-19/staging-lang-*.{png,jpg}`

## 1. 배포 상태
| 항목 | 값 |
|---|---|
| PR | **#661** `feat(i18n): 테넌트 제공 언어 · 세션 언어 제공 범위 한정 · AI 답변 세션 언어 고정` — main **`e8d4e6d`** · **#662** `fix(ai): 답변 언어 검증을 문자 비율로`(스테이징 첫 턴 오탐 O1) — main **`9ade01c`** (REQ/PLN docs #660) |
| CI | 통과(API jest 2,306 / types 26 / widget 48 / typecheck 9 / i18n:check) |
| **마이그레이션** | `sql/261019-tenant-widget-languages.sql`(`tenants.widget_languages json NULL`) — 스테이징 **선적용 2026-10-19 14:38(KST)** → 코드 배포. 프로덕션 **선적용 2026-10-19 21:23(KST)**(백업 `~/backups/sharptalk-production/20261019-2123`) → `production` ff `7992e71..4e60bcf` 배포. 매니페스트 `sql/artefacts.tsv` 갱신 |
| 스테이징 | 2026-10-19 14:42 #661 배포 · 14:50 #662 재배포 — `Nest application successfully started`, 컨테이너 재기동 확인 |
| go2joy 설정 | 테넌트 4 `widget_languages = ["vi","en"]`(SQL, 감사 로그 없음). ivyusa는 NULL(6개) |

## 2. 변경 내용
| 영역 | 내용 |
|---|---|
| 스키마·types | `tenants.widget_languages`; `offeredLanguages / offeredLanguageCodes / isOfferedLanguage`(등록 순·영어 고정·미등록 제거); `SessionResponse.languages`; 테넌트 설정 DTO `widget_languages`(저장 시 정규화, 6개 전부면 NULL) |
| 세션 API | `resolveLanguage(locale, tz, default, offered)`: 미제공 명시 locale → **EN**(D1), 기본·타임존 언어도 제공 범위 내만; `ensure` 기존 세션 `realignLanguage`(D6, 잠금 해제·캐시 삭제·로그); `setLanguage` 미제공 → **400 E3004** + warn(D3); `applyDetectedLanguage` 미제공 무시(D5); `languageForChannel` 동일 |
| AI | `replyLanguageRule(lang)`("Always reply in Vietnamese (vi), even if the customer wrote in another language or the context documents are in another language…")를 `answer`·`answerWithoutKnowledge` 공통 사용; 기본 규칙 "customer's language" → "conversation language the system specifies"; `reply-language.util.ts` 문자 체계 검증 → 불일치 시 `chat_answer_language_fix` 1회 번역·재검증·로그(D4). #662: 판정을 글자 수(8자)에서 **비율**(라틴 세션 CJK ≥30%, KO/JA/ZH 해당 문자 <10%)로 |
| 위젯 | 🌐 목록 = `languages`(1개면 숨김); 비제공 수동 선택은 `ivy_lang` 삭제 후 서버 언어로; `ivy_langs:<shop>` 캐시로 첫 렌더 보정; 호스트 `setLocale` 비제공 무시 |
| 콘솔 | 설정 › 위젯 동작 "제공 언어" 체크박스(English 고정·β 표기), 기본 언어 옵션 = 제공 언어만(비제공 기본값은 "타임존 따름"으로 표시·저장), 힌트 문구 6언어 |

## 3. 실측 (TCR 대응, 스테이징 go2joy 제공 VI·EN)
| ID | 결과 |
|---|---|
| U1~U12 | 자동 통과(신규 스펙 3개 + 기존 2,283) |
| I1 | SQL 선적용 → 부팅 정상 ✓ |
| I2 | `ensure`(새 토큰, locale ko) → `language EN`, `languages ["en","vi"]` ✓ |
| I3 | 기존 KO 세션 18865 토큰 `ensure` → EN, 로그 `session language realigned: session=18865 KO → EN (offered vi,en)` ✓ |
| I4 | 위젯 🌐 목록 English·Tiếng Việt 2개 ✓ (`staging-lang-picker-vi-en.png`). 브라우저 en-US라 VI(테넌트 기본)로 시작 — D1의 "선호 없음" 경로 |
| I5 | EN 선택 후 "오늘 예약 현황은 어디서 보나요?" → **영어 답변**(#19890, 한글 0). 로그 `reply language mismatch … expected=en` → `reply language fixed → en` — 1차 답변이 한국어였고 사후 검증이 교정 ✓ (`staging-lang-en-session-korean-question.jpg`) |
| I6 | VI 세션 "시간단위 예약 기능 있나요?" → **베트남어 답변**(#19888) ✓. 단 용어집 주석 "(오버나이트 / Overnight)"의 한글 11자가 8자 기준에 걸려 번역 호출 1회(원문 유지, O1). #662 뒤 "시간제 예약과 일 단위 예약은 어떻게 다른가요?" → 베트남어(#19892), 불일치 로그 없음 ✓ (`staging-lang-vi-session-glossary-after-fix.jpg`) |
| I7 | `POST /session/language KO` → 400 `E3004`, warn `language not offered: … asked=KO offered=vi,en`; VI → 200 ✓ |
| I8 | ivyusa `ensure`(locale ko) → KO, `languages` 6개 ✓ |
| I9 | 콘솔 화면: 코드·타입체크·i18n 검사(콘솔 로그인 미진행) |
| E1·E2·E8 | 코드 경로 확인(단위 테스트 E8은 `languageForChannel` 미작성 — `resolveLanguage` 공용이라 U3가 대신) |

## 4. 관찰
| # | 내용 | 처리 |
|---|---|---|
| O1 | 고정 8자 기준이 go2joy 용어집(ko/en/vi 병기) 주석을 불일치로 오탐 → 불필요한 번역 호출(2초) | **#662로 비율 판정** — 재측정 통과 |
| O2 | 번역 교정 시 응답 지연 +5초(5:48:27 → 32). 불일치 턴에만 발생 | 로그 `reply language mismatch`로 빈도 추적. 잦으면 프롬프트 보강 |
| O3 | 브라우저가 en-US면 테넌트 기본(vi)로 시작(D1 "선호 없음" 규칙 유지). 영어권 직원은 🌐에서 English 선택(잠금) | 요구사항 범위 밖, 현행 유지 |
| O4 | 이번 실측으로 go2joy 대화 1건(853, AI 호출 4회) 생성 | 테스트 표식 없음 → 통계 1건 영향 |
| O5 | `realignLanguage`는 `ensure` 때마다 테넌트 1회 조회 추가(제한 테넌트만 비용 의미) | 허용 범위; 필요 시 Redis 캐시 |

## 5. 남은 일
- 프로덕션(go2joy 테넌트 생성 시): SQL 선적용 → 배포 → `widget_languages` 설정.
- go2joy HA에 한국어 브라우저 사용자가 실제로 영어로 시작하는지 운영 로그(`realigned`/신규 세션 언어 분포)로 확인 — 45일 KO 57% → 0 기대.
- 콘솔 제공 언어 화면 실클릭 검증(로그인 가능한 담당자).
