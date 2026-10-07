# PLN-261007 — AI 크레딧 부족 메일 알림 + 시스템 기본 엔진 전환 안내

- 근거: [REQ-261007-AI-Credit-Alert](../analysis/REQ-261007-AI-Credit-Alert.md)
- **스키마 변경 없음**(중복 억제는 Redis 키). **UI 변경: 문구·버튼 동작 1곳**(§3)
- 상태: **승인 대기**

## 1. 설계
```
gateway.recordHealth(engine, error)          runEngineTest(…) ─┐
   └ reason === 'credit' ───────────────┐                       │
                                         ▼                       ▼
                       AiCreditAlertService.onCredit(engineId, detail)   (비동기, 예외 삼킴)
                         ├ Redis SET NX ai:credit-alert:{engineId}  TTL 6h   ← 있으면 생략(중복 억제)
                         ├ 엔진·소유 테넌트·오늘 실패 수·(플랫폼이면) 영향 테넌트 조회
                         └ MailerService.send(to = AI_ALERT_EMAIL ?? dev@amoeba.group)

gateway.recordHealth(engine, null) — 성공
   └ Redis 키 ai:credit-alert:{engineId} 존재 → DEL + 복구 메일 1통
```
- Redis가 없으면 프로세스 메모리 Map으로 대체한다(재시작하면 1통 더 갈 수 있다 — 허용).

## 2. 단계
- **S1** `AiCreditAlertService`(`infrastructure/external/ai/`): `onCredit`, `onRecovered`, 중복 억제, 메일 본문 생성(순수 함수 `creditAlertMail`)
- **S2** 게이트웨이 `recordHealth`에 연결: 실패 사유가 `credit`이면 `onCredit`, 성공이면 `onRecovered`(키가 있을 때만 메일)
- **S3** 메일 본문(한국어, 운영자용):
  - 제목: `[SharpTalk {env}] AI 크레딧 부족 — {테넌트명|시스템 기본 엔진} · {엔진명}`
  - 본문: 환경, 엔진(이름·프로바이더/모델·소유), 최초 감지 시각, 오늘 실패 수, 프로바이더 오류 요약, 영향
    ("이 엔진을 쓰는 고객 응답은 상담원 연결로 전환되고 있습니다"),
    조치 —
    · 자체 법인 엔진: ① 콘솔 › 설정 › 기본 › AI 엔진 › **[시스템 기본 엔진으로 전환]** ② 또는 프로바이더 콘솔에서 충전
    · 시스템 기본/플랫폼 엔진: 플랫폼 키 충전(Anthropic Console › Plans & Billing), 영향 테넌트 목록
  - 복구 메일: `[SharpTalk {env}] AI 크레딧 복구 — …`, 장애 지속 시간
- **S4** 테넌트 카드 문구·버튼: "플랫폼 엔진으로 전환" → "**시스템 기본 엔진으로 전환**". 버튼은 플랫폼 기본 엔진(`isDefault`)을 바로 선택하고 적용 확인을 띄운다.
  기본 엔진을 선택할 수 없으면(`tenant_selectable` 꺼짐) "운영자에게 시스템 기본 엔진 선택 허용을 요청하세요"를 표시한다.
  테넌트 API 응답에 `isDefault`(플랫폼 기본 여부)를 추가한다.
- **S5** 테스트: 메일 본문(두 종류·복구), 중복 억제(6시간 내 2번째 생략, 복구 후 재발 시 재발송), 게이트웨이 연결, 메일 실패가 응답에 영향 없음

## 3. 와이어프레임 (테넌트 카드 상태 요약 — 바뀌는 줄만)
```
│ ⚠ 크레딧 부족 — 고객 응답이 처리되지 않고 있습니다                          │
│   사용 중: go2joy · 내 엔진 · anthropic / claude-opus-4-8                   │
│   프로바이더 계정을 충전하거나 시스템 기본 엔진으로 전환하세요.               │
│                                   [시스템 기본 엔진으로 전환]  ← 변경       │
│   (선택 불가 시) ⓘ 운영자에게 시스템 기본 엔진 선택 허용을 요청하세요        │
```

## 4. 영향
| 영역 | 영향 | 대응 |
|---|---|---|
| 응답 경로 | 메일 발송 | 비동기·예외 삼킴 |
| 메일 폭주 | 장애 중 호출마다 실패 | 엔진당 6시간 1통(Redis NX), 복구 후 재발은 새 장애로 취급 |
| 개인정보 | 메일 본문 | 키·대화 내용 미포함, 오류 요약은 마스킹본 |
| 스테이징·프로덕션 공통 수신 | 둘 다 dev@ | 제목에 환경 표기 |

## 5. 결정 필요
- **D1. 시스템 기본 엔진(스테이징 id 2)의 "테넌트 선택 허용"을 켤지** — 권장: **켠다.** 안내대로 테넌트가 전환하려면 필요하다.
  과금은 Amoeba 키다. 프로덕션은 엔진 키를 등록한 뒤 켠다.
- **D2. 재알림 간격** — 권장: 6시간
- **D3. 복구 메일** — 권장: 보낸다
