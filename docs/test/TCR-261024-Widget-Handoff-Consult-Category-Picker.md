# TCR-261024 — 상담카테고리: 명칭 · 노출 · 위젯 고객 선택 · 규칙 그룹 연결

- PLN: `docs/plan/PLN-261024-Widget-Handoff-Consult-Category-Picker.md` (D1~D8 권장안 승인)
- 실행일: 2026-10-24
- 환경
  - API: 로컬 :3099(`DB_SYNCHRONIZE=false`, `sql/261024-consult-category.sql` 수동 적용)
  - 콘솔: vite :5183
  - 위젯: vite :5186(`?mode=app`)

## 1. 단위 테스트

| 파일 | 케이스 | 결과 |
|---|---|---|
| `handoff-router.service.spec.ts` | 기존 스펙 갱신: 규칙의 상담카테고리 조건은 고객이 고른 값과만 비교한다(`consultCategory`). 서명 region은 고객 정보 `region` 조건으로 본다 | PASS |
| 〃 신규 3건 | 상담카테고리 × 권역(표기 정규화) → 규칙 선택 / 서명 region은 상담카테고리 조건을 만족시키지 않음, 고르지 않으면 조건 없는 규칙으로 / 규칙 그룹(팀 × 라벨)을 resolver로 호출 | PASS |
| `routing-category.service.spec.ts` | 기존 4건 갱신(기업 사용처 제외) + 신규 1건: 새로 만들면 노출, 언어별 이름 정리(빈 값·모르는 언어 제거), 위젯 표시명은 세션 언어 → 기본 이름 → 코드 순, 노출·이름 변경, `visibleRow`(숨김·다른 테넌트는 null) | PASS |
| `chat.service.consult-category.spec.ts` (신규 5건) | A 경로: 노출 코드는 저장하고 시스템 줄(세션 언어)을 남기고 그 값으로 라우팅, 직전 상담원 건너뜀 / 숨김 코드는 무시하고 기본 라우팅(직전 상담원 유지) / B 경로: 미수락 대기에서 첫 선택이면 재라우팅 1회, 두 번째는 기록만 / 배정된 대화는 기록만 / 숨김 E5109, 다른 세션 404 | PASS |
| `agent-alert.service.spec.ts` (신규 2건) | `category_selected`는 기존 new 알림을 먼저 acked로 정리한 뒤 새 알림을 만들고 메일에 상담카테고리를 넣음 / 다른 사유는 기존 알림을 건드리지 않음 | PASS |
| `session.mapper.spec.ts` | 응답에 `consultCategories` | PASS |

**전체 결과**
- `npx jest`(api): 258 suites / 2,598 tests 통과
- api·web·widget `tsc --noEmit` 통과
- `i18n:check` 6개 언어 complete, `radius:check` 통과
- `migrations:manifest` +1

## 2. SQL (로컬)
- `routing_categories`에 north·south(기본 투입, name NULL)와 payment(결제)를 넣었다. 라벨 regions = [north, south, payment], 팀 regions = [south]인 상태에서 실행했다.
- 결과
  - 카테고리는 payment만 남음
  - 라벨 regions = ["payment"]
  - 팀 regions = NULL
  - 새 컬럼 4개 생성
  - 규칙 확인 SELECT 결과 0행
- 확인 후 테스트 행을 지웠다.

## 3. 통합 (실 HTTP)

준비
- 상담카테고리: payment(결제, vi "Thanh toán", en "Payment", 노출) / booking(예약, 노출) / internal(내부 검토, 숨김)
- 규칙
  1. 결제 · 북부: payment + 권역 북부·중북부 → 팀 5 × 라벨 accounting
  2. 결제 · 기타: payment → 라벨 consult(전원 알림)
  3. 예약: booking → 사용자 1
  4. 기본

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| I1 | ensure(vi/ko/en) | `consultCategories` = 결제·예약만(숨김 제외), 표시명 Thanh toán / 결제 / Payment | 일치 |
| I2 | A: 북부 세션(region "North") + payment | 규칙 "결제 · 북부"(group unit:5×label:accounting) | 일치 |
| I3 | A: 남부 세션 + "Payment" | "결제 · 기타" | 일치 |
| I4 | A: internal(숨김) | 무시하고 경고 로그, "기본" | 일치 |
| I5 | B: "상담원 연결해 주세요" → 인계(기본) → payment 선택 | `rerouted:true`, "결제 · 북부"로 재라우팅. 첫 알림 acked, `category_selected` 알림 new | 일치 |
| I6 | B: 같은 대화에서 다시 booking | `rerouted:false`(기록만) | 일치 |
| I7 | B: internal / 다른 세션 토큰 | E5109 / E5002 | 일치 |
| I8 | 시스템 줄 | vi "Đã rõ — … bộ phận Thanh toán …", ko "결제 상담으로 연결해 드릴게요 …" | 일치 |
| I9 | API 실부팅(엔티티 컬럼 추가) | `Nest application successfully started`, `/chat/consult-category` 매핑 | 확인 |

## 4. 화면

| # | 확인 | 결과 |
|---|---|---|
| S1 | 배정 규칙 제목 "배정 규칙 — 상담카테고리 × 업무", 칩 "결제 👁 · 예약 👁 · 내부 검토", 고객 정보 "권역" 조건 칩(북부 … 남부) | 확인 |
| S2 | 상담카테고리 관리 모달: 노출함/노출 안 함 토글, 언어별 이름 펼침(6개 언어), 추가 줄 "고객에게 노출" 체크, 사용처(규칙·팀·라벨) | 확인 |
| S3 | booking에 vi "Đặt phòng" 입력, internal 노출 전환 → [변경 저장] 토스트 | 확인 |
| S4 | 위젯(A): 문의 카드 [Chat with an agent] → "What do you need help with?" 카드(Payment / 예약 / 내부 검토, Skip) → Payment → "Got it — I'll connect you with our Payment team." + 대기 표시 | 확인 |
| S5 | 콘솔 라이브챗 #42 헤더 배지 `상담: 결제` | 확인 |
| S6 | 위젯(B): "I want to talk to a human agent" → 인계 안내 아래 "Pick a topic …" 카드 → 예약 → 재라우팅(로그 rule 예약) | 확인 |

실측 중 수정한 것:
- **상담원 알림 모달이 재라우팅 알림(`category_selected`)을 "고객이 상담원 연결을 요청했습니다"로 표시했다.** 전용 문구(alarmReasonCategory, 6개 언어)를 추가했다.

정리
- 테스트 대화 38~43과 그 메시지·알림·배정, 세션 147~152를 삭제했다.
- 상담카테고리를 삭제했다.
- 상담원 연결 설정은 테스트 전 값으로 복원했다(비교 일치).

## 5. 엣지 / 미검증
- 업무 외 시간(메일 접수)에 B 경로로 고르면 재호출하지 않고 기록만 한다(설계). 실측은 하지 않았다.
- 위젯에서 상담카테고리 표시명은 ensure 시점의 세션 언어를 따른다. 위젯 안에서 언어를 바꾸면 ensure를 다시 할 때 갱신된다.
- `sendMessage` 응답에 새 필드 `handedOff`를 만들지 않았다. 기존 `escalate`가 정확히 "이번 턴에 인계됨"이라 이를 신호로 쓰고 계약 주석에 명시했다(PLN 대비 변경).
