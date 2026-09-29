# PLN-260929 — 위젯 노출 제한(IP·URL·기간·초대키) 실행 계획

- 근거: REQ-260929-Widget-Access-Restriction (main `98f296e`)
- 사용자 결정(2026-09-29): **D1 = ⓐIP + ⓒ초대키** · **D2 = 도메인+경로 프리픽스** ·
  **D3 = IP OR URL**(기간은 항상 AND) · **D5 = 기간 종료 시 자동 해제**
- 전제(REQ에서 제안한 대로 진행, 반대 시 알려주시면 반영): **D4 = 노출 + `session/ensure`까지 거절** ·
  **D6 = 테넌트 단위**
- ⚠️ **PLN 승인 후 착수.** 이 문서는 구현 전 계획입니다.

---

## 1. 판정 규칙 (한 문장으로)

```
보인다 =  제한이 꺼져 있다
       OR (기간 안이고  AND  (IP 일치  OR  URL 일치  OR  초대키 일치))
```

- **기간은 AND**: 기간 밖이면 무엇이 맞든 제한 자체가 적용되지 않는다(= 종료 후 자동 해제, D5).
- **나머지는 OR**: 사무실에서 아무 페이지나(IP), 지정 URL이면 어디서든(URL), 초대키를 받은 테스터는
  어느 회선이든(키) 보인다.
- 제한이 켜져 있고 기간 안인데 셋 다 아니면 → **위젯이 존재하지 않는 것처럼 아무것도 그리지 않는다.**

## 2. 데이터 모델

기존 관례를 그대로 따른다 — 목록형 설정은 `tenants`의 JSON 컬럼(`embed_origins`가 그렇다),
비밀값은 암호화 transformer 컬럼(`embed_secret`이 그렇다).

```sql
-- sql/260929-tenant-widget-access.sql
ALTER TABLE `tenants`
  ADD COLUMN `widget_access` json DEFAULT NULL AFTER `embed_origins`,
  ADD COLUMN `widget_access_key` varbinary(512) DEFAULT NULL AFTER `widget_access`;
```

```jsonc
// tenants.widget_access — normalizeWidgetAccess()가 정규화·검증한 형태만 저장
{
  "enabled": true,
  "startsAt": "2026-10-05T00:00:00.000Z",   // UTC 저장, 콘솔은 테넌트 타임존으로 표시
  "endsAt":   "2026-10-19T14:59:59.999Z",
  "ips":  ["203.0.113.7", "10.10.0.0/24", "2001:db8::/32"],
  "urls": ["https://shop.example.com/collections/test", "https://staging.example.com"]
}
```

- `widget_access_key`는 **초대키 평문을 암호화 저장**(`secretTransformer` 재사용). 콘솔에서 링크를
  다시 보여줘야 하므로 해시가 아니라 복호 가능한 보관이다 — `embed_secret`과 같은 취급.
- 정규화·검증은 `packages/types/src/common/widget-access.ts`에 두고
  `normalizeWidgetAccess()` / `evaluateWidgetAccess()`를 export 한다(위젯 테마 모듈과 같은 패턴).
  **판정 함수는 순수 함수**로 두어 서버·테스트가 같은 코드를 쓴다.

### 2-1. 매칭 규칙

| 대상 | 규칙 |
|---|---|
| IP | 단일 주소 또는 **CIDR**(IPv4/IPv6). 저장 시점에 파싱 실패하면 **거절**(C5) — 런타임에 조용히 흘리지 않는다 |
| URL | `parseOrigin()`으로 스킴+호스트(+포트) 비교 후 **경로 프리픽스** 비교. `/collections/test`는 `/collections/test`, `/collections/test/xxx`에 일치하고 `/collections/testing`에는 **불일치**(경계는 `/` 또는 끝) |
| | 쿼리스트링·해시는 **무시**. 대소문자는 호스트만 무시(경로는 구분) |
| 키 | 쿼리 `?st_access=…`로 1회 방문 → 로더가 `localStorage['st:access:{shop}']`에 보관 → 이후 매 판정에 동봉 |

> 경로 프리픽스에 `*`를 허용하지 않는다 — 프리픽스 자체가 이미 "이 아래 전부"라서, `*`를 받으면
> `/a*b` 같은 기대를 만들고 매처가 그걸 지키지 못한다.

## 3. 판정 지점 — 두 곳, 역할이 다르다

| 지점 | 역할 | 실패 시 |
|---|---|---|
| **로더 `GET /public/widget/visibility`** | **보이게 할지**를 정한다. 브라우저가 부르므로 서버가 **실 IP**(XFF 첫 홉)를 본다 | **fail-open**(보임). API 한 번 삐끗했다고 전 스토어 위젯이 사라지면 안 된다 |
| **`session/ensure`(+세션 발급 경로)** | **동작할지**를 정한다. 권위 있는 판정 | fail-closed(E-code 403) |

두 층으로 나누는 이유: 로더 판정은 *화면*, ensure 판정은 *데이터*다. 네트워크 사고로 로더가
열려도 ensure가 막으므로 "안 보이는데 API는 열려 있음"도, "API 블립 때문에 위젯이 사라짐"도
생기지 않는다.

### 3-1. 깜빡임 없이 숨기기 (로더)

로더는 테넌트가 제한 중인지 **미리 알 수 없다**. 그래서:

```
① 페이지 로드 → visibility 요청(비동기) + 프레임 생성
② 이 스토어가 '제한 중'이라고 캐시에 적혀 있으면  → 판정 올 때까지 프레임 숨김
   적혀 있지 않으면(대다수 = 제한 없음)          → 평소대로 즉시 표시
③ 판정 도착:
     visible:false → 프레임 제거 + '제한 중' 캐시 기록
     visible:true  → 표시 유지 + '제한 중' 여부 캐시 갱신
```

- 캐시하는 것은 **"이 테넌트가 제한을 쓰는가"**라는 불리언뿐이다. **판정 결과 자체는 캐시하지 않는다** —
  기간 만료·해제가 즉시 반영돼야 한다(REQ §3-2).
- 결과: 제한 없는 스토어는 **한 번도 기다리지 않고**, 제한 중인 스토어는 **브라우저당 최대 한 번** 깜빡인다.

## 4. 콘솔 UI (ASCII 와이어프레임)

**설정 > 임베드 · SDK**, 기존 "허용 도메인" 카드 아래 새 섹션.

### 4-1. 꺼짐 (기본)

```
┌─ 노출 제한 (테스트 모드) ────────────────────────────────────┐
│                                                              │
│  [○ ] 사용 안 함                                              │
│  지정한 IP·URL에서만, 정해진 기간 동안만 위젯을 노출합니다.    │
│  켜면 그 밖의 방문자에게는 위젯이 아예 표시되지 않습니다.      │
└──────────────────────────────────────────────────────────────┘
```

### 4-2. 켜짐

```
┌─ 노출 제한 (테스트 모드) ────────────────────────────────────┐
│  [ ●] 사용 중                                                 │
│                                                              │
│  기간   시작 [2026-10-05 09:00]  종료 [2026-10-19 23:59]      │
│         테넌트 시간대: Asia/Seoul · 종료 후 자동 해제됩니다    │
│  ──────────────────────────────────────────────────────────  │
│  허용 IP                                     [+ 내 IP 추가]   │
│    203.0.113.7          [삭제]                               │
│    10.10.0.0/24         [삭제]                               │
│    [ 203.0.113.0/24            ]  [추가]                     │
│    IPv4·IPv6 · CIDR 표기 가능                                │
│  ──────────────────────────────────────────────────────────  │
│  허용 URL                                                     │
│    https://shop.example.com/collections/test   [삭제]        │
│    https://staging.example.com                 [삭제]        │
│    [ https://… 경로까지 적으면 그 아래 전부   ]  [추가]       │
│  ──────────────────────────────────────────────────────────  │
│  초대 링크                                                    │
│    https://shop.example.com/?st_access=9f2c…   [복사] [재발급]│
│    링크로 한 번 들어온 브라우저는 기간 내내 어디서든 보입니다  │
│  ──────────────────────────────────────────────────────────  │
│  ⓘ 지금 설정: 10/5 09:00 ~ 10/19 23:59 동안                   │
│     IP 2개 · URL 2개 · 초대 링크를 받은 브라우저에서만 노출    │
│                                          [ 저장 ]            │
└──────────────────────────────────────────────────────────────┘
```

### 4-3. 저장 실패(검증) · 만료 상태

```
   [ 10.10.0.0/33            ]  [추가]        ← 저장 자체를 거절
   ⚠ IP 또는 CIDR 형식이 아닙니다: 10.10.0.0/33

┌─ 노출 제한 (테스트 모드) ────────── [기간 종료됨] ───────────┐
│  [ ●] 사용 중 (기간이 지나 현재는 모두에게 노출 중)           │
│  종료 2026-10-19 23:59 · 다시 쓰려면 기간을 연장하세요        │
```

- 요약 문장(ⓘ)은 **저장된 값을 그대로 읽어 만든다**. "설정은 켰는데 아무 규칙도 없어서 아무에게도
  안 보이는" 상태를 막기 위해, **규칙이 0개면 저장을 거절**한다(아래 검증 표).

| 검증 | 처리 |
|---|---|
| 제한 켬 + 규칙 0개(IP·URL·키 전부 없음) | 저장 거절 — "최소 한 가지 허용 조건이 필요합니다" |
| 시작 ≥ 종료 | 저장 거절 |
| 종료가 과거 | 저장은 허용(즉시 해제 상태) + 경고 배지 |
| IP/CIDR·URL 형식 오류 | 해당 입력만 거절, 나머지 저장 안 함 |

## 5. 단계별 실행

### P1 — 판정 엔진 + 저장 (서버)

| 파일 | 변경 |
|---|---|
| `sql/260929-tenant-widget-access.sql` (+`artefacts.tsv`, `docker/init-sql/01-schema.sql`) | 컬럼 2개 |
| `packages/types/src/common/widget-access.ts` (신규) | `WidgetAccess` 타입 · `normalizeWidgetAccess()` · `matchIp()` · `matchUrl()` · **`evaluateWidgetAccess()`(순수)** |
| `domain/tenant/entity/tenant.entity.ts` | `widgetAccess`(json) · `widgetAccessKey`(secretTransformer) — **nullable 컬럼은 `type` 명시**(union 타입만 주면 부팅사) |
| `domain/tenant/tenant.service.ts` · `tenant.controller.ts` · `dto/request` | `GET/PATCH /tenants/widget-access`, 키 발급 `POST /tenants/widget-access/key`, 감사 기록 |
| `global/constant/error-code.constant.ts` | `WIDGET_ACCESS_DENIED`(다음 빈 Exxxx 블록) |

### P2 — 노출 판정 + 로더 (보이는 부분)

| 파일 | 변경 |
|---|---|
| `domain/tenant/widget-branding.controller.ts`(기존 `public/widget`) | `GET /public/widget/visibility?shop=&url=&key=` → `{visible, reason?}`. `Cache-Control: no-store` |
| `apps/widget/public/embed.js` | 마운트와 병렬로 판정 요청, §3-1 규칙으로 표시/제거, `st:access` 키 수집·보관, fail-open |
| `apps/widget/src/hooks/useSession.ts` | ensure 요청에 `page_url`·`access_key` 동봉 |

### P3 — 권위 판정 + 콘솔 UI

| 파일 | 변경 |
|---|---|
| `domain/session/session.service.ts` | `assertEmbedOriginAllowed` 옆에 `assertWidgetAccessAllowed()` — 제한 위반이면 403, **`tenants.status === 'suspended'`도 함께 거절**(REQ G6) |
| `apps/web/src/domain/settings/*` | §4 카드, `+ 내 IP 추가`(판정 응답이 `yourIp`를 함께 준다), 요약 문장, 검증 메시지 |
| `apps/web/src/i18n/locales/*/settings.json` | 6언어 |

## 6. 사이드 임팩트 분석

| 대상 | 영향 | 조치 |
|---|---|---|
| **콘솔 위젯 미리보기**(`?preview=` 서명 토큰) | 콘솔은 스토어 URL도 아니고 운영자 IP도 목록에 없다 → 미리보기가 막힌다 | **preview 토큰이면 판정 우회**. 토큰은 10분 HMAC이라 이미 신뢰 경계다 |
| **앱 모드**(`?mode=app`, WebView SDK) | 페이지 URL이 없다 → URL 규칙이 성립하지 않는다 | 앱 모드는 **URL 규칙 제외, 기간·IP·키는 적용**. (반대 의견 있으면 PLN 승인 시 알려주세요) |
| **구 로더가 깔린 스토어** | 판정 요청을 보내지 않는다 → 화면은 그대로 뜬다 | ensure 판정(P3)이 막으므로 **데이터는 보호**된다. 화면 숨김은 스니펫 갱신 후 적용 — 콘솔에 고지 |
| **허용 도메인(`embed_origins`) 관측 모드** | 별개 기능. 이번 건은 그 스위치를 건드리지 않는다 | 카드 문구를 정리해 둘을 구분(“설치 오류 방지” vs “테스트 노출 통제”) |
| **위젯 노출 통계**(PLN-260920) | 숨겨진 방문자는 마운트도 ensure도 하지 않으므로 **집계에 잡히지 않는다** | 의도된 동작. RPT에 명시 |
| 모바일 PWA(`apps/pwa`) | 자체 화면이라 로더를 쓰지 않음 | 이번 범위 밖 |
| 다국어 | 새 문구 전부 6언어 | `npm run i18n:check` 게이트 |
| 스키마 | SQL 1건 → PR 본문 `## Migration`, **선적용 후 코드 배포** | 배포 순서 준수 |

## 7. 테스트 계획 (TCR-260929)

- **판정 엔진(순수 함수)**: 제한 꺼짐 / 기간 전·중·후 경계(시작 정각·종료 정각) / IP 단일·CIDR 경계
  (`10.10.0.0/24`의 `.0`·`.255`·`.256`) / IPv6 / URL 호스트 일치·포트·경로 프리픽스 경계
  (`/test` vs `/testing`) / 쿼리·해시 무시 / 키 일치·불일치 / **OR 조합 4가지 진리표** / 규칙 0개
- **역검증**: `/testing`이 `/test`로 통과하지 않는지, `*.example.com`이 아펙스를 삼키지 않는지
  (부분일치 사고 계열 — 이 저장소에서 두 번 났다)
- **엔드포인트**: 미설정 테넌트는 `visible:true` 즉답 / 알 수 없는 shop / `no-store` 헤더 / `yourIp` 반환
- **ensure**: 제한 위반 403, preview 토큰 우회, suspended 거절
- **로더**(node:test + 기존 embed 하네스): fail-open, 제한 캐시가 있을 때만 대기, `visible:false`면
  **프레임이 DOM에서 사라지는지**, `?st_access=` 수집·보관
- **콘솔**: 규칙 0개 저장 거절, 잘못된 CIDR 거절, 요약 문장이 저장값과 일치
- **실측(스테이징)**: 제한 켜고 ①사무실 IP ②지정 URL ③초대 링크 ④그 외 — 네 경우의 화면과
  `session/ensure` 응답

## 8. 순서·산출물

1. PLN 승인 → P1(엔진·스키마) → SQL 선적용(스테이징) → PR
2. P2(엔드포인트·로더) → 배포 → 하네스 실측
3. P3(ensure·콘솔) → 배포 → 스테이징 4경우 실측
4. TCR-260929 · RPT-260929

각 단계는 **그 자체로 안전**하다: P1만 있으면 아무 동작도 바뀌지 않고(설정 저장만), P2는
fail-open이며, P3에서 비로소 권위 판정이 붙는다.

## 9. 명시적으로 안 하는 것

- **보안 경계로 쓰지 않는다.** Origin·URL은 브라우저가 보내고 IP는 XFF 신뢰 모델이다(REQ §3-3).
  이 기능은 "테스트 기간 동안 지정 환경에만 노출"을 위한 **노출 통제**이며, 인증·인가가 아니다.
- 지역(GeoIP)·기기·브라우저 기반 제한, 사용자별 롤아웃 비율(A/B) — 이번 범위 밖.
- `embed_origins` 집행 스위치(`EMBED_ORIGIN_ENFORCE`)를 켜는 일 — 별도 판단.
