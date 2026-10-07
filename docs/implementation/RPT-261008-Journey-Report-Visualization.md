# RPT-261008 — 고객여정 리포트 시각화 P1

- 근거: REQ/PLN-261008-Journey-Report-Visualization (PR #620), TCR-261008-Journey-Report-Visualization
- 범위: PLN P1 (결함 정정 + 숫자 요약). **P2(JSON 구조화)·P3(여정 맵·인쇄)는 미착수.**

## 1. 무엇이 바뀌었나

| 구분 | 변경 | REQ |
|------|------|-----|
| 지표 | `aiMessages`/`humanMessages` 분리(`agentMessages`는 합계 유지), `avgLoops` 대화 0건 → null, `stages5a` | F6·F7·T10 |
| 5A 대응표 | `journey-stage-map.ts` — CJM 6단계 → 5A 고정 (Purchase·Delivery→act, Post→advocate 후보) | T10 |
| 값 상태 | `journey-value-state.ts` — measured / not_applicable / not_measured / not_observable, **매퍼가 읽을 때 계산**(과거 리포트에도 적용, 저장 안 함) | F1·D3 |
| 인용 잘림 | 샘플이 `quote_max_chars`에서 잘리면 `…` 부착 + 프롬프트 고지 | F2 |
| 프롬프트 | Aware/Appeal "상담 대화**만으로는**" 관측 불가, `stages5a` 이벤트 수 사용 | D5 |
| CJM Inquiry | 칩/시나리오 버튼(`ScenarioService`) + 릴레이 off 모드 저장(`MessengerIngestService`, 동의 GRANTED만) | F3·T11 |
| 콘솔 | 리포트 모달 상단 `JourneyReportSummaryView`(KPI 6·값 상태 칩·해결 상태 바·5A 띠), 본문 Markdown 렌더링(HTML 무력화), 제목 크기 축소 | P1 |
| i18n | `journey` 네임스페이스 summary/valueState/reason/fiveA × 6개 언어 | — |

## 2. 파일

- API: `domain/journey/{journey-metrics.service,journey-prompt,journey-report.service,journey.mapper}.ts`,
  신규 `journey-stage-map.ts`·`journey-value-state.ts`·`journey-value-state.spec.ts`,
  `domain/chat/scenario.service(.spec).ts`, `domain/messenger/messenger-ingest.service(.spec).ts`
- Web: `domain/journey/{JourneyReportModal.tsx,journey.service.ts}`, 신규 `domain/journey/report/JourneyReportSummaryView.tsx`,
  `i18n/locales/{en,es,ko,vi,ja,zh}/journey.json`
- SQL: 없음

## 3. 테스트

TCR-261008 참조 — 단위 U-1~U-17, 통합 I-1~I-6 통과. API jest 전체 통과, CI 통과, 로컬 실부팅 2회, 스테이징 실측(매퍼 변환·칩→Inquiry), 로컬 화면 육안.

## 4. 배포 상태

| 항목 | 값 |
|------|----|
| PR | #621 (기능, `23a3511`) · #622 (제목 크기 + TCR/RPT) |
| 마이그레이션 | 없음 |
| 스테이징 | #621 배포 2026-10-08 07:56 KST — boot `successfully started`, healthy, 신규 라우트 401. #622는 머지 후 재배포 |
| 프로덕션 | **미배포** (승인 대기) |

## 5. 운영 메모

- **통계 Inquiry 계단 상승**: 배포 시점부터 칩 탭·릴레이 off 방의 고객 발화가 Inquiry로 기록된다. 과소집계의 정정이며
  고객 행동 변화가 아니다. 과거 데이터 **소급(backfill) 안 함** — 리포트 #5~#7처럼 옛 세션을 다시 읽은 리포트는 Ask 0으로 남는다.
- 릴레이 off 방은 대부분 동의가 없어(안내를 보내지 않으므로) 실제 증가는 작을 것 — 채팅 경로와 같은 동의 규칙을 택했다.
- 스테이징 검증 흔적: 위젯 세션 15592(ivyusa, landing `/rpt-261008-p1-check`), 대화 798.
- 시안의 조치 "해결시간 계측 추가"는 오진이었다(해결 0건) — 화면이 이제 "해당 없음 / 해결된 대화 없음"으로 구분해 보여준다.

## 6. 다음

- P2: 리포트 JSON 구조화 + 코드 근거 검증 + 진단 본문·조치→할 일 (SQL 1건 `content_json`)
- P3: 여정 맵 탭 + 인쇄 스타일
