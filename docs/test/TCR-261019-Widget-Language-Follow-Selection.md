# TCR-261019 — 위젯 언어 선택 준수 테스트 케이스

- 근거: [PLN-261019-Widget-Language-Follow-Selection](../plan/PLN-261019-Widget-Language-Follow-Selection.md)(2026-10-19 "권장안대로 진행" 승인, D1~D7 권장안) · 결과 [RPT](../implementation/RPT-261019-Widget-Language-Follow-Selection.md)

## 1. 단위 테스트 (자동)
| ID | 대상 | 케이스 | 기대 | 파일 |
|---|---|---|---|---|
| U1 | `offeredLanguages` | null/[] · `['vi','ko','th','vi']` · `['VI']` | 전부 / `en,ko,vi`(등록 순·영어 추가·미등록·중복 제거) / `en,vi` | `packages/types/src/common/language.spec.ts` |
| U2 | `isOfferedLanguage` | 코드·세션값 혼용, null 목록 | `ko`/`KO` 미제공 false, `en` 항상 true, `th` false | 〃 |
| U3 | `resolveLanguage`(D1) | 제공 VI/EN·기본 vi: locale vi / ko / en-US / 기본 ko+제공 EN·ES / 목록 NULL+ko | VI / **EN** / VI / EN / KO | `session.service.languages.spec.ts` |
| U4 | `setLanguage`(D3) | 미제공 KO 선택 / 제공 vi 선택 | `BusinessException` E3004·저장 없음 / VI·잠금 1 | 〃 |
| U5 | `applyDetectedLanguage`(D5) | 감지 KO(미제공) / EN(제공) | 변경 없음·update 미호출 / EN·update 호출 | 〃 |
| U6 | `ensure` 기존 세션(D6) | KO·잠금 세션 + locale ko / VI·잠금 / 목록 NULL | EN·잠금 0·캐시 삭제 / 그대로 / 그대로 | 〃 |
| U7 | `privacyNotice` | 기본 테넌트 | `languages` 6개 | `session.service.spec.ts` |
| U8 | `replyLanguageMismatch`(D4) | 한국어→EN/VI · 라틴→KO · 일치 5종 · 라틴끼리 · 한글 7자/8자 인용 · 20자 미만 | true / true / false / false / false·true / false | `reply-language.util.spec.ts` |
| U9 | `replyLanguageRule` | vi·VI·ko·th | "Always reply in Vietnamese (vi) … even if …" / 미등록은 `TH (th)` | `rag-reply-language.spec.ts` |
| U10 | `RagService.answer` | 1차 한국어+CITED → 2차 베트남어 / 2차도 한국어 / 1차 일치 | 2회 호출·`chat_answer_language_fix`·CITED 미전달·인용 유지 / 원문 유지 / 1회 호출 | 〃 |
| U11 | `answerWithoutKnowledge` | 1차 한국어 → 2차 베트남어 | 베트남어 반환, 프롬프트에 규칙 포함 | 〃 |
| U12 | 기존 스펙 | rag-*·tenant.service·session·embed·ai-config | 통과(기본 규칙 문구 교체 영향 없음) | — |

## 2. 통합 시나리오 (스테이징 go2joy, 제공 VI·EN)
| ID | 시나리오 | 기대 |
|---|---|---|
| I1 | SQL 선적용 → 배포 | `tenants.widget_languages` 존재, `Nest application successfully started` |
| I2 | go2joy `widget_languages=["vi","en"]` → `session/ensure`(새 토큰, locale ko) | `language: EN`, `languages: ["en","vi"]` |
| I3 | 기존 KO 세션 토큰으로 `ensure` | `language: EN`, API 로그 `session language realigned` |
| I4 | 위젯 열기(한국어 브라우저) | 영어 UI, 🌐 버튼 목록 English·Tiếng Việt 2개 |
| I5 | 한국어로 질문 | 영어 답변(한글 없음). 불일치 시 API 로그 `reply language mismatch … translating once` + `fixed` |
| I6 | 🌐 Tiếng Việt 선택 후 한국어 질문 | 베트남어 답변 |
| I7 | `POST /session/language` KO | 400 E3004, API warn 로그 |
| I8 | ivyusa(목록 NULL) | `languages` 6개, 버튼 6개, 동작 현행 |
| I9 | 콘솔 설정 › 위젯 동작 | 제공 언어 체크박스(English 고정), 기본 언어 옵션=체크된 언어만, 저장 토스트 — 코드·타입체크(콘솔 로그인 미진행) |

## 3. 엣지 케이스
| ID | 케이스 | 기대 |
|---|---|---|
| E1 | `ivy_lang=ko` 저장된 브라우저 + 제공 VI/EN | 첫 ensure 뒤 EN 전환·`ivy_lang` 삭제·`ivy_langs:<shop>` 캐시 → 다음 로드는 바로 EN |
| E2 | 호스트 `setLocale('ko')` | 위젯이 무시(목록 밖) |
| E3 | 기본 언어가 비제공(ko) | 서버: 건너뜀 → EN. 콘솔: 셀렉트가 "타임존 따름"으로 표시 |
| E4 | 6개 전부 체크 후 저장 | `widget_languages = NULL`(미제한 복귀) |
| E5 | 번역 재시도도 한국어 | 원문 전달 + `reply language fix failed` warn |
| E6 | 20자 미만 짧은 답변 | 판정 안 함 |
| E7 | 구 위젯 캐시(`languages` 미인지) | 버튼 6개 노출, 비제공 선택은 서버 400(조용히 실패) |
| E8 | 메신저 채널 세션(`languageForChannel`) | 같은 필터 — 릴레이 ko 힌트+제공 VI/EN → EN |
