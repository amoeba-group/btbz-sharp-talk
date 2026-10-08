# RPT-261008 — 고객여정 리포트 시각화 P1·P2

- 근거: REQ/PLN-261008-Journey-Report-Visualization (PR #620), TCR-261008-Journey-Report-Visualization
- 범위: PLN P1 (결함 정정 + 숫자 요약) · P2 (JSON 구조화 + 코드 근거 검증 + 진단 본문). **P3(여정 맵·인쇄)는 미착수.**

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
| 프로덕션 | ✅ 2026-10-08 09:12 KST — 백업 `~/backups/sharptalk-production/20261008-0911` → `kb_documents.video_ref` 선적용(동반 배포된 #618/#619 몫) → `production` ff `55a181e..34066ca` → `check-migrations` OK → `deploy-self-hosted.sh`. API healthy, ERROR 0, `/journey/reports/1` 401, `/kb-videos/1` 앱 응답 |

## 5. 운영 메모

- **통계 Inquiry 계단 상승**: 배포 시점부터 칩 탭·릴레이 off 방의 고객 발화가 Inquiry로 기록된다. 과소집계의 정정이며
  고객 행동 변화가 아니다. 과거 데이터 **소급(backfill) 안 함** — 리포트 #5~#7처럼 옛 세션을 다시 읽은 리포트는 Ask 0으로 남는다.
- 릴레이 off 방은 대부분 동의가 없어(안내를 보내지 않으므로) 실제 증가는 작을 것 — 채팅 경로와 같은 동의 규칙을 택했다.
- 스테이징 검증 흔적: 위젯 세션 15592(ivyusa, landing `/rpt-261008-p1-check`), 대화 798.
- 시안의 조치 "해결시간 계측 추가"는 오진이었다(해결 0건) — 화면이 이제 "해당 없음 / 해결된 대화 없음"으로 구분해 보여준다.

## 6. P2 — 리포트 구조화 (PR #624 + 후속 #625·#626·#627)

| 구분 | 변경 |
|------|------|
| 데이터 | `journey_reports.content_json` (`sql/261008-journey-report-content.sql`, init-sql·artefacts 갱신) |
| 생성 | 모델은 JSON, 인용은 샘플 번호로만 지목 → 코드가 원문으로 덮어씀·없는 근거 제거(개수 표시)·질문 반복 횟수 재계산. 2회 실패 → Markdown 폴백. JSON 호출 maxTokens 6000 |
| 모더레이션 | 텍스트 필드 전체를 구분자로 묶어 1회, 구분자 깨지면 필드별, 하나라도 차단 → 리포트 실패 |
| 프롬프트(실측 반영) | VALUE STATES 전달(#625) · 잘린 샘플 줄 표시 + 해결 집계 규칙 블록(#626) · 질문=고객이 물은 것, 상태명 노출 금지(#627) |
| 콘솔 | 헤드라인 → 질문과 인용 → 가설 카드 → 데이터 품질 플래그 → 조치(긴급도·할 일로 추가·추가됨) → 원문 보기(접힘) |

**스테이징 실모델 실측 (go2joy 그룹 9, claude-opus-4-8)**

| 리포트 | 반영 | 결과 |
|--------|------|------|
| #8 | #624 | 구조화 1회 성공, dropped 0, 인용 원문·잘림 표시·반복 2회 정확. 결함: "no resolution time was **measured**"(F1 재발), 리포트 자체 샘플 컷을 품질 플래그로 |
| #9 | #625 | "nothing was resolved"로 교정. 잔여: 샘플 컷을 고객이 받은 잘린 답으로 오인→조치 제안, "집계 규칙 미제공" 플래그(8월부터 규칙을 준 적 없음) |
| #10 | #626 | 컷 관련 플래그·조치 소멸, 규칙 원문 인쇄, **"5A ask 이벤트 0 — 문의 단계 기록 누락 의심"을 모델이 스스로 플래그**(F3와 일치). 잔여: 질문 칸에 분석 질문, 상태명 `not_applicable` 노출 → #627 |

토큰: 1회 입력 2,053 / 출력 2,032(그룹 2세션 기준).

**배포**: 스테이징 SQL 선적용(2026-10-08) 후 #624~#626 배포·부팅 정상. #627은 머지 후 배포. **프로덕션 미배포**(SQL 선적용 필요).

## 7. 다음

- P2 프로덕션: `content_json` 선적용 → production ff → 배포
- P3: 여정 맵 탭 + 인쇄 스타일
