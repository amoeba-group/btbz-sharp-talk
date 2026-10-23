# RPT-261023 — 위젯 하단 AI 고지 문구 테넌트 설정 (go2joy)

- REQ/PLN/TCR: `docs/{analysis,plan,test}/*-261023-Widget-Disclosure-Line-Copy.md` (PLN 승인, 권장안 D1~D4)
- PR #725 → main `ea6be2bc` (squash)

## 변경 요약
| 영역 | 내용 |
|---|---|
| 저장 | `tenants.widget_copy.disclosureLine`(언어별 bag) — 스키마 변경 없음 |
| API | `PATCH /tenants/widget-settings` `disclosure_line_{en,es,ko,vi,ja,zh}`(160자), 조회·세션 응답 `widgetCopy.disclosureLine` |
| 위젯 | 상·하단 고지 줄: 테넌트 문구 우선, 첫 `[…]`를 약관 링크(`terms_url` → 개인정보처리방침), 대괄호 없으면 기존 ` · 이용약관` 링크 |
| 콘솔 | 설정 › 위젯 › 동작 카드 "AI 고지 문구"(언어 탭별), 라벨·힌트 6개 언어 |

## 파일
- `packages/types/src/api/widget.types.ts`
- `apps/api/src/domain/tenant/{entity/tenant.entity.ts, dto/request/tenant.request.ts, dto/response/tenant.response.ts, tenant.service.ts, tenant.mapper.ts, tenant.service.spec.ts}`, `apps/api/src/domain/session/session.service.ts`
- `apps/widget/src/{lib/copy.ts, components/chat/ChatTab.tsx}`, `apps/widget/test/disclosure-line.test.mjs`
- `apps/web/src/domain/settings/{SettingsPage.tsx, settings.service.ts}`, `apps/web/src/i18n/locales/*/settings.json`

## 테스트
api 199 · widget 59 통과, typecheck/build/i18n:check 통과, CI 통과. 로컬 실측 TCR I-1~I-5 통과.

## 배포 상태
| 환경 | 마이그레이션 | 코드 | 운영 설정 | 검증 |
|---|---|---|---|---|
| 스테이징 | 해당 없음 | ✅ main `ea6be2bc` → `deploy-staging.sh` | ✅ go2joy(tenant 4) `terms_url` = `https://go2joy.vn/vi-vn/policy?tab=terms-of-use`(이전 NULL), `widget_copy.disclosureLine` EN/VI/KO — SQL `JSON_SET`(다른 문구 키 보존), 행 백업 `~/backups/pre-261023-go2joy-disclosure-tenants4.sql` | api healthy·ERROR 0. 스테이징 로더 점검 페이지(go2joy, 하단 배치)에서 VI "Được tạo bởi AI, áp dụng **điều khoản dịch vụ**", EN "Created by AI; apply **terms of service**", KO "AI가 생성함, **서비스 이용 약관**이 적용됩니다" — 굵은 부분만 링크, 클릭 → go2joy 약관 페이지 |
| 프로덕션 | 해당 없음 | ✅ `production` ff `b7c7286b..ea6be2bc` → `deploy-self-hosted.sh`(applied 109) | ⏸ **go2joy 테넌트 미이관**(프로덕션 tenants = ivyusa 1개) — 이관 시 위 값 적용 필요 | health 200, ERROR 0, 위젯 번들 `disclosureLine` |

## 남은 일
- 프로덕션 go2joy 테넌트 이관 시 약관 URL + EN/VI/KO 고지 문구 설정(콘솔 설정 › 위젯 › 동작 카드 / 개인정보 고지 화면).
- 스테이징 설정은 SQL로 넣어 감사 로그 행이 없음(콘솔 저장이 아니라서).
- 실측 중 스테이징 go2joy에 게스트 세션 몇 건 생성(메시지 없음).
