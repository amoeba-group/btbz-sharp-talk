# FIX-261007 — FAQ 제목 일치 우선(R5) · 연락 방법 질문의 상담원 오판(G1) · 위젯 탭 복귀 재조회(R6)

- 근거: [REQ-261007-Go2Joy-FAQ-Accuracy](../analysis/REQ-261007-Go2Joy-FAQ-Accuracy.md) R5·R6, [TCR-261007](../test/TCR-261007-Go2Joy-FAQ-Accuracy.md) §4

## R5 — 질문과 제목이 같은 FAQ가 최종 컨텍스트에서 빠짐 (D3·E1)
- **현상**: 44문항 Round 2에서 D3 "Tôi (khách sạn) có thể thanh toán cho Go2Joy như nào?"(계좌정보)와 E1 "Làm thế nào để liên hệ với khách đặt qua ứng dụng?"가 "문서에서 찾지 못함"으로 답했다
- **원인(실측)**: 해당 FAQ(#3361, #3365)는 **현재 질문만으로 한 벡터 검색에서 2위(0.621)·1위(0.593)** 다.
  하지만 베트남어 전문검색 결과와 RRF로 합치면, 두 갈래에 모두 걸린 다른 문서들(약 1/64+1/64)이 한쪽에만 걸린 FAQ(1/61)를 앞지른다.
  그래서 현재 질문 검색의 상위 3건(`mergeOwnFirst`)에도 들지 못했다
- **수정**: `RagService.titleBonus` — 제목 단어 중 질문에 있는 비율(`titleMatchScore`, "Câu hỏi:" 제거, 4단어 미만 제목은 0)이 0.8 이상이면 +0.05(RRF 최댓값 2/61≈0.033보다 크다), 0.6~0.8이면 +0.004
- **재발 방지**: FAQ처럼 "제목 = 질문"인 지식은 제목 일치가 가장 강한 신호다. 융합 순위만 믿으면 한쪽 갈래(VN 전문검색)가 약할 때 정답 문서가 빠진다

## G1 — "기술지원 연락 방법" 질문을 상담원 요청으로 판정 + 핸드오프 문구 불일치
- **현상**: "Tôi đăng nhập … không vào được / Cách liên hệ hỗ trợ kỹ thuật"에 답변 대신 핸드오프가 나갔다(reason `user_request`). 안내 문구는 "확실한 답을 찾지 못해 넘깁니다"였다
- **원인**: ① 의도 분류 프롬프트에 "연락 *방법*을 묻는 것은 답할 질문"이라는 구분이 없었다 ② `handoff()`가 사유와 관계없이 `handoff`(저신뢰) 문구를 썼다
- **수정**: ① 분류 프롬프트에 "Asking HOW to contact support (which phone/e-mail/channel) is a question to answer — other, not agent_request" 추가
  ② `user_request` 핸드오프는 기존 `connectingAgent` 문구("상담원에게 연결해 드리겠습니다", 6개 언어)를 쓴다

## R6 — 위젯을 백그라운드 탭에 두면 답변 표시가 늦음
- **원인**: 메시지 폴링 5초가 React Query 기본값상 백그라운드에서 멈추고, 전역 `refetchOnWindowFocus: false`라 탭 복귀 시에도 다음 주기까지 기다렸다
- **수정**: `useChat` 쿼리에 `refetchOnWindowFocus: 'always'`(쿼리 단위 설정이 전역 기본값보다 우선) → 탭으로 돌아오면 즉시 조회한다

## 테스트
- 신규 5건(`rag-title-match.spec.ts` 4, `chat.service.memory.spec.ts` G1 문구 1), API 전체 219 suites / 2157 tests, widget build
- 배포 후 44문항 재측정(Round 3) 결과는 아래에 추가한다

## 재측정 Round 3 (2026-10-07 22:46 배포 후, 스테이징 대화 789)
| 지표 | 리포트 | Round 2 | **Round 3** |
|---|---|---|---|
| 지원 이메일 "▇▇▇" | 48/50 | 0 | **0/44** |
| 번호 치환·의역 | 40 | 0 | **0** |
| 꼬리말 정확히 1회 | — | 42/42 | **44/44** |
| 문장 절단 | 2 | 0 | **0** |
| 핸드오프(오판) | — | G1 | **0** |

| 문항 | 리포트 | Round 3 |
|---|---|---|
| **D3** Go2Joy 납부 계좌 | 불일치 | ✅ 계좌번호 19133261136016 · Techcombank Q5 · 수취인 정확, #3361 인용 |
| **E1** 앱 예약 고객 연락 | 일치(R2에서 미응답) | ✅ #3365 인용, Chờ nhận phòng 조건 포함 |
| **G1·G2** 로그인 실패·기술지원 연락 | 일치(R2에서 핸드오프) | ✅ 답변(핸드오프 없음) |
| C1·D4·A2·B3·E2 | 부분 | ✅ 핵심 사실 포함 |
| G3 사용 가이드 | 부분 | 개요만 — 공개 URL 미보유(데이터) |

## 배포
| 항목 | 상태 |
|---|---|
| PR | #608 `63b7d55` |
| 스테이징 | ✅ 2026-10-07 22:46 KST |
| 프로덕션 | ✅ 2026-10-07 22:56 KST — `production` ff `216549b..12aa2f3`, 부팅 정상(ERROR 0) |
