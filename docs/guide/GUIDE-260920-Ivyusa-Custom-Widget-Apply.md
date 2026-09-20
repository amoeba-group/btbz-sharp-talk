# GUIDE-260920 — ambshop-dev 스토어: 기본 위젯 → ivyusa 커스텀 위젯 전환 적용 가이드

- 대상 스토어: `https://ambshop-dev.myshopify.com/` (Shopify 개발 스토어, 테마 Dawn)
- 대상 테넌트: 스테이징 `ivyusa` (tenant #1, `shop_domain = ambshop-dev.myshopify.com`)
- 근거 문서: REQ/PLN/RPT-260916-Ivyusa-Widget-Figma-Design · FIX-260916-Widget-Trigger-Missing ·
  FIX-260917-Embed-Snippet-Url · FIX-260917-Embed-Self-Base · 매뉴얼 05 §3.2-1 · 임베드SDK설치가이드 "트리거 모드"
- 실측 일시: **2026-09-20** (스토어프론트 브라우저 실측 + 스테이징 API 실조회)

---

## 0. 결론 먼저

**코드 변경은 없습니다.** ivyusa 커스텀 위젯(“IVY Figma”)은 이미 스테이징 테넌트에 **적용되어
라이브**입니다. 지금 스토어에 파란 원형 버블이 떠 있는 이유는 위젯이 “기본 shoptalk 위젯”이라서가
아니라, **진입 방식(런처)만 아직 기본값(떠 있는 버튼)**이기 때문입니다.

따라서 실제 작업은 두 건뿐입니다.

| # | 작업 | 담당 | 소요 |
|---|---|---|---|
| 1 | 스토어 테마: 헤더에 여는 요소(종+배지) 삽입 + 임베드 스니펫 갱신 | **IVY(스토어 측)** | 10~20분 |
| 2 | 콘솔: 런처 모드 = “스토어 헤더 트리거”로 전환 | 테넌트 마스터 | 1분 |

> ⚠️ **순서 고정: 1 → 2.** 반대로 하면 위젯을 여는 수단이 0개가 됩니다(FIX-260916 실제 사고).
> 현재 로더에는 폴백이 있어 “버튼이 사라지는” 사고까지는 나지 않지만, 트리거 모드가 **무효화되어
> 계속 떠 있는 버튼으로 동작**하므로 전환이 안 된 것처럼 보입니다.

---

## 1. 지금 상태 (2026-09-20 실측)

### 1.1 이미 ivyusa 커스텀인 것 — 손댈 필요 없음

`POST https://shoptalk.amoeba.site/api/v1/session/ensure {"shop_domain":"ambshop-dev.myshopify.com"}`
및 콘솔 API `GET /tenants/widget-theme`, `GET /widget-designs` 실조회 결과.

| 항목 | 현재 값 | 출처 |
|---|---|---|
| 커스텀 위젯 | **“IVY Figma” (id 5) 사용 중** (`activeId: 5`) | `/widget-designs` |
| 디자인 | 폰트 Inter 14 · 모서리 `lg` · 패널 380×720 · **빠른 답장 카드형** | `widgetTheme.design` |
| 브랜드 색 / 헤더 | `#2D5BE3` / 흰색 헤더 | `widgetTheme` |
| 탭 | 알림 + 채팅 (2탭, 상단) | `widgetTabs` |
| 표시명 / 첫 방문 문구 | “IVY Beauty” / EN·KO 문구 설정됨 | `widgetCopy` |
| Shopify 연동 | `connected`, 마지막 동기화 2026-09-20 03:10 | `/tenants/me/shopify` |

### 1.2 아직 기본(shoptalk)인 것 — 이번 작업 대상

| 항목 | 현재 값 | 확인 방법 |
|---|---|---|
| 런처 모드 | **`floating`** (`{position:right, size:md, icon:chat}` — `mode` 키 없음 = 기본) | `/tenants/widget-theme` |
| 스토어 헤더의 여는 요소 | **없음** (Dawn 헤더 아이콘 4개: 언어·검색·계정·장바구니) | 스토어프론트 DOM 실측 |
| 테마 스니펫 전역명 | **구형 `IVY_WIDGET_CONFIG`** | 스토어프론트 콘솔: `[SharpTalk] IVY_WIDGET_CONFIG still works, but new installs should use SHARPTALK_WIDGET_CONFIG.` (`shoptalk.amoeba.site/widget/embed.js:106`) |
| 스니펫의 `trigger` 키 | **없음** | 위와 동일(트리거였다면 로더가 도킹 동작) |
| 로더 출처 | `https://shoptalk.amoeba.site/widget/embed.js` (= **스테이징**) | 위 콘솔 로그의 스크립트 주소 |

### 1.3 스토어 테마 실측치 (Dawn) — 오프셋 산정 근거

| 측정 | 값 |
|---|---|
| `header` 높이 | **60px** (`header-wrapper` 경계선 포함 **61px**) |
| 스티키 헤더 | **사용 중** (`<sticky-header>` 존재) |
| 헤더 아이콘 컨테이너 | `.header__icons` — 자식 4개(`desktop-localization-wrapper`, `header__search`, 계정 `a.header__icon`, 장바구니 `a.header__icon`) |

→ **상단 오프셋은 68px 권장**(헤더 61 + 여유 7). 콘솔 기본값 72도 동작하지만 헤더와 11px 떠 보입니다.

### 1.4 화면 (변경 전 → 변경 후)

```
[변경 전 — 지금]                          [변경 후 — 목표(Figma)]
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ ambshop-dev   🔍  👤  🛒     │          │ ambshop-dev  🔍 🔔⁽¹⁰⁾ 👤 🛒 │ ← 헤더에 종+배지
├──────────────────────────────┤          ├──────────────────────────┬───┤
│                              │          │                    ┌─────┴──┐│ ← 헤더 아래 우측 도킹
│        (스토어 본문)          │          │   (스토어 본문)     │IVY     ││   top: 68px
│                              │          │                    │Beauty  ││   패널 380 폭
│                              │          │                    │[알림][채팅]
│                              │          │                    │ ▢ ▢    ││ ← 카드형 빠른 답장
│                    ╭────╮    │          │                    │ ▢ ▢    ││
│                    │ 💬 │⁽¹⁰⁾│ ← 떠 있는 │                    └────────┘│
│                    ╰────╯    │   파란 버블│                              │
└──────────────────────────────┘          └──────────────────────────────┘
                                           바깥 클릭·종 재클릭 → 닫힘(0×0, 클릭 비차단)
```

---

## 2. STEP 1 — 스토어 테마 (IVY 측)

Shopify Admin → **Online Store → Themes → … → Edit code**.
기존 위젯 스니펫은 보통 `layout/theme.liquid`의 `</body>` 직전에 있습니다
(`IVY_WIDGET_CONFIG`로 검색).

### 2.1 스니펫 교체 (필수)

기존 `IVY_WIDGET_CONFIG` 블록을 아래로 **통째로 교체**합니다.
(구 전역명도 영구 지원되지만, 새 표준으로 맞추면서 `trigger`를 넣습니다.)

```html
<!-- SharpTalk widget — ivyusa / trigger mode -->
<script>
  window.SHARPTALK_WIDGET_CONFIG = {
    shop: "ambshop-dev.myshopify.com",
    widgetUrl: "https://shoptalk.amoeba.site/widget",
    trigger: "#st-bell"          // 헤더의 여는 요소 (CSS 선택자)
    // badge: "[data-sharptalk-badge]"  // 기본값이라 생략 가능
  };
</script>
<script src="https://shoptalk.amoeba.site/widget/embed.js" defer></script>
```

- `widgetUrl`은 **`/widget`까지** 포함해야 합니다. 빠뜨리면 SPA 폴백이 **HTML을 200으로** 돌려주어
  “스크립트는 받았는데 위젯이 없는” 상태가 됩니다(FIX-260917).
- 프로덕션으로 옮길 때는 두 주소를 **함께** 바꿉니다(§6).

### 2.2 헤더에 여는 요소(종 + 배지) 넣기 — 두 가지 방법 중 택1

로더는 `trigger` 선택자에 해당하는 요소를 찾고, **최대 6회·약 3.6초** 기다린 뒤에도 없으면
떠 있는 버튼으로 **폴백**합니다. 그러니 종은 **embed.js보다 먼저, 빨리** 붙어야 합니다.

#### 방법 A — 스니펫만으로 주입 (권장: 테마 섹션을 건드리지 않음)

§2.1 블록 **바로 위**에 붙여넣습니다.

```html
<style>
  #st-bell{position:relative;display:flex;align-items:center;justify-content:center;
    width:44px;height:44px;padding:0;border:0;background:none;color:currentColor;cursor:pointer}
  #st-bell svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.6;
    stroke-linecap:round;stroke-linejoin:round}
  #st-bell [data-sharptalk-badge]{position:absolute;top:4px;right:4px;min-width:16px;height:16px;
    padding:0 4px;border-radius:8px;background:#E02B2B;color:#fff;font:600 10px/16px sans-serif;
    text-align:center}
</style>
<script>
  (function () {
    function mountBell() {
      if (document.getElementById('st-bell')) return true;
      var icons = document.querySelector('.header__icons');
      if (!icons) return false;
      var btn = document.createElement('button');
      btn.id = 'st-bell';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Notifications');
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M18 8a6 6 0 1 0-12 0c0 7-2 8-2 8h16s-2-1-2-8"/>' +
        '<path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>' +
        '<span data-sharptalk-badge style="display:none"></span>';
      // 장바구니 앞에 끼워 넣기 (없으면 맨 뒤). insertBefore의 기준 노드는
      // icons의 '직계 자식'이어야 하므로 거슬러 올라가 찾는다.
      var ref = icons.querySelector('#cart-icon-bubble');
      while (ref && ref.parentElement !== icons) ref = ref.parentElement;
      icons.insertBefore(btn, ref);
      return true;
    }
    if (!mountBell()) {
      document.addEventListener('DOMContentLoaded', mountBell);
      var n = 0, t = setInterval(function () { if (mountBell() || ++n > 12) clearInterval(t); }, 250);
    }
  })();
</script>
```

- 테마 편집기에서 헤더 설정을 바꿔 헤더가 다시 그려지면 종이 사라질 수 있습니다(주입 방식의 한계).
  실제 고객 화면에서는 페이지 로드마다 다시 주입되므로 문제 없고, 테마 편집 중에만 새로고침하면 됩니다.
- 모바일 헤더에도 `.header__icons`가 있어 같은 위치에 들어갑니다. 실제 기기에서 §4로 확인하십시오.

#### 방법 B — 테마 마크업에 직접 추가 (정공법: 프로덕션 테마 권장)

`sections/header.liquid`에서 `<div class="header__icons …">` 안, 장바구니 링크 **앞**에 넣습니다.

```liquid
<button id="st-bell" type="button" class="header__icon header__icon--summary link focus-inset"
        aria-label="Notifications">
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
       stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M18 8a6 6 0 1 0-12 0c0 7-2 8-2 8h16s-2-1-2-8"/>
    <path d="M13.7 20a2 2 0 0 1-3.4 0"/>
  </svg>
  <span data-sharptalk-badge
        style="position:absolute;top:4px;right:4px;min-width:16px;height:16px;padding:0 4px;
               border-radius:8px;background:#E02B2B;color:#fff;font:600 10px/16px sans-serif;
               text-align:center;display:none"></span>
</button>
```

`#st-bell`에는 `position:relative`가 필요합니다(배지 기준점). Dawn의 `.header__icon`에 없으면
`assets/base.css` 또는 테마 커스텀 CSS에 `#st-bell{position:relative}` 한 줄을 추가하십시오.

> 선택자는 `#st-bell`이 아니어도 됩니다. 이미 종/알림 아이콘이 있다면 그 선택자를 §3에 그대로
> 적으면 됩니다. 허용 문자: `-_a-zA-Z0-9#.[]="':>, 공백` (최대 80자).

---

## 3. STEP 2 — 콘솔 설정 (테마 반영을 눈으로 확인한 뒤에)

콘솔 `https://shoptalk.amoeba.site` → `dev@amoeba.group`(테넌트 마스터) 로그인 →
**설정 → 위젯 → “위젯 테마” 카드**.

| 필드 | 값 |
|---|---|
| 런처 모드 | **스토어 헤더 트리거 — 사이트의 요소(예: 종 아이콘)로 열고 헤더 아래에 도킹** |
| 트리거 선택자 | `#st-bell` |
| 상단 오프셋 (px) | **68** (Dawn 헤더 61 + 여유 7 / 허용 0~240) |
| 브랜드 색·헤더·커스텀 위젯 | **건드리지 않음** (이미 ivyusa 값) |

[저장] → 성공 토스트 확인. 카드 하단의 복사용 스니펫과 §2.1이 일치하는지 눈으로 대조하십시오.

API로 하려면(브랜드 색은 필수 필드라 함께 보냅니다. `design`은 생략하면 유지):

```bash
curl -X PATCH https://shoptalk.amoeba.site/api/v1/tenants/widget-theme \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"brand":"#2D5BE3","header_style":"white",
       "launcher":{"position":"right","size":"md","icon":"chat",
                   "mode":"trigger","offsetTop":68,"triggerSelector":"#st-bell"}}'
```

---

## 4. STEP 3 — 검증 체크리스트

스토어프론트를 **강력 새로고침**(⌘⇧R)하고 확인합니다. 로더는 런처 설정을
`localStorage['ivy:launcher:ambshop-dev.myshopify.com']`, 위젯은 `ivy_theme:{shop}`에 캐시하므로
첫 로드에 직전 값이 잠깐 쓰일 수 있습니다.

| # | 항목 | 기대 결과 |
|---|---|---|
| 1 | 우하단 파란 버블 | **없음** (닫힘 프레임 0×0, 그 자리 클릭이 페이지에 그대로 전달) |
| 2 | 헤더 종 클릭 | 헤더 아래 **우측**에 패널이 열림(상단 68px, 패널 폭 380) |
| 3 | 미읽음 배지 | 종 위 빨간 배지 숫자 = 위젯 미읽음 수, 0이면 숨김, 99 초과 `99+` |
| 4 | 종 재클릭 / 패널 바깥 클릭 | 닫힘 (여는 클릭이 즉시 닫지 않도록 300ms 보호) |
| 5 | 패널 헤더 | 흰색 · “IVY Beauty” · 톱니만 — **X·언어 pill 없음**(트리거 모드) |
| 6 | 채팅 첫 화면 | **카드형** 빠른 답장 4개(My Orders / Product Help / Contact Support / How to become an Affiliate) |
| 7 | 좁은 화면(<640px) | `compact=1`로 헤더 **X 버튼 유지** — 모바일에서 닫을 수 있는지 반드시 확인 |
| 8 | 스크롤 | 스티키 헤더가 줄거나 숨는 설정이면 패널이 헤더와 어긋남 → 오프셋 재조정 또는 스티키 설정 점검 |
| 9 | 브라우저 콘솔 | `launcher trigger … was not found` 경고가 **없어야** 함. 뜨면 선택자 불일치(§5) |
| 10 | 로그인 왕복 | 위젯 → 로그인 → 스토어 복귀 시 위젯이 주문 탭으로 재오픈 |
| 11 | 로그인 페이지 | 위젯이 **마운트되지 않음**(의도된 동작) |

---

## 5. 롤백 (30초)

콘솔 **설정 → 위젯 → 런처 모드 = “떠 있는 버튼 (기본)”** → 저장. 끝.
테마의 종·스니펫은 그대로 두어도 안전합니다 — 떠 있는 버튼으로 돌아가고, 종은 클릭해도
위젯을 열지 못하는 장식 요소가 됩니다(제거 권장, 필수 아님).

반대로 **테마만 되돌리고 콘솔을 트리거로 남겨도** 잠기지 않습니다: 로더가 요소 없음을 감지해
떠 있는 버튼으로 폴백하고 콘솔에 경고를 남깁니다(FIX-260916).

---

## 6. 함정 · 주의 (겪은 것만)

| 함정 | 내용 |
|---|---|
| **순서 역전** | 콘솔을 먼저 트리거로 바꾸면 여는 수단이 없어짐 → 폴백은 되지만 전환이 안 된 것처럼 보임. 테마 먼저. |
| **선택자 오타** | `#st-bell` vs `.st-bell` 한 글자 차이로 즉시 폴백. 콘솔 경고 문구에 실제 선택자가 찍히니 그것으로 대조. |
| **종이 늦게 그려짐** | 로더는 약 3.6초만 기다림. 종 주입 스크립트를 embed.js **위**에 두십시오. |
| **`/widget` 누락** | `widgetUrl`/스크립트 주소에서 빠지면 SPA 폴백이 **200 + HTML** 반환 → “에러 없는 실패”. 200은 검증 근거가 아님(FIX-260917). |
| **캐시** | `ivy:launcher:{shop}`·`ivy_theme:{shop}` 때문에 첫 로드가 직전 모습일 수 있음 → 강력 새로고침. |
| **오프셋은 고정값** | 패널은 뷰포트 상단에서 `offsetTop`px 지점에 고정(헤더를 추적하지 않음). 헤더가 스크롤에 따라 크기가 변하면 어긋남. |
| **구 전역명** | `IVY_WIDGET_CONFIG`도 계속 동작. 둘 다 있으면 `SHARPTALK_WIDGET_CONFIG`가 이김 — 교체 시 **구 블록을 지우십시오**(중복 방치 금지). |
| **테마 편집기** | 방법 A는 헤더 재렌더 시 종이 사라질 수 있음(편집 중 한정). 프로덕션 테마는 방법 B 권장. |

---

## 7. 프로덕션 스토어로 옮길 때 추가로 필요한 것

현재 이 스토어는 **스테이징(`shoptalk.amoeba.site`)** 에 붙어 있습니다.
프로덕션(`sharptalk.amoeba.site`)은 **이 스토어를 아직 모릅니다** — 실조회 결과
`session/ensure` → `E5005 Unknown shop domain`(2026-09-20).

옮기려면 아래가 모두 필요합니다(이 가이드의 범위 밖, 별도 작업).

- [ ] 프로덕션에 ivyusa 테넌트 생성/이관 + `shop_domain = ambshop-dev.myshopify.com`
- [ ] 위젯 테마·커스텀 위젯 “IVY Figma”·탭·문구·시나리오 이관(내보내기/가져오기 또는 재설정)
- [ ] Shopify 앱: `shopify.app.toml`의 `application_url`·redirect·App Proxy가 스테이징을 가리킴 →
      프로덕션 앱(또는 URL 전환) 필요, OAuth 재설치
- [ ] 임베드 오리진 등록(프로덕션에 별도 등록 필요 — ACM 사례 참조)
- [ ] 스니펫 2줄(`widgetUrl`, `script src`)을 프로덕션 주소로 교체
- [ ] 로더 배포 동일성 확인: 두 호스트의 `/widget/embed.js`는 2026-09-20 기준 **바이트 동일**(43,036B, 트리거 폴백 포함)

---

## 8. 정리 대상 (선택)

- `widget_designs`에 **“IVY Figma (copy)” (id 6)** 가 9/17 모서리 토큰 검증 때 남아 있습니다.
  혼동 방지를 위해 보관 또는 삭제 권장(사용 중 디자인은 id 5).
- Figma의 “AI 요약” 버튼은 용도 미확정으로 여전히 범위 밖(RPT-260916 §5).

---

## 부록 A. 동작 원리 한 줄 요약

| 계약 주체 | 책임 |
|---|---|
| **콘솔(테넌트 설정)** | “트리거 모드로 연다”는 **의도**와 오프셋·선택자를 선언 |
| **스토어 테마** | 여는 **요소**(`#st-bell`)와 배지 자리(`[data-sharptalk-badge]`)를 제공 |
| **로더(embed.js)** | 요소 확인 → 없으면 유예(6×600ms) → 폴백(떠 있는 버튼) → 콘솔 경고 |
| **위젯(iframe)** | 패널 렌더, 미읽음 수 통지(`ivy:unread`), 트리거 모드에서 X·언어 pill 숨김 |

## 부록 B. 이번 조사에 쓴 확인 명령

```bash
# 테넌트가 위젯에 내려보내는 실제 값 (공개 엔드포인트)
curl -sS -X POST https://shoptalk.amoeba.site/api/v1/session/ensure \
  -H 'Content-Type: application/json' \
  -d '{"shop_domain":"ambshop-dev.myshopify.com","language":"en"}'

# 배포된 로더에 트리거 폴백이 들어 있는지
curl -sS https://shoptalk.amoeba.site/widget/embed.js | grep -c trigger-missing

# 스토어가 쓰는 전역명·로더 출처: 스토어프론트 브라우저 콘솔 확인
#   → "[SharpTalk] IVY_WIDGET_CONFIG still works…" (shoptalk.amoeba.site/widget/embed.js:106)
```
