# FIX-260923 — 로그인한 쇼퍼의 위젯이 테넌트 탭 설정을 무시하고 기본 3탭을 그림

- 발견: REQ-260923-Ivyusa-Widget-Tabs-Chips-Track §2-2 (G1), PLN-260923 P0
- 영향: **스토어에 로그인한 모든 쇼퍼 × 모든 테넌트** — 탭 구성·탭 위치·로그인 방식·AI 처리 지역
  고지가 테넌트 설정이 아닌 내장 기본값으로 표시됨. 비로그인(게스트) 쇼퍼는 정상.

## 증상

| 관측 | 값 |
|---|---|
| `tenants(1).widget_tabs` | `["notifications","chat"]` |
| `POST /session/ensure`(shop=ambshop-dev) | `widgetTabs: ["notifications","chat"]` — 서버 정상 |
| ambshop-dev 스토어, "Test Customer" 로그인 상태 | **Notifications · Orders · Chat 3탭** |

## 근본 원인

위젯은 `/session/ensure`를 두 곳에서 부른다.

1. `useEnsureSession` — 익명 세션. 탭·로그인 방식·테마·문구·AI 지역을 모두 받아 적용.
2. `useSessionProfile` — 세션이 고객에 바인딩된 뒤 이름을 가져오는 재-ensure.

임베드에서 스토어 로그인 쇼퍼는 앱 프록시 핸드셰이크(`useEmbedIdentity`)가 검증된 토큰을
먼저 넘기고, `useEnsureSession`은 `authenticated`를 보고 **①을 아예 호출하지 않는다**(정상 설계 —
버려질 게스트 세션을 만들지 않기 위함). 그러면 이 쇼퍼의 유일한 ensure는 ②인데, ②는 과거 결함이
날 때마다 **필드를 하나씩** 덧붙여 왔다(문구 → 동의). 탭·로그인 방식·AI 지역은 아무도 옮기지 않아
스토어 초기값(`WIDGET_TABS_DEFAULT` = 3탭)이 그대로 남았다. 테마는 `/widget-design/live/{shop}.json`
선로딩 덕에 우연히 맞아 보였을 뿐이다.

추가로 ②는 `customerName`이 이미 있으면 실행하지 않는 조건이 있어, 이름이 먼저 채워지는 경로에서는
테넌트 설정을 받을 기회 자체가 없었다.

## 수정 (최소 변경)

- `adoptTenantConfig(res)` 하나로 **테넌트 설정 적용을 묶고** 두 호출 지점이 모두 이것을 부른다
  (탭·탭 위치·로그인 방식·테마·문구·AI 지역·`issueFeed`).
- `useSessionProfile`은 토큰당 1회 **이름 유무와 관계없이** 실행(요청 수는 그대로 토큰당 1회).
- 파일: `apps/widget/src/hooks/useSession.ts`, `apps/widget/src/hooks/useSessionProfile.ts`

## 검증

- 서버 응답 불변(`widgetTabs` 이미 정상) → 위젯 빌드 후 스테이징 스토어 로그인 상태에서 2탭 확인(RPT-260923).

## 예방 패턴

> **같은 응답을 받는 호출 지점이 둘 이상이면, 응답 → 상태 반영을 함수 하나로 만든다.**
> 필드를 호출 지점마다 복사하면 새 필드는 "먼저 떠오른 경로"에만 들어가고, 다른 경로의 사용자는
> 조용히 기본값을 본다. 이번 결함은 같은 파일에 "여기서도 문구를 적용해야 한다", "여기서도 동의를
> 적용해야 한다"는 주석이 이미 두 번 있었다 — 세 번째 필드를 찾는 대신 묶었어야 했다.
>
> 검증 쪽: **로그인/비로그인 두 상태로 모두 본다.** 임베드 검증 중 한쪽 상태만 보면 한 경로의 결함이
> 통째로 가려진다(미리보기 ≠ 임베드와 같은 계열).
