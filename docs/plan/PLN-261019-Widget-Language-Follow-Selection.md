# PLN-261019 — 위젯 언어 선택 준수 (테넌트 제공 언어 · AI 답변 언어 고정)

- 근거: [REQ-261019-Widget-Language-Follow-Selection](../analysis/REQ-261019-Widget-Language-Follow-Selection.md)
- 상태: **승인 대기** — 아래 D1~D7 결정 후 구현 시작
- 범위: `packages/types` · API(session·chat·rag·tenant) · 위젯 · 콘솔 설정 · SQL 1건

## 0. 결정 사항 (권장안 ★)
| # | 질문 | 선택지 | 권장 |
|---|---|---|---|
| D1 | 브라우저(호스트) 언어가 제공 언어에 없을 때 시작 언어 | ⓐ **영어**(요구사항 문구 그대로). 테넌트 기본 언어는 "선호 없음"(영어 브라우저·힌트 없음)일 때만 — 현행 의미 유지 / ⓑ 테넌트 기본 언어 → 없으면 영어 | ★ⓐ — go2joy에서 한국어 브라우저 사용자는 대개 외국인 직원이라 베트남어보다 영어가 맞다. 영어 브라우저는 OS 기본값이라 "선호 없음"으로 보는 현행 규칙은 유지 |
| D2 | 설정 위치 | ⓐ **테넌트 콘솔 설정 › 위젯 동작**(기본 언어 바로 위) / ⓑ 플랫폼 어드민 테넌트 화면 | ★ⓐ — 기본 언어·타임존이 이미 거기 있고 같은 PATCH로 저장. 플랫폼 운영자는 테넌트 콘솔로 들어가 수정 |
| D3 | 영어 고정 포함 | ⓐ **영어는 해제 불가**(폴백 언어) / ⓑ 자유 선택, 1개 이상 | ★ⓐ — D1·시스템 문구 폴백·KB 영어 문서가 모두 영어를 바닥으로 삼는다 |
| D4 | AI 답변 사후 검증 | ⓐ **문자 체계 검증 + 불일치 시 1회 번역 재시도**(라틴 세션에 한글/가나/한자, 또는 KO·JA·ZH 세션에 해당 문자 0) / ⓑ 프롬프트 수정만 | ★ⓐ — 모델은 확률적이고 실측 결함은 전부 한국어↔라틴. 추가 호출은 불일치 때만, 로그로 빈도 추적 |
| D5 | 자동 감지(2턴) 전환 | ⓐ **제공 언어 안에서만 전환**(비제공 언어는 무시) / ⓑ 자동 감지 폐지 | ★ⓐ — 6개 전부 제공하는 테넌트는 현행 그대로, 제한 테넌트만 달라진다 |
| D6 | 기존 세션 처리 | ⓐ **`ensure`에서 제공 언어 밖이면 재결정**(코드) / ⓑ 일회성 SQL로 go2joy KO 세션 EN 전환 | ★ⓐ — SQL 없이 다음 열기부터 고쳐지고 설정 변경에도 같은 길로 반영 |
| D7 | go2joy 제공 언어 | ⓐ **VI · EN** / ⓑ VI · EN · KO | ★ⓐ — 요구사항이 한국어 노출을 결함으로 봄. 한국어 직원은 영어 |

## 1. 단계

### P1 — 타입 · 스키마
- `sql/261019-tenant-widget-languages.sql`: `ALTER TABLE tenants ADD COLUMN widget_languages json NULL` (NULL = 6개 전부, 현행). `npm run migrations:manifest`.
- `packages/types/src/common/language.ts`: `offeredLanguages(list: string[] | null): LanguageDef[]` — 등록 언어만 남기고 **영어를 항상 포함**, 비어 있으면 전부. `isOffered(code, list)`.
- `packages/types/src/api/widget.types.ts` `SessionResponse.languages?: string[]`(소문자 코드, 표시 순서) — 구 위젯은 무시.
- `TenantSettingsResponse.widgetLanguages: string[] | null`, 요청 `widget_languages?: string[] | null`(`@IsIn(LANGUAGE_CODES, { each: true })`).

### P2 — API 세션 (`session.service.ts`)
- `resolveLanguage(locale, timezone, defaultLanguage, offered)`:
  1. 명시 locale(영어 제외)이 **제공 언어면** 채택
  2. 명시 locale이 있는데 제공 언어가 아니면 → **EN** (D1ⓐ)
  3. 선호 없음 → 테넌트 기본 언어(제공 언어일 때) → 타임존 언어(제공 언어일 때) → EN
- `ensure` 기존 세션: `language`가 제공 언어 밖이면 위 규칙으로 재결정 + Redis 캐시 삭제(D6ⓐ). 잠금 세션도 같다 — 더 이상 제공하지 않는 언어는 선택권이 없다.
- `setLanguage`: 제공 언어 밖 → `BusinessException(ERROR_CODE.LANGUAGE_NOT_OFFERED /* E3004 */, 400)` + `logger.warn`.
- `applyDetectedLanguage` 호출부(`chat.service.syncSessionLanguage`): 감지 언어가 제공 언어 밖이면 return (D5ⓐ).
- `languageForChannel`(메신저)도 같은 `resolveLanguage`.
- `session.mapper`: `languages` 추가. 테넌트 조회는 `ensure`가 이미 들고 있는 `tenant` 재사용(추가 쿼리 없음).

### P3 — API AI 답변 언어 고정
- `rag.service.answer` / `answerWithoutKnowledge`: 지시를 한 문장으로 통일 —
  `Always reply in ${PROMPT_LANGUAGE_NAMES[lang]} (${lang}), even if the customer wrote in another language or the context documents are in another language.` (`PROMPT_LANGUAGE_NAMES`는 `agent/prompt-language.ts` 재사용)
- `ai-config.service DEFAULT_RULES[3]`: `"Reply in the customer's language"` → `"Reply in the conversation language the system specifies, concisely and politely."` 테넌트가 저장한 규칙은 건드리지 않음(콘솔 기본값 표시도 함께 바뀜).
- 신규 `apps/api/src/global/util/reply-language.util.ts`: `replyLanguageMismatch(text, lang): boolean`
  - 라틴 세션(EN/ES/VI): 한글·가나·한자 글자 ≥ 8 → 불일치
  - KO: 한글 0 · JA: 가나+한자 0 · ZH: 한자 0 (글자 20자 이상인 답변만 판정)
  - 라틴끼리는 판정하지 않음(REQ §6)
- `rag.service`: `CITED:` 줄을 떼어낸 **표시 본문**에 대해 검증 → 불일치면 `ai.complete({feature:'chat_answer_language_fix'})`로 "다음 답변을 {언어}로 번역, 마크다운·목록 유지" 1회 → 재검증 통과면 교체, 아니면 원문 유지. 두 경우 모두 `logger.warn('reply language mismatch …')`(테넌트·세션 언어·감지·재시도 결과). 모더레이션은 이후 단계에서 현행대로 통과.
- 재사용 저장소: 재시도 뒤 본문을 저장하므로 오염 경로 차단. 기존 7건은 오염 없음(실측).

### P4 — 위젯
- `widgetStore.languages: string[]`(기본 = 전체) · `ensure` 응답으로 채움.
- `useSession`: 응답 `languages`에 현재 언어가 없으면 **수동 선택이어도** `res.language`로 전환하고 `ivy_lang` 삭제. 상점별 캐시 `ivy_langs:<shop>`에 목록 저장 → `initialLanguage()`가 다음 로드부터 캐시로 거른다(첫 로드의 짧은 한국어 깜빡임 방지).
- `LanguageSwitcher`: `LANGUAGE_OPTIONS.filter(offered)`; 1개면 렌더하지 않음. `useEmbedCommands` `locale` 명령도 제공 언어 밖이면 무시(서버가 400을 돌려주므로 조용히 실패하던 것을 명시).

### P5 — 콘솔 설정 (D2ⓐ)
- `SettingsPage` 위젯 동작 카드: "제공 언어" 체크박스 행(6개, English 체크·비활성, β 표기 유지) → 기본 언어 셀렉트 옵션은 체크된 언어만(체크 해제된 언어가 기본이면 "타임존 따름"으로 초기화하고 안내).
- 더티 판정·저장 PATCH에 `widget_languages` 추가, 저장 토스트는 기존 경로.
- i18n `settings.json` ×6: `widgetBehavior.offeredLanguages`, `offeredLanguagesHint`, `defaultLanguageHint` 문구 갱신("제공 언어에 없는 브라우저 언어는 영어로 시작").

### P6 — go2joy 반영 · 문서
- 스테이징 go2joy `widget_languages = ["vi","en"]`(SQL, 감사 로그 없음 → RPT 기록). 프로덕션은 go2joy 테넌트 생성 시.
- 매뉴얼 `apps/web/public/manual/basic-settings*`에 제공 언어 1행(있으면) — 구현 중 확인.
- TCR → RPT.

## 2. 와이어프레임

### 2.1 콘솔 설정 › 위젯 동작 (변경 부분)
```
┌ 위젯 동작 ───────────────────────────────────────────────────────┐
│ 로그인 방식      [리다이렉트 ▼]                                     │
│ 타임존           [Asia/Ho_Chi_Minh — Tiếng Việt ▼]                   │
│ ─────────────────────────────────────────────────────────────────  │
│ 제공 언어        [x] English(고정)  [x] Tiếng Việt  [ ] 한국어        │
│                  [ ] Español        [ ] 日本語 (β)   [ ] 中文 (β)     │
│   위젯 언어 버튼에 보이는 언어입니다. 영어는 항상 포함되며,            │
│   브라우저 언어가 여기 없으면 영어로 시작합니다. 저장 즉시 반영됩니다.  │
│ 기본 언어        [Tiếng Việt ▼]        ← 제공 언어만 선택 가능         │
│   영어 브라우저 등 선호가 없을 때 시작하는 언어입니다.                 │
│                                                        [저장]       │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 위젯 헤더 언어 버튼 (go2joy: VI·EN)
```
┌──────────────────────────────────────────────┐
│ [G2J]  Nguyen Van A            🌐 EN  ⚙  ✕   │
│                                ┌───────────┐ │
│                                │ English ✓ │ │
│                                │ Tiếng Việt│ │
│                                └───────────┘ │
```
제공 언어가 1개면 🌐 버튼 자체가 사라진다. 채팅 본문·말풍선·설문 카드 변화 없음.

### 2.3 AI 답변 흐름 (백엔드, UI 없음)
```
질문(한국어) ─▶ RAG 프롬프트 "Always reply in Vietnamese (vi) …"
   ─▶ 답변 ─▶ CITED 분리 ─▶ 문자 체계 검증(VI 세션에 한글 ≥8?)
        ├─ 일치 ─▶ 모더레이션 ─▶ 전달
        └─ 불일치 ─▶ 번역 1회 ─▶ 재검증 ─▶ 통과: 교체 / 실패: 원문 ─▶ warn 로그 ─▶ 모더레이션 ─▶ 전달
```

## 3. 측면 영향
| 영역 | 영향 | 대응 |
|---|---|---|
| 6개 전부 제공 테넌트(ivyusa 등) | `widget_languages NULL` → 현행과 동일. 바뀌는 건 프롬프트 문구·사후 검증만 | 스펙 기대값 갱신 |
| 잠금 세션이 비제공 언어 | 재결정으로 언어가 바뀜(의도) | REQ T2 |
| 콘솔 시뮬레이션(`rag.answer` 공용) | 같은 프롬프트·검증 적용(이점) | — |
| 답변 재사용 | 저장 본문이 검증 뒤 본문 | — |
| 메신저 채널 | 제공 언어 필터만 추가 | `languageForChannel` 스펙 |
| 구 위젯 캐시 | `languages` 없으면 전체 표시(서버가 400으로 거부) | 호환 |
| AI 비용 | 불일치 시 1회 추가 호출(실측 비율 5/700 ≈ 0.7%) | 로그 카운트 |
| 세션 캐시 | 재결정·설정 변경 시 `sessionCacheKey` 삭제 | 기존 패턴 |

## 4. 테스트 (TCR 초안)
- 단위: `resolveLanguage` 표(제공·미제공 × locale ko/vi/en/없음 × 기본 vi/없음) · `ensure` 기존 세션 재결정 · `setLanguage` E3004 · 감지 필터 · `offeredLanguages` 영어 고정 · `replyLanguageMismatch` 경계(7자/8자, 20자 미만 판정 안 함) · `rag.answer` 재시도 분기(mock 2회 호출·실패 시 원문) · `normalize`/DTO 검증.
- 통합(스테이징 go2joy VI·EN): 한국어 브라우저 → EN 세션·버튼 2개 · 한국어 질문 → 영어 답변 · 기존 KO 세션 토큰 → EN 재결정 · VI 선택 후 한국어 질문 → 베트남어 · ivyusa 6개 유지.
- 엣지: 저장된 `ivy_lang=ko` + 제공 VI/EN → EN 전환·키 삭제 · 기본 언어가 비제공 → 무시 · 검증 불일치 번역 실패 → 원문 전달 + warn.

## 5. 배포
1. PR(스키마 변경 → `## Migration` 섹션) 머지.
2. 스테이징 `sql/261019-tenant-widget-languages.sql` 선적용 → `deploy-staging.sh` → 부팅 로그 확인.
3. go2joy `widget_languages` SQL → 위젯 실측(localhost 테스트 페이지) → TCR/RPT.
4. 프로덕션: 같은 SQL 선적용 후 배포(go2joy 테넌트 없음 → 설정은 생성 시).
