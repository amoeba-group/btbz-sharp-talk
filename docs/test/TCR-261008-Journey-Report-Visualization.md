# TCR-261008 — 고객여정 리포트 시각화 P1

- 근거: PLN-261008-Journey-Report-Visualization §4 (P1 범위), REQ-261008 F1~F8
- 대상 PR: #621 (+ 후속 #622 제목 크기·문서)

## 1. 단위 테스트

| ID | 대상 | 케이스 | 기대 | 결과 |
|----|------|--------|------|------|
| U-1 | `toFiveA` | 6단계 전부 입력 | Awareness→aware, Browse→appeal, Inquiry→ask, Purchase+Delivery→act(합산), Post→advocate | ✅ |
| U-2 | `toFiveA` | 미지 단계 `Mystery` | 5칸 모두 0, 임의 매핑 없음 | ✅ |
| U-3 | `metricStates` | 해결 0건 + 중앙값 null | `not_applicable` (F1 — "미측정" 아님) | ✅ |
| U-4 | `metricStates` | 해결 2건 + 중앙값 null(ended_at 없음) | `not_measured` | ✅ |
| U-5 | `metricStates` | 중앙값 존재 | `measured` | ✅ |
| U-6 | `metricStates` | 대화 0건 | avgLoops·resolutionRate `not_applicable`, conversations `measured` | ✅ |
| U-7 | `metricStates` | Aware 2·Appeal 0·Ask 0·Act 0 | aware `measured`, appeal `not_observable`, ask/act `measured`(0은 개수) | ✅ |
| U-8 | `metricStates` | metrics null | 예외 없이 `not_applicable` | ✅ |
| U-9 | `clip` | 278자/200자 제한, 짧은 문장 | 200자+`…` / 원문 그대로 (F2) | ✅ |
| U-10 | `buildJourneyPrompt` | system 프롬프트 | 잘림 표시 의미 + `METRICS.stages5a` 언급 포함 | ✅ |
| U-11 | `JourneyMapper.toReport(…, true)` | 5A·상태 이전에 쓰인 metrics | `stages5a` 파생, `metricStates` 부여 | ✅ |
| U-12 | `JourneyMapper.toReport(…)` | 목록 | metrics 미포함(가벼운 목록 유지) | ✅ |
| U-13 | `ScenarioService.handle` | 동의 GRANTED + `shipping_policy` 칩 | CJM `Inquiry / scenario_button / {action}` 발행 (F3) | ✅ |
| U-14 | `ScenarioService.handle` | 동의 PENDING/DECLINED | 발행 없음 | ✅ |
| U-15 | `MessengerIngestService` | 릴레이 off 모드 + 동의 granted | CJM `Inquiry / relay_message` 발행 | ✅ |
| U-16 | `MessengerIngestService` | off 모드 + 동의 pending | 발행 없음, 메시지는 저장 | ✅ |
| U-17 | `MessengerIngestService` | auto 모드 | 인제스트는 발행 안 함(채팅 파이프라인이 발행 — 중복 방지) | ✅ |

실행: API jest 전체 **224 suites / 2,202 tests 통과**(릴레이 스펙 3건 추가 전 기준), 이후 messenger·chat/scenario·journey 248 tests 통과, CI `typecheck · test · build` 통과.

## 2. 통합 / 실측 시나리오

| ID | 시나리오 | 기대 | 결과 |
|----|----------|------|------|
| I-1 | 로컬 API 실부팅(DI 변경: `@Optional() EventBusService` 2곳) | `Nest application successfully started` | ✅ 2회 |
| I-2 | 스테이징 배포 후 API | boot log `successfully started`, 컨테이너 healthy, `/journey/reports/7` → 401 | ✅ |
| I-3 | 스테이징 배포 코드의 매퍼로 리포트 #7 실 metrics 변환 | 해결 중앙값 `not_applicable`, appeal `not_observable`, `stages5a` aware 2 | ✅ |
| I-4 | 스테이징 위젯 API: 세션 생성 → 동의 → `shipping_policy` 칩 | cjm_events에 `Awareness/session_start` + `Inquiry/scenario_button` | ✅ 세션 15592 |
| I-5 | 콘솔 리포트 모달(로컬, 스테이징 #7 metrics·본문 복사) | KPI 6개, 해결률 경고색, "해당 없음" 칩, 해결 상태 바 "열림 2", 5A 띠, Markdown 렌더 | ✅ 육안 |
| I-6 | 구 metrics(AI/사람 분리 없음) | 메시지 타일 "고객 2 · 상담 3"(레거시 표기) | ✅ |

## 3. 엣지 케이스

| ID | 케이스 | 처리 |
|----|--------|------|
| E-1 | 본문에 `<img onerror>` 등 HTML(고객 발화 인용 경유) | `<`를 `&lt;`로 치환해 텍스트로 표시 — preview가 rehype-raw를 항상 켜기 때문 |
| E-2 | 실패 리포트 | 요약 미표시, 오류 문구만(현행) |
| E-3 | metrics 없는 리포트(pending 중 열람) | 요약 미표시, 본문만 |
| E-4 | 과거 리포트 Ask 0 | 이벤트가 당시 기록되지 않았으므로 0 그대로 — **소급(backfill) 안 함**, RPT에 명시 |
| E-5 | `i18n:check` | 6개 언어 complete |

## 4. 미수행

- 스테이징 콘솔 실화면 육안(테넌트 4 go2joy 콘솔 계정 없음 — 동일 데이터 로컬 재현으로 대체)
- 좁은 화면(<640px) 육안 — 그리드 2열 전환은 코드로만 확인
