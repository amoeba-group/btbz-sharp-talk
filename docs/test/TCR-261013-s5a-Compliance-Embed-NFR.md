# TCR-261013-s5a — 컴플라이언스(SG-70) · 임베드 보안 문서/설정(SG-82) · NFR 측정(SG-53)

- 근거: PLN-261012 Go2Joy Stage1 Gap Closure §3.5 (SG-70, SG-82, SG-53) · REQ §3.6/3.8/3.9
- 브랜치: `feature/go2joy-s5a-compliance-embed` (기준 `f7266697`) · 배포 안 함 · 스키마 변경 없음
- 범례: ✅ 실행·통과 · ⬜ 실행 못 함(사유 명시) · "뮤테이션" = 수정을 되돌렸을 때 해당 테스트가 **실제로 실패**함을 확인

## 1. 단위 / 모듈 테스트

### SG-70 vn_pdpl · 동의 증적
| ID | 대상 | 케이스 | 결과 | 뮤테이션 |
|----|------|--------|------|----------|
| P1 | `privacy-notice-copy.spec` | `vn_pdpl` 선택 가능·varchar(16) 이내 · vi/en에 9개 키 전부 · CCPA/GA/365 문구 없음 | ✅ | — |
| P2 | 〃 | `{{retentionDays}}`/`{{region}}` 서버 보간(vi `Hoa Kỳ`, en `Singapore`), 토큰 잔존 없음 | ✅ | 보간 제거 시 실패 ✅ |
| P3 | 〃 | vi/en 외 언어는 EN 줄로 폴백(지역명도 영어) · 테넌트 override 안의 토큰도 보간 | ✅ | — |
| P4 | 〃 | 신규 3키(controller/crossBorder/rights)가 정규화에서 버려지지 않음 | ✅ | 키 제거 시 실패 ✅ |
| P5 | 〃 | `[[…]]` 미작성 표식 탐지 · 다른 프로필 결과는 바이트 동일(items·purpose만) | ✅ | — |
| P6 | `session.service.consent-evidence.spec` | env(`CONVERSATION_LOG_RETENTION_DAYS=180`,`AI_PROCESSING_REGION=US`) → 고지에 "180 ngày"·"Hoa Kỳ"; 빈 값 → 365(퍼지 잡이 쓰는 값과 동일) | ✅ | 서버 보간 제거 시 실패 ✅ |
| P7 | 〃 | 동의 grant/declined/withdrawn → `audit_logs` 행(actor system, `ip:null`, 세션 id·버전·언어, **토큰/PII 없음**) | ✅ | 쓰기 제거 시 실패 ✅ |
| P8 | 〃 | 위젯 재기록(replayed)은 증적 행 안 씀 · 증적 쓰기 실패해도 동의 요청은 성공 | ✅ | replay 구분 제거 시 실패 ✅ |
| P9 | `tenant.mapper.privacy-notice.spec` | 콘솔 placeholder가 보간된 값으로 표시 · 미작성 `[[…]]` 언어 목록 · VI 작성 시 VI만 해제 | ✅ | — |
| P10 | `retention-policy.util.spec` | 빈/0/음수/비숫자 → 365(보존 창) · 옵트인은 → 꺼짐 · 소수 버림 | ✅ | 옵트인 기본 ON 시 실패 ✅ |

### SG-70 보존 · 운영자 DSAR
| ID | 대상 | 케이스 | 결과 | 뮤테이션 |
|----|------|--------|------|----------|
| R1 | `opt-in-retention.service.spec` | 기본값: 쿼리·익명화 **전혀 없음**, 창 null | ✅ | — |
| R2 | 〃 | `0`/빈 값/음수/문자 → 꺼짐(전부 삭제 아님) | ✅ | — |
| R3 | 〃 | 비활성 고객만 선별(식별자 남음 + 세션·주문 활동 없음), 오류 1건이 나머지를 막지 않음 | ✅ | — |
| R4 | 〃 | audit_logs 청크 삭제, **90일 하한**(7 → 90) | ✅ | 하한 제거 시 실패 ✅ |
| R5 | 〃 | `RetentionService` 배선: 옵트인 서비스 없으면 0/null(기존과 동일) · 옵트인 실패가 퍼지 감사 행을 삼키지 않음 | ✅ | — |
| R6 | `privacy.service.operator.spec` | export에 `externalCustomerId`·`lastClaims` 포함, 감사 actor(위젯=system / 운영자=user+`via:operator`+reference) | ✅ | — |
| R7 | 〃 | 삭제 시 externalCustomerId·Cafe24 식별자도 비움 | ✅ | 제거 시 실패 ✅ |
| R8 | 〃 | 보존 만료 익명화는 suppression 기록·Shopify 전파 **안 함** | ✅ | `{suppress:false}` 제거 시 실패 ✅ |
| D1 | `operator-dsar.service.spec` | email(블라인드 인덱스)·external id·전화(표기 3종) 조회, **타 테넌트 0건** | ✅ | 테넌트 조건 제거 시 실패 ✅ |
| D2 | 〃 | 응답은 마스킹(`la***@…`, `***-5678`), 검색어는 감사에 **저장 안 됨** | ✅ | — |
| D3 | 〃 | export/erase: 타 테넌트·없는 id 모두 동일한 404(E5116), 확인 id 불일치 → E5117, 3자 미만 → E5115 | ✅ | — |
| D4 | 〃 | **회귀**: bigint id가 문자열이어도 행 id는 숫자, DTO가 숫자 문자열 수용 | ✅ | `@Type` 제거 시 실패 ✅ |

### SG-82 임베드
| ID | 대상 | 케이스 | 결과 | 뮤테이션 |
|----|------|--------|------|----------|
| E1 | `embed-identity-title.test.mjs` (실제 `embed.js`를 vm에서 실행) | 비-Shopify 호스트는 identity 요청 **0건**이면서 위젯에 anonymous 응답 전달 | ✅ | 원본 `embed.js`로 되돌리면 6건 실패 ✅ |
| E2 | 〃 | Shopify(`window.Shopify` / `*.myshopify.com`)는 기존과 동일하게 `/apps/ivy/identity?locale=` 호출 | ✅ | — |
| E3 | 〃 | `proxyPath`·`identityPath`(쿼리 있는 경로 포함)·`identityProbe:false/true` | ✅ | — |
| E4 | 〃 | iframe `title`: 기본 불변 · config · `init()` · 120자 절단 · visibility 호출 불변 | ✅ | — |
| E5 | `font-bundle.test.mjs` | 번들 CSS가 가리키는 파일 4개 존재·woff2 시그니처 · OFL 라이선스 동봉 · index.html은 `/base-font.css`(CDN 링크 없음) · `base-font.css` 기본은 jsDelivr(동작 불변) | ✅ | 가중치 변경 시 실패 ✅ |
| E6 | 〃 | prod/self-hosted nginx 템플릿 동일 · `frame-ancestors` 맵과 `add_header` · 빈 값 → 헤더 없음 구조 · Dockerfile 기본값 | ✅ | `add_header` 제거 시 실패 ✅ |
| E7 | `embed-loader.spec.ts`(jest) | 13개 중 12 통과, 1건(`keeps the widget iframe sandboxed`)은 **Windows CRLF 기존 실패** — 내 변경과 무관 | ⬜ 기준선 실패 | — |

### SG-53 NFR
| ID | 대상 | 케이스 | 결과 | 뮤테이션 |
|----|------|--------|------|----------|
| N1 | `detect-language.eval.spec` | 코퍼스 **642문장**(손으로 작성: vi 103 · vi 무성조 103+15 · en 99 · ko 60 · ja 42 · zh 41 · es 25+12 · 엣지 37 · 인사 18 · 혼합 18 · 한계 4(+es-plain 12) · **홀드아웃 65**) | ✅ | — |
| N2 | 〃 | 게이트 625문장(한계 17 제외) **100%**, 전체 97.4%; 버킷별 하한; **EN→VI 오탐 0**; VI 세션에서 VI 유지 | ✅ | 무성조 검사 제거 / 가나·한자 검출 제거 시 실패 ✅ |
| N3 | 〃 | 수정 전 검출기(HEAD~): 게이트 **60.0%**, 무성조 vi 0%, ja 0%, zh 0% | ✅ 측정 | — |
| N4 | `detect-language.util.spec` | 기존 케이스 전부 불변 통과 + 무성조 vi·ja·zh·한자 혼용 한국어·포르투갈어 EN 유지·짧은 응답 null | ✅ | — |
| N5 | `chat.service.latency.spec` | AI 턴 trace에 `latencyMs{total,classify,retrieve,generate,moderate}`; 재사용 응답은 retrieve/generate가 **null**(0 아님); 잡담 경로도 기록; 기존 trace 필드 불변 | ✅ | 기록 제거 시 4건 실패 ✅ |
| N6 | `rag-timings.spec`, `turn-latency.util.spec` | RAG가 검색/생성 ms 분리 보고(저하 시에도), 최근접순위 P50/P95, 음수 방지, 트레이스에서 단계 추출 | ✅ | — |

## 2. 통합 / 실행 검증

| ID | 시나리오 | 결과 |
|----|----------|------|
| I1 | **실부팅**(`scratch_s5a`, 포트 3024): `Nest application successfully started`, 새 라우트 `/privacy/operator/{lookup,export,delete}` 매핑, 무인증 401 | ✅ |
| I2 | 보존 스케줄러 첫 실행(실제 DB): 옵트인 꺼짐 → 감사 행에 `customerRetentionDays:null`, `auditLogRetentionDays:null`, 건수 0 | ✅ |
| I3 | **옵트인 퍼지 실제 SQL**(`CUSTOMER_RETENTION_DAYS=14`,`AUDIT_LOG_RETENTION_DAYS=90`, 관리자 `POST /privacy/retention/purge`): 30일 비활성 고객 → 익명화(external id·email·phone·claims 제거), **최근 세션 있는 고객은 그대로**, 200일 지난 감사 3행 삭제, 퍼지 자체 감사 기록, 이 경로는 `erased_identities`에 **기록 안 함** | ✅ |
| I4 | 콘솔(실제 Chrome, playwright): 설정 › 개인정보 고지에서 프로필 `Vietnam (personal data law)` 저장 → 토스트 "Privacy notice settings saved", placeholder에 **서버 보간값**(180 ngày, Hoa Kỳ), `[[…]]` 경고가 VI 작성 후 VI만 사라짐 | ✅ |
| I5 | 콘솔 설정 › Data requests: external id / 전화 `0912345678` 조회 → 마스킹 행 1건; **Export → JSON 다운로드**(`externalCustomerId`·`lastClaims` 포함) + 토스트; **Erase → id 입력 전 버튼 비활성** → 입력 후 삭제 + 토스트; 감사 `dsar.lookup/export/delete`(`via:operator`, reference) | ✅ (I5 중 `400` 버그 발견 → D4 회귀 테스트로 수정) |
| I6 | 위젯(실제 Chrome, vi): vn_pdpl 배너에 controller·items·purpose·retention(**180 ngày**)·aiProcessor·crossBorder·rights, 긴 목록은 스크롤(포커스 가능) · `Đồng ý` → 서버에 `consent.granted` 증적 1행(ip NULL) | ✅ |
| I7 | DB 확인: 운영자 삭제 후 고객 행의 external id 제거, `erased_identities` 1건(dsar) | ✅ |
| I8 | NFR-008 하네스(Chrome 154 / win32, `scripts/nfr008-diacritics.mjs`): 실제 빌드 CSS로 위젯 버블 인라인 코드·콘솔 textarea(xs/sm)·콘솔 코드칩 × NFC/NFD. 사용 폰트 **Consolas**(대체 폰트 없음), 겹침 부호 글리프 전부 1셀(≤0.5px), 먹물 높이 13–15px < 줄 높이 16–20px | ✅ (이 머신 한정) |

## 3. 전체 회귀 / 정적 검사

| 항목 | 결과 |
|------|------|
| `tsc -p tsconfig.check.json` api / web / widget | ✅ ✅ ✅ (오류 0) |
| API 전체 jest | 254 suites · 2,610 tests — **기준선 3건만 실패**(`embed-loader.spec`, `heic-conversion.spec`, `board-attachment.service.spec`), 2,607 통과 |
| packages/types jest | 12 suites · 275 ✅ |
| packages/common jest (`jest.check.config.js`) | 2 suites · 64 ✅ |
| widget `node --test test/*.test.mjs` | 80 ✅ (기존 61 + 신규 19: embed identity/title 12, font·nginx·Dockerfile 7) |
| `npm run i18n:check` | es ko vi ja zh 전부 complete |
| `npm run migrations:manifest` → `git diff --ignore-space-at-eol` | 변경 0 (SQL 없음) |
| `npm run env:check` | 기준선과 동일하게 실패 2건(`AGENT_PRESENCE_TTL_SEC`, `GUEST_GATE_CONFIDENCE` — 다른 스트림 소관). 내 신규 변수는 템플릿에 포함 |

## 4. 실행하지 못한 것 (NOT VERIFIED)

| 항목 | 이유 |
|------|------|
| nginx 템플릿 실제 렌더/`nginx -t`, 헤더 실응답 | 로컬에 nginx 이미지·바이너리 없음(이미지 pull 안 함). envsubst를 흉내 낸 렌더링과 구조 테스트만 수행 |
| 실제 Hotel Admin CSP 하에서 loader 동작 | Go2Joy 측 CSP 없음. 문서의 지시문은 코드 읽기로 검증, 브라우저 CSP 시험은 미실시 |
| 위젯 동의 **재기록(replay) 경로**의 브라우저 동작 | 같은 컨텍스트 reload에서 replay가 발생하지 않아 재현 못 함. 단위 테스트(P8)와 타입 체크만 |
| 실제 LLM 턴의 `latencyMs` 값·P50/P95 | scratch DB에는 실엔진이 없음(stub은 저하 처리 → AI 턴 미저장). 값은 모킹으로만 검증, **NFR-001 수치 자체는 측정 안 함** |
| NFR-008의 다른 OS/폰트(macOS·Linux·모바일) | 이 머신(Windows/Consolas) 결과만 |
| 번역 품질(vi 법적 문구 포함), 법적 정확성 | 사람 검수 필요 — 문서·코드 주석에 초안으로 명시 |
| 언어 코퍼스는 작성자(나)가 만든 문장 | 홀드아웃 65문장 100%이나 같은 저자·소규모 → 일반화 과신 금지 |
