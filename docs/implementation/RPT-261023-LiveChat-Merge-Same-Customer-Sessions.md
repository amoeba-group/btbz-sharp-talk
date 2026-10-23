# RPT-261023 — 라이브챗: 같은 고객 세션 통합 대화방 · 이후 세션 자동 추가

- REQ `docs/analysis/REQ-261023-LiveChat-Merge-Same-Customer-Sessions.md` · PLN(승인 D1~D6 권장안) · TCR 동명
- PR #716 → main `28f5d3af`

## 변경 요약

| 영역 | 내용 |
|---|---|
| 데이터 | `merged_rooms`(고객당 1방, `auto_join`)와 `merged_room_sessions`(세션은 한 방에만, `state` member/excluded, `added_by` NULL=자동). 기존 테이블 변경 없음 |
| 동일인 판정(D1) | 세션의 고객 + 그 세션 대화의 고객(claimed 귀속) + 같은 `email_hash`의 다른 고객 행. 게스트는 대상 아님(E5105) |
| API | `GET conversations/:id/merge-candidates`, `POST merged-rooms`(기존 방이 있으면 거기에 합류, 서버에서 다시 판정), `PATCH merged-rooms/:id`(자동 추가), `DELETE merged-rooms/:id/sessions/:sid`(빼기 → excluded, 2개 이하면 해제), `DELETE merged-rooms/:id`(해제). E5104~E5106, 감사 `merged_room.*`(변화 있을 때만) |
| 목록(D2) | 방별로 필터를 통과한 최신 대화 1행(같은 상태·채널·AI 에이전트 조건을 반복하는 `NOT EXISTS`). 고객·내용 검색 시에는 접지 않음. 행에 `mergedRoom{sessionCount, openCount}` |
| 대화방(D3) | 상세·[찾기]가 방 전체 대화를 하나의 기록으로 다룸(전역 `messages.id` 커서). 메시지에 `conversationId`, 상세에 `mergedRoom`(+대화 목록). 콘솔은 세션 구분선과 [답장 대상] 선택(선택 대화 전환 — 발신 경로 무변경) |
| 자동 추가(D4·D6) | `ChatService.getOrCreateConversation`(위젯 메시지마다) → `autoJoin`. 테넌트에 자동 추가 방이 없으면 조회 1회로 끝남. 실패해도 예외를 던지지 않음. excluded는 다시 넣지 않음 |
| 기타 | 동일인 제안 배너에서 같은 방 세션 제외, DSAR 삭제 시 방 삭제, i18n `livechat.merge.*` 6개 언어 |

## 파일
- **API**
  - 신규 `merged-room/{merged-room.module, merged-room.service, merged-room.service.spec, entity/merged-room, entity/merged-room-session}`
  - `agent/{agent-console.controller, agent.service, agent.mapper, agent.module, dto/request/agent.request}`
  - `chat/{chat.service, chat.module}`, `privacy/{privacy.service, privacy.module}`, `global/constant/error-code.constant`
- **스펙 갱신**: `agent.service.listsessions.spec`, `livechat-search-ip.spec`, `chat.service.thread.spec`
- **웹**: 신규 `live-chat/MergeRoomControl`, `live-chat/{LiveChatPage, live-chat.service, live-chat.hooks}`, i18n `livechat` 6개 언어
- **SQL**: `sql/261023-merged-rooms.sql`, `sql/artefacts.tsv`

## 테스트
- api jest 254 suites / 2,565 tests, api·web tsc, i18n:check, radius:check, CI 통과
- 로컬 실 HTTP 17건(위젯 메시지 경로 자동 가입 포함)과 화면 7건(TCR). 임시 데이터는 삭제함

## 배포 상태

| 환경 | 마이그레이션 | 코드 | 검증 |
|---|---|---|---|
| 스테이징 | ✅ 10/23 21:2x KST 선적용(CREATE만, 적용 전 테이블 없음 확인) | ✅ main `28f5d3af` → `deploy-staging.sh` | API healthy·`successfully started`·ERROR 0, 신규 라우트 401, 웹 번들 `merge-candidates` 포함. 배포 후 실사용 목록 폴링 46건 모두 200(새 접기 쿼리), 오류·auto-join 실패 0. 접기 조회 EXPLAIN = 유일 키 const. 실데이터: go2joy 고객 518(laquan10)의 claimed 대화 5건(883·887·888·889·890)이 통합 후보 |
| 프로덕션 | ✅ 10/23 21:29 KST 선적용(전체 백업 `~/backups/sharptalk-production/20261023-2129-pre-261023-merged-rooms/db_sharptalk.sql`, 3.2MB) | ✅ `production` ff `3edea378..28f5d3af` → `deploy-self-hosted.sh`(applied 108) | api/web/widget 재생성, 부팅 1회·ERROR 0, health 200, 신규 라우트 401, 웹 번들 신규 코드. 배포 후 3분간 관련 트래픽 없음(오류 0). 실데이터 변경 테스트 없음 |

## 미검증·후속
- 스테이징 콘솔 화면에서 실데이터로 통합·해제하는 확인은 하지 않았다. 스테이징 로그인 정보가 기록과 달라 추측 입력을 피했다. 로컬 화면 실측과 스테이징 실트래픽 200으로 대체했다.
- 메신저 채널 대화는 신원 연결이 없어 자동 추가 대상이 아니다(PLN 범위 밖).
- 핀 고정된 오래된 대화가 같은 방의 최신 줄로 접히면 핀 표시가 보이지 않는다(TCR §4).
- 롤백: 코드를 되돌린 뒤 `DROP TABLE merged_room_sessions; DROP TABLE merged_rooms;`
