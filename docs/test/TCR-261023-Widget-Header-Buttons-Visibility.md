# TCR-261023 — 위젯 헤더 버튼(언어 선택·설정) 노출 설정

- PLN: `docs/plan/PLN-261023-Widget-Header-Buttons-Visibility.md` (승인 2026-10-23, D1~D4 권장안)

## 단위 테스트

| ID | 위치 | 케이스 | 결과 |
|---|---|---|---|
| U-1 | `packages/types/src/common/widget-access.spec.ts` | 명시적 `false`만 숨김, 이상값(`'no'`)·누락은 노출 | ✅ |
| U-2 | 〃 | 제한 꺼짐·규칙 0개여도 숨김 버튼은 저장됨(D1) | ✅ |
| U-3 | 〃 | 기본값(전부 노출)은 저장하지 않음 | ✅ |
| U-4 | 〃 | 버튼 설정은 노출 판정(`evaluateWidgetAccess`)에 영향 없음 | ✅ |
| U-5 | `apps/api/.../tenant.service.widget-access.spec.ts` | 제한 off + 규칙 0개 + `controls` 저장 → E-거절 없이 저장 | ✅ |
| U-6 | 〃 | `controls`를 보내지 않는 구 클라이언트 저장 → 기존 값 유지 | ✅ |
| U-7 | 〃 | 버튼을 모두 다시 노출 + 다른 설정 없음 → `widget_access` NULL | ✅ |
| U-8 | `apps/api/.../session.service.spec.ts` | 세션 응답 `headerControls` 기본 `{language:true, settings:true}` | ✅ |
| U-9 | `apps/widget/test/embed-doc-lang.test.mjs` | `<html lang>`에서 읽은 언어 → `lang_src=doc`, `host_locale` 없음 | ✅ |
| U-10 | 〃 | 설정 `locale` 지정 → `host_locale=1`, `lang_src` 없음, 감시 안 함 | ✅ |
| U-11 | 〃 | `<html lang>` 없음 → `lang_src` 없음 | ✅ |
| U-12 | 〃 | SPA `lang` 변경 → `locale` 명령 `source:'doc'` 1회(같은 값 재전송 없음) | ✅ |

실행: types 29 · api tenant+session 198 · widget node test 전체 통과. `npm run typecheck`(9) · `npm run build`(6) · `npm run i18n:check` 통과.

## 통합 시나리오 (로컬 실측 — API dist + 위젯/콘솔 vite + 임베드 테스트 페이지 `<html lang="ko">`)

| ID | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| I-1 | API 부팅 | `Nest application successfully started` | ✅ |
| I-2 | `PATCH /tenants/widget-access` `controls:{language:false,settings:false}`(제한 off) | 200, 응답 `controls` 반영 | ✅ |
| I-3 | `controls.language:"x"` | 400 E5003 | ✅ |
| I-4 | `POST /session/ensure` | `headerControls:{language:false,settings:false}` | ✅ |
| I-5 | 이전 방문 수동 선택 `ivy_lang=en` 남은 브라우저로 ko 페이지 방문(숨김) | 🌐·⚙ 없음, 위젯 한국어, ✕ 유지 | ✅ |
| I-6 | 숨김 상태 안내 줄 | "개인정보 설정" 링크 노출 → 클릭 시 개인정보 패널 열림(D4) | ✅ |
| I-7 | 숨김 상태 SPA로 `<html lang>` en 전환 | 새로고침 없이 위젯 영어 전환 | ✅ |
| I-8 | 버튼 다시 노출 후 같은 페이지 | 🌐 KO·⚙ 복귀, 안내 줄 링크 사라짐 | ✅ |
| I-9 | 노출 상태 SPA `<html lang>` en 전환 | 위젯 언어 유지(방문자 선택 존중 — 현행) | ✅ |
| I-10 | 콘솔 `/settings/widget` 카드 | "위젯 노출 설정" ① 노출 제한 ② 헤더 버튼, 제한 off에서도 ② 편집 가능 | ✅ |
| I-11 | ② 언어 "노출 안 함" → 저장 | 성공 토스트, 새로고침 후 값 유지 | ✅ |

## 엣지 케이스

| ID | 케이스 | 처리 |
|---|---|---|
| E-1 | 구 API(필드 없음) | 위젯은 전부 노출 |
| E-2 | 구 로더 + 신 위젯 | `lang_src` 없음 → 설정 `locale`·`setLocale` 경로만(현행), SPA 감지만 빠짐 |
| E-3 | 화면 언어가 테넌트 제공 언어 밖 | 무시 → 세션 언어(서버 규칙 EN 폴백) |
| E-4 | 첫 방문(캐시 없음) | 첫 페인트는 기본(노출) → ensure 후 숨김·언어 전환 1회. 이후 방문은 캐시로 첫 페인트부터 반영 |
| E-5 | 트리거 모드(ivyusa) | 언어 버튼은 원래 숨김 — 그대로 |
| E-6 | 설정 버튼 숨김 + 동의 전 | 동의 배너의 "개인정보 선택 및 내 데이터" 링크도 그대로 |

## 참고
- 로컬 ivyusa의 시나리오 칩이 한국어 화면에서도 영어("My Orders")로 보이는 것은 테넌트 데이터 — 버튼 노출 상태에서도 동일(I-8)해 이번 변경과 무관.
- 실측 후 로컬 DB 설정은 기본값(전부 노출)으로 원복.
