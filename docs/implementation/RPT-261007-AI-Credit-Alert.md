# RPT-261007 — AI 크레딧 부족 메일 알림 + 시스템 기본 엔진 전환 안내

- [REQ](../analysis/REQ-261007-AI-Credit-Alert.md) · [PLN](../plan/PLN-261007-AI-Credit-Alert.md)(2026-10-07 승인, D1~D3 권장안)

## 1. 변경 (PR #601 `5c58797`)
| 단계 | 내용 |
|---|---|
| S1 | `AiCreditAlertService` — 크레딧 부족 시 `AI_ALERT_EMAIL ?? dev@amoeba.group` 메일. 자체 법인 엔진(전환·충전 안내)과 시스템 기본/플랫폼 엔진(충전·영향 테넌트) 두 종류. 엔진당 6시간 1통(Redis `SET NX EX`, Redis 다운 시 메모리), 복구 시 1통 |
| S2 | 게이트웨이 `recordHealth`: 실패 사유 `credit` → `onCredit`, 기록된 성공 → `onRecovered`(알림이 있었을 때만 메일). 비동기, 예외 삼킴 |
| S3 | 메일 본문(한국어): 환경·엔진·소유·감지 시각·오늘 실패 수·프로바이더 사유(마스킹본)·영향·조치. 키·대화 내용 미포함 |
| S4 | 테넌트 카드 [시스템 기본 엔진으로 전환] = 플랫폼 기본 엔진을 확인 후 즉시 적용. 선택 불가면 "운영자에게 선택 허용 요청" 안내. 6개 언어 |
| 부수 | `RedisService.setIfAbsent`, env 템플릿 4종에 `AI_ALERT_EMAIL` 추가, `scripts/env-inventory.mjs`가 `envNumber('X')`를 인식(FIX-260930 이후 16개 키 오탐 해소) |

## 2. 운영 조치 (같은 날, 사용자 지시)
- **ivyusa 스테이징 KB 삭제**: `한국배송`(2097)·`아시아 배송`(2345)을 콘솔 API로 삭제(Qdrant 포함). "Do you ship to Canada?" → `2.1.4` 근거 "배송 불가"로 정상 응답(콘솔·위젯 모두 확인)
- **스테이징 시스템 기본 엔진**: `Built-in Stub` → `Anthropic Claude`(id 2)로 바꿨다(SQL, 어드민 MFA 때문). 엔진 미지정 테넌트 6곳도 Claude로 응답하고, 과금은 운영자 키다
- **D1**: 스테이징 id 2 `tenant_selectable=1` — 테넌트가 [시스템 기본 엔진으로 전환]을 쓸 수 있다
- 프로덕션: 시스템 기본 엔진은 여전히 Stub이고, Anthropic 엔진에는 키가 없다(P3). 키 등록 후 기본 엔진 지정과 선택 허용을 같은 방식으로 적용해야 한다

## 3. 테스트
- 신규 9건, API 전체 215 suites / 2131 tests, api/web build, i18n:check, 로컬 실부팅(DI) 통과
- **메일 발송 실측(스테이징 컨테이너)**: 동일 템플릿(go2joy 사례)과 동일 SMTP로 `[테스트]` 1통 발송 → `accepted: dev@amoeba.group`.
  실제 크레딧 부족은 재현할 수 없어 자동 트리거 경로는 단위 테스트로 검증했다

## 4. 배포 상태
| 항목 | 상태 |
|---|---|
| 스키마 | 변경 없음 |
| 스테이징 | ✅ 2026-10-07 15:09 KST, 부팅 정상, DI 오류 0 |
| 프로덕션 | ✅ 2026-10-07 15:11 KST, `production` ff `2d08835..5c58797`, `check-migrations` OK, 부팅 정상(ERROR 0) |
