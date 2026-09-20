# RPT-260920 — 콘솔 PII 마스킹·열람 통제 실행 보고

- 요구사항: REQ-260920 · 계획: PLN-260920 · 테스트: TCR-260920
- 승인 결정(2026-09-20): 열람 권한 **마스터·디렉터**, **전 테넌트 일괄 적용**, **보존 확장 포함**
- PR: **#545**(구현) · **#548**(nginx 로거 수정) — 스키마 변경 없음, 마이그레이션 없음

## 1. 무엇을 바꿨나

원칙: **서버가 마스킹한다.** 평문은 별도의 열람 요청으로만 나가고, 그 요청은 감사에 남는다.

| 단계 | 내용 |
|---|---|
| P1 기본 마스킹 | `pii-display.util`(`maskName`·`maskEmail`·`maskPhone`) 신설. 고객 목록·상세, 라이브챗 대기열·고객 패널·검색, 히스토리 고객명, 만족도 응답자명에 적용. 목록에서 `phone` 제거, 수정 응답은 `{id,name,tier}`로 축소 |
| P2 열람·감사 | `CAPABILITY.CUSTOMER_PII_REVEAL`(마스터·디렉터) 신설. `GET /customers/:id/reveal`, `GET /agent/customers/:id/reveal` — 분당 30회, `customer.pii_revealed` 감사. 콘솔은 눈 아이콘으로 행 단위 5분 열람, 6언어 안내 |
| P3 로그 위생 | 고객 검색을 POST 본문으로 이동. nginx 접근 로그에서 쿼리스트링 제거(컨테이너 3개 스택 + 호스트 vhost 2개). gdrive 자격증명 감사 메타데이터 마스킹 |
| P4 AI·보존 최소화 | 여정 리포트 샘플에 `scrubPii` 적용. `moderation_logs.excerpt` 저장본 스크러빙. `moderation_logs`·`agent_alerts`를 보존 파기 대상에 추가. 지식 캡처 모달에 연락처 감지 경고 |

세 가지 마스킹 통제를 **분리 유지**했다. 로그용 `maskPii`, AI 전송용 `scrubPii`, 화면용
`pii-display.util`. 합치면 로그 포맷을 바꾸는 일이 화면 표기를 바꾸게 된다.

## 2. 파일

| 파일 | 변경 |
|---|---|
| `packages/types/src/domain/rbac.types.ts` | `CUSTOMER_PII_REVEAL` |
| `packages/common/src/rbac/permission-matrix.ts` | 마스터·디렉터에 부여 |
| `apps/api/src/global/util/pii-display.util.ts` (+spec) | 화면용 마스킹 3종 |
| `apps/api/src/domain/customer/{mapper,controller,service,module}.ts`, `dto/*` | 기본 마스킹·열람 라우트·POST 검색·감사 |
| `apps/api/src/domain/agent/{agent.service,agent.mapper,agent-console.controller}.ts` | 패널·대기열·검색 마스킹, 열람 라우트 |
| `apps/api/src/domain/analytics/analytics.service.ts` | 히스토리 고객명 표기 통일 |
| `apps/api/src/domain/journey/journey-report.service.ts` | AI 전송 샘플 스크러빙 |
| `apps/api/src/domain/moderation/moderation.service.ts` | 저장 발췌 스크러빙 |
| `apps/api/src/domain/privacy/{retention.service,privacy.module}.ts` (+spec) | 모더레이션·알림 파기 |
| `apps/api/src/domain/knowledge/gdrive-credential.service.ts` | 감사 메타데이터 마스킹 |
| `apps/web/src/lib/{rbac,api-client,pii-hint}.ts` | 권한·POST 목록·연락처 감지 |
| `apps/web/src/domain/customers/*`, `live-chat/{LiveChatPage,live-chat.service,KnowledgeCaptureModal}.tsx` | 열람 UI·POST 검색·경고 |
| `apps/web/src/i18n/locales/*/{customers,livechat}.json` | 6언어 문구 |
| `docker/{staging,production,self-hosted}/nginx.conf` | 쿼리스트링 없는 접근 로그 |

## 3. 배포 상태

| 환경 | 상태 |
|---|---|
| 스테이징 `shoptalk.amoeba.site` | **배포 완료**(2026-09-20 02:3x UTC) — main `573471e` → 실측 검증 완료(TCR §2) |
| 프로덕션 `sharptalk.amoeba.site` | **배포 완료**(2026-09-20 02:55 UTC) — `production` 브랜치를 main `041ac8b`로 승격, `deploy-self-hosted.sh` |
| 호스트 nginx(공용 TLS 종단) | shoptalk·sharptalk vhost 모두 쿼리 없는 로그 포맷, 백업 `/root/nginx-bak-*.20260920-114517`, 다른 사이트 영향 없음 |

### 프로덕션 배포 절차·검증
```
백업      scripts/backup-self-hosted.sh ~/backups/sharptalk-production/20260920-0253  (db 610KB)
승격      git push origin main:production   (fast-forward, 4 커밋)
마이그레이션 MYSQL_CONTAINER=sharptalk_mysql check-migrations.sh → OK(80건 적용, 추가분 없음)
배포      scripts/deploy-self-hosted.sh → api/web/widget 재생성, api healthy
nginx     바인드 마운트 반영 위해 컨테이너 강제 재생성
```

| 검증 | 결과 |
|---|---|
| `/api/v1/health`, 콘솔, 위젯 | 200 / 200 / 200 |
| `GET /customers/:id/reveal`(무인증) | **401** — 배포됨(404였다면 미배포) |
| `POST /customers/search`(무인증) | **401** — 배포됨 |
| 컨테이너 이미지 | `apps/api/dist`에 `customer.pii_revealed`·`pii-display.util.js` 포함, 웹 번들에 열람 문구 포함 |
| 접근 로그(컨테이너·호스트) | 쿼리스트링 0건 |
| 위젯 `session/ensure`(ivyusa.myshopify.com) | ok, 탭 구성 정상 |
| API 오류 로그 | 없음 |

이번 승격에는 다른 세션의 통계 작업(#546 어드민 테넌트별 통계·7단 여정)도 함께 실렸다.
스키마 변경이 없어 추가 SQL은 필요하지 않았다.

**프로덕션 데이터 레벨 확인은 보류.** `dev@amoeba.group` 계정이 아직 최초 로그인
비밀번호 변경 상태(E1005)라 인증이 필요한 응답을 확인하지 못했다. 비밀번호 변경은
사용자가 직접 해야 하는 일이므로, 변경 후 콘솔 `/customers`에서 마스킹과 눈 아이콘을
확인하면 된다. 코드·라우트·로그 레벨 검증은 위 표대로 끝났다.

## 4. 배포 중 발견하고 고친 것

**nginx 로그가 두 줄 남았다.** http 레벨 `access_log`는 `nginx.conf`의 기본 `main` 로거를
대체하지 않고 더하기만 한다. 새 포맷 한 줄과 쿼리스트링이 담긴 기존 한 줄이 같이 기록됐다.
`server` 블록으로 옮겨 상속을 대체하게 했다(PR #548).

**바인드 마운트 inode가 낡았다.** `git pull`이 파일을 새 inode로 바꿔도 실행 중인 컨테이너는
옛 파일을 계속 본다. `nginx -s reload`로는 반영되지 않아 컨테이너를 재생성해야 했다.
이 저장소에서 반복되는 함정이다.

## 5. 남은 항목

| 항목 | 성격 |
|---|---|
| 프로덕션 콘솔 최초 로그인 비밀번호 변경 | 사용자 — 변경해야 데이터 레벨 확인 가능 |
| 콘솔 화면 육안 확인(눈 아이콘·토스트) | 콘솔 로그인이 비밀번호 입력을 요구해 자동 확인 불가 — 사용자 확인 필요 |
| 수탁사 DPA·SCC 확인(PCB-01) | 계약·법무 |
| 프로덕션 `MFA_ENFORCE_FROM` 설정(PCB-04) | 운영 결정 — 현재 비어 있음 |
| 역할별 PII 접근 매트릭스 문서화·분기 재인증(PCB-08) | 문서·운영 |
| 대화 본문 평문 보존 | 기존 결정 유지(암호화하면 검색·모더레이션·파기·가독성이 깨짐) |

## 6. 준수 현황 변화

| 기준 | 이전 | 이후 |
|---|---|---|
| PRV-002 최소수집 | 미충족(응답 과다) | 충족(마스킹·phone 제거·AI 경로 일원화) |
| PRV-005 관리 화면 마스킹 | 미충족 | 충족 |
| PRV-040 PII 접근 감사 | 미충족(고객 조회 무기록) | 충족(열람 1건당 1행) |
| PRV-004 보존 제한 | 부분(모더레이션·알림 미연결) | 충족 |
| PRV-030/031 수탁사·국외이전 | 미충족 | 변화 없음(법무 대기) |
