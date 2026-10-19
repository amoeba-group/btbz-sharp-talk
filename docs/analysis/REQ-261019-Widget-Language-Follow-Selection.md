# REQ-261019 — 위젯 언어 선택 준수 (AI 답변 언어 · 테넌트 제공 언어)

- 요청일: 2026-10-19 · 요청: 사용자(요구사항) · 대상: 전 테넌트(발견 테넌트 go2joy)
- 후속: [PLN-261019-Widget-Language-Follow-Selection](../plan/PLN-261019-Widget-Language-Follow-Selection.md)

## 1. 요구사항 (원문)
1. 언어 선택과 다르게 한국어로 나오는 경우가 종종 있음.
2. 언어 선택에 따른 답변도 해당 언어로 나와야 한다.
3. 선택 버튼에 해당 언어가 없을 경우는 영어를 기본으로 하고, 어드민에서 해당 언어를 수정/반영할 수 있게 한다.

## 2. AS-IS

### 2.1 언어가 정해지는 길
| 단계 | 현재 동작 | 코드 |
|---|---|---|
| ① 위젯 초기 언어 | `localStorage.ivy_lang`(수동 선택) → `navigator.language`(6개 등록 언어면) → `en`. 이 값이 `session/ensure`의 `locale` 힌트로 그대로 전송 | `apps/widget/src/i18n/i18n.ts` `initialLanguage`, `store.language` |
| ② 서버 세션 언어 | `resolveLanguage(locale, timezone, default_language)`: **영어가 아닌 명시 locale은 항상 우선** → 테넌트 기본 언어 → 타임존 → EN. 테넌트가 제공 언어를 좁힐 수단이 없음(항상 6개) | `session.service.ts` `resolveLanguage` |
| ③ 세션 중 변경 | 헤더 🌐 수동 선택 → `language_locked=1`(감지 무시). 비잠금 세션은 고객 발화 **2턴 연속 스크립트 감지**로 자동 전환(PLN-260813 P2), 전환 대상에 제한 없음 | `chat.service.ts` `syncSessionLanguage`, `detect-language.util.ts` |
| ④ AI 답변 언어 | RAG 시스템 프롬프트 끝에 `Reply in language code: ${language}`. 같은 프롬프트의 페르소나 **기본 규칙**(테넌트가 규칙을 저장하지 않으면 적용, go2joy = 미저장)에 `"Reply in the customer's language"` — 두 지시가 **충돌**. 답변 뒤 언어 검증 없음 | `rag.service.ts` `answer`/`answerWithoutKnowledge`, `ai-config.service.ts` `DEFAULT_RULES` |
| ⑤ 시스템 문구·시나리오·위젯 문구 | `session.language` 키 + EN 폴백 — 정상 | `SYSTEM_MESSAGES`, `scenario.service.ts` `pick`, `widget-copy` |
| ⑥ 답변 재사용 | `lang` 스코프 검색 — 정상(단, ④에서 한국어로 나간 답변이 EN/VI로 저장될 수 있음) | `answer-reuse.service.ts` |
| ⑦ 콘솔 | 설정 › 위젯 동작에 **타임존·기본 언어**만 있음. 제공 언어(버튼 목록) 설정 없음 | `SettingsPage.tsx` |

### 2.2 실측 (스테이징 go2joy, 최근 45일, 2026-10-19 조회)
| 항목 | 값 |
|---|---|
| 세션 언어 분포 | **KO 554 (57%)** · VI 248 · EN 167 / 969 — go2joy는 `default_language=vi`, 타임존 HCM인데도 KO가 최다 = 한국어 브라우저의 locale 힌트가 테넌트 기본을 이김(②) |
| 한글 포함 AI 답변 | 121건 — 세션(메시지) 언어 KO 116 · **EN 4 · VI 1** |
| 비KO 세션의 한글 답변 5건 | 전부 **직전 고객 발화가 한국어**. 예) EN·잠금 세션 "오늘 예약 현황 보기" → 한국어 답변(#19863, 10/19) · VI·잠금 세션 "시간단위 예약 기능 있나요?" → 한국어(#19337, 10/13) · EN "시간단위 예약 가능?" → 한국어(#19067) |
| 답변 재사용 저장소 | 7건, 비KO 행의 한글 오염 0건 |
| KB 문서 | 270건 중 한글 23건(ko 문서) — 컨텍스트 언어가 답변 언어를 끌 수 있음 |

### 2.3 원인
| # | 원인 | 드러난 현상 |
|---|---|---|
| C1 | 브라우저 언어(명시 locale)가 테넌트 기본 언어보다 우선하고, 테넌트별 **제공 언어 제한이 없음** | 베트남 테넌트에서 한국어 UI·한국어 세션이 57% — "선택과 다르게 한국어" 체감의 주원인 |
| C2 | 프롬프트 충돌: 시스템은 "세션 언어로", 기본 규칙은 "고객 언어로" | 선택 언어가 EN/VI여도 한국어로 질문하면 한국어 답변(5건) |
| C3 | 자동 전환(2턴 감지)이 테넌트 제공 언어를 보지 않음 | 한국어 2턴이면 비잠금 세션이 KO로 전환, 이후 시스템 문구까지 한국어 |
| C4 | 답변 언어 사후 검증 없음 | 모델이 지시를 어기면(한국어 KB 컨텍스트·한국어 질문) 그대로 전달 |

## 3. TO-BE
| ID | 내용 |
|---|---|
| T1 | **테넌트별 제공 언어**(위젯 언어 버튼 목록) 설정. 영어는 항상 포함(폴백 언어). 미설정(NULL) = 현행 6개 전부 |
| T2 | 세션 언어는 **제공 언어 안에서만** 결정: 브라우저/호스트 locale이 제공 언어면 그 언어, **제공 언어에 없으면 영어**(요구 3). 테넌트 기본 언어는 "선호 없음"(영어 브라우저·힌트 없음)일 때만(현행 의미 유지). 기존 세션도 `ensure` 시 제공 언어 밖이면 재결정 → 이미 KO로 만들어진 go2joy 세션이 다음 열기부터 바로 고쳐짐 |
| T3 | 수동 선택·자동 감지 모두 제공 언어 밖 값은 거부(선택은 400, 감지는 무시) |
| T4 | **AI 답변은 세션 언어로 고정**: 프롬프트 지시 일원화("질문·문서가 다른 언어라도 반드시 {언어}로 답하라", 기본 규칙 문구 교체) + **사후 스크립트 검증** → 불일치면 1회 번역 재시도, 로그·카운트 |
| T5 | 위젯 🌐 버튼 목록 = 제공 언어만, 1개면 버튼 숨김. 저장된 수동 선택이 제공 언어 밖이면 버림 |
| T6 | 콘솔 설정 › 위젯 동작 "기본 언어" 옆에 "제공 언어" 체크박스로 수정·즉시 반영(새 세션 + 기존 세션 다음 열기) |

## 4. 갭 분석
| TO-BE | 변경 지점 | 종류 |
|---|---|---|
| T1 | `tenants.widget_languages json NULL` + `TenantSettings` DTO/mapper, `@sharptalk/types` 헬퍼 `offeredLanguages(list)` | 스키마·API |
| T2 | `SessionService.resolveLanguage(…, offered)` · `ensure` 기존 세션 재검사 · `languageForChannel` · `SessionResponse.languages` | API |
| T3 | `SessionService.setLanguage` 검증(E3004) · `applyDetectedLanguage` 호출 전 필터 | API |
| T4 | `rag.service` 두 프롬프트 · `DEFAULT_RULES[3]` · 신규 `reply-language.util.ts`(검증) + 번역 재시도 | API |
| T5 | `LanguageSwitcher` 옵션 필터 · `useSession` 채택 로직 · `initialLanguage` 상점별 캐시 | 위젯 |
| T6 | `SettingsPage` 체크박스 행 + i18n ×6 · `settings.service` 와이어 | 콘솔 |

## 5. 사용자 흐름 (go2joy: 제공 VI·EN, 기본 vi)
| 상황 | AS-IS | TO-BE |
|---|---|---|
| 한국어 브라우저 파트너가 위젯 열기 | 한국어 UI, 한국어 답변 | **영어** UI·답변, 버튼 VI/EN만. 한국어로 질문해도 영어 답변 |
| 베트남어 브라우저 | VI | VI(동일) |
| 영어 브라우저 | VI(기본 언어) | VI(동일, D1) |
| VI 선택 후 한국어로 질문 | 한국어 답변(5건 실측) | 베트남어 답변 |
| 한국어 2턴 연속 | 세션 KO 전환 | 전환 없음(KO 미제공) |
| 지난주 KO로 만들어진 세션 재방문 | 한국어 유지 | 다음 `ensure`에서 EN으로 재결정 |

## 6. 제약·비범위
- 자동 감지의 2턴 규칙(PLN-260813)은 **제공 언어 안에서** 유지 — 6개 전부 제공하는 테넌트(ivyusa)는 현행과 동일.
- 콘솔 라이브챗 번역·브리핑·여정 리포트 언어는 범위 밖. 메신저 채널(릴레이·텔레그램) 세션은 같은 필터만 적용.
- 스키마 변경 1열 → 스테이징·프로덕션 **SQL 선적용** 후 배포.
- 콘솔 로그인은 내가 할 수 없어(비밀번호 입력 금지) go2joy 설정은 SQL로, 화면은 타입체크·코드로 검증.
- 사후 검증은 **문자 체계 수준**(한글·가나·한자 ↔ 라틴)만 판정. EN↔VI, EN↔ES처럼 같은 라틴 문자는 프롬프트에 맡긴다(실측 결함은 전부 한국어 ↔ 라틴).
