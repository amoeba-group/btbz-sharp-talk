# TCR-261008 — 답변에 "영상 바로 보기" 링크

- 근거: [PLN-261006-KB-Video-Links](../plan/PLN-261006-KB-Video-Links.md) (권장안 D1~D4 승인 2026-10-08)

## 1. 단위

| ID | 대상 | 케이스 | 결과 |
|----|------|--------|------|
| V1 | `kb-video.service.spec` | `video_ref` 해석: https·`notion:<32hex>` 허용, http·javascript·빈 값 거부 | ✅ |
| V2 | 〃 | 서명은 테넌트·문서에 묶임(다른 문서/테넌트·빈 서명 거부), 경로 형식 | ✅ |
| V3 | 〃 | 잘못된 서명 → DB 조회 전 거부 / 없는 문서 not_found / 영상 없는 문서 no_video | ✅ |
| V4 | 〃 | https 영상은 노션 호출 없이 통과 | ✅ |
| V5 | 〃 | 노션 파일: 새 URL 받아 만료 5분 전까지(최대 50분) 캐시 / 캐시 적중 시 노션 미호출 | ✅ |
| V6 | 〃 | 토큰 없음·영상 아닌 블록·노션 오류 → unavailable(503 안내) | ✅ |
| B1 | `bulk-import.service.spec` | `video_ref` 열 있으면 생성 시 지정 | ✅ |
| B2 | 〃 | 영상만 바뀐 행 → 갱신하되 재임베딩·리비전 없음 | ✅ |
| B3 | 〃 | 열 없는 옛 파일 재업로드 → 기존 링크 보존(skip) | ✅ |
| B4 | 〃 | 열 있는 파일의 빈 칸 → 링크 해제 | ✅ |
| B5 | 〃 | 형식 위반(`javascript:`, `notion:xyz`) → invalid | ✅ |
| E1 | `bulk-export.service.spec` | 내보내기 열 = 가져오기 열(`video_ref` 포함), CSV·XLSX 라운드트립 | ✅ |

전체: API jest 2,189 ✅ · turbo typecheck 9/9 ✅ · widget test 43 ✅ · i18n:check ✅ · 빌드 ✅

## 2. 데이터·통합

| ID | 시나리오 | 결과 |
|----|---------|------|
| D1 | 노션 페이지 영상 블록 63개 조회, 분석 Video n ↔ 위치 대응(n≤16 동일, n≥17 +3) | ✅ `reference/go2joy-hotel-admin-video-blocks.json` |
| D2 | 대응 실검증: 위치 24 프레임 = 예약 관리 v0.4.1 '체크인 완료' 탭(Video 21 체크인), 위치 27 = 예약 리포트 기간 필터(Video 24) | ✅ |
| D3 | 변환기 `--lang vi/en` → 52행 중 51행 `video_ref` | ✅ |
| I1 | 로컬 실부팅 + `kb_documents.video_ref` 생성, 잘못된 서명 → 404 안내 | ✅ |
| I2 | 스테이징 SQL 선적용 → 배포 → go2joy 102건 video_ref 지정 | ✅ API healthy·부팅 1회, 102건 지정 |
| I3 | 스테이징 위젯 질의(체크인) → 출처에 [▶ 영상 보기] → 302 → 실제 영상 | ✅ VI 체크인 질의 → Video 21 VI/EN 2건에 링크 → 302 → 200 `video/quicktime` 9.1MB, 노션 위치 24 원본과 바이트 동일. 변조 서명·다른 문서 404, Redis TTL ~50분 |
| P4-1 | 신규 영상 12편 → Video 51~62 분석(프레임 63장) → 변환기 64건×2, 언어 분리 726건 폐기·0 생존 | ✅ |
| P4-2 | 스모크 계정으로 실 일괄 등록 API | ✅ 언어별 created 12·skipped 52·embedded 12 |
| P4-3 | 신규 카테고리 8개 범위 [9,10,21] | ✅ (생성 직후 범위 없음 → 전 에이전트 노출이라 즉시 지정) |
| P4-4 | hotel-admin "How do I create a new room type?" → Video 55 인용+링크, VI 고객 채팅 질의 → Video 53 / landing-guest 같은 질의 → 인용 0건 | ✅ |
| P4-5 | Video 55 링크 재생 → 노션 위치 55 원본과 동일(59MB) | ✅ |

## 3. 엣지
- 상담원 라이브챗 화면은 원래 출처 목록이 없음 → 영상 링크는 위젯과 AI 설정 미리보기에만(PLN 대비 축소, RPT에 기록).
- 답변 재사용은 저장된 출처를 그대로 재생하므로 링크도 유지(서명이 만료되지 않음).
- 노션에서 영상을 지우면 링크는 503 안내 + 서버 warn — 답변 자체는 영향 없음.
