# RPT-261023 라이브챗 — 고객·상담원 메시지 각각 번역

- 근거: REQ/PLN/TCR-261023-LiveChat-Bidirectional-Translation
- 결정: D1 답장 번역 후 발송 **제외**(운영자 열람 전용) · D2 자동응답 중 대화도 번역 **노출** · D3 번역은 콘솔 전용

## 변경 내용

- **서버** `agent.service.ts` `translateMessage`: 발화자별 프롬프트(고객 메시지 / 지원 답변 — 마크다운·목록·링크 보존), system 메시지는 E5003 거부. 엔드포인트·응답·캐시 키 불변.
- **콘솔** `LiveChatPage.tsx`:
  - 번역 아이콘+언어 팝오버를 `renderTranslateControl`로 묶어 고객·상담원·AI 버블이 공유.
  - 상담원·AI 버블: 호버 시 버블 왼쪽(시각 옆)에 번역 버튼, 번역 서브버블은 우측 정렬, AI·상담원 번역은 마크다운 렌더.
  - 번역 버튼은 대화 상태와 무관하게 항상 노출(AI 자동응답 중 포함). 지식조회·답글·이슈 3종은 기존 게이트 유지.
- i18n 신규 키 없음 · 스키마 변경 없음 · 마이그레이션 없음 · 신규 에러코드 없음.

## 파일

- `apps/api/src/domain/agent/agent.service.ts`
- `apps/api/src/domain/agent/agent.service.pin.spec.ts`
- `apps/web/src/domain/live-chat/LiveChatPage.tsx`
- `docs/analysis/REQ-261023-…`, `docs/plan/PLN-261023-…`, `docs/test/TCR-261023-…`, 본 문서

## 테스트

- `npm run typecheck` 9/9 · `npx jest src/domain/agent` 132/132 · `npm run i18n:check` 통과
- 로컬 실부팅 + 화면 확인(TCR I1~I6)

## 배포 상태

| 항목 | 상태 |
|---|---|
| PR | #696 squash-merge → main `d89001d9` (CI typecheck·test·build 통과) |
| 마이그레이션 | 없음(스키마 변경 없음) |
| 스테이징 | ✅ 2026-10-23 11:40 KST `deploy-staging.sh` — api healthy, 부팅 로그 `successfully started`, 컨테이너 내 API(`support reply` 프롬프트)·웹 번들(우측 정렬 서브버블) 새 코드 확인, `POST /agent/messages/:id/translate` 401 |
| 프로덕션 | ✅ 2026-10-23 11:43 KST `production` ff `18559f08..d89001d9` → `deploy-self-hosted.sh --check`(마이그레이션 누락 0) → 배포. api healthy, 부팅 로그, 새 코드 확인, 라우트 401 |
| 동승 | #695(go2joy HA 서명 전 identify)가 같은 ff로 스테이징·프로덕션에 함께 반영 — `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS` 양쪽 미설정 확인 = 현행 동작(사용자 승인) |
| 잔여 확인 | 스테이징 실 LLM 번역 품질·상담원 버블 육안(콘솔 로그인 필요) |
