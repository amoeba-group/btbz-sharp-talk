# TCR-260929 — 위젯 노출 제한 테스트 케이스·결과

- 근거: PLN-260929 §7 · PR #567(main `abcc655`)
- 환경: 로컬(jest/tsc/빌드) + **스테이징 실측**(`shoptalk.amoeba.site`, 테넌트 ivyusa)

## 1. 단위 — 신규 37건 (전부 통과)

### 1-1. 판정 엔진 22건 (`packages/types/src/common/widget-access.spec.ts`)

| 묶음 | 케이스 |
|---|---|
| IP | 단일 일치·불일치 · **CIDR 경계**(`/24`의 `.0`·`.255`·다음 블록) · `/32`·`/0` · IPv6 압축·`/32` 대역 · **`::ffff:v4` 듀얼스택 클라이언트가 v4 규칙에 매칭** · 잘못된 엔트리·빈 IP는 **절대 매칭 안 됨** |
| URL | 프리픽스·하위 경로 · **`/test`가 `/testing`·`/test-drive`를 삼키지 않음** · 쿼리·해시 무시 · 호스트만 대소문자 무시 · 호스트 전용 규칙 · 스킴·포트 불일치 · `*`는 와일드카드 아님 |
| 판정 | 제한 꺼짐 · **기간 밖이면 자동 해제** · 셋 다 불일치면 숨김 · **OR 진리표** · 기간은 AND · `skipUrlRule`이 URL 규칙만 끔 · 빈 키/미발급 키 |
| 정규화 | 파싱 실패 엔트리 드롭·중복 제거 · 미설정이면 null |

### 1-2. 저장 게이트 7건 · 판정 경로 8건

- 저장: 정상 저장+감사 · 잘못된 IP/CIDR 거절 · 잘못된 URL 거절 · **규칙 0개로 켜기 거절** ·
  초대키가 있으면 규칙 0개여도 허용 · 시작≥종료 거절 · 끄기는 목록을 지우지 않음
- ensure: 미설정 통과 · 불일치 403 · IP 허용 · **origin+landing_path로 URL 재구성** ·
  초대키 일치/불일치 · 기간 종료 후 통과 · **suspended 테넌트 거절** · parent origin 없으면 IP만으로 판정

회귀: api **1984/1984**(197 suites) · types **138/138** · `tsc` 4패키지 · 빌드 · `i18n:check` 6언어.

## 2. 통합 — 스테이징 실측 (2026-09-29)

SQL 선적용(`tenants.widget_access`·`widget_access_key`) 후 코드 배포, api `successfully started` 1회.

### 2-1. 기준선

```
제한 없음          → visible=true  restricted=false   (yourIp 반환)
Cache-Control      → no-store                          ← 판정은 캐시되지 않는다
알 수 없는 shop     → visible=true  restricted=false   ← 설치 오류를 차단으로 만들지 않는다
```

### 2-2. 제한 켬 (IP `203.0.113.7`, URL `…/collections/test`, 기간 ±1시간)

| # | 경우 | 노출 판정 | 세션(`ensure`) |
|---|---|---|---|
| ① | 허용 안 된 페이지·IP | **visible=false** | **E5092 거절** |
| ② | 허용 URL | visible=true | ok |
| ③ | 허용 URL 하위 경로 `/collections/test/item-1` | visible=true | — |
| ④ | **`/collections/testing`**(비슷한 이름) | **visible=false** | — |
| ⑦ | 초대키 소지(차단 페이지에서) | visible=true | ok |
| ⑧ | 틀린 키 | visible=false | — |
| ⑩ | **기간 종료 후** | **visible=true** (restricted=true, 사유 window) | ok |

→ 설계 의도와 전부 일치. 특히 ④가 `false`인 것이 이 기능의 핵심 안전장치다(부분일치 금지).

### 2-3. 검증 후 원복

검증용으로 켠 설정은 **즉시 원복**했다(FIX-260916에서 스테이징 설정을 켜둔 채 둬 실 스토어 위젯이
잠긴 전례). 원복 후: `visible=true restricted=false`, 세션 발급 정상.

## 3. 미수행

| 항목 | 사유 |
|---|---|
| 브라우저에서 "깜빡임 없이 사라지는지" 육안 확인 | 도킹 모드에서 자동화 클릭이 교차 오리진 iframe에 닿지 않음(RPT-260920 §6과 같은 제약). 로더 경로는 단위로만 검증 |
| 콘솔 카드 조작 실측 | 저장·검증·발급은 API로 확인. 화면은 육안 1회 필요 |
| 구 로더가 깔린 스토어 | 판정 요청을 보내지 않아 화면은 그대로 뜬다(설계) — 데이터는 ensure가 막는 것을 ①로 확인 |
