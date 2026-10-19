# TCR-261019 Cafe24 카드 복원 · 사이트 바로가기 · OAuth 연결 테스트 — 테스트 결과

- 근거: `PLN-261019-Cafe24-Card-Site-Link-Test-Error.md` · 구현 PR #677
- 환경: 로컬 jest/tsc/vite, 스테이징 `https://shoptalk.amoeba.site`(tenant 16 zhangbayo 실측)

## 1. 단위 테스트 (jest, `apps/api`)

| # | 케이스 | 파일 | 결과 |
|---|---|---|---|
| U1 | `cafe24CredentialMode()` oauth / manual / null / 빈 mallId→null | `ecommerce-integration.service.cafe24-mode.spec.ts` | ✅ |
| U2 | `getSettings(cafe24)` OAuth blob → `mode='oauth'`, `fields.mall_id=mallId`, `secrets.access_token=false` | 〃 | ✅ |
| U3 | manual blob → `mode='manual'`; 행 없음 → `null` | 〃 | ✅ |
| U4 | 타 provider 응답에 `mode` 키 없음 | 〃 | ✅ |
| U5 | `test(cafe24)` OAuth blob → `{ok:false, skipped:true}` 반환, 프로브 미호출, **저장 0회**, 기존 status 불변 | 〃 | ✅ |
| U6 | `test(cafe24)` manual blob → 프로브 실행·결과 기록(현행 유지) | 〃 | ✅ |
| U7 | `save(cafe24)` 수동 토큰 입력 시 OAuth 키(`mallId/refreshToken/…`) 제거, status unknown | 〃 | ✅ |
| U8 | `save(cafe24)` 토큰 공란이면 OAuth blob 유지 | 〃 | ✅ |
| U9 | `testConnection` 자격증명 없음 → not connected, 쓰기 없음, 토큰 서비스 미호출 | `cafe24-connection-test.service.spec.ts` | ✅ |
| U10 | 토큰+`/store` OK → `Connected: {shop_name} ({mall})`, status connected·detail·lastTestedAt 기록 | 〃 | ✅ |
| U11 | `getConnection()` null(refresh 실패) → error "reconnect", 기록 | 〃 | ✅ |
| U12 | `/store` 예외 → error(몰 ID 포함), 기록 | 〃 | ✅ |
| U13 | 앱 키 미설정(appConfig throw) → error 기록, `/store` 미호출 | 〃 | ✅ |
| U14 | `platformSiteUrl()` 16 케이스: Shopify handle(비-myshopify→null)·Cafe24 eclogin(api 호스트 접미 제거·빈값 null)·Woo·Odoo(스킴 보강)·Haravan·Klaviyo·Yotpo·Gorgias(서브도메인 정규화·null)·self(storefront 없음→null)·`javascript:` 거부 | tsx 스크립트(웹은 테스트 러너 없음) | ✅ 16/16 |

- `jest src/domain/cafe24 src/domain/tenant` **162 passed** · API `tsc --noEmit` ✅ · 웹 `tsc --noEmit` ✅ · 웹 `vite build` ✅ · `npm run i18n:check` 6개 언어 complete ✅

## 2. 통합 시나리오 (스테이징, 2026-10-19 16:23~16:35 UTC, 브랜치 배포 6ddad7b5→95bad8ad→7b88f826→ddc2652a)

검증 계정: 테넌트 16·3·1·4에 임시 master를 DB로 발급(bcrypt 해시 stdin 주입, `tmp-verify-261019*@amoeba.group`) → curl 로그인 →
`localStorage.ivy_auth` 주입 → 검증 후 **4계정 DELETE·로컬 비밀 파일 삭제** 완료.

| # | 시나리오 | 결과 |
|---|---|---|
| I1 | `GET /tenants/me/integrations/cafe24` (zhangbayo·amoebaorder) | ✅ `mode:'oauth'`, `fields.mall_id='zhangbayo'`/`'amoebaorder'`, status unknown(정정 직후). 배포 전 기준값은 `mall_id:null`·새 라우트 404 |
| I2 | 일반 `POST …/integrations/cafe24/test` (OAuth 테넌트) | ✅ `{ok:false, skipped:true, detail:"Connected through Cafe24 OAuth — …"}`, DB 3행 모두 불변 |
| I3 | `POST /tenants/me/cafe24/test` | ⚠️ **성공 경로는 스테이징에서 재현 불가** — (a) zhangbayo: 첫 실행(16:24, `/store` 프로브)에서 토큰 재발급은 성공했으나 `/store` 403 insufficient_scope → 프로브를 `/products`로 교체; 그런데 첫 구현의 `save(cred)`가 **회전된 refresh 토큰을 구 값으로 되돌려** 2회차부터 refresh 400(아래 §2.1). (b) amoebaorder: refresh 성공, `/products`·`/orders` 모두 403 insufficient_scope(몰 권한 축소, 8월 토큰 서비스 주석과 일치) → `ok:false "Cafe24 refused every read … re-authorise the mall"`, status error 기록. 즉 **토큰 발급→읽기→기록 경로는 실동작 확인**, "connected" 분기는 단위 테스트(U10·fallback)로 보증 |
| I4 | 카드 UI(zhangbayo) | ✅ 제목 Cafe24, 부제 `zhangbayo.cafe24.com · OAuth 연결`, 배지, 버튼 설정·연결 테스트·주문 동기화·상품 가져오기 + 링크 사이트 열기 |
| I5 | 카드 "연결 테스트" 클릭 | ✅ 오류 토스트(circle-alert) "Cafe24 token refresh failed — … reconnect the mall", 배지 오류·detail·마지막 확인 16:32:10 갱신 |
| I6 | "사이트 열기" href | ✅ `https://eclogin.cafe24.com/Shop/?mall_id=zhangbayo`, `target=_blank`, `rel=noopener noreferrer` |
| I7 | 카드 "설정" | ✅ 모달 제목 "Cafe24 재연결", 안내문에 몰 ID 보간, 입력값 `zhangbayo` 프리필, "토큰이 이미 있다면 직접 입력"·닫기·Cafe24 연결 |
| I8 | 자격증명 모달(직접 입력) → 연결 테스트 | ✅ info 토스트 "Cafe24 OAuth로 연결된 몰입니다 — 연결 테스트는 … Cafe24 카드에서 실행하세요.", 연결 상태 배지 불변 |
| I9 | ivyusa Shopify 카드 | ✅ 사이트 열기 → `https://admin.shopify.com/store/ambshop-dev`; 설정·연결 테스트·지금 동기화 유지 |
| I10 | go2joy 자체 플랫폼 카드 | ✅ 사이트 열기 → `https://www.go2joy.vn/`(storefront_url); 설정·위젯 설정으로 유지 |
| I11 | 마케팅 탭 Yotpo 카드 | ✅ 사이트 열기 → `https://my.yotpo.com/` |
| I12 | 데이터 정정 D6 | ✅ 15:44 UTC id 3·14 → unknown/NULL/NULL (프로덕션은 `integration_credentials` 0행 → 대상 없음) |
| I13 | 다른 Cafe24 행(annehearts id 4) | ✅ unknown 불변 |
| I14 | 배포 검증(4회) | ✅ 컨테이너 age 수초·`successfully started`·`/api/v1/health` 200·ERROR 0 |

### 2.1 실측이 잡은 결함 2건 (머지 전 수정)
| # | 결함 | 수정 커밋 |
|---|---|---|
| F1 | OAuth 테스트 프로브가 `/admin/store` → 앱이 `mall.read_store`를 요청하지 않아 항상 403 | 95bad8ad `/products?limit=1`, ddc2652a `/orders` 폴백 |
| F2 | 테스트 서비스가 먼저 읽은 `cred` 엔티티를 `save()` → 프로브 중 토큰 서비스가 회전·저장한 refresh 토큰을 **구 토큰으로 덮어씀** → 다음 refresh 400. 스테이징 zhangbayo의 refresh 토큰이 이렇게 소실됨(**운영자 재연결 필요**: 카드 → 설정 → Cafe24 연결) | 7b88f826 `update({id}, {status,detail,lastTestedAt})` + 스펙(U15·U16) |

- U15 `save()` 호출 시 throw하는 레포 더블로 partial update만 허용 ✅ · U16 패치 키 = `detail,lastTestedAt,status` ✅ · U17 catalogue 403·orders OK → connected(orders) ✅ · U18 둘 다 거부 → 두 실패 병기 + re-authorise ✅

## 3. 엣지 케이스
- E1 Shopify `shop_domain`이 커스텀 도메인(zhangbayomall.co.kr) → Shopify 카드가 아니므로 해당 없음; Shopify 카드에 비-myshopify 도메인이면 버튼 숨김(U14).
- E2 Cafe24 OAuth 테스트 중 refresh 토큰 회전 → `Cafe24TokenService.refresh` 단일 비행·저장(기존 동기화 경로와 동일).
- E3 `/store` 6초 초과 → error "timed out", 기록(U12 경로).
- E4 수동 토큰 저장으로 OAuth 키 제거 후 카드 → `mode='manual'`, 동기화 버튼 숨김, 일반 프로브 사용(U7).
