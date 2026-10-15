# TCR-261015 — SharpTalk for Go2Joy 1단계 D2·D3·D4·D5·D7 테스트 결과

> 근거: [PLN-261015](../plan/PLN-261015-SharpTalk-for-Go2Joy-Project-Plan.md) §6·§7 · 환경: 단위(jest) + 한국 스테이징 `go2joy`(tenant 4) 실측 2026-10-15

## 1. 단위 테스트
| 범위 | 파일 | 케이스 |
|---|---|---|
| D2 서명 속성 | `embed/embed.service.spec.ts` | 속성 함께 서명 저장 · id만 서명+속성=거절 · 값 변조 거절 · 허용 목록 밖 키 무시 · id 단독 서명 유지+이전 속성 제거 |
| D3 규칙 매칭 | `ai-engine/handoff-router.service.spec.ts` | 지역 AND 업무 · 지역 없는 업무 규칙 순서 · 대소문자 · 담당자 없는 규칙 건너뜀 · 미서명 세션 · deny 라벨 · 규칙 없음 / 라우트: 그룹+방식 · 불일치 폴백 · 근무시간 외 메일 우선 |
| D3 그룹 알람 | `agent/agent-alert.service.spec.ts` | least_loaded 1명 · 아무도 접속 없음→그룹 전원 · 동시상담 한도 · broadcast · 규칙 없음=기존 1행 · 확인 시 형제 행 확인 |
| D4 메일·재알림 | `agent/agent-alert-reminder.service.spec.ts` | 개인 주소 메일(호텔·지역·링크) · 전원 알림/주소 없음=운영 메일함 1회 · 대기 중 1회 재알림+리드 · 수락된 대화는 표시만 · reAlert 없는 테넌트 무동작 |
| D9 동의 | `embed/embed.service.spec.ts` | host_terms 서명 사용자 동의 기록(버전·시각) · widget 모드 불변 · 거부 유지 · 서명 실패 시 무동의 |
| D7 평가 | `agent/answer-rating.service.spec.ts` | 저장+갭 이벤트 · 재평가 교체·정확은 사유 제거 · 상담원 답변은 갭 없음 · 타 테넌트 404 · 고객 메시지 400 · 요약 집계 |

전체: API jest **2,263 tests 통과**, typecheck(api/web/widget)·i18n:check·radius:check 통과.

## 2. 스테이징 통합 시나리오 (실측)
| ID | 시나리오 | 결과 |
|---|---|---|
| IT-1 (EV-01) | 실제 embed_secret로 `userId+hotel_id/hotel_name/region/role` 서명 → identify | 201 verified, `sessions.identity_attributes` 저장 |
| IT-2 | id만 서명한 해시 + attributes | **401** E5048 + 서버 warn |
| IT-3 (D5) | 콘솔 목록·헤더 | "호텔: Test Hotel E2E · 북부 · 리셉션" 배지 (대화 835) |
| IT-4 (EV-05) | 규칙 `북부+e2e-d3 → 39(broadcast)`, 북부·남부 세션 각 이관 | 북부 836 → target 39 ×2행, 남부 837 → NULL(기존 전원) / 로그 `routed by rule E2E D3 north` |
| IT-5 (EV-06) | 규칙 `북부+e2e-d4 → 55(least_loaded)`, reAlert 1분 | 838 → target 55, 1분 30초 뒤 `reminded_at` 1회 기록, `alarm reminders sent for 1` |
| IT-6 (EV-10) | 위젯 대화 841 AI 답변을 부정확·최신 아님 평가 | PUT 200, 고객 메시지 평가 400, 상세에 rating, 지식 갭 #112(`answer_rating`) 생성, 요약 ai.inaccurate=1·outdated=1, 콘솔 말풍선·통계 탭 표시 |
| IT-8 (D9) | go2joy 임시 host_terms: 미서명 ensure / 서명 identify / 잘못된 서명 | pending / **granted v2026-07 + consentAt** / 401 — 로그 `consent via host terms`, 설정 widget 원복 |
| IT-7 | 회귀: 위젯 동일 질문(노쇼 신고) | 배포 후에도 VI 답변+Video 22 출처 정상 |

## 3. 엣지·관찰
- go2joy 스테이징 테넌트 `default_language`·`timezone` = NULL → locale 없는 세션은 EN → 베트남어 질문이 영어 답변/이관(대화 835·839·840). **D8에서 `vi`·`Asia/Ho_Chi_Minh` 설정 필요**(Go2Joy 동의 후).
- 테스트 정리: 규칙·reAlert는 `handoff_config=NULL`로 원복, 알람 확인 처리, 대화 835~841 종료, 테스트 이슈 #20~#24 반려, 평가·갭 #112 삭제.
