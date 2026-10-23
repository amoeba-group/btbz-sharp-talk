# FIX-261024 — 위젯: 상담카테고리 카드가 뜨지 않음

- 신고: 2026-10-24. go2joy HA(UAT)에서 bs·cs를 노출함으로 바꿨는데 [Talk to an agent]를 누르면 카드 없이 "You are being connected to a support agent. Please hold on…"만 나왔다.
- 관련: PLN-261024-Widget-Handoff-Consult-Category-Picker(#729)

## 1. 재현과 근거
- **스테이징 데이터**
  - go2joy 대화 892(세션 20962, ADMIN123)는 `consult_category` NULL이고, 알림 1건(`user_request`, target NULL)이 있었다.
  - 위 문구는 서버 메시지가 아니라 위젯이 상담카테고리 없이 escalate할 때 붙이는 로컬 줄(`chat.connectingAgent`)이다. 즉 위젯이 카드를 건너뛰었다.
- **서버는 정상**: 같은 ADMIN123 세션 토큰으로 `/session/ensure`를 호출하면 `consultCategories = [bs, cs]`가 돌아온다.
- **배포된 위젯에서 재현**
  - 스테이징 go2joy 위젯(`?mode=app&shop=…go2joy.vn&agent=hotel-admin`)을 새로 열고 첫 메시지로 "Hỏi về đối soát"를 보냈다.
  - AI가 인계했는데 카드 대신 기존 [Kết nối nhân viên hỗ trợ] 버튼이 나왔다.
  - 재현 대화 893과 알림은 확인 후 삭제했다.

## 2. 근본 원인
1. **null 비교 결함**
   - `ChatTab`은 "이미 고른 대화"를 `pickedFor`(초깃값 null) `!== conversationId`로 판정했다.
   - 첫 메시지를 보내는 시점에는 `conversationId`가 아직 null이다. 그래서 null === null이 "이미 골랐음"으로 읽혀 카드가 꺼졌다.
   - 새 대화의 첫 메시지에서 바로 인계되는 경우(go2joy 정산 문의처럼 흔함)에는 카드가 한 번도 뜨지 않는다.
2. **목록이 열 때 한 번만 읽힘**
   - 상담카테고리 목록은 위젯을 열 때(ensure) 한 번만 읽는다.
   - 운영자가 노출함으로 바꾸기 전에 열린 위젯은 빈 목록을 계속 들고 있다. 그래서 [상담원 연결]도 카드 없이 바로 연결된다.
   - 대화 892는 노출 전환(18:32 UTC) 1분 뒤였다. HA 화면이 그 전부터 열려 있었을 가능성이 높다.

## 3. 수정 (최소 변경, 위젯만)
- `picked`를 대화 id 집합으로 바꿨다. id가 없으면 "고르지 않음"이다. `SendResult`에 `conversationId`를 실어, 인계 판정은 이번 턴이 만든 대화로 한다.
- 카드를 띄울지 정할 때 목록이 비어 있으면 ensure로 한 번 다시 읽는다(`offeredCategories`). 목록이 있으면 추가 호출은 없다.
- 서버와 SQL은 변경하지 않았다.

## 4. 검증 (로컬 API + 위젯)
- 위젯을 연 뒤 API로 bs·cs를 노출로 만들었다(오래된 목록 상황).
- 첫 메시지 "I want to talk to a human agent" → 인계 안내 아래 "Pick a topic …" 카드(Business Support / Customer Services)가 나왔다.
- Customer Services를 고르자 "Got it — I'll connect you with our Customer Services team." 줄이 남았다.
- widget tsc, radius:check 통과. 테스트 데이터는 삭제했다.

## 5. 예방 패턴
- **"없음"을 나타내는 값 두 개를 직접 비교하지 않는다.** "아직 대화 없음(null)"과 "아직 고르지 않음(null)"은 다른 뜻이다. 집합의 원소 여부처럼, 값이 없으면 항상 '아님'이 되는 형태로 판정한다.
- 운영자가 바꾸는 노출 설정을 고객 화면이 열 때 한 번만 읽으면 바뀐 설정이 늦게 반영된다. 바로 그 동작을 실행하기 직전에 다시 읽는다(빈 목록일 때만 읽어 비용을 줄인다).
