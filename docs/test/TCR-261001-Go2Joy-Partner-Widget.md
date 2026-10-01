# TCR-261001 — 커머스가 아닌 테넌트: 답변 뒤 칩 + 채팅 주문 인증 게이트

- 근거: [PLN-261001-Go2Joy-Partner-Widget](../plan/PLN-261001-Go2Joy-Partner-Widget.md)

## 1. 단위

| ID | 대상 | 케이스 | 결과 |
|----|------|--------|------|
| U1 | `chat.service.commerce.spec.ts` | 스토어(commerce 1) + 주문 의도 + 게스트 → needsAuth=true, RAG 미호출 | ✅ |
| U2 | 〃 | 컬럼 없는 행(구 DB) → 스토어로 취급 | ✅ |
| U3 | 〃 | commerce 0 → needsAuth=false, RAG 답변, system 메시지 없음 | ✅ |
| U4 | `tenant.service.spec.ts` | `commerce_enabled` false 저장 → 생략 시 유지 → true 복귀 | ✅ |
| U5 | `session.*.spec.ts` | ensure 응답 `commerceEnabled: true` 기본 | ✅ |
| U6 | `widget/test/reply-chips.test.mjs` | 스토어 = 주문 칩 4종(시나리오 버튼 무관) | ✅ |
| U7 | 〃 | 비커머스 = 시나리오 앞 3개 + agent, 버튼 객체 동반 | ✅ |
| U8 | 〃 | 버튼 0개 → agent 칩만(스토어 칩 절대 아님) | ✅ |
| U9 | 〃 | 비활성 버튼 제외 | ✅ |

전체: API jest 204 suites / 2,041 tests 통과, widget node test 47 통과, `tsc` api·web·widget 통과,
`npm run i18n:check` 6개 언어 complete, 빌드 3앱 통과.

## 2. 통합 (실부팅·스테이징)

| ID | 시나리오 | 기대 |
|----|---------|------|
| I1 | 로컬 `node dist/main.js` 부팅 | `Nest application successfully started`, `tenants.commerce_enabled` tinyint NOT NULL DEFAULT 1 ✅ |
| I2 | 로컬 ensure(ivyusa) | `commerceEnabled: true` ✅ |
| I3 | 스테이징 SQL 선적용 → 배포 → 신규 필드 응답 | ensure에 `commerceEnabled` |
| I4 | 콘솔 go2joy 위젯 탭 카드에서 스토어 기능 끄기 → 저장 토스트 | `commerce_enabled=0`, 감사 `commerce:off` |
| I5 | go2joy(hotel-admin) "오늘 예약 현황 보기" | 로그인 요청 없음, 대시보드 안내 답변 |
| I6 | go2joy 답변 뒤 칩 | 파트너 버튼 3개 + Talk to an agent |
| I7 | ivyusa 무회귀 | 칩 4종 그대로, 주문 질의 시 로그인 요청 그대로 |

## 3. 엣지
- 구 위젯 번들(필드 모름) → 스토어 동작 유지(안전 방향).
- 시나리오 조회 로딩/실패: 스토어=내장 6버튼, 비커머스=빈 메뉴.
- 커머스 끔 + 로그인된 쇼퍼: 주문 컨텍스트 주입도 생략(주문 없음).
- 스냅샷 복원: 플래그 이전 스냅샷은 키가 없어 현재 값 유지.
