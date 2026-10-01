# RPT-261001 — go2joy 호텔 파트너 위젯: 커머스 전제 제거 + 지식 범위

- 근거: REQ / PLN / TCR-261001-Go2Joy-Partner-Widget
- 요청: go2joy Hotel Admin 에이전트 테스트 의견 3건 (2026-10-01)

## 1. 결과 요약

| 의견 | 조치 | 상태 |
|------|------|------|
| 3 지식 부족 | 원인 = 9/16 추가된 agent 21의 카테고리 범위 누락. 영상 카테고리 28개에 21 추가 | 스테이징 ✅ |
| 1 빠른 답변 버튼 | 상단 메뉴 = 파트너 버튼 4개(설정). 답변 뒤 칩 = 코드(`commerce_enabled`) | 스테이징 ✅ |
| 2 인증 화면 | 탭 = 채팅만(설정). 채팅 안 주문 인증 게이트 = 코드(`commerce_enabled`) | 스테이징 ✅ |
| 2 파트너 인증(호텔 ID·직원 권한) | go2joy 서버 서명 필요 — 별건 | 미착수 |

## 2. 변경 (PR #577, squash `0181c8b`)

- 스키마: `sql/261001-tenant-commerce-enabled.sql` — `tenants.commerce_enabled tinyint(1) NOT NULL DEFAULT 1`
  (+ `docker/init-sql/01-schema.sql`, `sql/artefacts.tsv`)
- API: `tenant.entity`·request/response DTO·mapper·service(저장·감사 `commerce:off`)·settings-snapshot,
  `session.service/mapper`(ensure `commerceEnabled`), `chat.service`(비커머스면 `needsOrderData` 게이트·주문
  컨텍스트·재사용 제외 생략, 분류 라벨 기록은 유지)
- 위젯: `reply-chips.ts`(신규), `ChatTab.tsx`, `useScenario.ts`(비커머스 로딩 폴백=빈 메뉴), `widgetStore.ts`, `useSession.ts`
- 콘솔: 설정 > 위젯 탭 카드 '스토어 기능' 토글, `settings.json` 6개 언어
- types: `SessionResponse.commerceEnabled?`
- 테스트: `chat.service.commerce.spec.ts`(3), `tenant.service.spec.ts`(+1), session spec 2건 기대값, `widget/test/reply-chips.test.mjs`(4)

## 3. 데이터 변경 (스테이징 go2joy, tenant 4)

| 대상 | 이전 | 이후 |
|------|------|------|
| `kb_categories.agent_ids` (28행) | 155=`[10,21]`, 177·183=`[9,10,11]`, 나머지=`[9,10]` | agent 10을 가진 행 모두 21 추가 |
| `tenants.widget_tabs` | `["notifications","orders","chat"]` | `["chat"]` |
| `tenant_ai_config.scenario_buttons` | `cancel_refund` 1개(agent 21, KO/VI 라벨) | 파트너 4개(action `message`, agentIds `[10,21]`, EN/VI/KO) |
| `tenants.commerce_enabled` | (신규, 1) | 0 |

## 4. 검증

- 단위: API jest 204 suites / 2,041 ✅, widget node test 47 ✅, tsc 3앱 ✅, i18n:check ✅, CI ✅
- 로컬 실부팅 ✅
- 스테이징(TCR I3~I7): ensure 필드 ✅ · "오늘 예약 현황 보기" 로그인 요청 없이 대시보드 안내 ✅ ·
  브라우저 실측 채팅 탭만 + 체크인 답변 Video 21 인용 + 파트너 칩 ✅ · 스토어(amoebaorder) 주문 질의 로그인 요청 유지 ✅
- 미확인: 콘솔 토글 클릭 저장(go2joy 콘솔 계정 없음 — SQL로 설정)

## 5. 배포 상태

| 환경 | SQL | 코드 | 비고 |
|------|-----|------|------|
| staging | ✅ 2026-10-01 선적용 | ✅ `0181c8b` 배포, API healthy | go2joy `commerce_enabled=0` |
| production | ✅ 2026-10-01 선적용(ivyusa=1) | ✅ `production` ff `07963e8..9d314f3` | 백업 `~/backups/sharptalk-production/20261001-0705`, `check-migrations` OK, `deploy-self-hosted.sh` → api healthy·`successfully started` 1회·스키마 에러 0, health 200, `/tenants/widget-settings` 401, ensure `commerceEnabled: true`. go2joy 없음 → 동작 변화 0 |

## 6. 남은 일 / 관찰

- 파트너 인증: `embed_secret` 서명 신원에 호텔 ID·역할 — go2joy 측 확인 후 REQ.
- 지식 공백: 고객 채팅·로그인·객실 최초 등록 영상 없음 → go2joy 자료 요청.
- 검색 품질(FIX 후보): 영어 "How do I process a guest check-in?" 인용 0건(같은 뜻 VI·KO는 정상),
  다른 영어 질의에 무관한 개인정보처리방침 스니펫 폴백 답변.
- 버튼 라벨이 그대로 질문이 됨 — "Today's bookings"는 상담원 이관, "View today's bookings"는 정답. 라벨은 질문형으로.
