# TCR-260916 — ivyusa 위젯 Figma 디자인 반영 (P1~P4)

- 근거: PLN-260916-Ivyusa-Widget-Figma-Design (승인 2026-09-16)
- 환경: 로컬 dev(API dist, 위젯 :5175, 콘솔 :5173), 테넌트 ivyusa, 하네스 `apps/widget/public/trigger-test.html`(위젯과 동일 오리진 — Vite dev 서버가 교차 오리진 스크립트 로드를 거부)

## 1. 단위 테스트
| ID | 대상 | 케이스 | 결과 |
|---|---|---|---|
| U-1 | `normalizeLauncher` | 기존 floating 값은 그대로(모드 키 없음) | PASS |
| U-2 | 〃 | `mode:'trigger'` + offset 클램프(999→240, -5→0) + 선택자 위생(`<script>`→null), camel/snake 동시 수용 | PASS |
| U-3 | 〃 | 알 수 없는 mode 드롭 | PASS |
| U-4 | `NotificationService.remove` | 선택 ids 소프트 삭제(내 것만), `deletedAt` 기록, 미읽음 캐시 무효화 | PASS |
| U-5 | 〃 | `all:true`는 id 조건 없음 / 아무것도 안 고르면 no-op(0) | PASS |
| U-6 | 기존 scoping 스펙 | 목록 조건에 `deletedAt IS NULL` 추가 반영 | PASS(기대값 갱신) |
| 합계 | api 1895/1895(187 suites) · types 78/78 | | PASS |

## 2. 정적 검사
| 검사 | 결과 |
|---|---|
| `tsc` types / api / web / widget | 4/4 PASS |
| `node --check apps/widget/public/embed.js` | PASS |
| `i18n:check` | complete (콘솔 `widgetTheme.launcherMode*`·`trigger*`, `widgetDesigns.quickReply*`, 위젯 `notifications.select/cancelSelect/deleteSelected/deleteAll/deleteAllConfirm` 6언어) |
| `env:check` · `check-migrations --check` | OK · 매니페스트 최신(83파일) |

## 3. API (로컬 curl)
| ID | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| I-1 | `PATCH /tenants/widget-theme` launcher `{mode:'trigger',offsetTop:64,triggerSelector:'#st-bell'}` | 저장·반환 | PASS |
| I-2 | `PATCH /widget-designs/:id` `design.quick_reply_style='card'` | `quickReplyStyle: card` | PASS |
| I-3 | `POST /session/ensure` | 테마에 launcher(trigger·offset·selector)와 `design.quickReplyStyle` 동봉 | PASS |
| I-4 | `DELETE /notifications {ids:[4,5]}` | `{deleted:2}`, 목록 5→3, 미읽음 5→3 | PASS |
| I-5 | 남의(없는) id 삭제 | `{deleted:0}` — 존재 여부를 흘리지 않음 | PASS |
| I-6 | `DELETE /notifications {all:true}` | `{deleted:3}`, 목록 0, 미읽음 0 | PASS |
| I-7 | DB 확인 | 행 5건 모두 남아 있고 `deleted_at` 기록(소프트 삭제) | PASS |

## 4. 브라우저 (트리거 모드 하네스)
| ID | 검사 | 결과 |
|---|---|---|
| B-1 | 닫힘 상태: 프레임 0×0·`visibility:hidden`·`top:64px`, 위젯 안에 플로팅 런처 **없음**(0개) | PASS |
| B-2 | 헤더 종 클릭 → 패널 420×680이 `top:64` 우측(x=860)에 도킹 | PASS |
| B-3 | 헤더에 X·언어 pill 없음(설계), 제목은 "Hi, {이름}" | PASS |
| B-4 | 채팅 탭 빠른 답장이 카드형(아이콘 6/6) | PASS |
| B-5 | 패널 바깥 클릭 → 닫힘 / 종 재클릭 → 열림 / 한 번 더 → 닫힘 | PASS |
| B-6 | 알림 탭: [Select] → 체크 원 2개 선택 → "Delete selected (2)"(채움) + "Delete all notifications"(외곽선) → 삭제 후 목록 0 | PASS |
| B-7 | 스토어 헤더 배지 `[data-sharptalk-badge]`가 미읽음 수 표시·0이면 숨김 | PASS |

## 5. 엣지·결정
| 케이스 | 처리 |
|---|---|
| 트리거가 `toggle`을 보내면 이중 전달(dev StrictMode) 시 상태가 반대로 | 로더가 자기 `isOpen`으로 **명시적 open/close** 전송 — 이중 전달에 영향 없음 |
| 좁은 화면 | 로더가 `?compact=1`을 붙여 위젯이 X 버튼을 유지(전체 화면엔 "바깥"이 없음) |
| 기존 테넌트 | `mode` 미설정=floating, `quickReplyStyle` 미설정=chip, 칩 순서는 주문 탭을 끈 테넌트에만 변경 — 무영향 |
| 패널 높이 | 상한 720→760, 로더 프레임 클램프 800→840 |
| 알림 삭제 | 소프트 삭제(행 보존) — 목록·미읽음·읽음 처리에서 제외 |
