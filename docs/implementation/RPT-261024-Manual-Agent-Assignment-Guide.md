# RPT-261024 — 사용자 매뉴얼 07 상담원 배정 가이드

- REQ: `docs/analysis/REQ-261024-Manual-Agent-Assignment-Guide.md`
- PLN: `docs/plan/PLN-261024-Manual-Agent-Assignment-Guide.md` (D1~D5 권장안 승인)
- TCR: `docs/test/TCR-261024-Manual-Agent-Assignment-Guide.md`

## 1. 결과
- **새 매뉴얼** `/manual/agent-assignment.{ko,en,vi}.html`(+MD 원문), 11장
  1. 한눈에 보기
  2. 상담원·팀·라벨
  3. 상담카테고리
  4. 배정 규칙(배정 확인·경고)
  5. 고객 화면(A: 상담원 연결 칩, B: AI 인계)
  6. 배정 판단 예시 표
  7. 알람(내 배정 / 다른 상담원 / 알람센터)
  8. 응대
  9. 알람 설정
  10. 체크리스트
  11. FAQ
- **캡처** `img/asg-*`: 17개 장면 × ko/en, 34장. vi는 en 이미지를 쓴다.
- **연결**: /manual 목록 카드 07, 통합 매뉴얼 14.1과 지식·AI 5.1a 링크(3개 언어). 변환기 DOC_META 추가.

## 2. 배포

| 환경 | 코드 | 확인 |
|---|---|---|
| 스테이징 | main ff → `c3ea0c10`, `deploy-staging.sh` | `successfully started`, ERROR 0. 3개 언어 페이지·이미지 200, 목록 카드 07 |
| 프로덕션 | `production` 36713aa0..c3ea0c10, `deploy-self-hosted.sh` | `successfully started`, ERROR 0, health 200. 페이지·이미지 200, 목록 카드 07 |

- PR #738(squash `cfc2e762`)
- ⚠️ **함께 반영된 다른 작업**: 이번 ff에 다른 세션의 #737(HA 연동 규격 v1.4 수신 코드)과 #736·#739(문서)가 포함되어 프로덕션에 함께 반영됐다.
  - #737은 SQL 변경이 없다. `handoff_config` JSON에 선택 필드 `provinceIndex`를 추가했을 뿐이다.
  - 배포 후 프로덕션 API는 정상(healthy, health 200, 오류 로그 없음)이다.
  - 해당 세션(go2joy-ha-77)에 알렸다.
