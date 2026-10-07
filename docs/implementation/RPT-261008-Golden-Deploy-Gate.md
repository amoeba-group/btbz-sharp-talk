# RPT-261008 — 배포 후 FAQ 회귀 자동 채점 게이트

- [PLN-261008-Golden-Deploy-Gate](../plan/PLN-261008-Golden-Deploy-Gate.md)(승인: D1 실패 ≥1이면 실패 · D2 CLI 스케줄러 차단 · D3 go2joy만)

## 1. 변경 (PR #616 `55a181e`)
| 항목 | 내용 |
|---|---|
| CLI | `database/golden-gate.ts`, `npm run golden:gate` — `GOLDEN_GATE=tenant:agent[,…]` 대상의 채점 세트를 실행하고 직전 실행과 비교. 실패 ≥1 또는 회귀가 있으면 `AI_ALERT_EMAIL ?? dev@amoeba.group`으로 메일. 비어 있으면 즉시 종료 |
| 배포 스크립트 | `deploy-staging.sh` — `GOLDEN_GATE` 설정 시 API `healthy`를 기다린 뒤 컨테이너 안에서 **백그라운드** 실행(`/tmp/golden-gate.log`). 롤백 없음, 종료 코드 변경 없음 |
| CLI 스케줄러 차단 | `SHARPTALK_CLI`(`isCliContext`) — CLI 진입점(kb-reindex·kb-import·verify-*·golden-gate)이 설정하고, **스케줄러 13곳**이 CLI에서는 시작하지 않는다 |
| PLN 대비 | D2는 "커머스 동기화 6곳"이었다. 점검하다 **메신저 발송(outbox)·유휴 대화 안내·메신저 수신·푸시·지식 갭·보존·질문 통계**도 CLI에서 중복 실행된다는 것을 발견해 같은 한 줄 가드로 함께 막았다. 고객 메시지가 두 번 나갈 수 있는 경로라 범위를 넓혔다 |
| 설정 | env 템플릿 4종 `GOLDEN_GATE=`, env 점검기에서 내부 변수 제외 |

## 2. 검증
- 단위 신규 5건, API 222 suites / 2176 tests, 로컬 실부팅(서버 스케줄러 9개 정상 시작), 게이트 미설정 시 즉시 종료
- **스테이징 실측**: `.env.staging`에 `GOLDEN_GATE=4:10` 추가(백업 `.env.staging.bak-261008-gate`). go2joy A1에 **일부러 답에 없는 사실**(`GATE-TEST-NOT-IN-ANSWER`)을 임시로 넣고 배포
  → 배포 스크립트가 게이트를 백그라운드로 시작 → 실행 #11 "deploy gate 55a181ed": **통과 40 · 실패 1**(바로 그 사실) · **회귀 1**(A1 통과→실패) → **알림 메일 발송됨**
  → 게이트 로그에 스케줄러 실행 흔적 없음(중복 차단 확인), 프로세스 자동 종료
  → 테스트 사실 원복(A1 = `bit.ly/3YZ8egt`)
- 같은 실행에서 I2(날짜 서식 정정분)는 통과 → 테스트 사실을 빼면 41/41 통과에 해당한다

## 3. 배포
| 항목 | 상태 |
|---|---|
| 스키마 | 변경 없음 |
| 스테이징 | ✅ 2026-10-08 00:50 KST, 게이트 ON(`GOLDEN_GATE=4:10`) |
| 프로덕션 | ✅ 2026-10-08 01:02 KST — `production` ff `7ae5c16..55a181e`, 부팅 정상(ERROR 0, 스케줄러 정상). 게이트는 미연결(PLN: 프로덕션 키 등록 후 결정) |

## 4. 운영 메모
- 스테이징 배포마다 go2joy 44문항(약 8~10분, AI 호출 44×2)이 자동으로 돈다. 끄려면 `.env.staging`의 `GOLDEN_GATE` 줄을 지우거나 비운다
- 결과 확인: `docker exec sharptalk_api_staging cat /tmp/golden-gate.log` 또는 콘솔 › AI 설정 › 회귀 검증
