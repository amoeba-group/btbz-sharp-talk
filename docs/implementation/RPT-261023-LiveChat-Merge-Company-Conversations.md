# RPT-261023 — 라이브챗: 기업 이전 대화 모달에서 통합 · 같은 기업 = 같은 고객 · 문구 "이 고객"

- REQ `docs/analysis/REQ-261023-LiveChat-Merge-Company-Conversations.md` · PLN(승인 F1~F4 권장안) · TCR 동명
- PR #721 → main `afa9bad5`
- 선행: RPT-261023-LiveChat-Merge-Same-Customer-Sessions (#716)

## 변경 요약

| 항목 | 내용 |
|---|---|
| "버튼 확인 안 됨" | 결함 아님. 사용자 탭이 배포 전 코드로 동작 중이었다(889 조회 중 `merge-candidates` 호출 0건, index.html은 no-cache). 새로고침으로 해소된다 |
| F1 판정 | 세션·대화의 `company_id`가 같은 세션을 같은 고객으로 판정한다(`matchedBy: company`). 세션에 고객·기업이 없고 claimed 대화로만 이어지면 '미검증' |
| F2 자동 추가 | 기업 기준 방은 그 호텔의 새 세션(위젯 메시지 시 기업 귀속 대화)을 자동 가입시킨다 |
| F3 방 기준 | `merged_rooms.company_id`(테넌트당 유일)를 추가하고 `customer_id`는 NULL을 허용한다. 사람 방을 호텔 대화에서 다시 통합하면 기업도 기록한다(다른 방이 그 기업을 쓰지 않을 때) |
| 모달 | 이전 대화 모달에 체크박스, "이후 이 고객의 새 세션 자동 추가", [선택한 대화 통합 (N)], 통합됨·현재·뺀 세션 표시, [열기] 추가. 기업 대화 행에 `sessionId` 추가 |
| F4 문구 | `company.earlier`/`earlierTitle` 6개 언어를 "이 고객"으로 변경. [기업] 배지는 유지 |
| DSAR | 사람 삭제 시 사람 기준 방은 삭제, 기업 기준 방은 유지하고 `customer_id`만 NULL |

## 파일
- **API**: `merged-room/{merged-room.service, merged-room.service.spec, entity/merged-room.entity}`, `company/{company.mapper, dto/response}`
- **웹**: `live-chat/{CompanyThreadButton, MergeRoomControl, live-chat.service}`, i18n `livechat` 6개 언어
- **SQL**: `sql/261023-merged-rooms-company.sql`, `sql/artefacts.tsv`

## 테스트
- api jest 256 suites / 2,577 tests(merged-room 16건), api·web tsc, i18n:check, CI 통과
- 로컬 실 HTTP 4건(나중에 온 직원 세션의 자동 가입 포함) + 화면 4건(TCR). 임시 데이터는 삭제함

## 배포 상태

| 환경 | 마이그레이션 | 코드 | 검증 |
|---|---|---|---|
| 스테이징 | ✅ 10/23 22:1x KST 선적용(적용 전 방 0개) | ✅ main `afa9bad5` → `deploy-staging.sh` | API healthy·`successfully started`·ERROR 0, 라우트 401, 웹 번들 `mergeSelected` 포함 |
| 프로덕션 | ✅ 10/23 22:15 KST 선적용(전체 백업 `~/backups/sharptalk-production/20261023-2215-pre-261023-merged-rooms-company/db_sharptalk.sql`, 3.2MB, 적용 전 방 0개) | ✅ `production` ff `fe21b7a9..afa9bad5`(#720 문서 동승) → `deploy-self-hosted.sh`(applied 109) | api/web/widget 재생성, 부팅 1회·ERROR 0, health 200, 라우트 401, 번들 반영. 실데이터 변경 테스트 없음 |

## 미검증·후속
- 스테이징 go2joy 화면 확인은 로그인 정보가 없어 하지 못했다. 콘솔을 **새로고침**한 뒤 889(또는 883·887·888·890·891)를 열면 "이 고객의 이전 대화 N건"과 [같은 고객 대화 통합 (N)]이 보여야 한다.
- 고객 화면(`customers.json`)의 "기업(호텔)" 표기는 이번 요청 범위 밖이라 유지했다.
