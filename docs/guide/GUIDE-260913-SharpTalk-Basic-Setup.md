# SharpTalk-Basic 세팅 가이드 — 기술 스택 · 서버 요구 사양 · 설치 · 운영

> 버전 1.0 · 2026-09-13 · 코드 기준(main `48b3e31`) · 근거 REQ/PLN-260913-Locale-Deployment-Guides
> 대상: 국가별 스테이징/프로덕션 서버를 세우는 인프라·운영 담당자
> 함께 읽기: [로컬 커스터마이징 가이드](GUIDE-260913-Locale-Customization.md) → 국가 프로필 가이드([VN-Go2Joy](GUIDE-260913-SharpTalk-VN-Go2Joy-Staging.md) · [USA-IVY](GUIDE-260913-SharpTalk-USA-IVY-Staging.md))

이 문서는 **"아무 국가에나 새 서버를 0에서 세워 운영 상태로 만드는 한 흐름"**만 담습니다. 세부 런북은 링크로 연결합니다:
`자체호스팅설치가이드`(패키지 상세) · `DEPLOYMENT-STRATEGY.md`(환경·브랜치) · `PRODUCTION-CUTOVER.md`(컷오버·코드로 오지 않는 것) · `.claude/skills/pre-deploy-check/SKILL.md`(마이그레이션 순서) · `CONFIG.md`(env·포트 참조).

---

## 0. SharpTalk-Basic이란

| 용어 | 뜻 |
|---|---|
| **SharpTalk-Basic** | 이 저장소(`amoeba-group/btbz-sharp-talk`)의 `main`. 모든 국가·고객사 배포의 **유일한 코드 원천** |
| **배포 프로필** | 한 서버(한 국가)를 정의하는 값의 묶음: env 파일 + 시크릿 파일 + 테넌트 설정 스냅샷 + 초기 데이터 + 체크리스트. 코드가 아닙니다 |
| **별칭** | `SharpTalk-{Basic \| CC \| CC-Customer}` — CC는 ISO 3166 대문자(KR·VN·USA). 예: `SharpTalk-VN-Go2Joy`, `SharpTalk-USA-IVY`. 프로필 디렉터리·시크릿 파일·compose 프로젝트명·백업 경로에 같은 별칭을 씁니다 |

```
                 SharpTalk-Basic (main, 단일 저장소)
                 ├─ 코드 · 스키마 · 마이그레이션 매니페스트 · 이미지 빌드 정의
                 │
   ┌─────────────┼──────────────────┐
   ▼             ▼                  ▼
SharpTalk-KR   SharpTalk-VN       SharpTalk-USA        ← 국가 = 배포 1벌(스테이징 + 프로덕션)
(현 스테이징)  └ Go2Joy(테넌트)   └ IVY(테넌트)         ← 고객사 = 그 안의 테넌트
   프로필 = deploy/profiles/<별칭>/ + secrets/<별칭>-server.md (gitignored)
```

원칙 세 가지:
1. **포크하지 않습니다.** 국가 요구가 코드를 바꿔야 하면 Basic에 설정·플래그로 넣고 프로필이 켭니다. 코드 없이 안 되는 것은 [로컬 커스터마이징 가이드 §4](GUIDE-260913-Locale-Customization.md#4-코드-변경이-필요한-갭) 갭 목록으로 관리합니다.
2. **국가 스테이징은 self-hosted 스택**(`docker/self-hosted/`)으로 세웁니다. env 검사·마이그레이션 검사·헬스 검증·백업/복원이 갖춰진 유일한 스택입니다. 한국 스테이징 스택(`docker/staging/`)은 공유 호스트 특수성(볼륨 이름 고정, 8080)이 많아 복제 기준으로 쓰지 않습니다.
3. **같은 국가의 두 번째 고객사는 테넌트 추가**입니다. 보존 기간·AI 키·AI 국외이전 고지는 배포 전역이라 국가 단위로 나누면 규제 요건이 맞아떨어집니다.

---

## 1. 기술 스택

| 층 | 구성 | 버전(이미지 태그 고정) |
|---|---|---|
| 모노레포 | Turborepo — `apps/api`(NestJS 10 + TypeORM), `apps/web`(콘솔, React 18 + Vite + Tailwind + Zustand + React Query), `apps/widget`(고객 위젯 SPA), `apps/pwa`(앱 모드, 선택), `apps/mobile`(RN, 선택), `packages/types`·`packages/common`, `sdk/android`(Kotlin WebView SDK) | Node **20** (`engines >=20`), 이미지 `node:20-alpine` |
| 데이터 | MySQL 8.0(utf8mb4_unicode_ci) · Redis 7 · RabbitMQ 3.13 · Qdrant 1.15.1(벡터) | `mysql:8.0` `redis:7-alpine` `rabbitmq:3.13-management-alpine` `qdrant/qdrant:v1.15.1` |
| 엣지 | nginx(컨테이너, TLS 없음) ← 호스트 TLS 종단(nginx/Caddy/LB) | `nginx:alpine` |
| AI | 게이트웨이 어댑터 anthropic · openai(+ google/azure/custom 자리) · **stub**(키 없이 동작), 임베딩 Voyage(`voyage-3/4`), RAG = Qdrant + MySQL FULLTEXT 폴백, 모더레이션 필수 통과 | — |
| 언어 | en(기본) · es · ko · vi · ja · zh — 목록은 `packages/types/src/common/language.ts` 한 곳 | — |
| 인증 | JWT(Bearer, localStorage) · bcrypt · TOTP MFA · 자격증명/PII AES-256-GCM(`CRED_ENC_KEY`) | — |
| 연동 | 커머스 Shopify·Cafe24·WooCommerce·Odoo·Haravan / 메신저 Telegram·Viber·AmoebaTalk 허브·btbz 릴레이·Gmail / 헬프데스크 Gorgias / 마케팅 Klaviyo·Yotpo / 지식 소스 Notion·Google Drive·게시판 | 자격증명은 콘솔에서 테넌트별 암호화 저장(env 아님) |

빌드는 서버에서 `docker compose --build`로 합니다(멀티스테이지, `turbo run build --filter`). **서버에 Node.js는 필요 없습니다.**

---

## 2. 아키텍처

```
 인터넷 ──TLS──▶ 호스트 nginx / Caddy / LB  (443, 인증서 — 스택 밖)
                       │  http://127.0.0.1:${HTTP_PORT:-8080}
                       ▼
               ┌── nginx (컨테이너) ──────────────────────────────┐
               │  /                    → web:80      (콘솔 SPA)     │
               │  /widget/…            → widget:80   (고객 위젯)     │
               │  /widget/widget-config.js  (배포별 런타임 설정, 호스트 파일) │
               │  /widget-design/live/ → 볼륨 /data/uploads/widget-live/ (정적 라이브 테마) │
               │  /api/…               → api:3000    (NestJS, WS 포함) │
               └───────────────────────────────────────────────────┘
                 api ─── mysql · redis · rabbitmq · qdrant  (내부 네트워크, 호스트 포트 없음*)
 볼륨: sharptalk_uploads(첨부·로고·테넌트 자산·라이브 테마) · mysql_data · redis_data · rabbitmq_data · qdrant_data
 * mysql만 127.0.0.1:3306 루프백 노출(백업·SQL 선적용용)
```

**데이터 위치(감사·규제 답변용)**

| 데이터 | 위치 | 나라 밖으로 나가는가 |
|---|---|---|
| 대화·고객·설정·감사로그 | `sharptalk_mysql_data` | 아니오 |
| 첨부·위젯 로고·디자인 파일·설정 스냅샷·라이브 테마 | `sharptalk_uploads` (`/data/uploads`) | 아니오 |
| 검색 인덱스(임베딩 벡터) | `sharptalk_qdrant_data` | 아니오(벡터만 저장) |
| 세션 캐시·번역 캐시 | `sharptalk_redis_data` | 아니오 |
| **AI 생성·임베딩 호출** | Anthropic/OpenAI/Voyage 엔드포인트 | **예 — 대화 본문 포함** |
| 켜둔 연동 | 커머스·메신저·헬프데스크 API | 예(해당 연동만) |

**외부 통신(egress) 허용 목록** — 방화벽이 아웃바운드를 막는 환경이면 열어야 합니다:
`api.anthropic.com` · `api.openai.com`(선택) · `api.voyageai.com` · Google Fonts(`fonts.googleapis.com`, `fonts.gstatic.com` — 위젯 프리셋 폰트) · 커머스/메신저 API 호스트(연동별) · `github.com`(소스 pull) · Docker Hub(이미지 pull) · SMTP 서버.

---

## 3. 서버 요구 사양

| | 스테이징(UAT·데모) | 프로덕션(초기, 테넌트 ≤5) | 프로덕션(성장) |
|---|---|---|---|
| vCPU / RAM | 4 / 8GB | 8 / 16GB | API·DB 분리 순서: MySQL → Qdrant → RabbitMQ |
| 디스크 | 80GB SSD (첨부 누적) | 200GB+ SSD, 볼륨 별도 디스크 권장 | 첨부 증가율로 산정 |
| OS | Ubuntu 22.04/24.04 LTS 또는 동급, **UTC** 호스트 시각, NTP | 동일 | |
| Docker | Docker Engine 24+ · Compose v2 (`docker compose`) | 동일 | |
| 포트 | 인바운드 22(관리자 IP 제한)·443(TLS 종단) / 내부 8080 | 동일 | |
| 백업 저장소 | 호스트 밖(오브젝트 스토리지·다른 서버) — **국가 안** | 필수, 일 1회 이상 | |
| 도메인 | 콘솔·위젯·API가 **한 오리진**(예 `talk-vn.example.com`) | 동일 | |
| 리전 | **데이터 상주 요건이 있는 국가는 그 나라 리전**(VN PDPD, KR PIPA) | 동일 | |

메모리는 MySQL·Qdrant·RabbitMQ가 한 호스트에 같이 뜨기 때문에 8GB 미만이면 빌드(`--build`) 중 OOM이 납니다. 빌드가 부담이면 CI에서 이미지를 만들어 레지스트리로 옮기는 방식으로 바꿀 수 있으나 현재는 서버 빌드가 표준입니다.

---

## 4. 설치 (0 → 첫 로그인)

```bash
# 4-1. 저장소
git clone https://github.com/amoeba-group/btbz-sharp-talk.git sharptalk && cd sharptalk
git checkout main                                   # Basic = main

# 4-2. 프로필에서 env 복사 (프로필이 없으면 self-hosted example)
cp deploy/profiles/<별칭>/.env.<별칭>.example docker/self-hosted/.env.self-hosted
#   또는: cp docker/self-hosted/.env.self-hosted.example docker/self-hosted/.env.self-hosted

# 4-3. 시크릿 생성 → env에 붙여넣기 (화면에만 출력, 디스크에 안 남음)
bash scripts/gen-secrets.sh

# 4-4. 배포 전 점검 (아무것도 바꾸지 않음): env 필수값·UPLOAD_DIR·미적용 SQL
bash scripts/deploy-self-hosted.sh --check

# 4-5. 설치 (빌드 + 기동 + 헬스 검증)
bash scripts/deploy-self-hosted.sh
```

`deploy-self-hosted.sh`가 하는 일(순서대로): env 파일 존재·`UPLOAD_DIR=/data/uploads`·필수 시크릿 검사 → `docker/self-hosted/widget-config.js` 생성(`VITE_API_BASE_URL`) → `scripts/check-migrations.sh`로 미적용 SQL 검출(있으면 **중단**) → `docker compose … up -d --build` → `/api/v1/health` 60×5초 폴링, `/widget/`·`/` 200, API 로그 `successfully started` 확인.

**스키마**: 첫 부팅은 MySQL 볼륨이 비어 있을 때 `docker/init-sql/01-schema.sql`이 자동 실행됩니다(마운트 `/docker-entrypoint-initdb.d`). 그 뒤의 변경은 `sql/*.sql`을 **코드 배포 전에 사람이 적용**합니다(§7.1). `DB_SYNCHRONIZE`는 언제나 `false`.

**첫 로그인**: `SEED_ON_BOOT=true`로 첫 부팅하면 플랫폼 관리자 `admin@amoeba.group`와 테넌트 `ivyusa`의 `dev@amoeba.group`이 `SEED_PASSWORD`로 생성됩니다(첫 로그인 시 변경 강제). **성공 후 즉시 `SEED_ON_BOOT=false`로 바꾸고 API를 재생성**하세요 — 켜 둔 채 재시작하면 계정 비밀번호가 시드값으로 되돌아갑니다. 시드 테넌트 이름·KB는 미국 화장품 기준이므로 국가 프로필 가이드의 "초기화" 절에서 정리합니다.

---

## 5. 환경 변수 카탈로그

원본은 `docker/self-hosted/.env.self-hosted.example`(CI `npm run env:check`가 코드와 대조). 아래는 **결정이 필요한 것** 중심 요약입니다. 전체 키 설명은 그 파일과 `CONFIG.md` §4를 보세요.

### 5.1 필수 (없으면 안 뜨거나 잘못 뜸)
| 키 | 값 | 비고 |
|---|---|---|
| `NODE_ENV` | `production` | 스테이징도 production — 시크릿 검사가 켜집니다 |
| `DB_*`, `DB_ROOT_PASSWORD`, `RABBITMQ_*`, `RABBITMQ_URL` | gen-secrets | `RABBITMQ_URL`에 같은 비밀번호를 넣어야 합니다 |
| `DB_SYNCHRONIZE` | `false` | 절대 true 금지 |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | 32B+ | placeholder 패턴이면 부팅 거부 |
| `CRED_ENC_KEY` | 32B base64 | **영구 불변**(§8) |
| `UPLOAD_DIR` | `/data/uploads` | 배포 스크립트가 검사 |
| `APP_PUBLIC_URL`, `PUBLIC_BASE_URL` | `https://<도메인>` | 푸시·메일·웹훅 링크의 기준. 비우면 **한국 스테이징으로 폴백** |
| `VITE_API_BASE_URL` | `https://<도메인>/api/v1` | **빌드 시 번들에 박힘** — 바꾸면 재빌드 |
| `SEED_ON_BOOT` / `SEED_DEMO_DATA` / `SEED_PASSWORD` | 첫 부팅만 true / false / 강한 값 | |

### 5.2 기능 (켜는 만큼)
| 블록 | 키 | 국가 프로필에서 정하는 것 |
|---|---|---|
| AI | `AI_DEFAULT_PROVIDER`(`stub`/`anthropic`), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_*` | 키 소유 주체, 국외이전 고지(대화 본문이 미국 엔드포인트로 감) |
| 검색 | `QDRANT_URL=http://qdrant:6333`, `VOYAGE_API_KEY`, `VOYAGE_MODEL` | 없으면 FULLTEXT만 — 한국어·베트남어 검색 품질 급락 |
| 첨부 링크 | `FILE_URL_SECRET` | 비우면 `CRED_ENC_KEY`에서 유도, 이후 불변 |
| 임베드 | `EMBED_ORIGIN_ENFORCE` | 처음엔 false로 경고만 관찰 |
| 커머스 | `SHOPIFY_*`(+`SHOPIFY_WEBHOOK_SECRET`·`FULFILLMENT_WEBHOOK_SECRET` — **production에서 필수**), `CAFE24_*` | 국가별 플랫폼. 앱 URL·콜백은 도메인 확정 후 외부 재등록 |
| 메신저 | `MESSENGER_WEBHOOK_BASE_URL` | 인터넷에서 닿는 오리진 |
| SSO | `AMA_SSO_*` | Amoeba 포털 쓸 때만 |
| 메일·알림 | `SMTP_*`, `ALERT_EMAIL_FROM/TO`, `SLACK_WEBHOOK_URL` | 발신 도메인은 국가별. `ALERT_EMAIL_FROM` 비우면 `noreply@ivyusa.local` 폴백 |
| 푸시 | `VAPID_*`, `EXPO_PUSH_ACCESS_TOKEN` | PWA/모바일 쓸 때만 |

### 5.3 튜닝 (규제와 직결되는 것만)
| 키 | 기본 | 결정 기준 |
|---|---|---|
| `CONVERSATION_LOG_RETENTION_DAYS` | 비움/0/잘못된 값=**365일**(영구 아님 — 2026-10-13 정정, 이전 표기는 틀렸음) | **공개한 개인정보 처리방침의 보존 기간과 같게**. 배포 전역(테넌트별 불가). `vn_pdpl` 동의 고지는 이 값을 그대로 인용함 |
| `AI_USAGE_RETENTION_DAYS` | 400 | 토큰 카운터만, 개인정보 없음 |
| `RETENTION_PURGE_INTERVAL_HOURS` | 24 | 0이면 스케줄러 정지 |
| `MFA_ENFORCE_FROM` | 비움 | **프로덕션에서만**, 계정 발급 뒤 날짜로(컷오버 §3-1) |
| `TENANT_ASSET_QUOTA_DESIGN_MB` / `_SETTINGS_MB` | 50 / 20 | 요금제별 상향 시 |
| `ATTACHMENT_MAX_*`, `ATTACHMENT_ALLOW_HEIC` | 10/20MB, true | nginx `client_max_body_size 25m`보다 작게 |

### 5.4 도메인을 담는 키 (도메인 전환 시 전부)
`VITE_API_BASE_URL`(재빌드) · `APP_PUBLIC_URL` · `PUBLIC_BASE_URL` · `SHOPIFY_APP_URL` · `CAFE24_REDIRECT_URI` · `CAFE24_CONSOLE_RETURN_URL` · `MESSENGER_WEBHOOK_BASE_URL`. 외부 재등록: Shopify 앱 URL·상점별 웹훅(301을 따라가지 않음), Cafe24 redirect_uri(앱당 1개), AMA 파트너앱. 상세: `docs/analysis/REQ-260909-Domain-Switch-Side-Impact.md`.

---

## 6. 초기화 — 코드로 오지 않는 것

배포만으로는 동작하지 않고 사람이 콘솔에서 넣어야 합니다(`PRODUCTION-CUTOVER.md` §3 확장).

| # | 항목 | 어디서 | 안 하면 |
|---|---|---|---|
| 1 | 플랫폼 AI 엔진 등록 + 키 | 어드민 > AI 엔진 | 시드는 stub만 → **조용히 stub 응답** |
| 2 | 테넌트 생성(이름·슬러그·도메인·요금제) → 제공 메뉴 → 애드온(워크플로우·커스텀 CSS) | 어드민 > 테넌트 | |
| 3 | 관리자 초대(임시 비밀번호 1회 표시) → 첫 로그인 → MFA | 어드민 > 테넌트 사용자 | |
| 4 | 테넌트 설정: 타임존(→ 기본 언어 유도), 스토어프런트·임베드 오리진·시크릿, 위젯 문구 6언어, 개인정보 URL·동의 버전, 알림 채널 | 설정 탭 6종 | 24시간 상담원 호출·영어 기본 |
| 5 | 핸드오프: 담당자·업무시간·휴게·영업외 메일 | 설정 > 기본 > 상담원 연결 | |
| 6 | 지식: 카테고리·KB(CSV/XLSX 일괄등록·카탈로그 동기화·외부 소스) → **Voyage 키로 재색인** | 지식 | 검색 0건 → 인계로 낙하 |
| 7 | 연동 자격증명(테넌트별 암호화 저장) + **[연결 테스트]** | 설정 > 플랫폼·메신저·마케팅 | 저장 ≠ 연결 |
| 8 | 커스텀 위젯·디자인 파일(선택) | 설정 > 위젯 | 기본 위젯 |
| 9 | 응답 규칙·모더레이션·시나리오 | AI 설정 | 시드 기본값(미국 화장품 문구) |

기존 환경(한국 스테이징)에 같은 테넌트가 있으면 4·8은 **설정 스냅샷 복원**, 6은 **KB 일괄 내보내기→등록**, 8은 **커스텀 위젯 패키지**로 옮깁니다. 7은 암호화 키가 다르므로 **재입력**입니다. 절차: [로컬 커스터마이징 가이드 §3](GUIDE-260913-Locale-Customization.md#3-테넌트-설정-이관).

---

## 7. 운영

### 7.1 배포 루틴 (SQL 먼저, 코드는 나중)
```bash
cd ~/sharptalk && git pull --ff-only origin main
MYSQL_CONTAINER=sharptalk_mysql bash scripts/check-migrations.sh      # 미적용 목록
# 있으면: docker cp sql/<file>.sql sharptalk_mysql:/tmp/ && docker exec -i sharptalk_mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" db_sharptalk < /tmp/<file>.sql'
bash scripts/deploy-self-hosted.sh                                     # 빌드·기동·검증
```
- 순서 근거: 옛 코드 + 새 컬럼 = 안전, 새 코드 + 옛 스키마 = 500. 스크립트는 SQL을 **절대 자동 적용하지 않습니다.**
- `sql/` 파일명 순서 ≠ 의존 순서(`AFTER <column>` 사용 파일 있음) → 릴리스 순서(매니페스트 순)로 적용.
- ssh + docker exec로 heredoc을 넘길 때는 `-i` 필수(dev-kit B-4).

### 7.2 배포 검증 (종료 코드를 믿지 않는다)
| 확인 | 판독 |
|---|---|
| `docker ps` STATUS | 컨테이너 나이가 방금이어야 함(옛 컨테이너가 살아 있으면 배포 안 된 것) |
| `docker logs sharptalk_api \| grep 'successfully started'` | 부팅 완료 |
| 새 라우트 curl | **401 = 배포됨 · 404 = 안 됨 · 502 = API 다운/재시작 중** |
| `/api/v1/health` | `{"status":"ok","db":"up"}` |
| `/widget/`, `/`, `/manual/` | 200 |

### 7.3 백업·복원 (반드시 둘 다)
```bash
bash scripts/backup-self-hosted.sh /backup/sharptalk/$(date -u +%Y%m%d)   # db.sql.gz + uploads.tar.gz + manifest
bash scripts/restore-self-hosted.sh /backup/sharptalk/20260913
```
DB만 백업하면 "대화는 있는데 사진이 없는" 시스템이 됩니다. 스크립트는 둘 중 하나가 비면 실패합니다. 백업은 **호스트 밖, 나라 안**으로 옮기고 복원 리허설을 분기 1회 합니다. Qdrant는 재색인으로 복구 가능하므로 백업 대상이 아닙니다(`npm run kb:reindex`는 개발 환경 명령; 서버에서는 콘솔 재색인 또는 API).

### 7.4 업그레이드·롤백
- 업그레이드 = 7.1. 릴리스 노트에 `## Migration`이 있는 PR은 SQL 선적용.
- 롤백 = `git checkout <이전 SHA>` → `deploy-self-hosted.sh`. 이미 적용한 SQL은 남겨 둡니다(옛 코드는 새 컬럼을 무시). 롤백 불가 마이그레이션(컬럼 삭제)은 PR 본문 롤백 계획을 따릅니다.

### 7.5 모니터링 지점
`/api/v1/health` 외부 감시 · `docker logs` `ERROR`/`WARN` 집계(4xx는 기본 미기록 — "로그 없음 ≠ 성공") · MySQL 디스크·`sharptalk_uploads` 사용량 · RabbitMQ 큐 적체(`:15672` 관리 UI는 내부에서만) · 보존 퍼지 실행 로그 · Anthropic/Voyage 실패율(콘솔 AI 사용량 탭 stub 폴백 경고).

---

## 8. 보안 기본값

| 항목 | 규칙 |
|---|---|
| 시크릿 파일 | `secrets/<별칭>-server.md`(gitignored) — 구조: `## Connection`(Host·DNS·SSH user·SSH key·deploy path·public URLs) / `## Deploy quickstart` / `## Admin` / 역순 배포·사고 로그. **값은 문서·PR·채팅에 쓰지 않음** |
| 절대 불변 | `CRED_ENC_KEY`(연동 자격증명·PII 복호화 불가), `FILE_URL_SECRET`(발송된 첨부 링크 전부 무효), `UPLOAD_DIR`, `DB_SYNCHRONIZE=false` |
| 포트 | 443만 인터넷. 8080은 루프백 프록시 대상, mysql 3306은 127.0.0.1, 나머지 내부 네트워크 |
| 헤더 | 콘솔 `X-Frame-Options DENY`/`frame-ancestors`(AMA 포털 iframe SSO를 쓰면 `'self' https://ama.…`로 완화), HSTS, nosniff |
| 임베드 오리진 | 허용목록은 **보안 경계가 아님** — 신원은 `embed_secret` HMAC 서명 |
| MFA | 프로덕션 `MFA_ENFORCE_FROM` 설정(계정 발급 후 날짜), 스테이징은 미설정 |
| CI | `typecheck · env:check · migrations manifest · test · build` — 배포 잡 없음(서버에서 수동) |

---

## 9. 스모크 체크리스트 (배포 직후 10분)

- [ ] `docker ps` 전 컨테이너 Up, api `(healthy)`
- [ ] `/api/v1/health` ok · `/`·`/widget/`·`/manual/` 200 · `/widget/widget-config.js`가 이 도메인의 API를 가리킴
- [ ] 플랫폼 관리자 로그인 → 테넌트 목록 · AI 엔진에 실제 엔진 활성
- [ ] 테넌트 master 로그인 → 설정 > 위젯 > 임베드 스니펫의 URL이 **이 도메인**(한국 스테이징 폴백 아님)
- [ ] 위젯 `?shop=<도메인>` 열기 → 동의 배너 → 인사말 → 질문 1건에 KB 근거 답변(스텁 아님)
- [ ] 첨부 이미지 업로드 → 서명 링크 200 → `docker exec sharptalk_api ls /data/uploads/<tenantId>`
- [ ] 커스텀 위젯 [사용함] → `/widget-design/live/<shop>.json` 200
- [ ] 상담원 인계 → 콘솔 라이브챗 알림
- [ ] 백업 스크립트 1회 실행 → 두 파일 생성
- [ ] `SEED_ON_BOOT=false` 확인

---

## 10. 알려진 결함·주의 (2026-09-13)

| 항목 | 상태 | 대응 |
|---|---|---|
| `docker/production/` 스택에 pwa 없음, `/app` 라우트 없음 | 설계 | PWA가 필요하면 self-hosted/staging 스택 참고해 추가 |
| 코드 폴백이 한국 스테이징을 가리킴(`APP_PUBLIC_URL`·`VITE_WIDGET_URL`·`ALERT_EMAIL_FROM`·Cafe24·pwa/mobile config·`shopify.app.toml`) | 갭 | env를 **비우지 말 것**. 목록: 로컬 가이드 §4 G14·G15 |
| 기본 언어 `en` 고정, 타임존 목록에 호찌민 없음, 베트남 전화 PII 패턴 없음, AI 고지 "미국" 고정, 시드 KB 미국 화장품 | 갭 | 베트남 착수 전 선행 요구사항(로컬 가이드 §4 P0) |
| 저장소는 로컬 볼륨만(S3 없음) | 설계 | 데이터 상주 = 호스트 리전으로 해결 |
| 보존 기간은 배포 전역 | 설계 | 국가 단위 배포 원칙(§0)으로 해결 |
