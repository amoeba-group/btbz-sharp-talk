# RPT-261013 — 호텔별 파일럿 허용 목록 (SG-40, s5d)

- 근거: PLN-261012 §3.5 SG-40 · REQ-261012 §3.5·§5.3 · W4·W8, 테스트: [TCR-261013-s5d-pilot-flag](../test/TCR-261013-s5d-pilot-flag.md)
- 브랜치: `feature/go2joy-s5d-pilot-flag` (base = `test/go2joy-integration` f7266697). **미배포 · 미푸시.**

## 1. 결과 요약
Go2Joy가 에이전트를 **서명된 `hotelSn` 목록의 호텔에만** 노출하고 점차 넓힐 수 있다. 서버가 매 턴 판정(권위), 위젯은 그에 맞춰 스스로 비켜 준다.

| 영역 | 내용 |
|------|------|
| 스키마 | `tenant_pilot_hotels`(UNIQUE `tenant_id+hotel_sn`, serial은 `utf8mb4_bin`) · `tenants.pilot_access` JSON `{enabled, guestAllowed(기본 true), nonPilot('hide'\|'notice', 기본 hide), notice{언어}}` |
| 강제(서버) | `ChatService.handleUserMessage` **동의 게이트 직후**, `escalate`, `ScenarioService` 스크립트 경로. 서명·`verified`·미만료 신원의 `claims.hotelSn`**만** 사용. 거부 = 소프트 다국어 시스템 응답, **저장 0 · LLM 0 · 대화 미생성 · CJM 0**, `pilot_denied` 로그. 게스트 = `guestAllowed`, v1·미서명·만료 = 게스트. 세션 생성 시에는 막지 않음 |
| 캐시 | Redis JSON 스냅샷 60 s TTL(설정+활성 호텔), 콘솔 변경마다 키 삭제 → 호텔 추가가 재식별 없이 다음 턴에 반영 |
| 응답 | `ensure`·`identify`에 `pilot:{eligible:null\|true\|false, mode?, notice?}`(비파괴), `POST /session/pilot` 재확인, 공개 `visibility`에 `pilot:{enabled}` |
| 위젯/로더 | **가역** `ivy:visibility`(display 토글, iframe 유지), 파일럿 사용 테넌트는 판정 전까지 숨김(재방문 즉시, 10 s fail-open), hide/notice 패널, 제한 상태 90 s 재확인, `ShopTalk.on('visibility')` |
| 콘솔 | `PilotAccessCard`(설정 › 위젯, `WidgetAccessCard` 옆): 스위치·비목록 동작·게스트·언어별 문구·호텔 표(추가/붙여넣기/CSV 미리보기→적용/일시중지/삭제)·토스트·6개 언어 |
| API | `tenants/me/pilot` GET(MASTER·DIRECTOR)/PUT(MASTER), `…/hotels` GET·POST, `…/hotels/import`(`dry_run`), `…/hotels/:hotelSn` PATCH·DELETE. 감사 `tenant.pilot_updated`·`pilot_hotel_added`·`pilot_hotel_removed` |

## 2. 커밋
| SHA | 제목 |
|-----|------|
| `81e79f13` | feat(pilot): schema, entity, shared types for the hotel pilot allowlist (SG-40) |
| `2ab6b191` | feat(pilot): server-side allowlist enforcement + console API (SG-40) |
| `78644f94` | feat(pilot): widget hides/shows for the hotel allowlist, reversible ivy:visibility (SG-40) |
| `a8e5df2f` | feat(pilot): console PilotAccessCard in widget settings, i18n x6 (SG-40, W4) |
| (docs) | docs: TCR/RPT-261013-s5d-pilot-flag |

## 3. 파일
- SQL: `sql/261016-tenant-pilot-hotels.sql`, `sql/artefacts.tsv`(+2줄), `docker/init-sql/01-schema.sql`
- types: `packages/types/src/common/pilot-access.ts`(+spec), `index.ts`, `api/widget.types.ts`
- API 신규 `apps/api/src/domain/pilot/`: `entity/tenant-pilot-hotel.entity.ts`, `pilot.service.ts`, `pilot-admin.service.ts`, `pilot.controller.ts`, `pilot.util.ts`, `pilot.mapper.ts`, `pilot.messages.ts`, `pilot.module.ts`, `dto/{request,response}/pilot.*.ts` + spec 5개
- API 수정(작은 hunk): `app.module.ts`, `chat.module.ts`, `chat.service.ts`(+33줄: import·trailing 선택 파라미터·게이트 2곳·`EscalateOutcome.pilotDenied`), `scenario.service.ts`(+20), `session.{controller,mapper,module}.ts`, `session.request.ts`, `embed.{controller,module}.ts`, `widget-branding.controller.ts`, `tenant.entity.ts`, `error-code.constant.ts`(E5130–E5134) + spec 4개
- widget: `public/embed.js`(로더 hunk 5곳), `lib/pilot.ts`, `hooks/usePilotVisibility.ts`, `components/widget/PilotNoticePanel.tsx`, `Widget.tsx`, `widgetStore.ts`, `sessionService.ts`, `useSession.ts`·`useSessionProfile.ts`·`useEmbedCommands.ts`·`useChat.ts`(각 3~7줄), 테스트 2개
- console: `PilotAccessCard.tsx`·`PilotHotelsPanel.tsx`·`PilotImportModal.tsx`·`pilot.service.ts`·`pilot.hooks.ts`, `SettingsWidgetPage.tsx`(+4줄), `i18n/locales/{en,es,ko,vi,ja,zh}/settings.json`(`pilot` 블록 말미 추가)
- 문서: `docs/guide/임베드SDK설치가이드_Embed-SDK.ko.md`(§ 파일럿 호텔 제한과 `visibility` 이벤트)

## 4. 테스트 결과
API jest 249 suites 통과 / 3 기준선 실패(`embed-loader`·`heic-conversion`·`board-attachment`, 내 변경과 무관), 2,636 tests 통과(신규 158) · types 274(+12) · widget node 97(+35) · tsc 3개 0 오류 · i18n:check complete · manifest diff 2줄 · 실부팅 `successfully started` · HTTP/브라우저 스모크 통과. 게이트 제거 시 12/25 실패, 원본 로더로 13/19 실패(증명). 상세는 TCR.

## 5. 배포 상태 · 마이그레이션 (`## Migration`)
| 환경 | SQL | 코드 |
|------|-----|------|
| local | 스크래치 DB 부팅·적용 검증 후 삭제 | 미배포 |
| staging | ⬜ 미적용 | ⬜ |
| production | ⬜ | ⬜ |

1. **순서: 코드 배포 전에 SQL 먼저**(스테이징은 `DB_SYNCHRONIZE=false`). 옛 코드 + 새 스키마는 안전, 새 코드 + 옛 스키마는 500(`pilot_access` 컬럼·테이블 없음).
2. 적용: `sql/261016-tenant-pilot-hotels.sql` — `CREATE TABLE IF NOT EXISTS`는 멱등, `ALTER TABLE tenants ADD COLUMN pilot_access`는 `SHOW COLUMNS FROM tenants LIKE 'pilot_access'` 확인 후 실행. `AFTER` 없음.
3. 롤백(코드 되돌린 뒤): `DROP TABLE tenant_pilot_hotels; ALTER TABLE tenants DROP COLUMN pilot_access;`
4. 확인: `npm run migrations:manifest` 후 `git diff --ignore-space-at-eol --stat sql/artefacts.tsv`(신규 2줄), `node scripts/check-migrations.mjs --json`(대상 DB), 새 라우트 `POST /session/pilot`·`GET /tenants/me/pilot` → 401(=배포됨)/404(=미배포).
5. 새 환경변수 없음(캐시 TTL 60 s는 상수 `PILOT_CACHE_TTL_SEC`). 기능은 테넌트가 콘솔에서 켜기 전까지 **꺼짐**: `pilot_access`가 없는 테넌트는 기존과 동일(요청당 Redis GET 1회 추가가 유일한 차이).

## 6. PLN 대비 차이 (근거 포함)
1. **SQL 파일명**: PLN 표는 `261015-…`, 브리프 지시대로 `261016-tenant-pilot-hotels.sql`.
2. **콘솔 경로**: `/tenant/pilot` 대신 `tenants/me/pilot`(기존 `tenants/me/<기능>` 관례 + `GET tenants/:uuid`와 겹치지 않음). 쓰기는 브리프대로 `PUT`(기존 widget-access는 `PATCH`).
3. **판정 대상 제외**: `channel`이 있는 세션(preview·messenger)은 규칙 밖. 메신저에는 서명된 호텔이 없어 "게스트 불허"가 연결된 방을 조용히 끄기 때문.
4. **상담원 연결(escalate)도 게이트** — 브리프에 없었으나, 비목록 호텔이 지원팀을 호출하면 파일럿 제한이 무의미해짐(게스트로 대화 후 identify한 세션이 방법).
5. **재확인 경로 추가**: `POST /session/pilot` + 위젯 90 s 재확인. 숨김 모드에서는 사용자가 메시지를 못 보내므로 이게 없으면 "추가가 재로그인 없이 반영"이 서버에서만 참이고 화면에는 반영되지 않음.
6. **`pilot_denied` 흔적 = 서버 warn 로그**: 거부 턴은 아무것도 저장하지 않아 메시지 행에 trace를 실을 수 없고, base에 `REFUSAL_REASON` enum(SG-50)이 아직 없음 → `PILOT_DENIED` 상수로 두었으니 s1b가 enum을 넣으면 연결.
7. **안내문 기본 문구 위치**: `SYSTEM_MESSAGES` 대신 `pilot.messages.ts`(PilotService가 `chat.service`를 import하면 순환). ChatService는 해석 결과만 전달. 6개 언어·테넌트 `notice` 오버라이드 요건은 충족.
8. **파트너 컨텍스트 헤더의 "파일럿 여부" 배지는 하지 않음**: 상담원 대화 목록·상세 매퍼마다 PilotService를 끌어와야 해서 "사소하지 않음"(브리프 조건). 후속.
9. **s1b 신원 헬퍼 대신 로컬 `signedHotelOf`**(브리프 지시). 만료는 `tenant.identityPolicy.maxAgeHours`를 **형태로만** 읽음(`identity_policy` 컬럼이 s1b에서 오면 그 순간부터 동작, 지금은 null=무기한). 컬럼/키 이름은 PLN §4의 `tenants.identity_policy {maxAgeHours}` 가정 → s1b가 다른 이름이면 `pilot.service.ts`의 `maxAgeHoursOf` 한 곳만 수정.
10. 활성 호텔 0개 + 켜짐은 서버가 막지 않음(파일럿을 닫는 방법). `WidgetAccess`의 `NO_RULES` 같은 거부를 두지 않았고 콘솔이 경고함.

## 7. 알려진 한계 · 후속
- **비목록 호텔의 `identify`는 여전히 `customers` 행(이름·이메일·전화)을 upsert**한다(`EmbedService.identify`는 건드리지 않음 — s1b 영역). "비목록 호텔은 저장 0"이 필요하면 호스트가 `visibility` 이벤트로 identify를 건너뛰거나, `identify`에 게이트 추가.
- 안내문은 ensure 시점 세션 언어로 해석됨(언어 전환 후 최대 90 s까지 이전 언어). 필요 시 `/session/pilot` 응답을 언어 변경 때도 호출.
- 분석(SG-52 활성 호텔 vs 목록), 역할별 티어는 범위 밖(웨이브 2). 거부 건수는 로그뿐.
- 번역·기본 안내문 원어민 검수(특히 vi), Go2Joy 안내문 확정.

## 8. 검증됨 / 검증 못함
- **검증됨**: 위 §4 전부 + 로컬 브라우저에서 콘솔 저장·붙여넣기 미리보기/적용·토스트, 로더+위젯의 숨김/안내문/가역 재표시/이벤트.
- **검증 못함**: 90 s 재확인 타이머의 실제(보이는 탭) 흐름 — 미리보기 창이 숨김이라 규칙상 건너뜀; CSV 파일 선택기 클릭; 네이티브 WebView 브리지; Safari/Firefox; 다중 인스턴스 캐시 무효화; DIRECTOR/STAFF의 HTTP 권한(가드 단위 테스트만); `embed-loader.spec.ts` 기준선 1건(Windows CRLF).

## 9. 다른 스트림과의 충돌 위험
- `error-code.constant.ts` 말미, `tenant.entity.ts`(`defaultLanguage` 뒤), `docker/init-sql/01-schema.sql` `tenants` 끝, `sql/artefacts.tsv`, 로케일 `settings.json` 말미: 모든 스트림이 같은 지점에 덧붙이므로 인접 hunk 충돌(내용은 독립).
- `chat.service.ts`: 생성자 **맨 뒤 선택 파라미터**(`pilot`) — 다른 스트림도 뒤에 붙이므로 순서가 바뀔 수 있음. 내 spec은 `Object.assign(svc, { pilot })`로 필드명 주입해 순서에 의존하지 않음. 게이트는 동의 게이트 직후(s4의 SG-31 전처리는 그 뒤라 인접하지 않음).
- `embed.js`: s1b(`identity-expired` 전달)·s5a(제목/probe 설정)와 **같은 메시지 핸들러·boot·checkVisibility 근처**를 만짐. 내 hunk는 (a) `accessDenied` 뒤 변수 7줄 (b) `revealFrame` 뒤 함수 2개 (c) `checkVisibility` 안 pilot 4줄 (d) `boot()` 1줄 (e) 메시지 핸들러 `ivy:unread` 앞 분기 하나.
- `session.controller.ts`·`embed.controller.ts`: s1b가 identify 응답/로그아웃을 건드리면 `toResponse(..., pilot)` 4번째 인자 줄이 충돌할 수 있음. `Widget.tsx`·`useEmbedCommands.ts`(identify 후 처리)도 인접.
