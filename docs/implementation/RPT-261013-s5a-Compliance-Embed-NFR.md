# RPT-261013-s5a — 컴플라이언스(SG-70) · 임베드 보안(SG-82) · NFR 측정(SG-53)

- 근거: PLN-261012 Go2Joy Stage1 Gap Closure §3.5 · REQ §3.6 / §3.8 / §3.9 · TCR-261013-s5a-Compliance-Embed-NFR
- 브랜치 `feature/go2joy-s5a-compliance-embed` (기준 `f7266697`), 커밋 12개, **푸시·배포 안 함**

> ⚠️ **법적 문구는 초안이다.** 적용 법령(저장소는 Nghị định 13/2023만 인용했고 2025년 개인정보보호법의 적용 여부·시행일은
> **확인되지 않음**), 처리·국외이전의 법적 근거, 컨트롤러 정보는 Go2Joy와 법무가 확정해야 하고 vi 문안은 원어민 검수가 필요하다.
> 이 단서는 최종 사용자에게 보이는 문구에는 넣지 않았고, 코드 주석(`privacy-notice-copy.ts`)·콘솔 경고·
> `GUIDE-261013-Go2Joy-PDPL-Checklist.md`에만 있다.

## 1. 결과 한눈에

| SG | 요구 | 상태 | 핵심 |
|----|------|------|------|
| SG-70 | `vn_pdpl` 프로필 + 서버 보간 + 위젯/콘솔 표시 | ✅ | 키 9개, vi/en 전부 작성, 그 외 언어는 EN 줄(번들 CCPA 문구로 안 떨어짐) |
| 〃 | 보존: 틀린 주석 수정 · customers/audit_logs 옵트인 | ✅ | 기본 **꺼짐**. 실DB로 검증 |
| 〃 | 동의 증적 | ✅ | `audit_logs` `consent.granted|declined|withdrawn`, PII·IP 없음 |
| 〃 | 운영자 DSAR 화면 | ✅ | API + 콘솔 탭 + 토스트 + i18n×6 + 감사 |
| 〃 | DPIA · 처리자 대장 · 사고 대응 · 점검표 | ✅ | 점검표는 vi/en, 연락처는 전부 placeholder |
| SG-82 | CSP/CORS 문서 | ✅ | vi/en 1문서, 코드로 주장 검증 |
| 〃 | `frame-ancestors`(nginx, env) | ✅ 코드 · ⬜ 실행 | 렌더·구조 테스트만, nginx 미실행 |
| 〃 | iframe title · identity 프로브 설정화 | ✅ | 실제 `embed.js`를 vm에서 테스트(원본에서 실패 확인) |
| 〃 | 폰트 | ✅ | Pretendard 1.3.9 로컬 사본 **번들**(다운로드 없음) + 선택 스위치 |
| SG-53 | 언어 코퍼스 ≥500 + 게이트 + 개선 | ✅ | 642문장, 수정 전 60.0% → 100%(게이트), 홀드아웃 65문장 100% |
| 〃 | 턴별 시간 | ✅ 기록 · ⬜ 실측치 | `retrieval_trace.latencyMs`, P50/P95 헬퍼. 실제 LLM 수치는 측정 못 함 |
| 〃 | NFR-008 | ✅ 실행 1회 | Windows/Consolas에서 합격, 다른 OS는 미실행 |

## 2. 커밋

| SHA | 제목 |
|-----|------|
| `3b666359` | feat(privacy): vn_pdpl 프로필, 서버 보간, 동의 증적 (SG-70) |
| `30660d99` | feat(privacy): 옵트인 보존 + 운영자 DSAR (SG-70) |
| `be3266b1` | docs(privacy): DPIA/처리자/사고/점검표 (SG-70) |
| `7ed10cd8` | feat(embed): frame-ancestors env, title/identity/폰트 설정, CSP·CORS 가이드 (SG-82) |
| `be6b3cda` | docs(embed): SDK 가이드에 신규 키 (SG-82) |
| `e7b183b6` | feat(nfr): 언어 코퍼스 + 검출기 개선 (SG-53) |
| `116afb71` | feat(nfr): 턴별 지연 trace (SG-53) |
| `f96ee024` | feat(nfr): NFR-008 하네스 (SG-53) |
| `c39cab4b` | fix(privacy): 운영자 DSAR 숫자 id (브라우저 스모크에서 발견) |
| `762362c0` | feat(embed): Pretendard 번들 (SG-82) |
| `b99c4637` | docs: Basic Setup 가이드의 보존 기본값 정정 |
| (이 RPT/TCR 커밋) | docs: TCR/RPT |

## 3. 변경 내용

### SG-70
- **프로필·보간** — `packages/types/.../privacy-notice-copy.ts`: `PRIVACY_PROFILE.VN_PDPL`, 키 `controller`·`crossBorder`·`rights`, `interpolateNoticeLine`/`aiRegionName`, `normalizePrivacyNoticeCopy`에 줄당 1000자 상한. `retention-policy.util.ts`가 퍼지 잡과 고지가 **같은 env 해석**을 쓰게 함(`blank/0 → 365`). `SessionService.privacyNotice`와 `TenantMapper.toPrivacyNotice`가 서버에서 보간. 다른 프로필의 결과는 바이트 동일.
- **표시** — `ConsentBanner.tsx`: 새 3줄은 서버가 보낼 때만 표시(번들 대체 문구 **없음**), 긴 목록은 `max-h-56` 스크롤(포커스 가능). `PrivacyNoticePage.tsx`: 프로필 옵션, 줄별 textarea, `[[…]]` 미작성 경고, 초안 안내(운영자용). `settings.json`×6.
- **동의 증적** — `SessionService.setConsent`가 `audit_logs`에 기록(actor `system`, `ip:null`, 대상 `session:<id>`, 버전·언어). 위젯 재기록은 `replayed:true`로 구분해 **기록하지 않음**(페이지 로드마다 1행이 쌓이는 것 방지).
- **보존** — `OptInRetentionService`(신규): `CUSTOMER_RETENTION_DAYS`(활동 없는 고객 **익명화**, 삭제 아님 — FK는 없지만 주문·알림·세션이 id를 들고 있음), `AUDIT_LOG_RETENTION_DAYS`(청크 삭제, **90일 하한**). 둘 다 비어 있으면 아무 쿼리도 안 함. 4개 `.env` 예시의 틀린 주석("0이면 영구") 정정 + `GUIDE-260913-SharpTalk-Basic-Setup.md`의 같은 오류 정정.
- **삭제/내보내기** — `PrivacyService`가 `exportCustomer`/`eraseCustomer`(id 기반)로 분리되어 위젯·운영자·보존 잡이 같은 코드를 씀. **추가 수정**: 삭제가 `external_customer_id`·Cafe24 식별자를 남기던 것을 비움, 내보내기에 `externalCustomerId`·`lastClaims` 추가.
- **운영자 DSAR** — `POST /privacy/operator/{lookup,export,delete}` (master/director, 테넌트 범위, 검색어는 body, 응답 마스킹, 삭제는 확인 id 필수, 타 테넌트는 동일 404). 콘솔 설정 › "Data requests". 에러 `E5115`–`E5117`. 전화는 인덱스가 없어 테넌트 고객을 **상한 있는 스캔**(20,000행)으로 비교하고 부족하면 `truncated`.
- **문서** — DPIA(feature 라벨 9종 전수 + 마스킹 안 되는 `agent_translate`/`agent_briefing` 갭), 처리자 대장(Notion·AmoebaTalk 허브·SMTP·jsDelivr·Go2Joy 호스팅, DPA 전부 TBD), 사고 대응(Go2Joy 연락 표 전부 〔지정 필요〕), 점검표(vi/en, B-1~B-16).

### SG-82
- **`embed.js`**(작은 hunk 4곳) — `title` 설정 키(기본 `IVY USA Support` 불변, 120자), `identityUrl()`: 기본 프로브는 `window.Shopify` 또는 `*.myshopify.com`일 때만, `identityProbe:false/true`·`identityPath`·`proxyPath`. 프로브를 건너뛰어도 위젯에는 `ivy:identity authenticated:false`가 전달됨. `identityProbe`/`identityPath`는 스크립트 로드 시점에 읽히므로 `init()`이 아닌 `SHARPTALK_WIDGET_CONFIG`에 둔다.
- **nginx** — `docker/production`·`docker/self-hosted`의 `nginx.widget.conf`가 envsubst **템플릿**(`/etc/nginx/templates/default.conf.template`). `WIDGET_FRAME_ANCESTORS`(빈 값 = 헤더 없음 = 기존), `WIDGET_FONT_CSS_URL`(기본 jsDelivr). Dockerfile이 기본값을 ENV로 지정, 두 compose가 전달.
- **폰트** — `index.html`은 `/base-font.css`(같은 출처)를 링크, 기본 내용은 기존 jsDelivr `@import`(동작 불변). `apps/widget/public/fonts/pretendard/`에 **Pretendard 1.3.9 4개 가중치(400/500/600/700) woff2 + OFL 라이선스**(약 3 MB)를 번들 — 같은 PC의 다른 프로젝트 `node_modules/pretendard@1.3.9`에서 **원본 그대로 복사**, 인터넷 다운로드 없음. Go2Joy 프로필 예시는 `WIDGET_FONT_CSS_URL=/widget/fonts/pretendard/pretendard.css`로 설정.
- **문서** — `GUIDE-261013-Go2Joy-HotelAdmin-CSP-CORS.md`(vi/en), SDK 한국어 가이드에 키 3개, CONFIG.md·env 예시.

### SG-53
- **코퍼스·평가** — `detect-language.corpus.ts`(642문장, 직접 작성, 무성조 vi는 vi를 성조 제거해 파생 + 손으로 쓴 줄임말 15, 홀드아웃 65), `detect-language.eval.spec.ts`(게이트·혼동 행렬 출력). **수정 전 60.0% → 수정 후 게이트 100%**(무성조 vi 0→100%, ja 0→100%, zh 0→100%).
- **검출기** — `vietnamese-ascii.util.ts`(강/약 음절·구·밀도, 보수적 — 영어 오탐 0, 포르투갈어는 EN 유지), `detect-language.util.ts`(가나→JA, 가나 없는 한자→ZH, 한글 우선; 기존 단위 테스트 불변). 알려진 한계: 한자뿐인 일본어는 ZH, 성조 없는 스페인어는 EN.
- **턴별 지연** — `RagService.answer`가 `timings{retrieveMs,generateMs}`, `ChatService`가 classify·moderate를 재서 AI 턴 `retrieval_trace.latencyMs{total,classify,retrieve,generate,moderate}` 저장(지식 답변·무지식 응답 모두). 실행 안 한 단계는 `null`. `turn-latency.util.ts`에 최근접순위 P50/P95 헬퍼 — **엔드포인트는 만들지 않음**(s5b가 행을 읽으면 됨). 예시 SQL:
  `SELECT JSON_EXTRACT(retrieval_trace,'$.latencyMs.total') FROM messages WHERE sender_type='ai' AND retrieval_trace IS NOT NULL AND created_at > NOW() - INTERVAL 7 DAY` → 값을 `summarizeLatency()`에 넘김.
- **NFR-008** — `scripts/nfr008-diacritics.mjs`(playwright `channel: 'chrome'`, `C:/Github/Work/node_modules/playwright`): 실제 빌드 CSS로 위젯 버블 인라인 코드·콘솔 textarea·코드칩 × NFC/NFD를 그려 사용 폰트(CDP)·1셀 폭·줄 높이를 보고하고 `out/nfr008-diacritics/`(gitignore)에 PNG·report.md 저장. **실행 결과**(Chrome 154, win32): Consolas만 사용, 겹침 부호 전부 1셀, 먹물 13–15px < 줄 높이 16–20px → 합격. **하네스이지 실제 앱이 아니고**, 이 PC 폰트 기준이다.

## 4. 배포 상태 · 마이그레이션

| 항목 | 상태 |
|------|------|
| 배포 | **안 함**(어느 환경도) |
| 스키마 | **변경 없음** — 엔티티·`sql/*.sql` 없음, `migrations:manifest` diff 0. PR에 `## Migration` 불필요(“none”) |
| 필요한 작업 | ① 위젯 이미지 재빌드(nginx 템플릿·폰트·`embed.js`) ② Go2Joy `.env`에 `CUSTOMER_RETENTION_DAYS`/`AUDIT_LOG_RETENTION_DAYS`(선택, 법무 확정 후), `WIDGET_FRAME_ANCESTORS`(Hotel Admin 오리진), `CORS_ORIGINS`(Hotel Admin) ③ 콘솔에서 Go2Joy 테넌트 프로필을 `vn_pdpl`로 바꾸고 **controller 줄 작성**(미작성 경고가 사라질 때까지) |
| 순서 | DB 선행 작업 없음. 코드 배포 후 프로필을 바꾸면 버전이 같아 재동의는 일어나지 않음 — 법무 확정 후 `bump_version`으로 재동의를 받을 것 |
| 스테이징 이미지 | `docker/staging`은 템플릿화하지 않음(변경 없음). `index.html`이 `/widget/base-font.css`를 요청하는데 정적 기본 파일이 이미지에 들어가므로 동작 동일 |

## 5. PLN 대비 차이 · 판단

1. **Notion은 고지의 수신자 목록에 넣지 않음.** 코드를 확인한 결과 Notion은 지식 소스를 *읽기만* 한다(고객 데이터가 나가지 않음). 거짓 고지를 피하려 처리자 대장에는 "유입 전용"으로, 고지에는 SMTP·Slack만 "구성에 따라"로 적었다.
2. **identity 프로브 자동 생략은 동작 변경이다.** 비-Shopify 호스트에서 항상 404였던 요청을 없앴다. 되돌리려면 `identityProbe:true`. 위험은 "App Proxy를 흉내 낸 비-Shopify 호스트"뿐이며 알려진 사례 없음.
3. **customers 퍼지는 삭제가 아니라 익명화**(고아 행 방지). suppression·Shopify 전파를 하지 않는 이유: 보존 만료는 이의 제기가 아니다.
4. **범위 추가(필요해서)**: 삭제 시 external/Cafe24 식별자 제거와 export 확대 — 이를 안 하면 운영자 DSAR이 "익명화"된 행에 키를 남긴다.
5. **JA/ZH 검출 추가**(브리프는 ASCII 베트남어만 요구) — 코퍼스가 두 언어가 `null`임을 보여 줬고 둘 다 세션 언어다.
6. DSAR 탭은 새 메뉴 코드를 만들지 않고 기존 `privacy_notice` 메뉴 코드로 판정하며, 서버는 master/director로 따로 제한한다.
7. 에러 코드는 E5115–E5117만 사용(E5118–E5119 예비).
8. Pretendard는 git에 3 MB 바이너리로 커밋했다(번들 요구). 부담되면 이미지 빌드 단계 복사로 바꿀 수 있다.

## 6. VERIFIED / NOT VERIFIED

**VERIFIED(이 PC, 위 TCR 참조):** tsc 3개 · API 전체 jest(기준선 3건 외 실패 0) · types/common jest · widget 80 · i18n:check · 실부팅(scratch_s5a:3024) · 핵심 수정 16건 뮤테이션(모두 테스트가 실패함) · 콘솔/위젯 브라우저 스모크(고지 저장·보간·경고, DSAR 조회·내보내기·삭제·감사, 위젯 배너·동의 증적) · 옵트인 퍼지 실제 SQL · NFR-008 1회 · 언어 평가.

**NOT VERIFIED:** nginx 템플릿 실제 렌더·응답 헤더 · 실제 Hotel Admin CSP 하의 loader · 위젯 동의 replay의 브라우저 동작 · 실제 LLM 턴의 지연 수치(NFR-001 값) · macOS/Linux 폰트 · 모바일 레이아웃 · 번역/법률 정확성 · 콘솔 5개 비영어 로케일의 시각 확인(키 완비만 확인).

## 7. 후속 과제

| # | 내용 | 비고 |
|---|------|------|
| 1 | `agent_translate`·`agent_briefing`·상담원 작성분 moderation 입력의 **PII 미마스킹** | 고지가 "AI 제공자로 전송"이라 말함 → 마스킹하거나 법무 승인 |
| 2 | 계좌번호·세금번호 마스킹(점검표 B-5) | 현재 카드·이메일·전화·주문번호·주소만 |
| 3 | 전화 조회 `phone_hash` 블라인드 인덱스 + 백필 | 현재는 상한 스캔 |
| 4 | 고객별 법적 보존(legal hold) 플래그 | 지금은 env를 끄는 것뿐 |
| 5 | vn_pdpl 외 프로필의 고지가 번들 문구(365일·"United States")를 씀 | Go2Joy는 vn_pdpl 사용 |
| 6 | staging nginx 이미지에서 `nginx -t` + `curl -I`로 헤더 확인, staging도 템플릿화 | 이번엔 미실행 |
| 7 | loader가 호스트 URL(≤300자)을 iframe URL에 실음(`ivy_land`) — 끄는 옵션 없음 | 서버는 origin+path만 저장 |
| 8 | 위젯 고지가 길어짐 — 접기/요약 UX 검토 | 지금은 스크롤 목록 |
| 9 | embed-origins 콘솔 화면 없음(API만) | CSP 가이드에 명시 |
| 10 | s5b: `retrieval_trace.latencyMs`를 /metrics로 노출, NFR-001 정의(스트리밍 없음 → "첫 응답까지") | 값만 저장 |
| 11 | vi 문안 원어민 검수 · 법무 확정(점검표 B-1~B-16) · DPA(처리자 대장) | Go2Joy |

## 8. 다른 스트림과의 충돌 위험

- `session.service.ts`(생성자 끝에 `audit?` 추가, `setConsent` 확장)·`session.module.ts`(AuditModule import) — **s1b가 audit/identify 감사를 같은 곳에 넣을 가능성**. 병합 시 두 `audit` 주입을 하나로.
- `error-code.constant.ts` 끝(E5115–E5117), 로케일 JSON(`settings.json`·`nav.json`, 새 `dsar.json`), `CONFIG.md`, `AppRouter.tsx`/`SettingsLayout.tsx`.
- `chat.service.ts`/`rag.service.ts` 작은 hunk(타이머 + trace 필드) — s2b·s4·s5b 인접 수정.
- `docker/*/Dockerfile.widget`, 두 compose의 widget 서비스, `deploy/profiles/SharpTalk-VN-Go2Joy` env 예시, `.env.self-hosted.example` — **s5c(호스팅)** 와 같은 파일.
- `PROCESSOR-REGISTER.md`·`INCIDENT-RESPONSE.md`·`AI-DPIA-GATE.md` — 다른 스트림이 행을 추가할 수 있음.
- `embed.js` — 내 hunk 4곳(title 2, identity 함수 + `fetchIdentity` 1). jest `embed-loader.spec.ts`는 CRLF 때문에 Windows에서 원래 1건 실패.
