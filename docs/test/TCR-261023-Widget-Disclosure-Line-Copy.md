# TCR-261023 — 위젯 하단 AI 고지 문구 테넌트 설정

- PLN: `docs/plan/PLN-261023-Widget-Disclosure-Line-Copy.md` (승인 2026-10-23, D1~D4 권장안)

## 단위 테스트
| ID | 위치 | 케이스 | 결과 |
|---|---|---|---|
| U-1 | `apps/api/.../tenant.service.spec.ts` | `disclosure_line_*` 저장 시 언어별·trim, 빈 값/null로 지우면 bag 삭제 → 전부 비면 `widget_copy` NULL | ✅ |
| U-2 | `apps/widget/test/disclosure-line.test.mjs` | go2joy EN/VI/KO 문구의 `[…]`가 링크 부분으로 분리(KO는 뒤 문구 `이 적용됩니다` 유지) | ✅ |
| U-3 | 〃 | 대괄호 없음 → 인라인 링크 없음(기존 ` · 이용약관` 링크가 뒤에 붙음) | ✅ |
| U-4 | 〃 | 빈 `[]`·닫히지 않은 `[` → 평문 | ✅ |
| U-5 | 〃 | 여러 쌍 → 첫 쌍만 링크 | ✅ |

실행: api tenant+session 199 · widget node test 59 통과, `typecheck`(9)·`build`(6)·`i18n:check` 통과.

## 통합 (로컬 — API dist + 위젯 vite + 임베드 테스트 페이지)
| ID | 시나리오 | 결과 |
|---|---|---|
| I-1 | `PATCH /tenants/widget-settings` EN/VI/KO 문구 저장 → 응답 `disclosureLine` 3개 언어 | ✅ |
| I-2 | `PATCH /tenants/privacy-notice` `terms_url` go2joy 약관 | ✅ |
| I-3 | 상단 배치 테넌트(로컬 ivyusa) EN: 고지 줄 "Created by AI; apply terms of service", 밑줄 부분만 링크 | ✅ |
| I-4 | 링크 클릭 → 새 탭 `https://go2joy.vn/vi-vn/policy?tab=terms-of-use` | ✅ |
| I-5 | 실측 후 로컬 설정 원복(문구 비움, terms_url null) | ✅ |

## 스테이징·프로덕션 실측 (go2joy, 하단 배치)
배포 기록은 RPT에. 확인 항목: EN/VI/KO 하단 줄 문구, 링크 대상, 문구 없는 언어(ES 등)는 기본 문구 + 기존 링크.

## 엣지
| 케이스 | 처리 |
|---|---|
| 약관 URL·개인정보처리방침 URL 모두 없음 | 대괄호만 지우고 평문 |
| 설정 없는 테넌트 | 기본 문구(현행) |
| 설정 버튼 숨김(#724) | 문구 뒤 " · 개인정보 설정" 링크 그대로 |
| HTML/스크립트 문자열 입력 | React 텍스트 노드로만 렌더 — 해석 안 됨 |
