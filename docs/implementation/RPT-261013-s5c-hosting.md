# RPT-261013-s5c-hosting

PLN-261012 **SG-80 / SG-81**(REQ D-18, §3.9) — "Go2Joy가 자기 인프라에서 SharpTalk를 단일 테넌트로 설치·운영한다"를 로컬에서 구현·검증한 결과.

- 작성일: 2026-10-13
- 문서 체인: `REQ-261012-Go2Joy-Stage1-Gap-Closure` §3.9 → `PLN-261012` §3.5 → 구현 → `TCR-261013-s5c-hosting` → 본 문서
- 브랜치 `feature/go2joy-s5c-hosting` (base `test/go2joy-integration` f7266697) — **push·PR 없음, 배포 없음**
- 커밋: `bae3c6dc` init-sql 6건 + 가드 · `cbf18935` migration 헬퍼 · `0018f198` 백업/복원/드릴/롤백/ops · `deceb0fd` 이미지 전달·번들·배포 · `5936358b` Amoeba 기본값 제거 · `47c1b1e0` 런북+가이드 정정 · `ed16240e` 실행 권한 · (이 문서 커밋)

## 1. 왜 필요했나 — 조사에서 확인한 것

| 발견 | 근거 | 조치 |
|---|---|---|
| **D-18 확인**: `docker/init-sql/01-schema.sql`이 6개 migration(19 artefact)을 갖고 있지 않음. 신규 설치는 `DB_SYNCHRONIZE=false`라 해당 컬럼이 영원히 없음 | 매니페스트 대조를 직접 계산, 일회용 MySQL에 수정 전 파일을 로드해 `check-migrations`가 정확히 6건 미적용 보고 | 파일 수정 + `npm run initsql:check` 가드(CI) |
| 첫 설치에서는 마이그레이션 검사가 아예 건너뛰어짐 | `deploy-self-hosted.sh`의 "DB 컨테이너 없음 = 첫 설치" 분기 | DB만 먼저 띄워 같은 검사를 하고 통과해야 앱 기동 |
| **파일명 순서 ≠ 릴리스 순서**: `migration_*.sql`이 가장 오래됐지만 마지막에 정렬. 안내문은 "릴리스 순서"라 하지만 목록은 파일명 순 | git 이력으로 103개 순서 계산 | `release order`(git 이력 또는 번들 동결본)로 출력 |
| `ALERT_EMAIL_FROM=`(빈 값)이 폴백되지 않음: `'' ?? user`는 `''` | 코드 | 빈 값 안전 해석 + Amoeba 주소 제거 |
| 기반 브랜치에서 `npm run env:check`가 이미 실패(`AGENT_PRESENCE_TTL_SEC`, `GUEST_GATE_CONFIDENCE`가 self-hosted 템플릿에 없음) | 실행 | 템플릿에 추가 |
| `/api/v1/health`는 **liveness만**(`{status:'ok'}`), 문서들은 `"db":"up"`이라 적음 | `health.controller.ts` | 문서 정정 + 배포 검증에 보호 라우트 401 판별 추가 |
| `CONVERSATION_LOG_RETENTION_DAYS` 비움/0 = **365일**(템플릿 주석은 "영구") | `retention.service.ts` | 런북에 정확히 기재, 템플릿 주석 수정은 SG-70(s5a) 범위로 두고 충돌 회피 |
| `CRED_ENC_KEY` 교체 시: 자격증명은 GCM 오류, **PII는 오류 없이 쓰레기 문자열**, blind index·삭제 차단 목록은 조용히 불일치, Tenant 로드(임베드 시크릿)가 광범위하게 실패할 수 있음. 코드에 교체 도구 없음 | `crypto.util.ts`, `tenant.entity.ts`, `migrate-encrypt-pii.ts` | 런북 §12(교체 금지 + 사고 시 절차) |

## 2. 변경 내용

### SG-80 — 전달·기본값

| 항목 | 내용 |
|---|---|
| init-sql | 8개 `CREATE TABLE`에 컬럼 19개(인덱스 1) 추가(덤프 순서) |
| 드리프트 가드 | `scripts/check-initsql-drift.mjs`: 매니페스트 vs 첫 부팅 DDL(CREATE 블록 + 뒤에 붙은 ALTER/INDEX), 종료 1(드리프트)/2(파싱 불가는 "이상 없음"으로 보고하지 않음), 사유 필수 예외 파일. `npm run initsql:check` + CI 단계 |
| 첫 설치 게이트 | `deploy-self-hosted.sh`: mysql 단독 기동 → `check-migrations.sh` → 통과 시에만 앱. 뒤처졌으면 "FIRST INSTALL STOPPED" |
| 이미지 | Dockerfile `npm ci` + ARG 핀(`node:20.19.0-alpine3.21`, `nginx:1.27.5-alpine`, digest 없음); compose `image: ${SHARPTALK_IMAGE_PREFIX:-sharptalk}/<svc>:${SHARPTALK_VERSION:-local}` + `build:`; 서드파티 핀(mysql 8.0.44, redis 7.4.9, rabbitmq 3.13.7, qdrant v1.15.1; env로 미러 지정) |
| 번들 | `scripts/build-release-bundle.sh`(미실행): build → save → `SHA256SUMS`, `manifest.json`(버전·커밋·이미지 체크섬·분류된 migration 목록), `release-order.txt`, `migrations.tsv`, README, 운영 스크립트, ops 파일. 기본 `--api-base /api/v1`(도메인 무관 번들). `deploy --bundle <dir>`: 체크섬 검증 → `docker load` → `--no-build`, 번들 자신의 스크립트로 재실행 |
| `--dry-run` | 배포·번들·백업·복원·롤백 모두 지원. 배포/번들은 docker 호출 0, 파일 쓰기 0(테스트로 고정) |
| 설정을 번들 밖에 | compose `env_file: ${SHARPTALK_ENV_FILE:-./.env.self-hosted}` (compose 렌더로 확인) — 번들 README의 `/etc/sharptalk` 방식이 실제로 동작하도록 |
| Amoeba 기본값 | §3 표 |

### SG-81 — 운영

| 항목 | 내용 |
|---|---|
| 백업 | 암호화(`openssl enc -aes-256-cbc -pbkdf2 -iter 600000`, 키 파일 ≥32자·권한 검사; **openssl 선택, gpg 아님**, HMAC 제외 사유 문서화), 회전 `BACKUP_KEEP_DAYS`, Qdrant 컬렉션 스냅샷(HTTP API, api 컨테이너의 Node 사용), 행 수 manifest, SHA256SUMS, 읽기 검증, LAST_SUCCESS/LAST_FAILURE |
| 복원 | 변경 전 검증, API 이미지로 업로드 복원(alpine pull 제거), Qdrant 복원, 첨부 정합성 검사를 컨테이너 N회 → 1회로, 행 수 대조 |
| 드릴 | `restore-drill-self-hosted.sh`: 일회용 MySQL로 운영 무접촉 복원 + 5가지 검사 + `DRILL_LOG` |
| 롤백 | `rollback-self-hosted.sh`: 이전 이미지 태그, 사이의 migration 분류, **non-reversible이면 거부(exit 3)**, 롤백 SQL 안내, `--allow-irreversible` |
| 스케줄 | `docker/self-hosted/ops/`: systemd 백업 timer(02:30 UTC)·분기 드릴 timer·cron.d·`backup.env.example` |
| 로그 | `json-file` 20m×5, self-hosted·production compose 전 서비스(`LOG_MAX_SIZE/FILE`) |
| golden gate | `deploy-self-hosted.sh --golden-gate`(기본 꺼짐; staging에만 있던 로직 이식) |
| 런북 | `docs/guide/RUNBOOK-261013-Go2Joy-SelfHosted.md`: 13절 베트남어 + 영어 요약표 + 부록(검증 현황·후속) |
| 문서 정정 | DEPLOYMENT-STRATEGY, Basic Setup, VN-Go2Joy 가이드·CHECKLIST, 자체호스팅설치가이드, INCIDENT-RESPONSE(JWT 변수명·백업·로그), PRODUCTION-CUTOVER, CONFIG.md, `sql/README.md` |

## 3. Amoeba 기본값 목록과 처리

| 위치 | 기본값 | 처리 |
|---|---|---|
| `apps/web/src/lib/widget-url.ts` | `shoptalk.amoeba.site/widget` (compose는 `VITE_WIDGET_URL`을 전달하지 않아 모든 자체 호스팅 콘솔이 이것을 노출) | 명시값 > 절대 `VITE_API_BASE_URL`의 오리진 > 콘솔 자신의 오리진 > (dev만) 레거시. 순수 함수 `widget-url-resolve.ts` + 테스트 |
| `ai-credit-alert.service.ts`, `golden-gate.ts` | `dev@amoeba.group` | `AI_ALERT_EMAIL` → `ALERT_EMAIL_TO` → 없음(경고 로그) |
| `mailer.service.ts` | `noreply@ivyusa.local` (+ 빈 값 버그) | `ALERT_EMAIL_FROM` → `SMTP_USER` → `noreply@<APP_PUBLIC_URL 호스트>` |
| `seed.runner.ts` | 테넌트 `ivyusa`, `admin@/dev@amoeba.group`, 비밀번호 `amb2026!@` | `SEED_TENANT_SLUG/NAME/DOMAIN`, `SEED_ADMIN_EMAIL`, `SEED_MASTER_EMAIL`, `SEED_ADMIN_PASSWORD`; production에서 비밀번호 미지정 시 계정별 생성·1회 출력(신규 계정에만 적용). 무설정 = 기존과 동일 |
| `web-push.provider.ts` | VAPID subject `mailto:dev@amoeba.group` | `VAPID_SUBJECT` → https `APP_PUBLIC_URL` → 레거시(개발 한정) |
| `docker/self-hosted/nginx.web.conf` | `frame-ancestors 'self' https://ama.amoeba.site` | 빌드 인자 `CONSOLE_FRAME_ANCESTORS`(기본 없음 = `'self'`) |
| 번들 매뉴얼 17개 파일 | `shoptalk/sharptalk.amoeba.site` | 이미지 빌드 시 `MANUAL_HOST`로 치환(번들은 `talk.example.com`) |
| **변경하지 않음(목록만)** | `nudge.service.ts`의 `APP_PUBLIC_URL` 폴백(배포 스크립트가 빈 값을 거부), Cafe24 콜백/반환 URL(Go2Joy 미사용), pwa/mobile `config.ts`·`app.json`·`shopify.app.toml`, 메신저 어댑터 기본 URL(`api-talk.amoeba.site` 허브·`messenger.amoeba.site` 릴레이 — Amoeba 운영 서비스이므로 egress 목록에 기재), 콘솔 입력란 placeholder(`ops@amoeba.group`)·DEV 한정 로그인 힌트 | 런북 §2 |

## 4. PLN 대비 편차

1. `seed/seed.runner.ts`가 아니라 실제 경로 `apps/api/src/database/seed.runner.ts`.
2. 롤백 분류를 Node가 아니라 **bash+awk**로 구현(고객 호스트에 Node가 없을 수 있음). 분류는 보수적: `MODIFY`로 컬럼을 넓히는 것도 `destructive`.
3. HMAC 없음(openssl `-hmac`은 키를 명령줄에 노출). 무결성은 SHA256SUMS(손상 감지), 변조 방지는 오프사이트 object-lock에 위임 — 문서화.
4. 번들 서명(cosign/GPG)은 구현하지 않음. 체크섬 + 별도 채널로 `sha256sum SHA256SUMS` 전달을 런북에 규정.
5. `.gitattributes`(LF 강제)를 신설: Windows 체크아웃의 CRLF가 셸 스크립트·Dockerfile COPY 스크립트·`artefacts.tsv`를 깨뜨렸다.
6. 포함 범위 확대: `SHARPTALK_ENV_FILE` env_file 보간, `/api/v1/auth/me` 401 검증, `up --no-deps --force-recreate nginx`(스테이징 스크립트의 `--force-recreate nginx`는 의존 서비스까지 재생성).
7. staging compose의 로그 로테이션은 건드리지 않음(요구는 self-hosted·production).

## 5. 마이그레이션·배포 상태

- **스키마 변경 PR 규칙 해당 여부**: 새 `sql/*.sql` 없음, `*.entity.ts` 변경 없음. `docker/init-sql/01-schema.sql`만 수정(이미 `sql/`에 있던 6개 migration을 반영) → 기존 DB에는 적용할 SQL 없음. **`## Migration` 절 불필요.**
- 배포 상태: **어디에도 배포하지 않음** (staging·KR production·Go2Joy 모두).
- Amoeba 자체 환경에 배포할 때 필요한 선행 조치(안 하면 동작이 바뀜):
  1. staging·KR-production **env에 `AI_ALERT_EMAIL=dev@amoeba.group` 명시** — 코드 기본값이 사라졌다(예시 파일은 갱신).
  2. KR-production은 AMA 포털 iframe SSO를 쓰므로 env에 `CONSOLE_FRAME_ANCESTORS=https://ama.amoeba.site` 필요(웹 이미지 재빌드).
  3. 위 외에는 기본값이 기존과 같다(시드 무설정). 의도된 동작 변경 1건: 콘솔 임베드 스니펫의 위젯 URL — staging은 그대로지만, **KR production은 지금까지 스테이징 호스트(`shoptalk.amoeba.site`)를 노출**하던 것이 자기 도메인(`sharptalk.amoeba.site`)으로 바뀐다.

## 6. VERIFIED vs NOT VERIFIED

**VERIFIED (실행함)** — 상세 `TCR-261013-s5c-hosting.md`
- `scripts:test` 97/97, API jest 2505 통과(실패 3 = 알려진 baseline), tsc ×3 오류 0, `initsql:check`, `env:check`, compose 렌더(self-hosted·production), `bash -n` 전체.
- 일회용 MySQL 8.0.44: 수정 전/후 init-sql, 암호화 백업 → 복원 → 드릴(음성 케이스 포함), 시드 실DB 실행.
- 수정 전 코드에서 회귀 테스트가 실패함(첫 설치 게이트 부재, CRLF 매니페스트, 백업 실패 잔여물, 드리프트).

**NOT VERIFIED**
- 실제 `docker build`/`save`/`load`/번들 배포, 이미지 내부 `npm ci`(건식만), Linux 호스트 설치, **기반 이미지 태그 존재**(`node:20.19.0-alpine3.21`, `nginx:1.27.5-alpine` — 번들 스크립트가 빌드 전 `docker manifest inspect`로 확인).
- 실제 Qdrant 스냅샷/업로드(가짜 서버만), `nginx -t`, `VITE_API_BASE_URL=/api/v1` 콘솔의 브라우저 동작, `kb-reindex.js` 컨테이너 실행, shellcheck(미설치), systemd/cron 실제 등록, Redis 장애 시 동작.
- 번들 서명 없음(미구현).

## 7. 교차 스트림 위험·후속

| 항목 | 내용 |
|---|---|
| **병합 시 init-sql 재검증** | 다른 스트림이 `sql/*.sql`·`01-schema.sql`을 동시에 수정: 병합 후 `npm run initsql:check`를 다시 실행(가드는 CREATE 블록과 ALTER 추가형 모두 인식) |
| `docker/self-hosted/.env.self-hosted.example`·프로필 예시 | s5a/s5b/s5d가 같은 파일을 수정(AGENT_PRESENCE/GUEST_GATE 키는 나도 추가 — 동일 문구, 충돌 시 한쪽 채택). 보존 기간 주석 오류(영구 아님, 365일)는 s5a SG-70이 고칠 것 |
| `ai-credit-alert.service.ts`, `mailer.service.ts` | s5b(SG-83 일반 알림 채널)가 같은 파일을 만질 수 있음 — 수신자 해석은 `alert-address.util.ts` 한 곳으로 모아 두었으니 s5b는 그 함수를 확장 |
| `INCIDENT-RESPONSE.md` | s5a가 연락처 표를 수정(내 수정은 §3.2/3.4/4의 3줄) |
| 런북의 링크 | `GUIDE-261013-Go2Joy-HotelAdmin-CSP-CORS.md`, `GUIDE-261013-Observability-Alerting.md`는 다른 스트림 산출물 — 병합 전에는 끊어진 링크 |
| `/health/ready` | s5b가 Redis·Qdrant를 추가할 때 런북 §9의 표를 갱신 |
| 후속 | 번들 서명, Node 20 EOL(2026-04) → 22 LTS, `CRED_ENC_KEY` 교체 도구, 번들 첫 실빌드·Linux 설치 리허설, 런북 vi 원어민 검수·연락처 기입, 첫 실설치 시 `docker compose config`가 아닌 실제 `up`으로 `env_file` 보간 재확인 |
