# RPT-261015 — SharpTalk for Go2Joy 1단계 아메바 개발분 (D2·D3·D4·D5·D7)

> 계획: [PLN-261015](../plan/PLN-261015-SharpTalk-for-Go2Joy-Project-Plan.md) (10/15 승인, 1단계 10/31 완료) · 테스트: [TCR-261015](../test/TCR-261015-Go2Joy-Phase1-D2-D7.md)

## 1. 변경 요약
| 항목 | 내용 | PR | main |
|---|---|---|---|
| 계획서 | PLN-261015 + 실화면 9장, 일정 10/31 | #636 | c96fb47 |
| D2·D5 | identify `attributes` 서명(`userId\nkey=value…`), `sessions.identity_attributes`, 콘솔 호텔·지역·권한 배지, 임베드 가이드 §3.4 | #637 | a7654e1 |
| D3 | `handoff_config.routingRules` 지역×키워드×라벨, least_loaded/broadcast, 그룹 알람(상담원별 행, 형제 확인), 설정 편집기, 폼 밖 필드 보존 | #638 | 7126313 |
| D4 | 담당자 개인 메일(호텔·지역·링크), `reAlert{afterMinutes, escalateToUserIds}` 1분 주기 재알림, `agent_alerts.reminded_at`, 편집기 보정 | #639 | a9311b4 |
| D7 | `answer_ratings` + 평가 API·말풍선 UI, 부정확 AI 답변→지식 갭(`answer_rating`), 통계 '답변 정확도' 탭, **init-sql 재생성**(09-13 이후 누락분) | #640 | 1b8f01e |

## 2. 주요 파일
- API: `embed/identity-attributes.ts`, `embed/embed.service.ts`, `session/entity/session.entity.ts`, `ai-engine/handoff-router.service.ts`, `ai-engine/entity/tenant-ai-config.entity.ts`, `agent/agent-alert.service.ts`, `agent/agent-alert-reminder.service.ts`, `agent/answer-rating.service.ts`, `agent/entity/answer-rating.entity.ts`, `agent/agent-console.controller.ts`, `knowledge/knowledge-gap.service.ts`, `chat/chat.service.ts`
- Web: `live-chat/IdentityBadges.tsx`, `live-chat/AnswerRatingControl.tsx`, `ai-settings/RoutingRulesEditor.tsx`, `ai-settings/HandoffSection.tsx`, `statistics/AccuracySection.tsx`, i18n 6개 언어
- SQL: `261015-session-identity-attributes.sql`, `261015-agent-alerts-reminded-at.sql`, `261015-answer-ratings.sql`, `docker/init-sql/01-schema.sql`(94 테이블)

## 3. 배포 상태
| 환경 | SQL | 코드 | 검증 |
|---|---|---|---|
| 스테이징 | 3건 선적용(10/15) | 1b8f01e 배포, `successfully started` | TCR §2 IT-1~7 통과 |
| 프로덕션(KR) | **미적용** | 미배포 | go2joy 테넌트 없음 — 배포 시 SQL 3건 선적용 필수 |
| Go2Joy 서버 | init-sql에 포함 | D1 설치 시 | 서버·DNS 미제공(10/15) |

## 4. 남은 일
- 아메바: D9 약관 고지 모드, D8 지식 정비(충돌 78건, go2joy 기본 언어 `vi`·타임존 설정 — 미설정이 영어 답변 원인), D1 설치(서버 제공 후), Zalo 알림(OA 제공 후).
- Go2Joy(10/22): 서버·SSH·DNS, Hotel Admin 서버 서명(형식: 임베드 가이드 §3.4), 지역·업무·담당자 명단, Zalo OA, 약관 문구.
- 알려진 제약: 그룹 알람 확인은 형제 행까지 일괄 확인(수락과 별개); 재알림 대상 리드는 테넌트 공통 1세트.
