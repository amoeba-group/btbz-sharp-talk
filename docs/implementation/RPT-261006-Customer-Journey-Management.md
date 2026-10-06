# RPT-261006 — 동일인 그룹 제안 + 고객여정관리 (+ FIX-261006 번역 메뉴)

- 근거: REQ / PLN(승인, 권장안 D1~D4) / TCR-261006, FIX-261006
- 요청(2026-10-06): ① 번역 아이콘 메뉴 잘림 ② 동일인 그룹핑·고객여정분석/관리(아메바톡 참조)

## 1. 결과 요약

| 항목 | 내용 | 상태 |
|------|------|------|
| FIX-261006 | 라이브챗 번역 팝오버 잘림 → fixed + 앵커 + 상하 반전 | 스테이징 ✅ (실화면 6개 언어 확인) |
| AS-IS 확인 | 타임라인/프로젝트 그룹(#352)·고객여정분석 리포트(#375~#385)는 이미 운영 중 | — |
| P1 동일인 제안 | 대화 상단 배너(같은 customer_id·email_hash), 묶기/기존 그룹에 추가, 그룹 최소 1세션 | 스테이징 ✅ |
| P2 여정 카드 | 단계(5A)·담당·이력(audit)·다음 행동, 리포트 문장 → 할 일 | 스테이징 ✅ |
| P3 여정 보드 | `/journey` 칸반·드래그 단계 변경·필터·`?group=` 딥링크, 설정 > 기타 단계 편집 | 스테이징 ✅ |
| P4 타임라인 | cjm 이벤트 + 대화 시작/종료/만족도, payload 미노출 | 스테이징 ✅ |

## 2. 변경

| PR | 커밋 | 내용 |
|----|------|------|
| #586 | `94e364f` | FIX-261006 `LiveChatPage.tsx` 번역 팝오버 |
| #587 | (docs) | REQ/PLN-261006 |
| #588 | `085a628` | P1 — `GET /agent/conversations/:id/related-sessions`, `RelatedSessionsBanner.tsx`, MIN_MEMBERS 1, 6개 언어 |
| #589 | `2e337c3` | P2~P4 — 엔티티 3·`JourneyManageService`·라우트 11개·`JourneyCard/Timeline/BoardPage/StagesCard`·메뉴 `journey`·`audit.list(target)`·E5093~E5094·6개 언어 |

신규 API (`/api/v1`): `journey/stages`(GET·PUT), `journey/people`, `journey/board`, `journey/groups/:id/{journey,stage,owner,history,timeline,tasks}`, `journey/tasks/:id`(PATCH·DELETE), `agent/conversations/:id/related-sessions`.

## 3. 검증

- 단위: API jest 2,085 ✅ · common 60 ✅(메뉴 회귀 게이트) · turbo typecheck 9/9 ✅ · 빌드·i18n:check ✅ · CI ✅
- CI에서 한 번 실패: `menu-access.spec`의 `Record<MenuCode>` 대응표에 `journey` 누락 → 추가하자 회귀 게이트가 staff·consult 기본값 누락을 다시 잡아 `DEFAULT_ROLE_MENUS.staff`에 `journey` 추가(이슈 보드와 같은 대상).
- 로컬 실부팅 + API 종단 스모크(시드 계정, 로컬 DB 테스트 데이터 후 원복):
  제안 2건 → 그룹 생성 → 제안 0건 · 1세션 그룹 생성 · 5A 시드 · 단계 ask(감사 1행) · 없는 단계 E5093 ·
  담당자 · 기한 지난 할 일 → 보드 open 1/overdue 1, 기한 초과 필터 · 이력 from null→ask · 타임라인 8건 ·
  사용 중 단계 삭제 E5094 · 그룹 해제 → journeys/journey_tasks 0
- 스테이징: SQL 선적용 → 배포, API healthy·부팅 1회·스키마 에러 0, 신규 라우트 401
- **미확인**: 콘솔 실화면(배너·여정 카드·보드 드래그) — 스테이징 go2joy 세션 만료(대리 로그인 안 함), 로컬 확인 중 브라우저 확장 연결 끊김. 운영자 육안 확인 필요(TCR I3~I7).

## 4. 배포 상태

| 환경 | SQL | 코드 |
|------|-----|------|
| staging | ✅ 2026-10-06 `261006-journey-management.sql` 선적용 | ✅ `2e337c3` (FIX #586·P1 #588 포함) |
| production | ✅ 2026-10-06 선적용(백업 `~/backups/sharptalk-production/20261006-1311`) | ✅ `production` ff `3b2523b..f47f0a4` — check-migrations OK, api healthy·부팅 1회·스키마 에러 0, health 200, 신규 라우트 401, 콘솔 번들에 `/journey`·related-sessions 포함 |

## 5. 후속
- 회사 엔티티(여러 프로젝트를 한 회사로), 세그먼트, 리포트 5A 가설의 '단계 제안' 표시, 그룹 메모.
- 동일인 신호 확대(전화번호 등)는 오병합 위험으로 보류(D4).
