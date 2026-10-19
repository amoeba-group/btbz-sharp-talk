# RPT-261019 — 만족도 3문항 설문 · AI 고지 하단 배치 — 구현·스테이징 결과

- 근거: [REQ](../analysis/REQ-261019-Csat-Survey-Disclosure.md) · [PLN](../plan/PLN-261019-Csat-Survey-Disclosure.md)(2026-10-19 "진행"으로 승인, 권장안 D1ⓑ·D2·D3·D4·D5·D6) · [TCR](../test/TCR-261019-Csat-Survey-Disclosure.md)
- 캡처: `docs/log/2026-10-19/staging-csat-*.{jpg,png}`

## 1. 배포 상태
| 항목 | 값 |
|---|---|
| PR | **#658** `feat(csat): 만족도 3문항 설문 + AI 고지 하단 배치` — squash merge, main **`684811d`** (REQ/PLN docs #652 선행) |
| CI | 통과(API jest 2,282 / types / widget / build) |
| **마이그레이션** | `sql/261019-conv-csat-survey.sql` — 스테이징 **선적용 2026-10-19 12:40(KST)**(`conversations` 3열, `tenants` 2열 확인) → 코드 배포. 프로덕션 미적용(배포 시 선적용 필요). 매니페스트 `sql/artefacts.tsv` 갱신 |
| 스테이징 | 2026-10-19 12:45(KST) `deploy-staging.sh` — `Nest application successfully started` |
| go2joy 설정(P5) | 테넌트 4 `csat_mode = survey`, 디자인 #7 `disclosurePlacement = bottom`(SQL, 감사 로그 없음). `terms_url`은 Go2Joy 제공 대기 → 하단 줄에 링크 없음 |

## 2. 변경 내용
| 영역 | 내용 |
|---|---|
| 스키마 | `conversations.csat_resolved tinyint(1) NULL · csat_reason varchar(32) NULL · csat_comment varchar(80) NULL`; `tenants.terms_url varchar(512) NULL · csat_mode varchar(8) NOT NULL DEFAULT 'rating'` |
| types | `common/csat.ts`(`CSAT_MODE`·`CSAT_REASON` 5종·`CSAT_REASON_MAX_RATING=2`·`CSAT_COMMENT_MAX_CHARS=50`), `WidgetDesign.disclosurePlacement`, `SessionResponse.csatMode/termsUrl` |
| API | `POST /chat/csat` 선택 필드(사유는 2점 이하만, 코멘트는 other만 + `scrubPii`) · `classifyOutcome`: 설문 "미해결" → `customer_unresolved`(별점 모드는 현행) — 대시보드·여정·통계 공용 · 세션 `csatMode/termsUrl` · 위젯 설정 `csat_mode` · 개인정보 안내 `terms_url` · 만족도 통계 행/요약 확장 · 여정 리포트 해결 규칙 문장 |
| 위젯 | `CsatCard` 설문 모드(Q1 라디오 → 이모지 세그먼트+라벨 → 2점 이하면 사유 4종+기타 50자 카운터 → 제출), 별점 모드 무변화 · 고지 하단 줄(`aiDisclosureShort` + 약관 링크 + 상담 종료) · 6언어 |
| 콘솔 | 위젯 동작 카드 "만족도 카드" 라디오 · 개인정보 안내 "이용약관 URL" · 편집기 "AI 고지 위치" · 통계 › 만족도 열 3개 + 카드 2개(설문 응답 있을 때) · 해결 사유 라벨 `customer_unresolved` 6언어(statistics·journey) |
| 매뉴얼 | 05 2.1 표 "AI 고지 위치" 행 ko/en/vi |

## 3. 실측 (TCR 대응)
| ID | 결과 |
|---|---|
| U1~U11 | 자동 통과(API 2,282 / types 35) |
| I1 | SQL 선적용 → 부팅 정상 ✓ |
| I2 | `csatMode: survey`, `termsUrl: null`, `disclosurePlacement: bottom` ✓ |
| I3 | 상단 바 없음, 하단 "AI-generated replies · processed in the United States", 상담 중 "End chat" 링크 ✓ (`staging-csat-disclosure-bottom.jpg`) |
| I4~I6 | 테스트 대화 1건(852)을 DB에서 종료 처리 → 설문 카드 → "Not yet resolved" + 1점("Very unhappy") + 사유 "Other reason" + 코멘트 "Goi toi 0908754789 nhe" → 제출 201 → DB `csat_rating 1 · csat_resolved 0 · csat_reason other · csat_comment "Goi toi [PHONE] nhe"` ✓ (`staging-csat-survey-other-reason.png`) |
| I7·I8·I9·I10·I11 | 코드·단위 테스트로 확인, 화면 미실측(콘솔 로그인 미진행, 다른 테넌트 미확인) |
| E6 | 전화번호 마스킹 실측 ✓ |

## 4. 관찰
| # | 내용 | 처리 |
|---|---|---|
| O1 | 제출 직후 카드가 "감사합니다" 상태를 보이지 않고 사라짐 — `useChat.rate()`가 `canRate=false`로 바꿔 카드가 언마운트(별점 모드도 동일한 **기존 동작**) | 원하면 후속: 제출 상태 유지 후 N초 뒤 제거 |
| O2 | 종료된 대화 아래 "Connect to an agent" 버튼이 남음(기존 폴백 액션) | 기존 동작, 범위 밖 |
| O3 | 테스트로 go2joy 대화 1건·AI 호출 1회 생성(852), 상담원 큐는 DB 종료 처리로 회피 | 데이터 정리 불필요(테스트 표식 없음 → 통계 1건 영향) |
| O4 | 신 위젯 → 구 API 순서로 배포하면 설문 필드가 400이 될 수 있음 | 이번엔 API·위젯 동시 배포라 무관, 프로덕션도 동일 스크립트 |

## 5. 남은 일
- **Go2Joy**: 약관 URL(설정 › 개인정보 안내 › 이용약관 URL) — 받으면 하단 줄에 링크가 붙음. 사유 라벨 VI 문구 검수.
- 프로덕션(go2joy 테넌트 생성 시): SQL 선적용 → 배포 → 설정.
- O1 결정(제출 후 감사 문구 유지).
- 해결률 영향: 스테이징 go2joy는 설문 응답 1건(미해결)뿐이라 수치 변화 미미. 운영 후 통계 › 해결 렌즈의 `customer_unresolved` 비율로 추적.
