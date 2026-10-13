# SharpTalk 자체 호스팅 설치 가이드

고객사 클라우드에 SharpTalk를 설치·운영하는 절차. (PLN-260820 기준)

대상: 고객사 인프라 담당자. 필요한 것은 **Docker와 Docker Compose가 있는 리눅스 호스트 한 대**뿐이며,
Node.js는 필요하지 않습니다.

## 0. 이 스택이 담는 것

```
  (고객사 TLS 종단: ALB / nginx / Caddy)
              │
         nginx :8080
        ├─ /api/     → api        (NestJS)
        ├─ /widget/  → widget     (스토어에 심는 위젯)
        └─ /         → web        (상담 콘솔)
  api ─ mysql · redis · rabbitmq · qdrant
  볼륨: uploads(첨부·로고) · mysql · redis · rabbitmq · qdrant
```

대화·고객정보·첨부파일은 **전부 이 호스트의 볼륨 안**에 있습니다. 외부로 나가는 것은 AI 응답
생성을 위한 모델 호출(Anthropic 등)과, 연동을 켠 경우의 커머스/메신저 API뿐입니다.

## 1. 준비

| 항목 | 권장 |
|---|---|
| CPU / RAM | 4 vCPU / 8GB 이상 (MySQL·Qdrant·RabbitMQ가 함께 뜹니다) |
| 디스크 | 50GB 이상 — 첨부파일이 여기 쌓입니다 |
| 포트 | 내부 8080(기본). 인터넷 노출은 TLS 종단이 담당 |
| 도메인 | 콘솔·위젯을 서비스할 도메인 (예: `talk.example.com`) |

## 2. 설치

```bash
git clone <repo> btbz-sharptalk && cd btbz-sharptalk

# 2-1. 설정 파일
cp docker/self-hosted/.env.self-hosted.example docker/self-hosted/.env.self-hosted

# 2-2. 시크릿 생성 → 위 파일에 붙여넣기
bash scripts/gen-secrets.sh
```

`.env.self-hosted`에서 **최소한 이것들**을 채웁니다:

| 키 | 값 |
|---|---|
| `APP_PUBLIC_URL` · `PUBLIC_BASE_URL` | `https://talk.example.com` |
| `VITE_API_BASE_URL` | `https://talk.example.com/api/v1` |
| `UPLOAD_DIR` | `/data/uploads` **(바꾸지 마세요 — §6 참고)** |
| `DB_PASSWORD` 등 시크릿 | 2-2에서 생성한 값 |
| `SEED_ON_BOOT` | 최초 1회만 `true`, 이후 `false` |

```bash
# 2-3. 설치 전 점검 (아무것도 바꾸지 않습니다)
bash scripts/deploy-self-hosted.sh --check

# 2-4. 설치
bash scripts/deploy-self-hosted.sh
```

마지막에 아래가 모두 나와야 정상입니다:

```
    health   : {"success":true,"data":{"status":"ok"} …
    widget   : 200
    console  : 200
    boot log : 1 x 'successfully started'
```

### 2-5. 번들로 설치 (인터넷·레지스트리 없는 서버)

서버에서 빌드하지 않고 Amoeba가 만든 **릴리스 번들**(이미지 tar + `SHA256SUMS` + `manifest.json` + 스크립트)을 복사해 설치할 수 있습니다. 이미지는 버전 태그가 붙고(`sharptalk/{api,web,widget}:<version>`) 기반 이미지는 버전이 고정되며, MySQL·Redis·RabbitMQ·Qdrant·nginx도 번들에 들어 있어 서버가 Docker Hub·npm·GitHub에 나갈 필요가 없습니다.

```bash
cd sharptalk-<version> && sha256sum -c SHA256SUMS
bash scripts/deploy-self-hosted.sh --bundle . --dry-run   # 모든 동작 출력, 실행 없음
bash scripts/deploy-self-hosted.sh --bundle .
```

**첫 설치에서도 마이그레이션 검사를 합니다**: DB 컨테이너만 먼저 띄워 init-sql이 만든 스키마를 `sql/artefacts.tsv`와 대조하고, 어긋나면 앱 컨테이너를 띄우지 않고 멈춥니다. 설정 파일은 번들 밖(`SHARPTALK_ENV_FILE`)에 두고 릴리스 기록(`SHARPTALK_STATE_DIR`)도 번들 밖에 두어야 롤백이 가능합니다. 전체 절차: [RUNBOOK-261013-Go2Joy-SelfHosted.md](RUNBOOK-261013-Go2Joy-SelfHosted.md).

## 3. TLS 연결

이 스택은 TLS를 끝내지 않습니다. 고객사의 로드밸런서나 nginx가 `https://talk.example.com` →
`http://<host>:8080`으로 넘겨주면 됩니다. 인증서는 고객사의 다른 인증서와 같은 곳에서 관리하는
편이 낫다는 판단입니다.

## 4. 첫 로그인

`https://talk.example.com/` 에서 시드 계정으로 로그인하고 **즉시 비밀번호를 바꾸세요.**
그 다음 `.env.self-hosted`의 `SEED_ON_BOOT`를 `false`로 바꾸고 재배포합니다 — 그대로 두면
재시작 때 시드 계정이 되살아납니다.

## 5. 업그레이드

```bash
git pull
bash scripts/deploy-self-hosted.sh
```

스크립트가 **먼저 미적용 스키마 변경을 확인하고 멈춥니다.** 나오는 목록을 안내대로 적용한 뒤
다시 실행하세요. 순서가 중요합니다 — 옛 코드 + 새 컬럼은 안전하지만, **새 코드 + 옛 스키마는
500**입니다.

```bash
# 미적용 목록만 보고 싶을 때
bash scripts/check-migrations.sh
```

> ⚠️ 파일명 알파벳 순서는 의존성 순서가 아닙니다. 일부 파일이 `AFTER <컬럼>`으로 나중 이름의
> 파일이 만드는 컬럼을 참조합니다. **릴리스된 순서(오래된 것부터)** 로 적용하고, `Unknown column`
> 오류가 나면 그 컬럼을 만드는 파일을 먼저 적용한 뒤 다시 실행하세요.

**롤백**: `bash scripts/rollback-self-hosted.sh --dry-run`(먼저) → 실행. 이전 이미지 태그로 재기동하며, 두 릴리스 사이에 `breaking`/`destructive`/`unknown` 마이그레이션이 있으면 **거부**합니다(그땐 배포 전 백업 복원 또는 전진 수정). 이전 이미지를 지우는 `docker image prune -a`는 금지.

## 6. 백업 — 반드시 두 개

```bash
bash scripts/backup-self-hosted.sh /backup/shoptalk/$(date -u +%Y%m%d)
```

`db.sql.gz`(대화·고객·설정)와 `uploads.tar.gz`(첨부·로고) **두 개가 함께** 있어야 합니다.
DB만 백업하면 복원 후 "대화는 있는데 사진이 없는" 시스템이 됩니다. 스크립트는 둘 중 하나라도
비면 실패로 끝냅니다.

복원:

```bash
bash scripts/restore-self-hosted.sh /backup/shoptalk/20260820
```

복원 후 **첨부 행과 실제 파일이 일치하는지 자동으로 확인**하고, 어긋나면 실패로 알립니다
(백업 두 개를 서로 다른 시점에 뜬 경우가 여기서 걸립니다).

**추가 기능(모두 기본 꺼짐)**: `BACKUP_ENCRYPT_KEY_FILE`(openssl AES-256-CBC, `*.enc`; 키는 백업과 **다른 곳**에 보관), `BACKUP_KEEP_DAYS`(성공 후 오래된 백업 삭제), Qdrant 스냅샷 자동 포함(`BACKUP_QDRANT=auto`), 모든 아카이브 읽기 검증, `SHA256SUMS`, 성공/실패 마커 `LAST_SUCCESS`/`LAST_FAILURE`. 복원 리허설은 **운영 스택을 건드리지 않고** 임시 MySQL 컨테이너에서 수행합니다: `bash scripts/restore-drill-self-hosted.sh --latest <백업루트>`(분기 1회; 결과는 `DRILL_LOG`).

정기 실행 예시는 `docker/self-hosted/ops/`(systemd timer·cron·`backup.env.example`)에 있습니다. 상세: [RUNBOOK-261013-Go2Joy-SelfHosted.md](RUNBOOK-261013-Go2Joy-SelfHosted.md) §8.

## 7. 바꾸면 안 되는 것

| 값 | 이유 |
|---|---|
| `CRED_ENC_KEY` | 바꾸면 저장된 연동 자격증명과 암호화된 개인정보를 **복호화할 수 없습니다.** 옛 키 없이는 복구 불가 |
| `FILE_URL_SECRET` | 바꾸면 이미 고객에게 나간 **첨부 링크가 전부 무효**가 됩니다 |
| `UPLOAD_DIR` | 볼륨 마운트 경로(`/data/uploads`)와 달라지면 첨부가 컨테이너 안에 쓰이고 **다음 배포에서 사라집니다.** 배포 스크립트가 이 값을 검사합니다 |
| `DB_SYNCHRONIZE` | `true`로 두면 코드가 스키마를 임의로 바꿉니다. 운영에서는 항상 `false` |

## 8. 문제가 생겼을 때

| 증상 | 확인 |
|---|---|
| 배포 후 500이 쏟아진다 | `bash scripts/check-migrations.sh` — 미적용 스키마 변경 |
| 컨테이너가 계속 재시작한다 | `docker logs sharptalk_api` — 시크릿이 짧거나 placeholder면 **의도적으로 부팅을 거부**합니다 |
| 첨부가 재배포 후 사라졌다 | `UPLOAD_DIR`이 `/data/uploads`인지, compose 볼륨이 붙어 있는지 |
| 위젯이 뜨지 않는다 | 콘솔 → 설정 → 임베드에서 **허용 도메인** 확인 |
| 위젯이 엉뚱한 API를 부른다 | `docker/self-hosted/widget-config.js` — 배포 스크립트가 `VITE_API_BASE_URL`로 생성합니다 |

## 9. 데이터가 어디에 있는가 (감사용)

| 데이터 | 위치 |
|---|---|
| 대화·고객·설정 | `sharptalk_mysql_data` 볼륨 |
| 첨부파일·위젯 로고 | `sharptalk_uploads` 볼륨 |
| 검색 인덱스(임베딩) | `sharptalk_qdrant_data` 볼륨 |
| 세션 캐시 | `sharptalk_redis_data` 볼륨 |
| **외부로 나가는 것** | AI 모델 호출(대화 본문 포함), 켜둔 연동의 커머스/메신저 API |

마지막 줄은 계약서에 그대로 반영되어야 합니다: **저장은 고객사, 처리(AI)는 외부 모델**입니다.
