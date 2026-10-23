# RPT-261022 — go2joy HA: 서명 전 신원 수용(`claimed`) · AI 신원 주입 · 연속성 · 작업 로그 — 구현·로컬 실연 결과

- 근거: [REQ-261022](../analysis/REQ-261022-Go2Joy-HA-Unsigned-Identify.md) · [PLN-261022](../plan/PLN-261022-Go2Joy-HA-Unsigned-Identify.md)(P1~P8) · [SPEC-261022](../plan/SPEC-261022-Go2Joy-HA-Unsigned-Identify.md) · [TCR-261022](../test/TCR-261022-Go2Joy-HA-Unsigned-Identify.md)
- 공유용 보고서 PDF(스크린샷 21장, 영문·베트남어·한국어·한국어 화면판): `RPT-261022-Go2Joy-HA-Signin-Integration-Status.{en,vi,ko,ko-ui}.pdf` — 용량(8 MB) 때문에 저장소에 넣지 않고 별도 공유
- 브랜치 `feature/go2joy-ha-unsigned-identify`(base main `18559f08`)

## 1. 배포 상태
| 항목 | 값 |
|---|---|
| PR | **미생성**(커밋 전) |
| 스키마 | 변경 없음(엔티티는 주석만) → SQL 선적용 없음 |
| 스테이징 | **미배포**. 배포 시 백엔드 env `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS=4` 추가(Go2Joy·가이드 v1.3 담당과 합의 후) |
| 프로덕션 | 대상 아님(변수 미설정 = 현행 동작) |

## 2. 변경 내용
| 단계 | 내용 |
|---|---|
| P1 | 허용 목록 테넌트의 서명 불일치·시크릿 없음 identify → `identity_level=claimed`. 1단계 정규화(NFC·권역·지역표) + `user_id`·`name`만 세션에 저장, 고객·기업·동의·대화 귀속 없음, 이메일·전화 미저장, `verified` 세션 강등 금지(401). 허용 목록 판정은 `embed/unsigned-identify.ts`로 통합 |
| P2 | 콘솔 신원 응답에 `userId`·`name`(마스킹)·`verified`, 목록 이름 대체(`identity.name`), 헤더 "미검증" 배지·목록 방패 아이콘, 라우팅 조건 `identity_level=claimed`, 알림 메일 `· Unverified`, 라우팅 조건 안내 문구 갱신(6개 언어) |
| P6 | 세션의 HA 사용자가 정해지거나 바뀔 때 1회 감사 행 `host.user_signed_in`(actor `host`=세션 id, metadata `{level, hotelId, region}`, PII 없음). 조회 시 이름 해석·마스킹, `action_prefix` 쉼표 목록, 작업 로그 기본 `agent.,host.`·필터·배지(6개 언어) |
| P7 | claimed 스레드: 같은 테넌트 claimed 세션 중 `user_id`가 같은 것의 고객 없는 대화. 새 대화 `prev_conversation_id` 연결(허용 목록일 때만) → AI 직전 대화 발췌·sticky 배정 재사용. `threadAvailable`·`GET /chat/thread`가 claimed 허용. verified와 섞이지 않고 승격 시 병합 없음(D8ⓐ) |
| P8 | 호스트 속성이 있는 verified·claimed 세션의 두 답변 경로(RAG·인사)에 `CALLER_START…END` 블록(이름·호텔·성·권역·역할·Verified)과 규칙. 값은 한 줄·80자·블록 표식 제거. userId·이메일·전화 미전송. CALLER가 있는 답변은 재사용 저장 안 함. 이름 전송은 D9(사용자 결정) |
| 실연 중 수정 | claimed 이름이 콘솔·작업 로그에서 마스킹 없이 보이던 문제 → `maskName`. 좁은 목록 행에서 배지 잘림 → 아이콘 + 툴팁 |

## 3. 파일
- API 신규: `embed/unsigned-identify.ts`(+spec), `chat/caller-context.util.ts`(+spec)
- API 수정: `embed/{embed.service, embed.module, identity-attributes}`, `session/{session.service, session.mapper, entity/session.entity(주석)}`, `chat/{chat.service, chat.controller, rag.service, thread.service}`, `agent/{agent.service, agent.mapper, agent-console.controller, agent-alert.service}`, `audit/{audit.service, audit.module}` + 각 spec
- 공용 타입: `common/enum.types.ts`(`SESSION_IDENTITY.CLAIMED`), `common/routing-condition.ts`
- 웹: `live-chat/{IdentityBadges, LiveChatPage, live-chat.service}`, `work-log/{WorkLogPage, work-log.service}`, i18n `livechat`·`workLog`·`aiSetting` × 6개 언어
- 문서: `CONFIG.md`(env), REQ·PLN·SPEC·TCR·RPT-261022

## 4. 테스트 결과
| 항목 | 결과 |
|---|---|
| `apps/api` 전체 | 246 스위트 / 2,470개 통과(신규 40여 개) |
| `packages/types` | 186개 통과 |
| typecheck api·web, `npm run build` | 오류 0, 6/6 |
| `i18n:check` | 6개 언어 complete |
| 로컬 E2E(격리 스택·실 API·목 AI) | **25/25** |
| 로컬 화면 실연(헤드리스 Chromium) | 18개 화면 — TCR §6 |

## 5. Go2Joy 쪽 확인 (HA UAT, 2026-10-22)
| 시각 | 관찰 |
|---|---|
| 11:39 | 스니펫 고정 값(`go2joysupport`, `testing`, 고정 이메일·전화) → 위젯은 게스트(배너·"Support center") |
| 13:56 | **로그인 사용자 값으로 변경**(이름·이메일·호텔 1721·성·역할). 남은 문제: `hash "testing"`(F1), `region="Hồ Chí Minh"`(성 이름, F2 → 저장 시 `hồ_chí_minh`, 권역 규칙 불일치), 허용 외 키 `district·hotel_code·hotel_group_id·user_id·user_sn`(F3, 서명 시 전체 거부 원인), `userId=go2joysupport`(가이드 v1.3 `ha:{userSn}`, F4), `phone=""`(F5) |
| 재현 | 같은 payload → 스테이징 `401 E5048`, 이 브랜치 → `claimed` 저장(추가 키 무시, region 문제 확인) |

## 6. 남은 일
- Go2Joy: F2~F5 수정, 로그인 상태에서만 identify 확인(F7), 서버 HMAC 서명(G10), 개인정보 고지에 AI 처리·표시 이름 포함(G4·G5).
- SharpTalk: 가이드 v1.3 담당(KimIgyong)과 임시 모드 합의 → PR(`## Migration: 없음`) → 스테이징 배포·env 설정 → HA UAT 재확인 → 본 RPT에 배포 기록 추가.
- 서명 완료 후 env 제거(임시 모드 종료).
