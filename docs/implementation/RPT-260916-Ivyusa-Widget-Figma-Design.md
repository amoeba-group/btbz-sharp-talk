# RPT-260916 — ivyusa 위젯 Figma 디자인 반영 실행 보고

- 근거: REQ/PLN-260916-Ivyusa-Widget-Figma-Design (승인 2026-09-16) · TCR-260916
- PR: **#534** (squash → main `4b77438`) + 본 문서 PR
- Figma: `TalkTalk` node 345-14751 및 Master Shots(345-11447) 형제 프레임 — 브라우저로 직접 확인

## 1. 접근 방식
**ivyusa 하드코딩 없음.** Figma가 요구한 것 중 설정으로 되는 것은 설정으로, 안 되는 것은 **모든 테넌트가 고를 수 있는 옵션**으로 넣고 기본값은 현행 동작으로 두었습니다. ivyusa는 그 옵션을 켠 첫 테넌트입니다.

## 2. 무엇이 바뀌었나
| 단계 | 변경 |
|---|---|
| **P1 설정** | 스테이징 ivyusa: 브랜드 `#2D5BE3`·흰 헤더, 탭 2개(알림·채팅), 커스텀 위젯 "IVY Figma"(Inter 14·모서리 16·380×720) 사용함, 시나리오 4개(My Orders/Product Help/Contact Support/How to become an Affiliate), 첫 방문 문구 |
| **P2 트리거 진입** | `launcher.mode`(`floating`\|`trigger`)·`offsetTop`·`triggerSelector` 신설. 트리거 모드: 플로팅 런처 없음, 닫힘 시 iframe 0×0(클릭 비차단), **헤더 아래 우측 도킹**, 바깥 클릭·재클릭으로 닫힘, 미읽음 수를 `[data-sharptalk-badge]`에 주입, 헤더의 X·언어 pill 숨김(좁은 화면은 `?compact=1`로 X 유지). 패널 높이 상한 720→**760**(로더 프레임 840) |
| **P3 알림 선택 삭제** | `notifications.deleted_at` 소프트 삭제 + `DELETE /notifications`(ids[] \| all, 소유 검증·캐시 무효화) + 위젯 선택 모드(체크 원, 채움 [선택 알림 삭제]·외곽선 [전체 알림 삭제]) + 칩 순서(주문 탭 숨김 시 전체·주문·배송·이벤트·리뷰·문의) |
| **P4 카드형 빠른 답장** | `design.quickReplyStyle`(`chip`\|`card`) + 시나리오 액션별 아이콘 + 커스텀 위젯 편집기 선택 |
| **문서** | 콘솔 런처 모드 UI·스니펫 예시(6언어), 매뉴얼 05 §3.2-1·필드 표·FAQ, 임베드 SDK 가이드 "트리거 모드", 하네스 `apps/widget/public/trigger-test.html` |

## 3. Figma 대조 (스테이징 실측)
| 디자인 | 결과 |
|---|---|
| 헤더 종 아이콘 + 빨간 배지로 진입 | ✅ 트리거 모드 + `data-sharptalk-badge` |
| 헤더 아래 우측 도킹, 380 폭·모서리 16 | ✅ 420×800 프레임 안 380 패널, `top:72` |
| 흰 헤더 · "Hi, {이름}" · 톱니만 | ✅ (X·언어 pill 숨김) |
| 탭 2개 + 카운트 배지 | ✅ |
| 알림 칩·그룹·상태 배지·미읽음 점·트래킹·주문 상세·리뷰 | ✅ 기존 구현 |
| 알림 선택 → 선택/전체 삭제 | ✅ 신규 |
| 아이콘 카드 빠른 답장 4개 | ✅ 신규(스테이징 라벨 4개 반영) |
| 주 색 `#2D5BE3` | ✅ |
| "AI 요약" 버튼 | ❌ 사용처 불명 — 범위 밖(§5) |
| AI 고지 바 | 디자인에 없지만 **법적 필수**라 유지 |

## 4. 테스트
- jest **api 1895/1895**, types **104/104**(캐시가 가리던 스펙 컴파일 오류를 CI가 검출 → 수정)
- tsc 4패키지 · `node --check embed.js` · i18n complete · env:check · 매니페스트(83)
- curl: 테마·디자인 저장/ensure 전달, 삭제 API(선택·남의 id 0·전체·미읽음 0·행 보존)
- 브라우저(로컬 하네스 + **스테이징 실측**): 도킹·헤더 컨트롤·카드 빠른 답장·바깥 클릭 닫기·선택 삭제·배지

## 5. 배포 상태
| 항목 | 상태 |
|---|---|
| SQL | `260916-notifications-deleted-at.sql` — **staging·production DB 모두 선적용 완료**(2026-09-16) |
| 코드 staging | main `4b77438` 배포, API healthy·`successfully started` |
| 스테이징 ivyusa | 트리거 모드(offset 72, `#st-bell`)·카드 빠른 답장·2탭·IVY Figma 디자인 적용 |
| production | 코드 미배포(다음 승격 시 함께). DB는 준비됨 |

## 6. 잔여
- **스토어 테마 삽입은 IVY 측**: Shopify 헤더에 `#st-bell`(+ `data-sharptalk-badge`)을 넣고 스니펫의 `trigger`를 채워야 실제 매장에서 동작합니다. 콘솔이 복사용 스니펫을 제공합니다.
- Figma "AI 요약" 버튼 용도 확인 필요(범위 밖).
- 매뉴얼 en/vi 번역은 ko 원본 반영 후 별도(현재 ko만 갱신).
- 트리거 모드에서 로그인 리다이렉트 복귀(`ivy:reopen`)는 흐름 동일하나 실매장 E2E는 테마 삽입 후 확인 권장.
