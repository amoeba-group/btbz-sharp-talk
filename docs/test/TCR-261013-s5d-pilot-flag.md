# TCR-261013 — 호텔별 파일럿 허용 목록 (SG-40, s5d)

- 근거: [PLN-261012 §3.5 SG-40](../plan/PLN-261012-Go2Joy-Stage1-Gap-Closure.md), REQ-261012 §3.5·§5.3, 와이어프레임 W4·W8
- 범위: 서버 판정(채팅·시나리오·상담원 연결) + Redis 스냅샷 + 위젯/로더 `ivy:visibility` + 콘솔 `PilotAccessCard` + 감사
- 환경: 로컬(Windows), 스크래치 DB `scratch_s5d`(검증 후 삭제), 개발 Redis 공유. **미배포.**

## 1. 단위 — API (jest, 신규 8 suites · 158 tests 전부 통과)

| ID | 대상 | 케이스 | 결과 |
|----|------|--------|------|
| U1 | `pilot.util.spec` (33) | `signedHotelOf`: 서명+verified만 hotelSn 반환 / 게스트·v1(클레임 없음)·`signed≠true`·guest 레벨·빈 hotelSn → null / 표시용 `hotelName·hotelCode` 무시 / `maxAgeHours` 초과·`verifiedAt` 없음·파싱 불가 → 만료=null / 정책 없음·0·음수·NaN = 무기한 | ✅ |
| U2 | 〃 | `decidePilot` 행렬: 꺼짐/미설정=해당없음, 목록 호텔=허용, 비목록=거부, 게스트=`guestAllowed`, **식별된 비목록 호텔은 `guestAllowed`로 구제 안 됨**, 빈 목록=식별 호텔 전부 거부, 대소문자·앞자리 0 정확 비교 | ✅ |
| U3 | 〃 | 붙여넣기/CSV 파서: 쉼표·세미콜론·탭·공백 구분, 따옴표, 헤더행 건너뜀, BOM·CRLF·CR, 빈 줄·`#` 주석, 잘못된 첫 칸 보존, 메모 255자 절단, `1721, 2204`는 **메모로** 읽음(호텔로 추측 안 함) | ✅ |
| U4 | 〃 | `planHotelImport`: added/existing/reactivated/duplicate/invalid, 첫 등장 우선 | ✅ |
| S1 | `pilot.service.spec` (25) | 판정 행렬(서명 호텔 허용/비목록 거부/게스트 허용·불허/v1=게스트/미서명 클레임=게스트/**만료 신원=게스트**/기능 꺼짐: 목록 조회조차 안 함/`channel` 있는 preview·messenger 제외/일시중지 호텔 거부) | ✅ |
| S2 | 〃 | 테넌트 문구(세션 언어) → 없으면 내장 6개 언어 문구, **DB 오류는 거부로 전파(fail-closed)** | ✅ |
| S3 | 〃 | Redis 스냅샷: 60 s TTL로 1회 조회 후 캐시, 변경 후 `invalidate` → **같은 세션 객체로** 다음 턴 반영(추가·삭제·스위치), 테넌트별 키, 손상 캐시=미스, Redis 없이도 동작 | ✅ |
| S4 | 〃 | `statusFor`/`hintFor`: eligible `null/true/false`(+mode+notice), 서버 게이트와 같은 결정, 실패 시 `{eligible:null}`(페이지 로드 보호) | ✅ |
| A1 | `pilot-admin.service.spec` (27) | 설정 저장(전체 교체·캐시 삭제·`tenant.pilot_updated` 감사), 잘못된 모드/언어/길이/타입 → E5133, 감사 실패해도 변경 성공 | ✅ |
| A2 | 〃 | 호텔 추가: 정규화·`added_by`·감사·캐시 삭제 / 비서번호 E5130 / 멱등 / 일시중지 재개 / 한도 E5131 / 테넌트 격리 | ✅ |
| A3 | 〃 | **CSV 드라이런**: 건수·중복·무효 줄, **아무것도 쓰지 않음(저장·감사·캐시 0)**; 실제 적용은 드라이런과 동일 결과; 감사 1행; 이미 있는 것만 붙여넣으면 무변경; 빈 입력·헤더만·5000줄 초과 E5134; 한도 초과 E5131; Excel CSV | ✅ |
| A4 | 〃 | 일시중지/재개/삭제 + 감사(`pilot_hotel_removed`/`added`), 없는 호텔 404 E5132, 타 테넌트 행 접근 불가, 같은 상태 설정은 no-op | ✅ |
| C1 | `pilot.controller.spec` (31) | **권한**(실제 `AuthorizationGuard` × 핸들러 메타데이터): 읽기=MASTER·DIRECTOR, 쓰기 5개=MASTER만, MANAGER·STAFF 모두 거부, 시스템 admin 거부, principal 없음 거부, 모든 핸들러에 rank 데코레이터 | ✅ |
| C2 | 〃 | 호출이 항상 호출자 `tenantId`로 범위 한정, camelCase 응답, 페이지네이션, 미지정 `active`=전체, 임포트 미리보기 100행 제한(건수는 전체) | ✅ |
| C3 | 〃 | 요청 DTO snake_case 검증(camelCase 키 거부·모드·불린·길이) | ✅ |
| G1 | `chat.service.pilot-gate.spec` (16) | **강제 행렬**(실제 ChatService + 실제 PilotService): 서명 비목록 호텔 → 소프트 안내문·`pilotDenied`, **메시지·대화·CJM·분류기·RAG·모더레이션 호출 0** / 허용 호텔은 평소대로 / 게스트 허용·불허 / v1 / 미서명 / 만료 / 기능 꺼짐=기존과 동일 / preview·messenger 제외 / **동의 게이트가 먼저** | ✅ |
| G2 | 〃 | 호텔 추가 → 같은 세션의 다음 턴 허용(재식별 없이), 삭제 → 다음 턴 거부 | ✅ |
| G3 | 〃 | 상담원 연결(escalate): 비목록 호텔은 알림 발행·저장 없음, 목록 호텔은 정상 | ✅ |
| G4 | 〃 | PilotService 없이 만든 ChatService = 기존 동작 | ✅ |
| G5 | `scenario.service.pilot-gate.spec` (9) | 스크립트 버튼 경로 동일 계약(소프트 안내문·대화 미생성·행 0·모더레이션 0·CJM 0), 스크립트 없는 `message` 액션은 채팅 경로의 거부를 `pilotDenied`로 전달 | ✅ |
| R1 | `session.controller.pilot.spec` (12) | `ensure`·`identify` 응답의 `pilot`(null/true/false+mode+notice), 재확인 `POST /session/pilot`(공개, 새 호텔 추가 즉시 반영), 검증 실패 시 페이지 로드 유지, `SessionMapper`는 `pilot`이 없으면 키를 보내지 않음 | ✅ |
| V1 | `widget-branding.controller.pilot.spec` (5) | 공개 `visibility`에 `pilot:{enabled}` **한 가지 불린만**(목록 내용 노출 없음), 기존 판정 불변 | ✅ |

## 2. 단위 — packages/types, widget

| ID | 대상 | 케이스 | 결과 |
|----|------|--------|------|
| T1 | `pilot-access.spec` (12, types jest 13 suites·274 ✅) | `normalizeHotelSn`(정확 비교), `readPilotAccess` 기본값·`true`만 켜짐·알 수 없는 모드/언어, `pilotNoticeFor` | ✅ |
| W1 | `test/pilot.test.mjs` (15, node --test) | 서버 판정 → 뷰(`allowed/hide/notice`), 읽을 수 없는 값은 `allowed`(추측으로 숨기지 않음), 앱 모드에서 hide→안내문, `ivy:visibility` 메시지 모양(안내문/호텔 데이터 미포함), `reducePilot`(첫 판정 known, 열린 패널 닫기, 동일 객체 유지, 가역), 재확인 규칙(제한 상태·보이는 탭·90 s만) | ✅ |
| W2 | `test/embed-pilot-visibility.test.mjs` (20, **실제 `embed.js`를 vm에서 실행**) | 숨김=`display:none`(iframe 제거 아님)·**가역**·안내문 모드는 프레임 유지 / 자기 iframe의 메시지만(다른 소스·출처 무시)·불린 아닌 값 무시 / `visibility` 속성 불간섭 / `ShopTalk.on('visibility')` 변경당 1회(이유·모드 변경 포함), 던지는 핸들러 격리 / 파일럿 사용 테넌트는 판정까지 숨김·재방문 즉시 숨김·플래그 정리 / **10 s fail-open**·판정 오면 타이머 해제 / 파일럿 없는 테넌트·구 위젯 = 무변경 / 노출 제한의 `hideFrame`은 그대로 제거·되살리지 않음 | ✅ |

전체: API jest **249 suites 통과 · 3 실패(기존 Windows 기준선 `embed-loader`·`heic-conversion`·`board-attachment`)** · **2,636 tests 통과 · 3 실패(동일)** · widget node tests **97/97**(62 + 신규 35) · types jest 274/274 · `tsc -p tsconfig.check.json` api·web·widget 모두 0 오류 · `npm run i18n:check` 전 언어 complete · `migrations:manifest` diff = 신규 2줄만.

`embed-loader.spec.ts`는 기준선에서 CRLF 때문에 `keeps the widget iframe sandboxed` 1건만 실패(13건 중 12건 통과, 내 로더 수정 후에도 동일: 파싱 검사 포함 통과).

## 3. 게이트 없이는 실패함을 증명 (되돌려 실행 후 복구)

- `chat.service.ts`(2곳)·`scenario.service.ts`(1곳)의 `await this.pilot?.denialFor(session)`을 `null`로 바꾸고 `chat.service.pilot-gate`·`scenario.service.pilot-gate` 실행 → **25건 중 12건 실패**(거부해야 할 모든 케이스: 비목록 호텔, 게스트 불허, v1, 미서명, 만료, 언어 문구, 추가/삭제 반영, escalate). 통과한 13건은 "허용/기능 꺼짐/제외/동의 우선/미연결" 케이스. 복구 후 전부 통과(diff 33·20줄 복원 확인).
- 원본 `embed.js`(`git show HEAD:…`)로 로더 테스트 실행 → **19건 중 13건 실패**(숨김·가역·이벤트·보류·fail-open 등), 6건은 "무변경" 케이스라 통과.

## 4. 통합 — 실부팅 + HTTP 스모크 (스크래치 DB, 포트 3028)

| ID | 시나리오 | 결과 |
|----|---------|------|
| I1 | `DB_SYNCHRONIZE=true`로 실부팅 → `Nest application successfully started`, 라우트 8개 매핑(`tenants/me/pilot…`, `session/pilot`) | ✅ |
| I2 | synchronize가 만든 `tenant_pilot_hotels`/`tenants.pilot_access` DDL = `sql/261016-…sql` (바이너리 collation 포함). SQL 파일을 별도 빈 DB에 적용해 확인 후 삭제 | ✅ |
| I3 | 기능 꺼짐: ensure `pilot.eligible:null`, 비목록 호텔(3307) identify 후 채팅 → AI 응답(평소) | ✅ |
| I4 | 켜고 목록 1721·2204: 게스트 ensure `eligible:true`; 3307 identify → `eligible:false,mode:notice,notice:<테넌트 VI/내장>`; 채팅·**시나리오** → `pilotDenied:true, conversationId:null`; 1721 → AI 응답 | ✅ |
| I5 | **재식별 없이 반영**: 3307 추가(POST) → 같은 세션의 `/session/pilot` `eligible:true`, 바로 다음 채팅 AI 응답 / 삭제 → 바로 다음 채팅 거부 / 1721 일시중지 → 거부 (실 Redis 키 삭제 경유) | ✅ |
| I6 | 드라이런은 행을 만들지 않음(0), 적용 후 2건, 목록 API 페이지네이션 | ✅ |
| I7 | 게스트 불허 시 게스트 ensure `eligible:false,mode:hide`·채팅 거부, 기능 끄면 즉시 다시 응답 | ✅ |
| I8 | 잘못된 모드 400, 없는 호텔 DELETE 404, 잘못된 serial E5130, 토큰 없음 401 | ✅ |
| I9 | DB: `audit_logs`에 `tenant.pilot_updated`·`pilot_hotel_added`(single/bulk)·`pilot_hotel_removed`(deleted/paused) 기록; 거부된 턴은 `messages`·`conversations`에 흔적 없음(허용된 턴만 1건) | ✅ |
| I10 | 공개 `visibility`가 `pilot:{enabled:true}` 반환 | ✅ |

## 5. UI 스모크 — 브라우저(콘솔 5128, 위젯 5129, 로컬 Hotel Admin 대역 페이지)

| ID | 시나리오 | 결과 |
|----|---------|------|
| B1 | 콘솔 설정 › 위젯에 카드 표시(MASTER) → 켜기 → 옵션 노출 → "안내문 표시" + VI 문구 → [저장] → 토스트 "Pilot settings updated", 배지·요약 갱신 | ✅ |
| B2 | "목록 붙여넣기": 헤더·중복·잘못된 줄 포함 → [미리보기] 칩(신규 2·재개 1·중복 1·무효 1) + "Line 6" 메시지 + 행별 상태 → [N개 추가] → 토스트, 모달 닫힘, 개수 갱신 | ✅ |
| B3 | 로더+위젯: 파일럿 사용 테넌트 → `visibility {visible:true}` 이벤트, 게스트 런처 표시, localStorage `st:pilot:<shop>=1` | ✅ |
| B4 | 비목록 호텔 identify(안내문 모드) → 런처 유지, 열면 안내문 패널 | ✅ |
| B5 | hide 모드: 비목록 identify → `display:none`·iframe 유지·`visible:false/pilot/hide` 이벤트·런처 사라짐 → 목록 호텔 identify → **다시 표시** (가역) | ✅ |

## 6. 검증하지 못한 것 (NOT VERIFIED)

- **90 s 재확인 타이머의 실제 브라우저 동작**: 미리보기 창이 숨김 상태(`document.visibilityState === 'hidden'`)라, 규칙이 의도대로 "보이는 탭에서만"을 지켜 재확인을 건너뜀. 규칙은 W1로, 엔드포인트는 I5로 검증했으나 타이머 → 재표시의 끝단 흐름은 보이는 탭에서 못 봄.
- CSV **파일 선택기**(`<input type=file>`)는 브라우저에서 눌러 보지 않음(붙여넣기 경로와 서버 CSV 파서는 검증, `file.text()` → 같은 경로).
- 네이티브 WebView(RN/iOS/Android) 브리지로의 `ivy:visibility` 전달과 앱 모드 안내문 표시 — 코드·순수 함수 테스트만.
- `display:none` iframe의 Safari/Firefox 동작(Chromium 계열만 확인).
- 다중 API 인스턴스 간 캐시 무효화(Redis 키 삭제라 설계상 동일하나 인스턴스 1개로만 실행).
- DIRECTOR/STAFF 권한은 실제 가드 단위 테스트로 검증, HTTP로는 MASTER만.
- 안내문 기본 문구(6개 언어)와 콘솔 번역은 초안 — 원어민 검수 필요(특히 vi).

## 7. 엣지 메모
- 이미 대화 중인 게스트 세션이 비목록 호텔로 identify되면 같은 세션에 기존 대화가 남음 → 다음 채팅·상담원 연결은 거부되고, 위젯은 숨김.
- `channel`이 있는 세션(preview·messenger)은 판정 대상이 아님(콘솔 미리보기와 연결된 메신저 방을 "게스트 불허"가 조용히 끄지 않도록).
- 목록 켜짐 + 활성 호텔 0개는 허용(파일럿을 닫는 방법). 콘솔이 경고만 표시.
