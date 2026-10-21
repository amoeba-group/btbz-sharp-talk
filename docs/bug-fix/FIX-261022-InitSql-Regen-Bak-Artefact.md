# FIX-261022 — init-sql 재생성 + 백업 테이블을 마이그레이션 산출물로 세던 결함

## 증상
- `docker/init-sql/01-schema.sql`이 10/15 재생성 이후 5건(261019 3건, 261022 2건) 뒤처져 있었다. 이 파일로 새로 설치하면 팀(units), 만족도 설문 모드, 위젯 언어, 지역 범위, 기업고객·대화 연속성 컬럼이 없어 해당 기능이 500을 낸다.
- 재생성한 init-sql로 띄운 빈 MySQL에 `check-migrations.sh`를 돌리자 `261019-units.sql`이 **PARTIALLY applied**로 실패했다(`missing: table:job_labels_bak_261019`).

## 원인
- `261019-units.sql`은 라벨 이름을 영어로 바꾸기 전에 `CREATE TABLE IF NOT EXISTS job_labels_bak_261019 AS SELECT * FROM job_labels`로 롤백용 스냅샷을 만든다.
- `scripts/check-migrations.mjs`는 모든 `CREATE TABLE`을 산출물로 기록하므로, 이 백업 테이블도 `sql/artefacts.tsv`에 스키마로 올라갔다.
- init-sql은 `*_bak_*` 테이블을 의도적으로 뺀다. 그래서 새 설치는 이 "산출물"을 영원히 갖지 못하고, 배포 스크립트의 마이그레이션 점검이 매번 실패한다. 스테이징·프로덕션은 SQL을 실제로 실행해 백업 테이블이 생겼기 때문에 드러나지 않았다.

## 수정
- `check-migrations.mjs`: 이름에 `_bak_`가 들어간 `CREATE TABLE`은 산출물에서 제외하고, `sql/artefacts.tsv`를 재생성했다(1행 제거).
- `01-schema.sql`: 스테이징 실 DB에서 재생성했다(97 테이블, `*_bak_*` 제외). 10/22 배포 직후의 프로덕션 스키마와 문자셋 표기만 빼고 동일함을 테이블 단위로 대조했다.

## 검증
- init-sql만으로 띄운 임시 MySQL 8.0에서 97 테이블 생성, `check-migrations.sh` → `OK — every schema migration is present.`
- `node scripts/check-migrations.mjs --check` → up to date

## 예방
- 롤백용 스냅샷 테이블은 반드시 `*_bak_*` 이름을 쓴다. 산출물 집계와 init-sql이 모두 이 규칙으로 제외한다.
- init-sql 재생성 게이트는 "init-sql만으로 띄운 DB에서 check-migrations OK"다. 재생성 후 생략하지 않는다.
