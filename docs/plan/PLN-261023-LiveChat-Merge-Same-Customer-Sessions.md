# PLN-261023 라이브챗 — 같은 고객 세션 통합 대화방 · 자동 추가

- REQ: `docs/analysis/REQ-261023-LiveChat-Merge-Same-Customer-Sessions.md`
- 상태: **승인됨** (2026-10-23, 권장안 D1~D6)

## 1. 결정 사항 (권장안 ★)

| # | 결정 | 선택지 | 권장 |
|---|---|---|---|
| D1 | 동일인 판정 기준 | A. 고객 행 일치(`sessions.customer_id` 또는 그 세션 대화의 `conversations.customer_id`) + 같은 이메일(`email_hash`)의 다른 고객 행 / B. A + 같은 B2B 기업 / C. 판정 없이 아무 세션이나 수동 통합 | ★A — 기존 동일인 제안과 같은 규칙에 claimed 대화를 더한다. 기업 단위는 '프로젝트' 그룹의 몫이고, 확인된 신원 없이 묶으면 남의 대화가 섞일 위험이 있다 |
| D2 | 목록 표시 | A. 통합방을 **1행으로 접기**(필터를 통과한 대화 중 가장 최근 것이 대표, `[통합 N]` 배지) / B. 각 행 유지 + 배지만 | ★A — "한 대화방"이라는 요구 그대로다. B로는 목록이 줄지 않는다 |
| D3 | 대화방 화면 | A. **기존 대화방 화면**에서 메시지만 통합(고객 패널·AI·종료·인계 유지, 답장 대상 선택) / B. 그룹 방 화면 재사용 | ★A — 요구가 "타임라인/프로젝트 외에"이고, 그룹 방에는 상담 기능이 없다 |
| D4 | 자동 추가 기본값 | A. 통합할 때 체크박스 **기본 켬**, 이후 메뉴에서 켜기/끄기 / B. 기본 끔 | ★A — 요구의 핵심이 이후 세션까지 묶는 것이다. 다만 '선택 기능'이므로 끌 수 있다 |
| D5 | 고객당 통합방 수 | A. **고객 1명당 1개**, 세션은 통합방 1곳에만 / B. 여러 개 허용 | ★A — 세션이 두 방에 들어가면 목록 접기와 자동 추가 대상이 모호해진다 |
| D6 | 빼기·해제 | A. 세션 빼기는 **제외로 기억**(자동 추가로 다시 들어오지 않음), 해제는 통합방과 기록만 삭제 / B. 빼기 후 재가입 허용 | ★A — 운영자가 뺀 세션이 다음 접속 때 다시 붙으면 빼기가 무의미하다 |

## 2. 데이터 모델 (SQL `sql/261023-merged-rooms.sql`, 선적용)

기존 `chat_groups`는 재사용하지 않는다. 그쪽은 (그룹, 세션) 단위로만 유일하고, kind는 동작 차이가 없는 구분자라는 원칙이 있기 때문이다(REQ-260824). 통합방에는 "세션은 한 곳에만"과 "고객당 하나"라는 제약이 필요하다.

```sql
CREATE TABLE merged_rooms (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,          -- 기준 고객 (D1·D5)
  auto_join TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_mroom_tenant_customer (tenant_id, customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE merged_room_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  room_id BIGINT NOT NULL,
  session_id BIGINT NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'member',  -- member | excluded (D6)
  added_by BIGINT NULL,                          -- NULL = 자동 추가
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_mrs_tenant_session (tenant_id, session_id),  -- 세션은 한 곳에만 (D5)
  KEY idx_mrs_room (room_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- 엔티티 2개(nullable 컬럼에는 `type` 명시). `migrations:manifest` 갱신. 롤백은 DROP 두 줄이다(기존 테이블 변경 없음).
- 오류 코드: E5104 `MERGED_ROOM_NOT_FOUND`, E5105 `MERGE_NO_IDENTITY`(확인된 신원 없음), E5106 `MERGE_SESSION_CONFLICT`(다른 고객의 세션, 또는 다른 통합방 소속).

## 3. 단계

### S1 통합방 API (`domain/agent/merged-room.service.ts`)
| 라우트 | 동작 |
|---|---|
| `GET conversations/:id/merge-candidates` | 이 대화 세션의 동일인 세션 목록(D1)과 현재 통합방. 세션 메타만 반환하고 본문은 반환하지 않는다(동일인 제안과 같은 원칙). claimed 세션에는 `unverified` 표시 |
| `POST merged-rooms` `{conversation_id, session_ids, auto_join}` | 생성. 기준 고객 방이 이미 있으면 그 방에 추가한다. 모든 세션이 같은 고객인지 서버에서 다시 판정한다 |
| `PATCH merged-rooms/:id` `{auto_join}` | 자동 추가 켜기/끄기 |
| `DELETE merged-rooms/:id/sessions/:sessionId` | 빼기 → `excluded`(D6). 남는 멤버가 1개 이하이면 방을 해제한다 |
| `DELETE merged-rooms/:id` | 해제(통합방과 기록만 삭제) |

- 권한은 그룹과 같은 `CONVERSATION_HANDLE`이다. 생성·빼기·해제·자동 추가 전환·자동 가입은 모두 `audit_logs`에 남긴다(`merged_room.*`).

### S2 목록 접기 · 통합 피드 · 답장 대상
- `listSessions`: 통합방 멤버 세션의 대화는 **필터를 통과한 것 중 방별 최신 1건**만 남긴다(`NOT EXISTS` 더 최근 동일 방 대화 — 검색·상태·채널·AI 에이전트 필터를 그대로 공유). total에도 같은 조건을 적용한다. 행에 `mergedRoom {id, sessionCount}`을 추가한다.
- 대화 상세에 `mergedRoom {id, autoJoin, sessions[{sessionId, channel, label, conversationIds, open}], replyTargets}`을 추가한다.
- `GET conversations/:id/messages?merged=1`: 그 대화가 속한 방의 모든 멤버 세션 대화를 전역 `messages.id` 커서로 묶는다(기존 그룹 피드 방식을 공용 헬퍼로 추출). 메시지마다 `conversationId`·`sessionId`가 있어 구분선을 그린다.
- 대화방 [찾기](PLN-261023 S1)도 `merged=1`이면 방 전체에서 찾는다.
- 발신은 바꾸지 않는다. 화면이 고른 답장 대상 대화 id로 기존 `POST conversations/:id/messages`를 호출한다. 서버는 그 대화가 같은 방인지 따로 확인할 필요가 없다(원래 대화 단위 권한).

### S3 자동 추가
`MergedRoomService.autoJoin(tenantId, sessionId)`. 실패해도 예외를 밖으로 던지지 않는다(warn 로그만). 다음 세 시점에 호출한다.
1. `ChatService.getOrCreateConversation`이 새 대화를 만든 직후(세션 고객 또는 claimed 귀속 고객)
2. `SessionService.bindCustomer`(대화 도중 로그인)
3. `EmbedService.claimIdentity`의 대화 귀속 직후

판정은 D1과 같다. 기준 고객 또는 같은 이메일 고객의 방이 있고, `auto_join=1`이며, 이 세션이 `excluded`가 아닐 때만 `member`로 넣는다.

### S4 콘솔
- 목록 행에 `[통합 N]` 배지
- 대화 헤더에 [같은 고객 대화 통합 (N)]. 기존 `RelatedSessionsBanner`의 그룹 추가 버튼 옆에 둔다
- 통합 모달(후보 체크 + 자동 추가 체크박스)
- 헤더 `[통합 N ▾]` 메뉴(세션 목록·빼기·자동 추가 전환·해제)
- 메시지 영역 세션 구분선과 컴포저 [답장 대상 ▾]
- 모든 동작에 성공/오류 토스트
- i18n `livechat` 6개 언어

## 4. 와이어프레임

**① 대화 헤더 · 통합 모달**
```
┌ 김하나 · 세션 912 ─────────────── [같은 고객 대화 통합 (2)] [찾기] [⋯] ┐
                     ┌──────────────────────────────────────────────┐
                     │ 같은 고객의 대화 통합                        ✕ │
                     │ 판정: 같은 고객 계정 · 같은 이메일              │
                     │ ☑ 세션 120  웹   마지막 10/02 14:20  고객 계정  │
                     │ ☑ 세션 388  앱   마지막 10/15 09:03  같은 이메일 │
                     │ ☑ 세션 912  웹   진행 중 (현재)                │
                     │ ─────────────────────────────────────────── │
                     │ ☑ 이후 같은 고객의 새 세션 자동 추가           │
                     │                         [취소]  [3개 세션 통합] │
                     └──────────────────────────────────────────────┘
```

**② 목록 · 통합 대화방**
```
┌ 목록 ───────────────────────┐ ┌ 김하나 · 세션 912  [통합 3 ▾] [찾기] [⋯] ┐
│ ● 김하나 · 세션 912 [통합 3] │ │ ─────── 세션 120 · 웹 · 10/02 ─────── │
│   환불 문의드려요     2분 전 │ │ 고객  사이즈 M 재고 있나요?             │
│ ○ 이둘 · 세션 905           │ │ AI    네, M은 3개 남아 있습니다.        │
│   배송 문의          10분 전 │ │ ─────── 세션 388 · 앱 · 10/15 ─────── │
└─────────────────────────────┘ │ 고객  배송 언제 와요?                  │
                                │ ── 세션 912 · 웹 · 오늘 · 진행 중 ──── │
 [통합 3 ▾] 메뉴                │ 고객  환불 문의드려요                  │
 ┌──────────────────────────┐   │ ────────────────────────────────── │
 │ 세션 120 웹 종료  [빼기]  │   │ 답장 대상 [세션 912 · 웹 (진행 중) ▾] │
 │ 세션 388 앱 종료  [빼기]  │   │ [메시지 입력…………………………]  [보내기] │
 │ 세션 912 웹 진행 중       │   └──────────────────────────────────────┘
 │ ☑ 새 세션 자동 추가       │
 │ [통합 해제]               │
 └──────────────────────────┘
```

- 진행 중인 대화가 없으면 답장 대상은 가장 최근 대화다. 수신 전용 채널(sms)은 대상 목록에서 비활성화된다.
- 고객 패널·AI 토글·종료·인계 버튼은 답장 대상 대화에 적용된다는 것을 헤더 번호(세션 912)로 보여 준다.

## 5. 부작용 분석

| 영역 | 영향 | 대응 |
|---|---|---|
| 목록 쿼리(5초 폴링) | 상관 서브쿼리 1개 추가 | `uq_mrs_tenant_session` 조회 + 기존 `conversations(session_id)` 인덱스. 통합방이 없는 테넌트는 LEFT JOIN 미일치로 비용이 거의 없다. 스테이징 EXPLAIN 확인 |
| 대기열·알림·배정·통계·CSAT | 대화 단위 그대로라 변화 없음 | 목록에서 같은 방의 **두 번째 진행 중 대화**는 접혀서 안 보일 수 있다 → 행 배지에 "진행 중 2" 표시, 답장 대상 목록에 노출 |
| 타임라인/프로젝트 그룹 | 독립(세션이 둘 다에 속할 수 있음) | 없음 |
| 동일인 제안 배너 | 통합방 멤버는 후보에서 뺀다 | 배너 문구는 유지 |
| 대화 연속성·sticky·AI 이전 대화 발췌 | 변화 없음(대화 단위) | — |
| 고객 개인정보 삭제(DSAR) | 고객 삭제 시 그 고객 기준의 통합방도 삭제 | `privacy.service`에 정리 추가 |
| 위젯·고객 화면 | 영향 없음(콘솔 전용) | — |
| 동시 작업 | REQ-261023 양방향 번역이 `LiveChatPage.tsx` 메시지 영역을 수정 중 | 먼저 머지된 쪽에 리베이스. 메시지 렌더 컴포넌트는 손대지 않고 구분선만 끼워 넣는다 |

## 6. 테스트 계획 (TCR에서 상세화)
- **단위**
  - 판정: 고객 행·이메일·claimed 대화 / 게스트 E5105 / 타 고객 세션 E5106 / 다른 방 소속 E5106 / 타 테넌트 404
  - 목록 접기: 필터별 대표 1건, total
  - 통합 피드 커서
  - 자동 추가: 켬·끔·excluded·실패 무시
  - 빼기→1개 이하 자동 해제
  - DSAR
- **통합(로컬 실 HTTP)**: 생성 → 목록 1행 → 피드 → 답장 대상 발신 → 새 세션 자동 가입 → 빼기 → 재접속 시 미가입 → 해제 원복
- **화면**: 모달, 배지, 구분선, 답장 대상, 메뉴, 토스트
- **배포**: 스테이징에 SQL 선적용 → 배포 → go2joy·ivyusa 실데이터로 통합·해제(원복) 확인

## 7. 범위 밖
- 서로 다른 고객 행을 하나로 합치는 고객 병합(데이터 변경)
- 신원 없는 게스트 세션 통합
- 메신저 채널 사용자와 위젯 고객 간 자동 판정. 기존에는 신원 연결이 없다. 필요하면 별건으로 진행
