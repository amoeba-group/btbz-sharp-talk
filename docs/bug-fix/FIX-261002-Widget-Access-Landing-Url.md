# FIX-261002 — 노출 제한의 URL 규칙이 실 위젯에서 한 번도 매칭되지 않았다

- 신고(2026-10-02): "14.161.40.143에서 접속했으나 위젯 노출 안 됨"
- 영향: 노출 제한을 켠 테넌트에서 **허용 URL 규칙이 무효**. IP·초대키만 실제로 동작했다.
- 관련: REQ/PLN-260929(노출 제한) · FIX-261002-Wildcard(같은 날 `*.host` 미지원 수정)

## 1. 증상과 단서

사용자 IP를 허용 목록에 넣었는데도 스토어에서 위젯이 뜨지 않았다. 스토어 도메인을
허용 URL에 추가하자 **보이기는** 했다. API 로그에 결정적 단서가 있었다.

```
WARN widget access denied (tenant 1, page https://ambshop-dev.myshopify.comhttps://ambshop-dev.myshopify.com/)
                                              └──────────── 오리진 ────────────┘└──────── 또 전체 URL ────────┘
```

## 2. 근본 원인

`session/ensure`의 권위 판정에서 페이지 URL을 이렇게 만들었다.

```ts
const pageUrl = parentOrigin ? `${parentOrigin}${landingPath ?? ''}` : null;
```

이름이 `landing_path`라 **경로**인 줄 알았는데, 로더는 전체 URL을 보낸다.

```js
out.push('ivy_land=' + encodeURIComponent(String(window.location.href)…));
```

그래서 두 개가 이어붙어 어떤 규칙에도 맞지 않는 문자열이 됐다. **내 curl 검증은
`landing_path: "/"`를 손으로 넣어 통과했고**, 실 위젯만 실패했다 — 검증이 현실과 다른
입력을 쓴 전형적인 경우다.

### 왜 "스토어 도메인을 추가하니 보였나"

로더의 노출 판정(`/public/widget/visibility`)은 **자기 페이지 URL을 직접** 만든다
(`location.origin + location.pathname`) — 이쪽은 정상이었다. 그래서 화면에는 떴고,
세션 발급(ensure)은 계속 거절당하는 **"위젯은 보이는데 대화가 안 되는"** 상태였다.
노출 제한을 설계할 때 피하려던 바로 그 모양이다.

## 3. 수정

```ts
// 이미 절대 URL이면 그대로 쓰고, 진짜 경로일 때만 오리진에 잇는다.
const normalised = normalizeLandingPath(landingPath);
const pageUrl = normalised ?? (parentOrigin ? `${parentOrigin}${landingPath?.startsWith('/') ? landingPath : ''}` : null);
```

- 정규화는 이미 있던 `normalizeLandingPath`(쿼리 제거·스킴 검증)를 재사용한다.
- `skipUrlRule`도 `!parentOrigin` → **`!pageUrl`**로 바꿨다. 부모 오리진이 없어도
  랜딩 URL만 있으면 URL 규칙을 적용할 수 있다.
- 거절 로그에 **클라이언트 IP를 포함**했다. "이 방문자는 왜 안 보이나"를 답하는 데
  로그 고고학이 한 번 필요했다.

## 4. 테스트

신규 3건: 실 위젯이 보내는 **전체 URL**로 허용 규칙 매칭 · 규칙 밖 전체 URL은 거절 ·
부모 오리진 없이 랜딩 URL만으로 매칭. 기존 8건 유지(총 11).

## 5. 예방 패턴

**검증 입력은 실제 클라이언트가 보내는 것과 같아야 한다.** `landing_path`라는 이름만 보고
경로를 손으로 넣어 테스트했고, 이름이 거짓말을 하는 바람에 결함이 그대로 배포됐다.
계약 필드의 **이름이 아니라 실제 값**을 확인할 것 — 가능하면 클라이언트 코드에서 그 값을
만드는 지점을 직접 읽을 것.

부가: 두 층 판정(로더=화면, 서버=데이터)은 한쪽만 틀리면 **"보이는데 안 되는"** 상태를 만든다.
두 층이 같은 입력으로 같은 판정을 하는지 실 요청으로 확인해야 한다.
