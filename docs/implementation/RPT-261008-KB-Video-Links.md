# RPT-261008 — 답변에 "영상 바로 보기" 링크 (go2joy)

- 근거: REQ/PLN-261006-KB-Video-Links(권장안 D1~D4 승인 2026-10-08), TCR-261008-KB-Video-Links

## 1. 결과
| 단계 | 내용 | 상태 |
|------|------|------|
| P1 | `kb_documents.video_ref`, 콘솔 문서 편집 "영상" 칸, 일괄 등록/내보내기 `video_ref` 열 | 스테이징 ✅ |
| P2 | `GET /api/v1/kb-videos/:id?t=&sig=` 서명 링크 → 노션 새 URL 302, Redis 캐시 | 스테이징 ✅ |
| P3 | 위젯 출처 "▶ 영상 보기"(영상 출처 우선), AI 설정 미리보기 | 스테이징 ✅ |
| P4 | 신규 영상 12편 지식화(Video 51~62) — **고객 채팅·객실 유형 등록·정책·채널** | 스테이징 ✅ |
| 데이터 | go2joy 영상 KB 126건(VI/EN × 63편) 전부 영상 링크 | 스테이징 ✅ |

PLN 대비 차이: 상담원 라이브챗 화면에는 원래 출처 목록이 없어 링크를 넣지 않음(위젯·미리보기만).

## 2. 변경
| PR | 커밋 | 내용 |
|----|------|------|
| #592 | (docs) | REQ/PLN |
| #618 | `5efc0d8` | P1~P3 — 엔티티·SQL `261008-kb-documents-video-ref.sql`·`KbVideoService/Controller`·`video-ref.util`·`signKbVideo`·`NotionClient.videoUrl`·rag 출처 `videoUrl`·위젯/콘솔·`reference/go2joy-hotel-admin-video-blocks.json`·`scripts/go2joy-video-refs-sql.mjs` |
| (이 PR) | | P4 — `reference/hoteladminvideoguidevien.md` Video 51~62(12편, 목차 포함), 블록 대응표 63편 전부 번호 부여, 변환기 카테고리 4개·63편 |

## 3. 조사로 확인한 사실
- 노션 페이지 영상 63개 **전부 노션 업로드 파일**(서명 URL 약 1시간 만료) → 직접 링크 불가, 서버 경유 서명 링크로 해결.
- 분석 Video n ↔ 노션 순서: n≤16 동일, 17~50은 +3(분석 이후 메시지 영상 3편 삽입). 위치 24(Video 21 체크인)·27(Video 24 리포트) 실프레임으로 검증.
- 261001 go2joy 테스트에서 "없다"던 **고객 채팅·객실 등록** 영상이 분석 이후 추가된 12편 안에 있었음 → Video 53·55로 지식화.

## 4. 검증 요약
- 단위: API jest 2,189 · typecheck 9/9 · widget 43 · i18n · CI ✅
- 스테이징: 체크인(VI) → Video 21 링크 → 실제 영상(원본과 바이트 동일), 객실 등록(EN) → Video 55 링크 → 실제 영상, 고객 채팅(VI) → Video 53, landing-guest는 미노출, 변조 서명 404.
- 재생 형식: 원본이 `.mov`(video/quicktime) — Chrome·Safari 재생, Firefox는 내려받기가 될 수 있음.

## 5. 배포 상태
| 환경 | SQL | 코드 | 데이터 |
|------|-----|------|--------|
| staging | ✅ 2026-10-08 선적용 | ✅ `5efc0d8` | ✅ go2joy 126건 링크, 신규 24건 임베딩, 카테고리 8개 범위 |
| production | ⬜ | ⬜ | go2joy 없음 — SQL+코드만 반영하면 동작 변화 0 |

## 6. 운영 메모
- 노션 영상이 바뀌면: 블록 순서가 그대로면 링크는 자동으로 새 영상을 가리킴. 영상이 추가·삭제되면 노션 API로 페이지의 video 블록을 다시 나열(이번엔 스테이징 API 컨테이너 안에서 일회성 스크립트로 조회 — 저장소에 상시 도구 없음) → 대응표 갱신 → 변환기 → 일괄 등록(멱등).
- go2joy 노션 토큰이 끊기면 링크는 503 안내 + warn 로그(답변은 정상).
- 링크 공개 범위(D2): 링크를 받은 사람은 그 영상 1편을 볼 수 있음 — go2joy 동의 확인 필요.
