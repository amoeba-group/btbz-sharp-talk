# RPT-260929 — 위젯 노출 제한(IP·URL·기간·초대키) 실행 보고

- 근거: REQ-260929(`98f296e`) · PLN-260929(`9a6819f`, 승인 2026-09-29) · TCR-260929
- PR: **#567** (squash → main `abcc655`) + 본 문서 PR
- 결정 반영: D1=IP+초대키 · D2=도메인+경로 프리픽스 · D3=IP OR URL(기간 AND) · D5=자동 해제 ·
  (전제) D4=ensure까지 거절 · D6=테넌트 단위

## 1. 무엇이 바뀌었나

| 단계 | 변경 |
|---|---|
| **P1 엔진·저장** | `packages/types/widget-access.ts` — 순수 판정 함수 + IPv4/IPv6/CIDR 매처 + 오리진·경로 매처. `tenants.widget_access`(json) + `widget_access_key`(암호화). 콘솔 API `GET/PATCH /tenants/widget-access`, `POST …/key`(감사 2종) |
| **P2 노출 판정** | `GET /public/widget/visibility`(`no-store`) — 브라우저가 부르므로 서버가 실 IP를 본다. 로더는 마운트와 병렬로 묻고 거절이면 **프레임을 DOM에서 제거**. 초대 링크 1회 수집·보관 |
| **P3 권위 판정·콘솔** | `session/ensure`에 fail-closed 판정 + `tenants.status=suspended` 차단. 설정>위젯에 노출 제한 카드(기간·IP·URL·초대 링크·요약·만료 배지) 6언어 |

## 2. 설계에서 붙든 것 4가지

1. **숨김은 로더가 한다.** 서버 403만으로는 런처가 캐시 테마로 이미 그려져 "버튼은 뜨는데 눌러도
   안 되는" 상태가 된다(REQ §1-1 실측). 그래서 판정은 마운트 전에 묻고, 거절이면 iframe을 지운다.
2. **두 층, 반대 방향의 실패.** 로더 판정은 *화면*이라 fail-open(블립으로 전 스토어 위젯이
   사라지면 안 된다), `ensure`는 *데이터*라 fail-closed. 그래서 "안 보이는데 API는 열림"도,
   "블립 때문에 위젯 실종"도 생기지 않는다.
3. **캐시는 불리언 하나.** "이 테넌트가 제한을 쓰는가"만 기억하고 판정 결과는 캐시하지 않는다 →
   제한 없는 스토어는 한 번도 기다리지 않고, 기간 만료는 즉시 반영된다.
4. **페이지 URL은 재구성.** `parent_origin + landing_path`로 만든다. 세 번째 필드를 추가하면
   둘과 어긋날 수 있다.

## 3. 파일

- 타입/엔진: `packages/types/src/common/widget-access.ts`(+spec) · `index.ts`
- API: `sql/260929-tenant-widget-access.sql`(+`artefacts.tsv`·`init-sql`) ·
  `domain/tenant/{entity/tenant.entity.ts, tenant.service.ts, tenant.controller.ts, tenant.mapper.ts,
  widget-branding.controller.ts, dto/request/tenant.request.ts}` ·
  `domain/session/{session.service.ts, session.controller.ts, dto/request/session.request.ts}` ·
  `global/constant/error-code.constant.ts`(E5088~E5092)
- 로더/위젯: `apps/widget/public/embed.js` · `src/hooks/useSession.ts` · `src/services/sessionService.ts`
- 콘솔: `apps/web/src/domain/settings/{WidgetAccessCard.tsx(신규), SettingsWidgetPage.tsx,
  settings.service.ts, settings.hooks.ts}` · `i18n/locales/*/settings.json`(6언어)
- 테스트: 판정 엔진 22 · 저장 게이트 7 · ensure 경로 8

## 4. 테스트 (TCR-260929)

api **1984/1984**(197 suites) · types **138/138** · `tsc` 4패키지 · 빌드 · `i18n:check` 6언어.

스테이징 실측(제한 켠 뒤 즉시 원복): 차단 페이지 `visible=false`+ensure `E5092` /
허용 URL·하위 경로 `true` / **`/collections/testing` `false`**(부분일치 금지 확인) /
초대키 소지 `true`·틀린 키 `false` / **기간 종료 후 `true`**(자동 해제) /
`Cache-Control: no-store` / 알 수 없는 shop은 통과(설치 오류를 차단으로 만들지 않음).

## 5. 배포 상태

| 항목 | 상태 |
|---|---|
| PR | **#567** → main `abcc655` |
| SQL staging | **선적용 완료** 2026-09-29 (코드 배포 전) |
| 코드 staging | 배포 완료 — api healthy, `successfully started` 1회 |
| SQL production | **선적용 완료** 2026-09-29 — 밀려 있던 **4건을 순서대로** 적용(아래) |
| 코드 production | 배포 완료 2026-09-29 — `main:production` 승격(`1d3de70`) → `check-migrations.sh` **86 적용·대기 0** → `deploy-self-hosted.sh`. api healthy · `successfully started` 1회 · 스키마 에러 로그 0건 |

기본값은 "미설정 = 꺼짐"이라 **배포만으로 바뀌는 테넌트는 없다**.

### 5-1. 프로덕션에 함께 올라간 SQL 4건

`production`이 9/20 이후로 밀려 있어, 이번 배포는 이 기능만의 것이 아니었다. 코드 배포 전에
**전부 선적용**했다(모두 nullable 추가형, 백필 1건 포함).

| # | SQL | 출처 |
|---|---|---|
| 1 | `260920-order-items-image-url.sql` | read_products 후속(#559) |
| 2 | `260924-fulfillments-tracking-url.sql` | 탭·칩·Track 작업(#562, `fulfillments.tenant_id` 백필 포함) |
| 3 | `260924-order-items-product-url.sql` | 같은 작업 |
| 4 | `260929-tenant-widget-access.sql` | 이번 기능 |

> 교훈: 프로덕션 승격은 **내 변경만 보는 게 아니라 `production..main`의 SQL 전부**를 봐야 한다.
> 이번에는 4건 중 2건이 다른 세션 작업이었다.

### 5-2. 프로덕션 스모크 (내용 기준)

```
GET /public/widget/visibility → {visible:true, restricted:false, yourIp:…}, Cache-Control: no-store
로더 embed.js                → checkVisibility 2 · st:restricted 1 · st_access 2
콘솔 번들                     → widgetAccess 문구 6건
```

## 6. 잔여·후속

- **콘솔 카드 육안 확인 1회**와 브라우저에서의 "깜빡임 없이 사라지는지" 확인(자동화 클릭이 교차
  오리진 iframe에 닿지 않아 미수행, RPT-260920 §6과 같은 제약).
- **구 로더가 깔린 스토어**는 화면이 그대로 뜬다(설계) — 데이터는 ensure가 막는다. 스니펫 갱신
  안내는 콘솔 문구로만 되어 있고, 별도 공지 절차는 없다.
- `EMBED_ORIGIN_ENFORCE`(허용 도메인 집행)는 **여전히 관측 모드**다. 이번 기능과 별개이며,
  콘솔의 "이 도메인에서만 위젯이 뜹니다" 문구와 서버 동작의 간극은 그대로 남아 있다(REQ §1-1 ①).
- 노출 통계는 숨겨진 방문자를 세지 않는다(마운트도 ensure도 하지 않으므로) — 의도된 동작.
