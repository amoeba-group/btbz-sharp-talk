# TCR-261008 — 고객여정 리포트 시각화 P1·P2

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

## 5. P2 — 구조화 리포트

| ID | 대상 | 케이스 | 기대 | 결과 |
|----|------|--------|------|------|
| P2-U1 | `groundContent` | 모델이 바꿔 쓴 인용 | 샘플 원문으로 덮어씀 | ✅ |
| P2-U2 | `groundContent` | 없는 샘플 번호·근거 없는 가설 | 제거, `dropped`=2 | ✅ |
| P2-U3 | `groundContent` | 질문 count 40(모델) | 샘플 내 같은 문장 2로 재계산 | ✅ |
| P2-U4 | `groundContent` | 인용 없는 질문 | count null | ✅ |
| P2-U5 | `groundContent` | 5A 외 단계·제목 없는 조치·테넌트 섹션 외 narrative | 제거 | ✅ |
| P2-U6 | `groundContent` | top-N 3 | 질문 3개로 절단 | ✅ |
| P2-U7 | `groundContent`/`extractJson` | headline 없음·JSON 아님·코드펜스 | null / null / 파싱 | ✅ |
| P2-U8 | `contentTexts`↔`withContentTexts` | 왕복 | 같은 필드에 되돌림, 빈 값 null 유지 | ✅ |
| P2-U9 | `contentToMarkdown` | KO | 한국어 제목, 인용 출처 | ✅ |
| P2-U10 | 서비스 | 정상 JSON 1회 | content 저장, body 직렬화, AI 1회, maxTokens 6000 | ✅ |
| P2-U11 | 서비스 | JSON 2회 실패 | 3번째 Markdown 호출, content null, ready | ✅ |
| P2-U12 | 서비스 | 모더레이션 BLOCKED | failed / blocked by moderation | ✅ |
| P2-U13 | 서비스 | 마스킹(구분자 유지) | 1회 호출, 해당 필드에만 반영 | ✅ |
| P2-U14 | 서비스 | rephrase(구분자 소실) | 필드별 재검사 | ✅ |
| P2-U15 | 프롬프트 | JSON 형식 | 샘플 #번호, 참조 인용 규칙, 질문=고객 질문 | ✅ |
| P2-U16 | 프롬프트 | VALUE STATES·잘린 줄 표시·RESOLUTION_RULE | 포함, 사유 6종 전부 명시 | ✅ |

| ID | 통합 시나리오 | 결과 |
|----|---------------|------|
| P2-I1 | 로컬 SQL 적용 + 실부팅 | ✅ |
| P2-I2 | 스테이징 SQL 선적용 → 배포 → 부팅 | ✅ |
| P2-I3 | 스테이징 실모델 생성 #8·#9·#10 (RPT §6 표) | ✅ 3회 모두 구조화 성공, dropped 0 |
| P2-I4 | 콘솔 진단 본문 육안(로컬, #10 복제): 헤드라인·질문·인용·가설 카드·플래그·조치 | ✅ |
| P2-I5 | [할 일로 추가] 클릭 → 토스트 "다음 행동을 추가했습니다." + 버튼 "추가됨" 비활성 | ✅ |
| P2-I6 | API jest 전체 225 suites / 2,223 tests, CI | ✅ |

미수행: 스텁 엔진 테넌트에서 Markdown 폴백 실측(단위 P2-U11로 대체), 큰 그룹(수백 메시지) 토큰 실측.
