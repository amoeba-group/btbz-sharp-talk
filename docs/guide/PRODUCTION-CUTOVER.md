# 프로덕션 컷오버 런북 (Production Cutover)

| | |
|---|---|
| Doc ID | CHATWIDGET-GUIDE-PRODCUT-1.0.0 |
| 작성일 | 2026-08-13 |
| 상태 | **B1 해소 완료 · B2(인프라) 대기** |
| 대상 | 스테이징에서 검증된 `main`을 프로덕션으로 처음 올리는 작업 |
| 선행 | `docs/guide/DEPLOYMENT-STRATEGY.md` (승격 흐름·환경 정책) |

---

## 0. 현재 상태

프로덕션은 **2026-09-14 가동**(`https://sharptalk.amoeba.site`, 스테이징 호스트의 두 번째 스택 — self-hosted 스택 :8081, `~/sharptalk-production`, 브랜치 `production`). 아래 표는 착수 전 상태 기록이며, 남은 컷오버 항목은 §3(코드로 오지 않는 것)·`deploy/profiles/SharpTalk-KR-Production/CHECKLIST.md` P3.

| 항목 | 상태 |
|---|---|
| 호스트 | 미프로비저닝 — **2026-09-13 결정(PLN-260913-Production-Provisioning-Deploy)**: 신규 호스트(8vCPU/16GB/200GB, Ubuntu 24.04), 도메인 `sharptalk.amoeba.site`, **self-hosted 스택**(`docker/self-hosted`, 검사·백업 도구 완비)으로 배포. 호스트 준비는 `sudo bash scripts/provision-host.sh --domain … --email …`, 프로필은 `deploy/profiles/SharpTalk-KR-Production/` |
| `docker/production/.env.production` | **없음** — self-hosted 스택을 쓰므로 실제 env는 서버의 `docker/self-hosted/.env.self-hosted`(프로필 example에서 복사) |
| `production` 브랜치 | **없음** |
| 배포 스크립트·compose·nginx | ✅ 준비됨 (`docker/production`은 템플릿으로 유지; 실배포는 self-hosted) |
| 스테이징 | ✅ 가동 중, 최신 `main` 검증 완료 |

---

## 1. 착수 전 차단 요인 (반드시 먼저 해소)

### B1 — 첫 부팅 스키마 ✅ **해소 완료 (2026-08-13)**

프로덕션 MySQL은 첫 부팅에 `docker/init-sql/01-schema.sql`을 실행합니다. 이 파일이 **41개 테이블로 28개 뒤처져** 있었고(스테이징 실제 68개), `DB_SYNCHRONIZE=false`라 런타임 생성도 되지 않아 **API는 뜨고 기능은 500으로 죽는** 상태였습니다.

스테이징 실 스키마에서 재생성해 해소했습니다.

| 검증 | 결과 |
|---|---|
| 빈 DB에 적용 | 오류 없이 완료 |
| 테이블 | **68 / 68** |
| 컬럼 | **669 / 669** — 차이 0 |
| 인덱스·유니크 | **297 / 297** — 차이 0 |

**스키마 파일도 하나로 합쳤습니다.** `sql/01-schema.sql`(48개)과 `docker/init-sql/01-schema.sql`(41개)이 서로 다른 채 공존한 것이 격차가 묻힌 원인이었습니다. 프로덕션 compose가 디렉터리째 마운트하므로 실제 파일은 `docker/init-sql/`에 있어야 하고, 중복본은 삭제한 뒤 README·SPEC·CONFIG·compose 주석의 참조를 모두 그쪽으로 돌렸습니다.

재생성 명령은 파일 헤더에 적어 두었습니다 — **엔티티가 아니라 실제 가동 중인 DB에서** 떠야 합니다.

### B2 — 인프라·자격증명 (사용자 결정 필요) 🟡

| 항목 | 필요한 것 |
|---|---|
| 호스트 | 서버 + Docker + compose |
| DNS·TLS | 도메인 → 호스트, TLS 종단(호스트 nginx 또는 LB) |
| `.env.production` | `DB_*`·`RABBITMQ_*`·`JWT_*`·`CRED_ENC_KEY`(신규 32B)·`ANTHROPIC_API_KEY`·`VOYAGE_API_KEY`·`VITE_API_BASE_URL` |
| Shopify | 프로덕션 앱 등록 또는 기존 앱의 콜백 URL 추가 |
| SMTP | 오프아워 회신 발신 계정 |

> `VITE_API_BASE_URL`은 **빌드 시점에 번들에 박힙니다.** 도메인이 정해지기 전에는 web/widget을 빌드해도 소용없습니다.

---

## 2. 컷오버 순서

```
① 스키마 재생성(B1)         → 커밋 (2026-09-13 재검증: FIX-260913, init-sql만으로 check-migrations OK)
② 호스트·DNS·TLS 준비(B2)   → scripts/provision-host.sh (Docker·UFW·UTC·호스트 nginx·certbot)
③ .env.production 작성       → 서버에만 보관(절대 커밋 금지)
④ production 브랜치 생성      → 검증된 main 커밋을 승격
⑤ 첫 배포 + 첫 부팅 시드
⑥ 테넌트 데이터 이관(§3)     ← 코드로 오지 않는 것들
⑦ 스모크 테스트(§4)
⑧ SEED_ON_BOOT=false 로 전환 후 재배포
```

---

## 3. 코드로 오지 않는 것들 (놓치기 쉬움)

배포만으로는 동작하지 않고, **사람이 넣어야** 하는 데이터입니다.

| # | 항목 | 근거 |
|---|---|---|
| 1 | **AI 엔진 등록 + API 키** | 시드는 stub 엔진만 만듭니다. Anthropic 엔진을 콘솔에 등록하고 키를 넣지 않으면 **조용히 stub 응답**이 나갑니다 (PR #102에서 겪은 실패) |
| 2 | **응답 규칙 5번** | `DEFAULT_RULES` 변경은 **신규 테넌트에만** 적용됩니다. 기존 테넌트를 이관하는 경우 "연결을 약속하지 말 것"을 콘솔에서 직접 반영해야 합니다 (RPT-260813) |
| 3 | **핸드오프 설정** | 업무시간·타임존·오프아워 메일함·담당자. 비어 있으면 24시간 상담원 호출로 동작합니다 |
| 4 | **지식 문서** | 정책 224건 + 상품지식. CSV 임포트 / 카탈로그 동기화 / 사용법 가이드 10~12건은 **각각 실행**해야 합니다 |
| 5 | **재위임 안내 문구** | 기본 문구로 동작하나 IVY 확정본이 있으면 반영 |
| 6 | **모더레이션 규칙** | 시드가 기본 2건을 넣지만 운영 규칙은 별도 |
| 7 | **상담원 계정** | 초대 → 임시 비밀번호 전달 → 첫 로그인 시 변경. MFA는 아래 §3-1 참조 |

### 3-1. MFA 강제 — **프로덕션 전용** (결정 2026-08-13)

`MFA_ENFORCE_FROM`은 **`.env.production`에만 설정한다. 스테이징에는 두지 않는다.**
스테이징에서는 2026-08-13에 이 값을 주석 처리했다(`docker/staging/.env.staging`, 백업
`.env.staging.bak-mfa-*`). 이유: 스테이징의 master 랭크 16개 계정은 전부 테스트 로그인이고,
강제가 켜지면 이들이 등록 화면에 묶여(`mfaPending` → E1010) **미실시 수동 스모크 백로그가 통째로
막힌다.** 스테이징은 인증 흐름 검증용이지 자격증명 운영 환경이 아니다.

동작(코드 기준, `auth.service.ts:542-558` + `jwt-auth.guard.ts:73-76`):

| `MFA_ENFORCE_FROM` | 대상 랭크(`master`/`director`, 시스템 admin 전원) |
|---|---|
| 미설정 | 강제 없음. MFA는 자발적 등록만 가능(기능 자체는 동작) |
| 설정, 날짜 이전 | 로그인 응답에 안내 플래그(유예 배너). 차단 없음 |
| 설정, 날짜 경과 | 미등록 계정의 토큰에 `mfaPending` → **등록 라우트 외 전면 차단(E1010)** |

컷오버 시 할 일:
1. `.env.production`에 `MFA_ENFORCE_FROM=<날짜>`를 설정한다. **날짜는 계정 발급 이후로 잡는다** —
   계정을 만들기도 전에 지난 날짜를 넣으면 첫 로그인부터 등록 화면에 묶인다.
2. 유예 기간을 실제로 쓰려면 **먼저 미설정으로 배포 → 계정 발급·안내 → 날짜 설정 후 재배포** 순서로 간다.
   (값은 부팅 시 읽히므로 변경에는 API 컨테이너 재생성이 필요하다)
3. 강제일 전에 대상자 등록률을 확인한다 —
   `SELECT u.id, u.email FROM users u LEFT JOIN mfa_credentials m ON m.actor_type='user' AND m.actor_id=u.id AND m.enabled_at IS NOT NULL WHERE u.\`rank\` IN ('master','director') AND m.id IS NULL;`
   (프라이버시 백로그 **PCB-04**가 요구하는 확인 항목)
4. 강제 후 E1010 잠금과 등록 화면 동작을 실제 브라우저로 1회 확인한다(현재까지 API 사이클만 검증됨).

---

## 4. 스모크 테스트 (배포 직후)

| # | 확인 | 기준 |
|---|---|---|
| 1 | 부팅 | 로그에 `Nest application successfully started` + `Qdrant connected` |
| 2 | 헬스 | `/api/v1/health` → `{"status":"ok","db":"up"}` |
| 3 | 라우트 | 보호 라우트가 **401**(404면 미배포, 502면 API 다운) |
| 4 | 위젯 | 세션 생성 → 동의 → 질문 → **실제 LLM 응답 + 근거 인용**(stub 문구가 아닌지 확인) |
| 5 | 이관 | "상담원 연결해 주세요" → `escalate=true`, 상담원 알림 |
| 6 | 잡담 | "안녕하세요" → **이관 없이** 응답 |
| 7 | 방치 순회 | 부팅 로그에 `Idle sweep every 30s …` |
| 8 | 주문 | Shopify 동기화 1회 + 위젯 주문 조회 |
| 9 | 모더레이션 | 차단 규칙이 실제로 차단하는지 |
| 10 | 시드 | 확인 후 **`SEED_ON_BOOT=false`** 로 전환 |

---

## 5. 롤백

| 상황 | 조치 |
|---|---|
| 배포 실패 | 고객사 자체 호스팅 스택: `scripts/rollback-self-hosted.sh`(이전 이미지 태그로 재기동, 두 릴리스 사이 마이그레이션 안전성 검사 — 안전하지 않으면 거부). 서버 빌드 스택: 이전 커밋으로 재기동(`docker compose up -d`) |
| 스키마 문제 | 첫 배포 전 **DB 볼륨 스냅샷**을 반드시 확보. 초기 부팅 스키마는 **DB가 비어 있을 때만** 실행되므로, 잘못 뜨면 볼륨을 비우고 다시 시작하는 것이 가장 빠름 |
| 데이터 유입 후 | 스키마 되돌리기는 개별 SQL 롤백(각 `migration_*.sql` 상단에 롤백문 기재됨) |

---

## 6. 권고

**B1은 처리했습니다.** 남은 것은 B2(호스트·DNS·TLS·자격증명)이며, 이는 인프라 결정이라 사용자 몫입니다.

그 다음은 §3입니다. 과거 스테이징 배포에서 반복적으로 사고가 난 지점이 **"코드는 갔는데 데이터가 없어서 조용히 stub으로 도는"** 경우였습니다.
