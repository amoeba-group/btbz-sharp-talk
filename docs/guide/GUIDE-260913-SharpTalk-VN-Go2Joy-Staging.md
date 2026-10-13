# SharpTalk-VN-Go2Joy — 베트남 스테이징 세팅·배포·운영 가이드

> 버전 1.0 · 2026-09-13 · 코드 기준(main `48b3e31`) · 근거 REQ/PLN-260913-Locale-Deployment-Guides
> 공통 절차는 [SharpTalk-Basic 세팅 가이드](GUIDE-260913-SharpTalk-Basic-Setup.md), 항목별 위치는 [로컬 커스터마이징 가이드](GUIDE-260913-Locale-Customization.md). 이 문서는 **프로필 차이만** 적습니다.
> 프로필 파일: `deploy/profiles/SharpTalk-VN-Go2Joy/` · 시크릿: `secrets/SharpTalk-VN-Go2Joy-server.md`(gitignored)
> **Go2Joy 자체 인프라(단일 테넌트) 운영**은 번들 설치·롤백·암호화 백업·키 보관·사고 대응까지 [RUNBOOK-261013-Go2Joy-SelfHosted.md](RUNBOOK-261013-Go2Joy-SelfHosted.md)(베트남어)에 있습니다. 이 문서의 스테이징 절차와 겹치는 부분은 런북이 우선합니다.

---

## 0. 프로필 요약

| 항목 | 값 |
|---|---|
| 별칭 | **SharpTalk-VN-Go2Joy** (국가 VN, 1차 고객사 Go2Joy) |
| 고객사 | Go2Joy — 시간제 호텔 예약 플랫폼. 스토어프런트 커머스가 아니라 **호텔 관리자·고객 지원 채팅**. 요구·비즈모델: `docs/analysis/REQ-260831-SharpTalk-Go2Joy-Requirements.md`, `REQ-260825-Go2Joy-ChatAgent-BizModel.md`, 사이드임팩트 `AN-260907-SharpTalk-Go2Joy-Side-Impact.md` |
| 현재 위치 | 한국 스테이징 테넌트 `go2joy`(plan `starter`, workflow `base`) — KB 104건(영상 가이드 vi/en) + 호텔 관리자 KB(`reference/go2joy-hotel-admin-kb.{,en,vi}.md`), Notion 연결, Haravan 자격증명 |
| 언어 | 위젯·KB **vi/en 병기**, 콘솔 운영자 vi 또는 en. vi는 β(미검수) |
| 타임존 | `Asia/Ho_Chi_Minh` (ICT, UTC+7) |
| 통화 | VND (Haravan 동기화 시) |
| 규제 | **PDPD — Nghị định 13/2023/NĐ-CP**(개인정보 보호 법령): 동의, 정보주체 권리, **국외이전 영향평가 서류(A05 제출)**, 침해 통지 72h. *정확한 의무 범위·제출 절차는 현지 법무 확인 필요* |
| 연동 | Notion(KB 소스), Haravan(선택), AmoebaTalk 허브(Zalo·Line·WhatsApp — `api-talk.amoeba.site`), Viber(직접), 모바일 앱(Kotlin SDK `sdk/android`) |
| AI | Anthropic(미국 처리) + Voyage 임베딩 — **국외이전 고지 대상** |
| 결정 필요 | 호스트·클라우드·리전(`<VN_HOST>`), 도메인(`talk-vn.<domain>` 가정), TLS 종단, 백업 저장소, 요금제(starter 유지 여부), 현지 법무·DPO 연락처 |

### 0.1 착수 전 선행 요구사항 (코드 갭 P0 — [로컬 가이드 §4](GUIDE-260913-Locale-Customization.md#4-코드-변경이-필요한-갭))
| 갭 | 없으면 |
|---|---|
| G1/G2 테넌트 기본 언어 | 브라우저가 en-US인 베트남 고객에게 영어 위젯 |
| G3 핸드오프 타임존 목록 | 업무시간을 호찌민 기준으로 못 잡음(서버는 IANA 수용 — 임시로 API 직접 호출 가능) |
| G6 베트남 전화 PII 패턴 | 로그·감사에 `+84`·`09xx` 번호가 마스킹되지 않을 수 있음 |
| G7 AI 국외이전 고지 문구 | 고지가 "미국 처리"만 말함 — PDPD 고지 문구 확정 후 반영 |
| G11 시드 KB | 첫 부팅에 미국 화장품 KB·시나리오가 들어옴 → §6에서 삭제로 우회 |
| G10 사고 통지 매트릭스 | `INCIDENT-RESPONSE.md`에 PDPD 행 추가(문서) |

**2026-09-13 구현 완료(REQ/PLN-260913-VN-Prerequisite-Gaps)** — 위 6건은 Basic에 반영됐습니다. 프로필에서 켜는 값: `SEED_KB_PROFILE=none`, `AI_PROCESSING_REGION`(실제 처리 지역), 테넌트 설정 > 기본에서 기본 언어 `vi`. G7 고지 문구의 **법적 표현 확정**은 여전히 현지 법무 몫입니다.

---

## 1. 서버 준비
- 사양: Basic §3 스테이징(4vCPU/8GB/80GB) — 프로덕션은 8/16/200+.
- **리전: 베트남 내**(데이터 상주). 백업도 베트남 내 오브젝트 스토리지.
- OS UTC, Docker 24+/Compose v2, 인바운드 22(관리 IP)·443, egress 허용: Anthropic·Voyage·Google Fonts·Notion API·Haravan API·`api-talk.amoeba.site`·GitHub·Docker Hub·SMTP.
- 호스트 시각이 UTC여도 콘솔·핸드오프는 테넌트 타임존(ICT)으로 동작합니다.

## 2. 도메인·TLS
- 콘솔·위젯·API 한 오리진: `talk-vn.<domain>`(가정). 모바일 앱은 이 오리진의 `/widget/`을 WebView로 엽니다.
- TLS 종단은 호스트 nginx/Caddy(스택 밖). 인증서 자동 갱신 확인.
- 도메인 5키(Basic §5.4)에 이 오리진을 넣습니다. Shopify·Cafe24는 사용하지 않으므로 외부 재등록 없음. **AmoebaTalk 허브·Viber 웹훅은 새 오리진으로 재등록**(`MESSENGER_WEBHOOK_BASE_URL`).
- 이전에 배포된 **모바일 앱의 `widgetUrl`**을 새 오리진으로 바꿔 재배포해야 합니다(SDK 설정값).

## 3. env — Basic self-hosted example 대비 차이
`deploy/profiles/SharpTalk-VN-Go2Joy/.env.SharpTalk-VN-Go2Joy.example` 기준.

| 키 | 값 | 이유 |
|---|---|---|
| `APP_PUBLIC_URL`, `PUBLIC_BASE_URL`, `VITE_API_BASE_URL` | `https://talk-vn.<domain>`(/api/v1) | 폴백 금지 |
| `MESSENGER_WEBHOOK_BASE_URL` | 같은 오리진 | 허브·Viber 웹훅 |
| `CONVERSATION_LOG_RETENTION_DAYS` | 처리방침과 일치(초안 **180**) | PDPD 보존 최소화 원칙 — 법무 확정 |
| `AI_DEFAULT_PROVIDER` / `ANTHROPIC_MODEL` | `anthropic` / 표준 모델 | 스모크는 `stub`로 먼저 |
| `VOYAGE_API_KEY`, `VOYAGE_MODEL`, `QDRANT_URL` | 필수 | 베트남어 검색은 FULLTEXT로는 부족 |
| `SHOPIFY_*`, `CAFE24_*` | 비움 | 미사용. `SHOPIFY_WEBHOOK_SECRET`·`FULFILLMENT_WEBHOOK_SECRET`은 production 검사 때문에 **임의 강한 값** 필요 |
| `HARAVAN_SYNC_INTERVAL_MIN` | 0(수동) → 사용 시 60 | |
| `NOTION_MAX_REQUESTS_PER_PAGE` / `_PAGES_PER_SYNC` | 30 / 200 | 큰 페이지 `truncated` 시 상향 |
| `SMTP_*`, `ALERT_EMAIL_FROM` | 베트남 발신 도메인 | 비우면 `SMTP_USER` → `noreply@<APP_PUBLIC_URL 호스트>`로 폴백(Amoeba·`ivyusa.local` 주소는 더 이상 쓰지 않음). `AI_ALERT_EMAIL`/`ALERT_EMAIL_TO`는 Go2Joy 수신처로 지정 — 둘 다 비면 알림 메일 없음 |
| `AI_PROCESSING_REGION` | 실제 추론 지역(현행 `US`) | 위젯 AI 고지에 지역명으로 표시(G7) |
| `SEED_KB_PROFILE` | `none` | 첫 부팅에 미국 화장품 KB를 넣지 않음(G11) |
| `VITE_GA4_MEASUREMENT_ID` | 비움 | 동의 모드 있어도 PDPD 검토 전 미사용 |
| `MFA_ENFORCE_FROM` | 스테이징 비움 | 프로덕션에서 계정 발급 후 |
| `SEED_ON_BOOT`/`SEED_DEMO_DATA` | 첫 부팅 true/**false** | 데모 주문(USD) 불필요 |

## 4. 스키마·배포·검증
Basic §4·§7 그대로. 프로필 특이점:
- 프로필 env의 `SEED_TENANT_SLUG=go2joy`·`SEED_TENANT_NAME`·`SEED_TENANT_DOMAIN`·`SEED_ADMIN_EMAIL`·`SEED_MASTER_EMAIL`을 채우면 첫 부팅에 **테넌트 `go2joy`와 Go2Joy 계정이 직접 생성**됩니다(`ivyusa`·`@amoeba.group` 계정 없음, 데모 데이터·미국 화장품 KB 없음, `SEED_PASSWORD`를 비우면 일회용 비밀번호를 로그에 한 번 출력). 기본값으로 부팅했다면 시드 테넌트 `ivyusa`가 생기므로 §5에서 정리합니다.
- 위젯 `widget-config.js`가 `talk-vn` API를 가리키는지 확인(`curl https://talk-vn.<domain>/widget/widget-config.js`).
- 정적 라이브 테마 `/widget-design/live/<shop>.json`은 shop 도메인 키로 저장됩니다. Go2Joy는 스토어 도메인이 없으므로 **스토어프런트 설정에 앱 식별용 도메인**(예 `app.go2joy.vn`)을 넣어 두는 것이 위젯 세션 키·미리보기·라이브 파일에 필요합니다.

## 5. 플랫폼 어드민 초기화
| 순서 | 값 |
|---|---|
| AI 엔진 | Anthropic 엔진 등록·활성(키는 env가 아니라 여기), 임베딩은 env |
| 테넌트 | 이름 `Go2Joy`, 슬러그 `go2joy`(로그인 `/user/go2joy`), 도메인 `app.go2joy.vn`(가정), 요금제 **starter**(현행) — 이슈 보드·통계·AI 설정이 필요하면 growth 또는 custom |
| 제공 메뉴 | 플랜 기본 + 필요 시 오버라이드(지식·AI 설정·통계) |
| 애드온 | 워크플로우 `base`(현행), 커스텀 CSS **끔**(요청 시) |
| 관리자 | Go2Joy 운영자 master 1 + director 1 초대(임시 비밀번호 1회 표시), Amoeba 운영 계정 별도 |
| 시드 테넌트 | 위 시드 env로 `go2joy`를 직접 시드했다면 해당 없음. 기본값으로 부팅했다면 `ivyusa` 정지 또는 삭제(데모 데이터 없음이면 삭제) |

## 6. 테넌트 초기화 (한국 스테이징 `go2joy`에서 이관)
[로컬 가이드 §3](GUIDE-260913-Locale-Customization.md#3-테넌트-설정-이관) 절차. Go2Joy 특이점:

| 항목 | 방법 |
|---|---|
| 설정 13항목 | 한국 스테이징에서 스냅샷 다운로드 → 대조하며 수동 입력. **타임존 `Asia/Ho_Chi_Minh`** + **기본 언어 `Tiếng Việt`**(설정 > 기본, G1/G2) 먼저 |
| 위젯 문구 | vi·en 탭 필수(`reference/go2joy-*` 문구), ko는 비워도 됨 |
| 커스텀 위젯 | 있으면 패키지 가져오기. 모바일 앱 모드는 패널 크기 무시(화면 채움) |
| KB | 카테고리 = 영상 번호 명시표(`reference/hoteladminvideoguidevien.md` 변환 기준, 메모리 `go2joy-video-guide-kb`), 일괄 다운로드 → 일괄등록(라운드트립), Notion 소스 재연결(`GUIDE-260828-Go2Joy-Notion-Connection.md`) → 동기화 → 재색인 확인. **시드 KB(미국 화장품 12건)와 시나리오 문구 삭제/수정** |
| 자격증명 | Notion 통합 토큰·Haravan 토큰 재입력 → [연결 테스트]. **연결 테스트 통과 ≠ 가져오기 정상** — 동기화 1회 실행해 건수 확인 |
| 메신저 | AmoebaTalk 허브 자격증명 재입력, 채널 동의 모드 `notice`(첫 접촉 시 고지) |
| 임베드 | 오리진(앱 WebView 오리진·웹 사이트), 시크릿 재발급 → Kotlin SDK `ShopTalkConfig(widgetUrl, shop, locale, agent)` 갱신 |
| 핸드오프 | 담당자·업무시간(타임존 `Asia/Ho_Chi_Minh` 선택 가능, G3)·영업외 문구 vi/en |
| 개인정보 | 처리방침 URL(베트남어), 동의 버전(예 `2026-09-vn`), 버전 변경 시 전 고객 재동의 |
| AI 설정 | 페르소나 vi/en 병기 원칙, 응답 규칙(약속 금지), 모더레이션 규칙 현지화 |

## 7. 베트남 커스터마이징 체크리스트
- [ ] PDPD: 동의 화면 문구(위젯 배너 — 코드 i18n)·처리방침 URL·**국외이전(AI 미국 처리) 고지** — 법무 확정 문구를 G7 구현에 반영
- [ ] PDPD 국외이전 영향평가 서류 준비(수탁자: Anthropic·Voyage·AmoebaTalk 허브·Notion) → `PROCESSOR-REGISTER.md` 국가 열 갱신
- [ ] 보존 기간 env = 처리방침
- [ ] `INCIDENT-RESPONSE.md`에 PDPD 통지 행(72h) 추가, 현지 연락망
- [ ] 언어: 위젯 vi 기본(G2), vi 번역 원어민 검수(G18) — 콘솔 β 배지 제거는 검수 후
- [ ] 전화·주소 PII 패턴(G6) 구현 후 로그 샘플 검사
- [ ] 통화 VND 표기(Haravan 사용 시 G4/G5 확인)
- [ ] 모바일 SDK: `widgetUrl`·`shop`·`locale=vi`, `?mode=app`, 실기기 스모크(`kotlin-android-sdk` 결함 5건 재발 확인)
- [ ] Zalo(허브) 발신·수신 E2E, 수신전용 스레드 아웃박스 정책 확인
- [ ] 매뉴얼: `/manual` vi판 제공(문서 내 URL은 한국 스테이징 표기 — 필요 시 치환)

## 8. 운영
- 배포 루틴·검증·백업·롤백: Basic §7. `MYSQL_CONTAINER=sharptalk_mysql`.
- 백업 보관: 베트남 내, 일 1회, 복원 리허설 분기 1회 — 스케줄 `docker/self-hosted/ops/`(systemd timer·cron), 암호화 `BACKUP_ENCRYPT_KEY_FILE`, 보존 `BACKUP_KEEP_DAYS`, 리허설 `restore-drill-self-hosted.sh`(운영 스택 무접촉, `DRILL_LOG` 기록). 런북 §8.
- 모니터링: Basic §7.5 + Notion 동기화 실패(감사 로그 `source.sync` 실패 기록), 허브 폴링 지연.
- 사고 대응: `INCIDENT-RESPONSE.md` 절차 + PDPD 72h + 현지 법무.
- 시크릿: `secrets/SharpTalk-VN-Go2Joy-server.md`(구조는 Basic §8).

## 9. 프로덕션 승격
| 항목 | 스테이징 → 프로덕션 |
|---|---|
| 선행 | G1/G2·G6·G7 구현·배포, vi 검수, PDPD 서류, UAT 서명 |
| 스택 | 같은 self-hosted 스택, 별도 호스트(8/16/200+), `restart: always`로 조정 가능 |
| env | `SEED_DEMO_DATA=false`, `MFA_ENFORCE_FROM`(계정 발급 후), 실 SMTP, 보존 기간 확정, `EMBED_ORIGIN_ENFORCE` 검토 |
| 데이터 | 스테이징 테넌트를 다시 §6 절차로 이관(스냅샷·패키지·KB) — DB 복사 금지(데모 흔적) |
| 외부 | 모바일 앱 `widgetUrl` 프로덕션 오리진으로 스토어 재배포, 허브·Viber 웹훅 재등록 |
| 컷오버 | `PRODUCTION-CUTOVER.md` §2 순서, §4 스모크 |

## 10. 체크리스트 (한 장)
- [ ] 호스트·리전·도메인·TLS 결정 → 시크릿 파일 생성
- [ ] 프로필 env 복사·시크릿 생성·`--check` 통과
- [ ] 설치 → 스모크(Basic §9)
- [ ] 어드민 초기화(§5) → 테넌트 이관(§6)
- [ ] 베트남 체크리스트(§7) 항목별 담당·기한
- [ ] 운영 루틴 캘린더(배포·백업·리허설)
- [ ] 프로덕션 승격 조건(§9) 충족 확인
