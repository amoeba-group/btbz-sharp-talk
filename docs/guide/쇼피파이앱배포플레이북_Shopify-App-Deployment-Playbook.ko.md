# 쇼피파이 앱 배포 플레이북 (Shopify App Deployment Playbook)

- **작성일**: 2026-07-21 · **기준 커밋**: main `8e9eed0`
- **목적**: shoptalk 앱을 2026년 신규 Shopify 플랫폼(새 Dev Dashboard) 기준으로 등록·설치·검증한 **전 과정을 실제 설정값과 함께 기록**. 다른 앱(신규 테넌트·타 프로젝트) 배포 시 그대로 따라할 수 있는 참고 문서.
- **관련 문서**: `docs/report/RPT-Shopify-App-Registration-Manual-20260720.md`(등록 로드맵) · `docs/guide/쇼피파이연동가이드_Shopify-Integration.ko.md`(연동 아키텍처) · `shopify.app.toml`(리포 루트)
- ⚠️ **비밀값 규칙**: Client Secret·서버 비밀번호 등은 이 문서에 없다. gitignored인 `secrets/staging-server.md`에만 기록한다.

---

## 1. 최종 구성 요약 (실제 값)

| 항목 | 값 |
|---|---|
| 앱 이름 | `shoptalk` |
| 관리 대시보드 | 새 Dev Dashboard — `https://dev.shopify.com/dashboard/184769504/apps/394267852801` |
| (구) Partner 조직 | `https://partners.shopify.com/4515502` (조직: AMOEBA COMPANY LIMITED) |
| **Client ID** (`SHOPIFY_API_KEY`) | `6999d1547fe02aeafa5d0b9396aa4aba` |
| Client Secret (`SHOPIFY_API_SECRET`/`SHOPIFY_WEBHOOK_SECRET`) | `shpss_…` — `secrets/staging-server.md` 참조 (대시보드 Settings → Credentials) |
| App URL | `https://shoptalk.amoeba.site` |
| Redirect URL | `https://shoptalk.amoeba.site/api/v1/auth/shopify/callback` |
| App Proxy | prefix `apps` / subpath `ivy` → `https://shoptalk.amoeba.site/api/v1/shopify/proxy` |
| Scopes | `read_orders,read_customers,read_fulfillments,read_products,write_customer_data_erasure`<br>*(2026-09-20 `read_products` 추가 → 앱 버전 shoptalk-8. 주문 라인의 옵션·사진용)* |
| GDPR Compliance webhooks | `…/api/v1/webhooks/shopify/customers/data_request` · `…/customers/redact` · `…/shop/redact` |
| 설치 방식 | `use_legacy_install_flow = true` (인가 코드 OAuth), `embedded = false` (독립형 콘솔) |
| 배포 방식 | **Custom distribution** → 대상 스토어 `ambshop-dev.myshopify.com` (개발 스토어) |
| Admin API | **GraphQL 전용**, 버전 `2026-01` |
| 토큰 방식 | **만료형 오프라인 토큰** (access 1h + refresh 90d, 자동 갱신) |
| 릴리스된 앱 버전 | shoptalk-4 (기본 구성) → shoptalk-5 (scope 추가, 현행) |

### 백엔드 코드 매핑
| 기능 | 위치 |
|---|---|
| OAuth 설치/콜백 (state·HMAC·`expiring=1` 토큰 교환) | `apps/api/src/domain/shopify-oauth/shopify-oauth.service.ts` |
| 토큰 자동 리프레시 (만료 2분 전, 테넌트별 single-flight) | `apps/api/src/domain/tenant/tenant.service.ts` → `getShopifyConnection`/`refreshShopifyToken` |
| GraphQL Admin 클라이언트 (orders 쿼리·webhookSubscriptionCreate) | `apps/api/src/domain/order/shopify-admin.client.ts` |
| 웹훅 수신 + HMAC 검증 (fail-closed) | `apps/api/src/domain/order/shopify-order-webhook.controller.ts` · `global/util/shopify-hmac.util.ts` |
| GDPR 웹훅 3종 처리 | `apps/api/src/domain/privacy/privacy.controller.ts` |
| App Proxy 신원 브리지 | `apps/api/src/domain/shopify-proxy/` + `apps/widget/public/embed.js` |
| 앱 구성 파일 | 리포 루트 `shopify.app.toml` |

---

## 2. 절차 A — 앱 생성과 구성 배포

### A-1. 앱 생성 (Dev Dashboard)
1. `dev.shopify.com/dashboard` → **Create app** → 이름 입력 (예: `shoptalk`).
2. 생성 후 **Settings → Credentials**에서 **Client ID**와 **Secret** 확보.
   - Secret은 즉시 `secrets/staging-server.md`에 기록 (커밋 금지).
3. 계정 주의: Shopify 로그인은 조직 소유 계정으로. *(이 프로젝트: Google SSO `dev@amoeba.group`. `fremdung@gmail.com`은 별개의 비밀번호 계정이라 조직 앱이 안 보인다 — 로그인 삽질 방지 포인트.)*

### A-2. `shopify.app.toml` 작성 (구성의 코드화 — 핵심)
대시보드 UI에서 일일이 클릭하지 말고 리포 루트의 TOML로 관리한다. **현행 전체 파일**:

```toml
client_id = "6999d1547fe02aeafa5d0b9396aa4aba"
name = "shoptalk"
application_url = "https://shoptalk.amoeba.site"
embedded = false

[access_scopes]
scopes = "read_orders,read_customers,read_fulfillments,read_products,write_customer_data_erasure"
use_legacy_install_flow = true

[auth]
redirect_urls = [
  "https://shoptalk.amoeba.site/api/v1/auth/shopify/callback"
]

[webhooks]
api_version = "2026-07"

# NOTE: app-level `topics` subscriptions are NOT allowed while
# use_legacy_install_flow = true (CLI rejects the deploy). Operational webhooks
# (orders/*, fulfillments/*) are registered per shop at runtime via
# webhookSubscriptionCreate — orders topics additionally require Protected
# Customer Data approval; until then the scheduled incremental sync covers them.
[[webhooks.subscriptions]]
compliance_topics = [ "customers/data_request" ]
uri = "https://shoptalk.amoeba.site/api/v1/webhooks/shopify/customers/data_request"

[[webhooks.subscriptions]]
compliance_topics = [ "customers/redact" ]
uri = "https://shoptalk.amoeba.site/api/v1/webhooks/shopify/customers/redact"

[[webhooks.subscriptions]]
compliance_topics = [ "shop/redact" ]
uri = "https://shoptalk.amoeba.site/api/v1/webhooks/shopify/shop/redact"

[app_proxy]
url = "https://shoptalk.amoeba.site/api/v1/shopify/proxy"
prefix = "apps"
subpath = "ivy"
```

다른 앱에 적용 시 바꿀 것: `client_id`, `name`, 도메인(URL 4곳).

### A-3. CLI로 구성 배포 (`shopify app deploy`)
```bash
# CLI 4.x는 Node 22+ 필수. (Node 20이면 CLI 3.68은 실행되지만 서버가
# "CLI version >= 3.84.1" 요구로 거부; 3.84.1은 별도 버그로 배포 실패 → 최신 4.x 사용)
npx -y @shopify/cli@latest app deploy --path . --allow-updates --message "설명"
```
- 첫 실행 시 **device auth**: `https://accounts.shopify.com/activate-with-code?...` 링크+코드가 출력된다 → 조직 계정으로 로그인된 브라우저에서 열어 승인. *(비대화형 환경에서는 `script -q /dev/null npx …`로 가상 TTY를 만들어야 코드가 출력된다.)*
- 성공 시 "New version released to users" + 버전명(shoptalk-N). 배포 = 새 앱 버전 생성+릴리스.
- `--allow-updates`가 CI/비대화형용 확인 생략 플래그 (구버전의 `--force`는 4.x에서 제거됨).

### A-4. 배포 방식(Distribution) 선택 — 설치 전 필수
- Dev Dashboard 앱 → **Distribution** → **Custom distribution** 선택 → 대상 스토어 도메인 입력 → **Generate link**.
- ⚠️ **한 번 정하면 변경 불가.** App Store 공개는 별도 public 앱으로 새로 만들어 심사받는 구조로 간다.
- 배포 방식 미선택 상태로 설치 URL 열면 **"This app is under review"** 로 차단된다 — 이 오류의 원인은 심사가 아니라 배포 방식 미설정이다.
- 대상 스토어가 플랜 만료로 동결이면 ("This store will be right back" 화면) 설치 불가 → **개발 스토어**(무료)를 만들어 대상으로 지정. *(이 프로젝트: ambshopi.myshopify.com 동결 → `ambshop-dev.myshopify.com` 개발 스토어로 전환.)*

---

## 3. 절차 B — 서버 설정과 설치

### B-1. 서버 환경변수 (`docker/staging/.env.staging`)
```bash
SHOPIFY_API_KEY=6999d1547fe02aeafa5d0b9396aa4aba
SHOPIFY_API_SECRET=<Client Secret — secrets/staging-server.md>
SHOPIFY_WEBHOOK_SECRET=<위와 동일 값 — 웹훅 HMAC은 앱 secret으로 서명됨>
SHOPIFY_SCOPES=read_orders,read_customers,read_fulfillments,read_products   # TOML과 일치시킬 것
SHOPIFY_APP_URL=https://shoptalk.amoeba.site
SHOPIFY_SYNC_INTERVAL_MIN=30        # 예약 증분 동기화 (0=off)
CRED_ENC_KEY=<base64 32B — 토큰 암호화 저장용, 기존 값 유지>
```
변경 후 API 컨테이너 재생성:
```bash
cd docker/staging && docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --force-recreate api
```

### B-2. 테넌트-스토어 매핑 (설치 전에!)
OAuth 콜백은 `shop_domain`으로 테넌트를 upsert한다. **기존 테넌트에 토큰을 연결하려면 설치 전에 shop_domain을 맞춰둘 것** (아니면 새 테넌트가 생긴다):
```bash
# 콘솔 Settings → Shopify 카드에서 변경하거나, API로:
TOKEN=$(curl -s -X POST https://shoptalk.amoeba.site/api/v1/auth/user/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<테넌트 마스터>","password":"<pw>"}' | jq -r .data.accessToken)
curl -X PUT https://shoptalk.amoeba.site/api/v1/tenants/me/shopify \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"shop_domain":"ambshop-dev.myshopify.com"}'
```

### B-3. 설치 (OAuth 승인)
스토어 관리자 권한이 있는 브라우저에서:
```
https://shoptalk.amoeba.site/api/v1/auth/shopify/install?shop=ambshop-dev.myshopify.com
```
→ 승인 화면에서 **Install**. 콜백이 `expiring=1`로 토큰을 교환해 `{accessToken, refreshToken, expiresAt, refreshTokenExpiresAt}`를 AES-256-GCM으로 저장한다.
⚠️ **scope를 늘린 새 버전을 릴리스했으면 반드시 재설치**해야 새 scope가 grant된다.

### B-4. 검증 시퀀스
```bash
# 1) 자격증명 저장 확인 (updatedAt이 방금 시각이어야 함)
curl -s https://shoptalk.amoeba.site/api/v1/tenants/me/shopify -H "Authorization: Bearer $TOKEN"
# 2) 연결 테스트 (GraphQL shop 쿼리) → {"ok":true,"detail":"Connected: <스토어명>"}
curl -s -X POST https://shoptalk.amoeba.site/api/v1/tenants/me/shopify/test -H "Authorization: Bearer $TOKEN"
# 3) 주문 동기화 → {"ok":true,...}
curl -s -X POST https://shoptalk.amoeba.site/api/v1/tenants/me/shopify/sync -H "Authorization: Bearer $TOKEN"
# 4) 실시간 웹훅 등록 (PCD 승인 후에만 성공 — §5 참조)
curl -s -X POST https://shoptalk.amoeba.site/api/v1/tenants/me/shopify/register-webhooks -H "Authorization: Bearer $TOKEN"
# 5) 웹훅 HMAC fail-closed 확인 (무서명 → 401이어야 정상)
curl -s -o /dev/null -w "%{http_code}" -X POST -H 'Content-Type: application/json' -d '{}' \
  https://shoptalk.amoeba.site/api/v1/webhooks/shopify/orders/updated
```

### B-5. 위젯 테마 설치 (스토어프런트)
스토어 관리자 → Online Store → Themes → **Edit code** → `layout/theme.liquid`의 `</body>` 직전에:
```html
<script>
  window.SHARPTALK_WIDGET_CONFIG = {
    shop: "ambshop-dev.myshopify.com",
    widgetUrl: "https://shoptalk.amoeba.site/widget"
  };
</script>
<script src="https://shoptalk.amoeba.site/widget/embed.js" defer></script>
```
- 개발 스토어 스토어프런트는 입장 비밀번호 필수: Online Store → **Preferences → Password protection**에서 설정 (플랜 선택 전엔 해제 불가).
- 스토어 고객으로 로그인하면 App Proxy(`/apps/ivy/identity`)로 위젯이 자동 인증된다.
- 같은 스니펫은 관리 콘솔 Settings → "Install on your store" 카드에서 항상 복사 가능.

---

## 4. 2026 신규 앱 플랫폼 제약 (전부 실제로 겪은 것 — 최다 시간 소모 구간)

| # | 증상 | 원인 | 해결 (코드 반영됨) |
|---|---|---|---|
| 1 | 모든 Admin API 403: *"Non-expiring access tokens are no longer accepted"* | 신규 앱은 만료형 오프라인 토큰만 허용 | 토큰 교환에 `expiring: '1'` + refresh_token 저장 + `grant_type=refresh_token` 자동 갱신 (PR #17) |
| 2 | REST `orders.json` 403: *"not approved to access REST endpoints with protected customer data"* (shop.json은 정상, GraphQL orders는 정상) | 신규 앱은 보호 고객 데이터(PCD) 리소스를 REST로 접근 불가 | Admin 클라이언트 GraphQL 전면 전환 — `orders` 쿼리, `webhookSubscriptionCreate`, `{ shop { name } }` (PR #17) |
| 3 | `webhookSubscriptionCreate` 403: *"not approved to subscribe to webhook topics containing protected customer data"* | orders/* 웹훅 토픽은 PCD **승인** 필요 (읽기의 dev-store 예외와 별개) | PCD 승인 신청 (신규 Dev Dashboard에 UI 없음 — 구 Partner 대시보드 앱 → API access, 또는 지원 문의). 승인 전에는 30분 예약 동기화가 대체 |
| 4 | CLI 배포 오류: *"App-specific webhook subscriptions are not supported when use_legacy_install_flow is enabled"* | TOML의 앱 레벨 `topics` 구독은 legacy install flow와 비호환 | 운영 웹훅은 런타임 등록 유지, TOML에는 compliance_topics만 |
| 5 | `fulfillments/*` 토픽 구독 거부 | `read_fulfillments` scope 미부여 | scope 추가(shoptalk-5) 후 재설치 필요 |
| 6 | CLI 3.68: *"CLI version no longer supported (>=3.84.1)"* / 3.84.1: *"At least one specification file is required"*(버그) / 4.x: Node 20에서 SyntaxError | CLI·Node 버전 매트릭스 | **Node 22 + CLI 4.x(latest)** 고정 |
| 7 | 설치 화면: *"This app is under review"* | Distribution 미선택 | Custom distribution 선택 (§2 A-4) |
| 8 | 위젯 콘솔 401 노이즈 (`unread-count`) | 스토어의 구 세션 토큰이 검증 전 쿼리에 노출 | 토큰은 ensure 검증 후에만 쿼리에 노출 (PR #18) |

**공개(App Store) 등록으로 갈 때 추가로 필요한 것**: `RPT-Shopify-App-Registration-Manual-20260720.md` §5–6 (Theme App Extension, 설치 UX, 리스팅, PCD 정식 승인, 심사 2–4주). 이번에 만든 GraphQL·만료형 토큰 코드는 그대로 재사용된다.

---

## 5. 다른 앱 배포 체크리스트 (요약)

- [ ] 조직 계정으로 Dev Dashboard에서 앱 생성 → Client ID/Secret 확보 (Secret은 gitignored 파일에)
- [ ] `shopify.app.toml` 복사 후 client_id/name/도메인 치환
- [ ] Node 22 + `npx @shopify/cli@latest app deploy --allow-updates` → device auth 승인 → 버전 릴리스 확인
- [ ] Distribution = Custom → 대상 스토어(활성 상태 확인!) → 설치 링크 생성
- [ ] 서버 env: `SHOPIFY_API_KEY/SECRET/WEBHOOK_SECRET/SCOPES/APP_URL/SYNC_INTERVAL_MIN` → api 재기동
- [ ] (기존 테넌트 연결 시) 설치 **전** `shop_domain` 재지정
- [ ] 설치 URL 승인 → B-4 검증 5종 실행
- [ ] PCD 승인 신청 → 승인 후 "Register webhooks" 재실행
- [ ] 테마에 위젯 스니펫 삽입 → 스토어프런트에서 버블·채팅·고객 인증 확인
- [ ] scope 변경 시마다: TOML 수정 → deploy → **재설치**
