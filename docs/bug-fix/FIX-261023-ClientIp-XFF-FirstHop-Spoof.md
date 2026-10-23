# FIX-261023 — 클라이언트 IP를 브라우저가 위조할 수 있던 결함 (X-Forwarded-For 첫 hop)

- 발견: RPT-261023-LiveChat-Search-IP-SessionNo-B2BLink 스테이징 실측(보안 후속)
- 관련: PR #567(위젯 노출 제한), FIX-261002, PLN-261023 S2(`trustedClientIp`)

## 증상
스테이징 ivyusa(노출 제한 켜짐, 허용 IP 1개)에 `X-Forwarded-For: 6.6.6.6` 헤더만 붙여 위젯 ensure를 호출하자 판정이 바뀌어 E5092로 거부됐다. 거꾸로 **허용 IP를 헤더에 적으면 제한을 통과**할 수 있다는 뜻이다.

## 근본 원인
프록시 구성은 host nginx → stack nginx → API이고, 두 nginx 모두 `$proxy_add_x_forwarded_for`로 **오른쪽에 덧붙인다**. API가 받는 값은 `<브라우저가 보낸 값…>, <실제 접속 IP>, <host nginx>`다. 그런데 IP를 읽는 네 곳이 모두 **가장 왼쪽(첫 hop)** 을 읽었다. 이 자리는 브라우저가 마음대로 쓸 수 있다.

| 읽는 곳 | 영향 |
|---|---|
| `RequestContextMiddleware` → `ctx.ip` | 위젯 노출 제한 판정 2곳(`widget-branding.controller` visibility, `session.service` ensure), 감사 로그 `audit_logs.ip`, 노출 제한 로그 |
| `XffThrottlerGuard.getTracker` | 전역 스로틀 — 요청마다 헤더를 바꾸면 매번 새 창 |
| `auth.controller` `clientIp()` | 로그인·MFA·SSO의 계정+IP 시도 제한 우회 |

PLN-261023 S2에서 세션 IP용으로 오른쪽부터 읽는 `trustedClientIp`(hop 2)를 만들었지만, 판정이 달라질 수 있어 기존 `ip`는 그대로 두었었다.

## 수정
- 요청 컨텍스트의 `ip`를 `trustedClientIp(xff, req.ip)`로 바꾸고, 따로 있던 `clientIp` 필드는 없앴다. 세션 IP 기록은 이제 `ip`를 읽는다.
- `XffThrottlerGuard`와 `auth.controller`의 `clientIp()`도 같은 함수를 쓴다. 이제 "누구인가"를 읽는 방법은 하나다.
- 스키마 변경 없음, UI 영향 없음.

## 판정 영향
- 헤더를 보내지 않는 정상 브라우저는 체인이 `<실제 IP>, <host nginx>`라서 첫 hop과 결과가 같다. 판정이 바뀌지 않는다.
- 달라지는 경우는 클라이언트 쪽 프록시가 XFF를 붙이는 접속(사내 프록시 등)뿐이다. 이때는 내부 주소 대신 그 프록시의 공인 IP가 읽힌다.
- 배포 전 확인: 프로덕션에는 IP 허용 목록을 쓰는 테넌트가 0곳이다. 스테이징은 ivyusa 1곳(IP 1개)이다. 양쪽 `audit_logs`에 사설 대역(10./172./192.168.) IP 기록도 없다.
- 로그인 시도 제한은 키가 바뀌는 순간 진행 중이던 카운터가 사실상 초기화된다(배포 시 1회).

## 테스트
- 신규 `global/middleware/client-ip-spoof.spec.ts`:
  - 미들웨어가 위조 첫 hop을 무시한다.
  - 허용 IP를 위조해도 노출 제한을 통과하지 못하고, 정상 접속은 통과한다.
  - 헤더를 바꿔도 스로틀 키가 그대로다.
- `npx jest`(api) 253 suites / 2,550 tests 통과, `tsc --noEmit` 통과.

## 재발 방지 패턴
- **프록시 헤더는 오른쪽부터 신뢰 hop 수만큼만 읽는다.** 첫 hop은 클라이언트의 주장일 뿐이다. 신뢰 경계에 놓이는 값(허용 목록, 시도 제한, 감사)은 반드시 우리 프록시가 쓴 자리에서 읽는다.
- **같은 개념을 읽는 방법은 하나만 둔다.** 이번 결함은 같은 파싱이 3곳에 복사돼 있어 함께 남아 있었다. 새 읽기 방법을 만들면 기존 읽는 곳을 함께 옮기거나, 옮기지 않은 곳을 후속으로 명시한다.
- 프록시 hop 수(`TRUSTED_PROXY_HOPS=2`)가 바뀌는 배포(nginx 1단 설치 등)에서는 이 값을 함께 확인한다. 체인이 짧으면 가장 왼쪽으로 폴백한다.

## 배포 상태
- PR #713 → main `4929d5d9`. 스키마 변경이 없어 SQL은 적용하지 않음.

| 환경 | 코드 | 검증 |
|---|---|---|
| 스테이징 | ✅ 10/23 `deploy-staging.sh` (`4929d5d9`) | API healthy·`successfully started`·ERROR 0. ivyusa(허용 IP 1개) visibility: 허용 IP에서 헤더 없음/`XFF 6.6.6.6` 모두 visible·읽힌 IP 동일(수정 전엔 위조로 거부됨). 허용 밖(스테이징 서버)에서 `XFF: <허용 IP>`로 위조 → visible=false·읽힌 IP=서버 실제 IP(우회 차단) |
| 프로덕션 | ✅ 10/23 `production` ff `68c42bb6..3edea378`(#714 문서 동승) → `deploy-self-hosted.sh`(applied 107, 누락 0) | API healthy·`successfully started`·ERROR 0. visibility `yourIp`: 헤더 없음/`XFF 6.6.6.6` 모두 실제 공인 IP → 프로덕션 프록시 체인도 hop 2 일치 |
