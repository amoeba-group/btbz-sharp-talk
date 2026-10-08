# RPT-261008 — 채팅 마크다운 보기 모드 표시

- 요구: 채팅 위젯·콘솔 채팅 화면에서 `**굵게**` 같은 마크다운이 기호 그대로 보임 → 서식으로 표시
- 문서: [REQ](../analysis/REQ-261008-Chat-Markdown-Render.md) · [PLN](../plan/PLN-261008-Chat-Markdown-Render.md) (승인: D1 고객 메시지 원문 · D2 메신저 평문화 · D3 표 미지원)

## 변경
| 영역 | 내용 |
|---|---|
| `packages/types/src/common/markdown-lite.ts` | 경량 파서 `parseLiteMarkdown`(굵게·기울임·인라인 코드·글머리표·번호 목록·1단 중첩·http(s) 링크)와 `stripLiteMarkdown`(평문). HTML 문자열을 만들지 않고 데이터만 반환. lookbehind 정규식 미사용(구형 Safari) |
| 위젯 `RichText` / `MessageBubble` | AI·상담원·시스템 메시지는 서식 표시, 고객 메시지는 원문 |
| 콘솔 `RichText`·`MessageBody` | 라이브챗 대화창, 대화 기록, AI 설정 미리보기, 이슈 미리보기 |
| 라이브챗 목록 미리보기 | 기호를 뺀 한 줄 평문 |
| `messenger-outbox.service` | 메신저 채널(카카오·잘로 등) 발송은 평문(`- **Email:**` → `• Email:`). 저장 원문은 그대로 |

저장 데이터·API 응답은 바뀌지 않는다(표시 계층만 변경). 링크는 `target=_blank rel="noopener noreferrer"`, `javascript:` 같은 스킴은 링크가 되지 않는다.

## 테스트
- 파서 단위 10건: 중첩, 링크 끝 구두점, `2 * 3 * 4`·`file_name_v2`·미닫힘 `**` 오탐 방지, HTML 문자열 비해석, 목록·중첩·시작 번호, 평문화
- 메신저 평문 발송 1건(outbox 17건 통과), API 전체 스위트, web·widget 빌드
- CI: 첫 실행에서 `radius:check` 게이트가 인라인 코드의 고정 `rounded`를 잡음 → `rounded-st-xs`(테넌트 모서리 토큰)로 수정 후 통과
- 스테이징 실측(go2joy 위젯, 기존 대화): `<strong>` 17개, `ul` 4개, `ol` 1개 렌더, 화면 텍스트의 `**` 0개
- 콘솔 화면은 로그인이 필요해 직접 열지 않았다(같은 파서·같은 컴포넌트 구조, 빌드 산출물 확인)

## 배포
| 환경 | 상태 |
|---|---|
| PR | #629 (REQ/PLN), #630 (구현, squash 8e419e8) |
| 마이그레이션 | 없음 |
| 스테이징 | 배포 완료 — API healthy, 부팅 로그 확인, widget/web/api 산출물에 신규 코드 확인 |
| 프로덕션 | 배포 완료(production 8e419e8) — check-migrations OK, API healthy, 부팅 로그 확인 |
