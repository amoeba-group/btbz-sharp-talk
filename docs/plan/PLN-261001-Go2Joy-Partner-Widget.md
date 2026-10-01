# PLN-261001 — 커머스가 아닌 테넌트: 답변 뒤 칩 + 채팅 주문 인증 게이트

- 근거: [REQ-261001-Go2Joy-Partner-Widget](../analysis/REQ-261001-Go2Joy-Partner-Widget.md) G1~G3
- 상태: **승인됨 (2026-10-01)** — 설정 변경분 §1은 같은 날 스테이징 적용, S0~S3 구현은 TCR-261001

## 1. 이미 적용한 설정 변경 (코드 무관, 스테이징 go2joy)

| # | 변경 | 되돌리기 |
|---|------|---------|
| K1 | `kb_categories.agent_ids`: agent 10을 가진 28개 카테고리에 21 추가 | 이전 값: 155=`[10,21]`, 177·183=`[9,10,11]`, 나머지 25개=`[9,10]` → 155 외 행에서 21 제거 |
| K2 | `tenants.widget_tabs` = `["chat"]` (기존 3탭) | `["notifications","orders","chat"]` |
| K3 | `scenario_buttons` = 파트너 버튼 4개(action `message`, agentIds `[10,21]`, EN/VI/KO) | 기존: `cancel_refund` 1개(agent 21) |

스모크(agent `hotel-admin`): 직원 계정 생성→Video 48, 객실 차단→Video 13, VI 체크인→Video 21,
"Dispute a booking"→Video 29, "View today's bookings"→Video 0 정상. 남은 결함:
"오늘 예약 현황 보기"(KO)→**주문 인증 게이트**(S2가 해결), 영어 "How do I process a guest
check-in?"→미검색(검색 품질, 본 PLN 범위 밖 — §6).

## 2. 단계

### S0 — 테넌트 성격 플래그 (G3)
- `tenants.commerce_enabled TINYINT(1) NOT NULL DEFAULT 1` — 기본 1이라 기존 테넌트 무변화.
- SQL `sql/261001-tenants-commerce-enabled.sql` + `npm run migrations:manifest`, 엔티티 `type: 'tinyint'` 명시.
- `session/ensure` 응답에 `commerceEnabled: boolean` 추가, 콘솔 위젯 설정 GET/PUT에 `commerce_enabled`.
- **대안(기각 권고)**: 플래그 없이 "목록 탭이 하나도 없으면 비커머스"로 유도 — 스키마 0이지만
  파트너 인증이 생겨 탭을 다시 켜는 순간 go2joy가 커머스로 되돌아간다(보이지 않는 결합).

### S1 — 답변 뒤 칩 (G1) · `ChatTab.tsx`
- `commerceEnabled=true` → 현행 그대로(My orders / Shipping / Returns / Agent).
- `false` → **테넌트 시나리오 버튼 중 앞 3개**(이미 에이전트 범위·언어 해석된 `useScenario` 결과) +
  Talk to an agent. 클릭은 상단 메뉴와 같은 `handleScenario`로 → 동작 일치.
- `useScenario` 로딩/실패 폴백(커머스 6버튼)도 `false`면 빈 목록 — 첫 화면에 커머스 메뉴가 깜빡이지 않게.

### S2 — 채팅 주문 인증 게이트 (G2) · `chat.service.ts:777`
- `commerce_enabled=0` 테넌트는 `needsOrderData` 게이트와 주문 컨텍스트 주입(:794)을 건너뛰고
  일반 RAG 경로로 → "오늘 예약 현황 보기"가 Hotel Admin에서 보는 방법으로 답한다.
- 답변 재사용 제외 조건(:822)의 `needsOrderData`도 같은 판정 사용(커머스 아님 = 주문 데이터 아님).

### S3 — 콘솔 토글 · 설정 > 위젯 탭 카드
```
┌ 위젯 탭 ───────────────────────────────────────────────┐
│ 탭 구성   ☐ 알림  ☐ 주문  ☑ 채팅                         │
│ 탭 위치   [ 위 ▾ ]                                       │
│ ─────────────────────────────────────────────────────── │
│ 스토어 기능  ☐ 주문 조회·배송·반품 기능 사용               │
│   끄면: 채팅의 주문 로그인 요청과 'My orders·배송·반품'     │
│   칩이 사라지고, 답변 뒤에는 AI 설정의 시나리오 버튼이       │
│   나옵니다. 호텔·B2B 등 주문이 없는 서비스용.                │
│                                              [ 저장 ]    │
└─────────────────────────────────────────────────────────┘
```
위젯 (commerce 꺼짐, agent hotel-admin):
```
┌ Go2Joy Support ───────────────── ✕ ┐
│ (AI) Room blocking: 1. Quản lý …   │
│ [View today's bookings] [How to    │
│  check in a guest] [Dispute a      │
│  booking] [Talk to an agent]       │
│ ┌────────────────────────┐ [ ➤ ]   │
└────────────────────────────────────┘
```
- 저장 성공/실패 토스트(기존 카드 패턴), i18n 6개 언어 + `npm run i18n:check`.

### S4 — 적용·검증
- 스테이징 SQL 선적용 → 배포 → go2joy `commerce_enabled=0` (콘솔에서) → 위젯 실측(칩·KO 질의).
- ivyusa(스테이징) 무회귀: 칩 4종 그대로, 주문 질의에 로그인 요청 그대로.
- 프로덕션: SQL만 선적용(기본 1, go2joy 없음) → 코드 배포. 동작 변화 0.

## 3. 영향 분석
| 영역 | 영향 |
|------|------|
| 기존 테넌트 | 기본값 1 → 무변화. 테스트: 커머스 경로 기존 스펙 유지 + 비커머스 분기 신규 |
| 스키마 | 컬럼 1개 추가(PR `## Migration` 필수, 롤백 = DROP COLUMN) |
| 위젯 캐시 | 구 위젯 번들은 `commerceEnabled`를 모름 → 커머스 칩 유지(현행과 동일, 안전 방향) |
| 분석 | `needsOrderData` 통계 렌즈는 의도 기록을 그대로 남김(게이트만 건너뜀) |

## 4. 테스트 (TCR 예정)
- api: 비커머스 테넌트 + needsOrderData 의도 → needsAuth=false, RAG 호출 / 커머스 테넌트 → 현행.
- widget: commerceEnabled false → 칩 = 시나리오 앞 3 + agent; 버튼 0개 → agent 칩만.
- 실제 부팅 확인(엔티티 변경).

## 5. 범위 밖 / 별건
- **파트너 인증(호텔 ID·직원 권한)**: go2joy Hotel Admin 서버가 `embed_secret`으로 `user_id`에
  호텔 ID·역할을 서명해 넘기는 방식 제안 — go2joy 측 확인 후 별도 REQ.
- 고객 채팅·로그인·객실 최초 등록 지식: 영상 51편에 없음 → go2joy에 자료 요청.

## 6. 관찰 (별건 후보)
- 영어 "How do I process a guest check-in?" → 인용 0건(Video 21 미검색), 같은 뜻 VI 질의는 정상.
- "How do I mark a booking as checked in (Nhan phong)…" → "Here's what I found for you: [policy]
  Chính sách bảo mật…" — 무관한 정책 스니펫 폴백 답. 검색/폴백 경로 FIX 후보.
