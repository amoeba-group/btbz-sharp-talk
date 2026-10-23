# RPT-261023 — 위젯 헤더 버튼(언어 선택·설정) 노출 설정

- REQ/PLN/TCR: `docs/{analysis,plan,test}/*-261023-Widget-Header-Buttons-Visibility.md` (PLN 승인, 권장안 D1~D4)
- PR #724 → main `b7c7286b` (squash)

## 변경 요약
| 영역 | 내용 |
|---|---|
| 콘솔 | `/settings/widget` 카드 "위젯 노출 설정" = ① 노출 제한(기존) ② 헤더 버튼 노출(언어·설정 라디오), 저장 토스트 문구 갱신 |
| 저장 | `tenants.widget_access.controls {language, settings}` — 노출 판정과 독립(D1), 기본값(전부 노출)은 저장 안 함 |
| API | `PATCH /tenants/widget-access` `controls`(부분·구 클라이언트는 기존 값 유지), 세션 ensure 응답 `headerControls` |
| 위젯 | 숨긴 버튼 미렌더(✕는 유지), shop별 캐시 `ivy_hdr:<shop>`로 첫 페인트 반영 |
| 언어(D3) | 로더 `lang_src=doc` + `<html lang>` MutationObserver → `locale` 명령 `source:'doc'`. 언어 버튼 숨긴 테넌트만 화면 언어 우선·이전 수동 선택 무시 |
| 개인정보(D4) | 설정 버튼 숨김 시 AI 고지 줄에 "개인정보 설정" 링크 |

## 파일
- `packages/types/src/common/widget-access.ts`(+spec), `packages/types/src/api/widget.types.ts`
- `apps/api/src/domain/tenant/{tenant.service.ts, tenant.mapper.ts, dto/request/tenant.request.ts}`, `tenant.service.widget-access.spec.ts`
- `apps/api/src/domain/session/{session.service.ts, session.mapper.ts, session.service.spec.ts}`
- `apps/widget/public/embed.js`, `apps/widget/src/{i18n/i18n.ts, hooks/useSession.ts, hooks/useEmbedCommands.ts, store/widgetStore.ts, components/widget/WidgetPanel.tsx, components/chat/ChatTab.tsx, i18n/locales/*.ts}`, `apps/widget/test/embed-doc-lang.test.mjs`
- `apps/web/src/domain/settings/{WidgetAccessCard.tsx, settings.service.ts}`, `apps/web/src/i18n/locales/*/settings.json`

## 테스트
types 29 · api 198 · widget 55 통과, typecheck/build/i18n:check 통과, CI 통과. 로컬 실측 TCR I-1~I-11 통과.

## 배포 상태
| 환경 | 마이그레이션 | 코드 | 검증 |
|---|---|---|---|
| 스테이징 | 해당 없음(스키마 변경 없음) | ✅ main `b7c7286b` → `deploy-staging.sh` (2026-10-24 KST 새벽) | api healthy·`successfully started` 1회·ERROR 0, `/tenants/widget-access` 401, 로더 `lang_src=doc`, 위젯 번들 `ivy_hdr:`, 콘솔 SettingsWidgetPage 청크 반영 |
| 프로덕션 | 해당 없음 | ✅ `production` ff `cb601a93..b7c7286b` → `deploy-self-hosted.sh`(check-migrations applied 109) | api/web/widget 재생성, health 200, 라우트 401, 로더·위젯 번들 반영, ERROR 0 |

운영 설정 변경 없음 — 모든 테넌트 기본값(버튼 노출) 그대로. 숨김은 각 테넌트 콘솔에서 선택.
