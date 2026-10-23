# RPT-261024 — 알람센터 · 배정 상담원 표시 · 알람 설정 · 배정 시뮬레이터 (+ FIX 상담카테고리 카드)

- REQ: `docs/analysis/REQ-261024-Alarm-Center-Assignee-Region-Routing.md`
- PLN: `docs/plan/PLN-261024-Alarm-Center-Assignee-Region-Routing.md` (D1~D7 권장안 승인)
- TCR: `docs/test/TCR-261024-Alarm-Center-Assignee-Region-Routing.md`
- 같은 요청에서 처리한 결함: `docs/bug-fix/FIX-261024-Widget-Consult-Category-Card-Not-Shown.md` (#731)

## 1. 변경 내용

| 항목 | 결과 |
|---|---|
| 알람 표시(D1) | 상담원별 행을 `event_key`로 묶어 하나의 알람으로 보인다. 표시: 배정자(이름 / "전체(맞는 규칙 없음)" / "○○ 외 n명"), 규칙, 상담카테고리, 호텔·권역. 테넌트 상담원 모두에게 노출 |
| 닫기와 확인(D2) | 닫기 = 본인만 읽음(`agent_alert_reads`). 확인(재알림 중지) = 배정자 또는 전원 대상 알람만. 다른 사람의 닫기로 배정자 알람이 꺼지지 않음 |
| 알람센터(D3) | 헤더 🔔(안 읽은 수) + 드로어(최근 20건) + `/live-chat/alerts`(범위·상태·기간·상담카테고리 필터, 확인 처리, 대화 이동). 실시간 상담 메뉴 권한 공유 |
| 개인 설정(D4) | 팝업(모든 알람 / 내 배정만(전원 대상 포함) / 끄기), 소리(Web Audio 합성음, 들어보기), 데스크톱 알림(권한 요청·차단 안내), 내 배정 메일(끄면 개인 메일만 생략, 운영 메일함은 유지) |
| 시뮬레이터(D6) | `POST /ai-config/routing/simulate`. 편집 중 규칙 + 상담카테고리·권역·성·언어 → 맞는 규칙·대상·건너뛴 이유. 라우터와 같은 `ruleVerdict`·그룹 해석을 쓰고 알림은 보내지 않음 |
| 규칙 경고(D7) | 업무 라벨 오용(정책 규칙 전용), 지역명 규칙에 권역·성 조건 없음, 활성 0명(초대 수락 전 n명) |

## 2. 파일
- **SQL**: `sql/261024-alarm-center.sql`, `sql/artefacts.tsv`
- **API**
  - `agent/entity/agent-alert.entity.ts`(+3 컬럼), `agent-alert-read.entity.ts`·`user-alert-settings.entity.ts`(신규)
  - `agent/alert-center.service.ts`(+spec, 신규)
  - `agent/agent-alert.service.ts`(event_key·규칙 저장, 메일 설정, `canAckAlarm`)(+spec)
  - `agent/agent-console.controller.ts`(alerts, center, settings, read, ack), `agent.module.ts`, `dto/request/agent.request.ts`
  - `ai-engine/handoff-router.service.ts`(`ruleVerdict`, `simulate`)(+spec), `ai-config.controller.ts`, `dto/request/ai-config.request.ts`
- **Web**
  - `domain/alerts/*`(신규: service, hooks, AlarmBell, AlertsPage, AlertSettingsModal, alarm-signal, alarm-format)
  - `live-chat/EscalationAlarm.tsx`(재작성), `live-chat.service.ts`, `live-chat.hooks.ts`
  - `ai-settings/RoutingSimulator.tsx`(신규), `RoutingRulesEditor.tsx`(`routingRowsToRules` 공유, 경고), `HandoffSection.tsx`, `ai-settings.service.ts`
  - `layouts/Header.tsx`, `router/AppRouter.tsx`, i18n `livechat`·`aiSetting` ×6

## 3. 테스트
- api jest 259 suites / 2,609 tests 통과(신규 11건)
- api·web tsc, i18n:check, radius:check, CI 통과
- 로컬 실 HTTP 9개 시나리오, 화면 8항목(TCR)
- 실측 중 수정
  - 설정 재저장 500(BIGINT PK `save()` → `upsert`)
  - 시뮬레이터에서 초대 사용자 이름 표시

## 4. 배포

| 환경 | SQL | 코드 | 확인 |
|---|---|---|---|
| 스테이징 | 10/24 04:16 적용. 백업 `~/backups/staging/20261024-0416-pre-alarm-center.sql`. 컬럼·테이블 생성 확인 | `8170695e` ff, `deploy-staging.sh` | `successfully started`, ERROR 0, center·settings·simulate 401, health 200 |
| 프로덕션 | 적용. 백업 `~/backups/sharptalk-production/20261024-0218-pre-alarm-center.sql.gz`(로컬 시각 기준 파일명) | `production` 1b97224a..8170695e, `deploy-self-hosted.sh` | `successfully started`, ERROR 0, center 401, health 200 |

- PR #732(squash `8170695e`). 결함 수정 #731(`1b97224a`)은 앞서 스테이징·프로덕션 배포함.
- 롤백: 코드를 되돌린 뒤 SQL 파일 하단의 DROP 문.

## 5. go2joy 스테이징 — ADMIN123(남부 호텔)이 남부 상담원에게 가려면 (운영 설정)
현재 규칙(10/24 조회)은 다음 이유로 남부 호텔을 남부 상담원에게 보내지 못한다. 설정 › 상담원 연결의 **배정 확인**에 "Customer Services · 남부"를 넣으면 같은 진단이 나온다.

| 현재 | 문제 | 고칠 것 |
|---|---|---|
| BS_North_SA: 상담카테고리 bs, 업무 라벨 **sa**, 그룹 North × sa | 업무 라벨은 정책(deny) 인계에만 맞아 이 규칙은 영원히 안 맞음(경고 표시됨) | 업무 줄의 sa 해제. 담당자 › 라벨에서 sa 선택. 고객 정보 › 권역 북부·중북부 추가 |
| CS_North_CS: cs, 그룹 North × cs, 조건 없음 | 남부 호텔도 North 팀으로 감(경고 표시됨) | 고객 정보 › 권역 북부·중북부 추가 |
| (없음) | 남부 규칙 없음 | 새 규칙 CS_South: cs + 권역 남부·중남부 → 팀 South × 라벨 cs (BS도 같은 방식) |
| South·South Center 팀원 4명 `invited` | 배정 대상 아님(활성 0명 → 규칙 건너뜀) | 초대 수락(첫 로그인) 필요. 그 전에는 경고에 "초대 수락 전 n명" 표시 |
