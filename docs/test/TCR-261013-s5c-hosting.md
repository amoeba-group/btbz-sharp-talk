# TCR-261013-s5c-hosting

PLN-261012 SG-80 / SG-81 (REQ D-18) — Go2Joy 자체 인프라 호스팅: 테스트 케이스와 결과.

- 작성일: 2026-10-13
- 브랜치: `feature/go2joy-s5c-hosting` (base `test/go2joy-integration` f7266697) · **배포하지 않음**
- 실행 환경: Windows 11 + Git Bash, Docker Desktop 28.2.2 (로컬 일회용 컨테이너만), Node 22.21.1
- **원칙**: 배포 스크립트·`docker compose build/up`(self-hosted/production)·이미지 빌드·다운로드는 실행하지 않았다. 스크립트 로직은 가짜 `docker`/`curl`로, DB 동작은 일회용 MySQL 8.0.44 컨테이너(`mysql:8.0` 로컬 이미지)로 검증했다.

## 1. 요약

| 영역 | 도구 | 결과 |
|---|---|---|
| `scripts/__tests__/*.test.mjs` (`npm run scripts:test`) | `node --test` | **97 / 97 통과** (아래 §2) |
| API jest (전체) | `npx jest` (apps/api) | 2505 통과 · 3 실패 = **알려진 baseline 3건**(`embed-loader`, `heic-conversion`, `board-attachment.service`), 내 변경과 무관 |
| API jest (내가 건드린 파일) | seed-identity · seed.runner · alert-address · ai-credit-alert 외 | 신규·갱신 27건 포함 전부 통과 |
| tsc | `tsconfig.check.json` ×3 (api / web / widget) | 오류 0 |
| `npm run initsql:check` | 드리프트 가드 | `OK — 192 manifest artefact(s) all exist … (93 tables)` |
| `npm run env:check` | 템플릿 완전성 | OK (기반 브랜치에서 이미 실패하던 2건 `AGENT_PRESENCE_TTL_SEC`·`GUEST_GATE_CONFIDENCE`를 템플릿에 추가) |
| `npm run migrations:manifest` | 매니페스트 | 변경 없음(새 SQL 파일 없음) |
| `bash -n` | 모든 `.sh` (scripts, lib, build-steps, docker/*/deploy-*.sh) | 통과(테스트 `every shell script parses`) |
| shellcheck | — | **미설치 → 미실행** |
| `docker compose config` | self-hosted, production (환경변수 채움) | 렌더 성공, 전 서비스 `json-file 20m×5`, 이미지명·핀 확인 (build/up 아님) |

## 2. 테스트 파일별 (모두 `scripts/__tests__/`)

| 파일 | 건수 | 무엇을 고정하는가 |
|---|---|---|
| `check-initsql-drift.test.mjs` | 7 | 음성/양성 픽스처, ALTER 추가형 DDL 인식, CRLF, 예외(사유 필수), 종료코드 1/0/2, **실제 저장소 드리프트 0** |
| `widget-url-resolve.test.mjs` | 6 | 콘솔 설치 스니펫이 스테이징 호스트를 가리키지 않음(명시 > 절대 API 베이스 > 자기 오리진 > dev 한정 레거시) |
| `migrations-lib.test.mjs` | 13 | 분류(additive/breaking/destructive/data/unknown), 주석 처리(`America/*` 사례), 롤백 SQL 추출, **실제 103개 migration 전부 분류·unknown 0**, 릴리스 순서(임시 git 저장소: `migration_*`가 가장 오래됐으나 파일명상 마지막), 동결 `release-order.txt`, CRLF 매니페스트 |
| `deploy-self-hosted.test.mjs` | 18 | `--dry-run`(docker 호출 0, 파일 쓰기 0) · `--check` · **첫 설치: mysql 단독 기동 → 게이트 → 앱 기동 순서** · **init-sql 뒤처지면 앱 미기동(D-18)** · 업그레이드 게이트 · `--skip-migration-check` · 검증 실패 기록 · 401/404 라우트 판별 · 설정 거부(env 없음, UPLOAD_DIR, 시드 반쪽 설정) · golden gate 3경로 · 번들 dry-run/체크섬 변조 거부/`--no-build` 배포/API 베이스 불일치/재실행/비번들 거부 · 절대 경로 env 파일 전달 |
| `rollback-self-hosted.test.mjs` | 10 | 안전/additive 허용, destructive·breaking·unknown **거부(exit 3)**, 기록 없음 거부, `--allow-irreversible`, `--to`, 롤백 후 이력, 이미지 누락 중단, 확인 입력 |
| `backup-restore.test.mjs` | 15 | 평문 백업 불변, `--dry-run`, 암호화(`Salted__`, 올바른/틀린 키), 키 파일 거부, **회전(대상·보존 규칙)**, 실패 마커·잔여 디렉터리 제거, Qdrant on/auto/실패, 복원 `--dry-run`·키 없음/틀린 키/변조 거부, 레거시 백업, 드릴 dry-run/즉시 실패/`--latest` |
| `qdrant-snapshot.test.mjs` | 7 | **가짜 Qdrant HTTP 서버**: 컬렉션별 스냅샷·서버측 삭제·요약 출력, stdin 파이프 실행, api-key, 실패·`QDRANT_URL` 없음, 빈 Qdrant, 복원 `priority=snapshot` |
| `release-bundle.test.mjs` | 5 | `--dry-run` 전체 계획·docker 호출 0, 입력 검증, 옵션 전달, **가짜 docker 빌드가 만든 번들**(구조·SHA256SUMS·manifest.json JSON·migrations.tsv=release-order), 번들을 `deploy --bundle --dry-run`이 수락 |
| `compose-and-images.test.mjs` | 16 | `npm ci`·`FROM` 전부 ARG 핀(digest 금지)·Dockerfile↔compose 핀 일치, 빌드 스텝 배선, Amoeba 호스트/메일박스 기본값 0, env 템플릿·프로필, `rewrite-manual-host.sh`·`render-frame-ancestors.sh`(악성 값 거부), compose 렌더 3종 + `SHARPTALK_ENV_FILE`, systemd/cron 정합, `bash -n` |

## 3. 실제 MySQL / 컨테이너로 확인한 것 (일회용 `mysql:8.0` = 8.0.44, 알파인 스탠드인 API)

| ID | 시나리오 | 결과 |
|---|---|---|
| E-1 | **수정 전** `01-schema.sql`(HEAD)을 빈 DB에 로드 → `check-migrations.sh` | 적용 93 · **미적용 6**(정확히 `260920-sessions-access-stats`, `260924-fulfillments-tracking-url`, `260924-order-items-product-url`, `261007-ai-engine-health`, `261007-answer-footer`, `261008-golden-graded`) → FAIL |
| E-2 | **수정 후** 파일 로드 → 같은 검사 | 오류 없이 93 테이블, **적용 99 · OK** |
| E-3 | 암호화 백업(`BACKUP_ENCRYPT_KEY_FILE`, 회전 14일) | `db.sql.gz.enc`·`uploads.tar.gz.enc`·manifest(행 수 포함)·SHA256SUMS·`LAST_SUCCESS` |
| E-4 | 복원 드릴(`--latest`) | **DRILL PASSED** — 93 테이블, 행 수 일치, 첨부 2/2, 마이그레이션 미적용 0; 컨테이너 자동 제거, `DRILL_LOG` 기록 (약 75초) |
| E-5 | 드릴 음성 | 틀린 키 · 키 없음 · 변조한 암호문 → 컨테이너 시작 전에 실패 |
| E-6 | 재난 시뮬레이션(테넌트·첨부 행 삭제, uploads 비움) 후 `restore-self-hosted.sh --yes` | DB·파일 복구, 첨부 행 2 · 파일 없는 행 0, 테이블 카운트 일치, API 컨테이너 정지→기동 |
| E-7 | 시드 CLI를 일회용 DB(`scratch_s5c`)에서 실행 | custom identity(`go2joy`, `app.go2joy.vn`, 지정 이메일): 테넌트 1행·`ivyusa`/`amoeba` 행 0·KB/고객/주문 0·**일회용 비밀번호 계정별 1회 출력**; 재실행 시 계정 해시 불변("already exist"); 기본(무설정) 실행은 `ivyusa`·`admin@/dev@amoeba.group`·데모 데이터 그대로 |
| E-8 | `npm ci --dry-run --offline`을 Docker 빌드 컨텍스트와 같은 5개 워크스페이스 매니페스트 사본에서 | lock만으로 1098 패키지 해석 성공(실제 이미지 내 `npm ci`는 미실행) |

모든 일회용 컨테이너·볼륨·DB(`s5c_scratch_mysql`, `s5c_scratch_api`, `s5c_uploads`, `scratch_s5c`, `scratch_s5c2`)는 삭제했다. `sharptalk_*` 개발 컨테이너는 건드리지 않았다(스크래치 DB만 사용).

## 4. 수정 전 코드에서 실패함을 확인한 것 (회귀 증명)

| 버그 | 수정 전 동작 (HEAD 스크립트를 샌드박스에서 실행) |
|---|---|
| 첫 설치에서 마이그레이션 검사 생략 | init-sql이 뒤처진 상태로 `exit 0`, **앱 기동됨, 게이트 실행 안 됨** |
| CRLF 매니페스트 | 컬럼이 있는데도 전부 미적용으로 보고(`exit 1`) |
| 백업 실패 | 반쯤 쓰인 디렉터리가 남고 실패 마커 없음 |
| init-sql 드리프트 | 가드가 19개 artefact(6개 파일)를 정확히 지목하고 `exit 1` |
| 빈 `ALERT_EMAIL_FROM` | `'' ?? user` → 발신자 `''` (`alert-address.util.spec`의 빈 문자열 케이스가 고정) |

## 5. 실행하지 않은 것 (NOT VERIFIED)

- 실제 `docker build`·`docker save`·번들 생성, 이미지 내부 `npm ci`, `docker load`/`up` 기반 번들 배포, Linux 호스트 설치 — 금지 사항 + 시간. 번들 스크립트는 가짜 docker와 `--dry-run`으로만 검증.
- 기반 이미지 태그 `node:20.19.0-alpine3.21`·`nginx:1.27.5-alpine`의 **존재**(로컬에 없고 다운로드 금지). `build-release-bundle.sh`가 빌드 전에 `docker manifest inspect`로 확인하고, 틀리면 빌드 전에 실패한다. 나머지 핀(mysql 8.0.44, redis 7.4.9, rabbitmq 3.13.7)은 로컬 이미지의 버전에서 가져옴.
- 실제 Qdrant의 스냅샷/업로드 API(가짜 서버로 문서화된 엔드포인트만 시험), `nginx -t`(nginx 이미지 없음 — `nginx.web.conf` 변경은 CSP 헤더의 자리표시자 1줄), 콘솔을 `VITE_API_BASE_URL=/api/v1`로 빌드했을 때의 **UI 동작**(브라우저 미사용), `kb-reindex.js`를 컨테이너에서 실행하는 런북 명령, shellcheck, 실제 systemd/cron 등록.
- `scripts:test` 전체는 Windows에서 약 2분 20초(137.8초, 파일 병렬 실행; 파일 하나씩은 1~3분 — 프로세스 생성 비용). Linux CI 소요는 측정하지 않았다. Node 20(CI)에서는 `.ts`를 직접 import하는 `widget-url-resolve.test.mjs`가 자동 skip된다.
