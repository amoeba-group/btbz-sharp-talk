# PLN-261019 — go2joy HA: 동의 배너 생략(호스트 약관) · 헤더 로그인 사용자 이름

- 근거: [REQ-261019-Go2Joy-HA-Consent-Skip-Header-Name](../analysis/REQ-261019-Go2Joy-HA-Consent-Skip-Header-Name.md)
- **UI 변경 있음**(§4 — 헤더 제목 자리, 콘솔 문구 행 1개). **스키마 변경 없음.**
- 전제 결정(REQ §5 제안): D1ⓐ 서명 identify · D2 name 덮어씀 · D3 이름만 · D4 서명 전 배너 유지
- 상태: **승인 대기** — 승인 전 구현하지 않음

## 1. 단계

### P1 — 설정 (코드 없음)
- 스테이징 테넌트 4: `consent_source = 'host_terms'`(설정 › 개인정보 안내 › 동의 방식 "호스트 앱 약관"). 서명 identify가 오기 전까지는 화면 변화 없음(C3).
- Go2Joy에서 약관 URL·버전 문자열을 받으면 `privacy_policy_url`·`consent_notice_version` 설정 — 고지 버전은 세션 동의 기록에 남는 값.

### P2 — 코드 (소)
- `widget_copy.headerGreeting`: `Record<lang,string>`, `{name}` 자리표시자. `packages/types` `WidgetCopy`, API 엔티티·DTO(`header_greeting_{6}` MaxLength 80)·`mergeWidgetCopy`·매퍼·세션 `widgetCopy` 전달(#650과 같은 패턴). 위젯 `WidgetPanel`: `customerName`이 있을 때 `pickCopy(headerGreeting, lang)`이 있으면 `fill(…, '{name}', customerName)`, 없으면 내장 `header.greeting`. 콘솔 문구 카드에 "로그인 사용자 인사말" 행(힌트: `{name}`만 적으면 이름만 표시).
- `EmbedService.identify`: `name`이 비어 있지 않으면 고객 표시명을 갱신(현행 "빈 칸만 채움" → 덮어씀). 이메일·전화는 현행 유지. `embed.service.spec` 케이스 추가(이름 변경 반영, 빈 name은 무시).
- 세션 응답 `customerName`은 갱신된 이름을 돌려줌(기존 경로).
- 테스트: `tenant.service.spec`(headerGreeting bag), `embed.service.spec`, i18n:check.

### P3 — Go2Joy 통합 안내 (문서)
- `docs/guide/GUIDE-261019-Go2Joy-HA-Identify.md`(ko/vi 요지): HA 로그인 완료 시점에 서버가 `hash = HMAC-SHA256(embed_secret, "<userId>\nhotel_id=…\nregion=…\nrole=…")`를 내려주고, 페이지가 `ShopTalk.identify({ userId, hash, name: <profile 이름>, attributes })`를 호출. 로그아웃 시 `ShopTalk.reset()`(가이드 §4). 시크릿 전달 경로(스테이징 `secrets/`, 프로덕션 별도 발급).
- 체크리스트: 서명 실패 시 401 → 게스트로 계속(배너 표시) — "이름이 안 뜨면 서명부터 의심".

### P4 — 검증·RPT
- 스테이징 시크릿으로 서명한 identify를 로컬 점검 페이지(#650 때와 같은 페이지)에서 호출: 배너 없음, 세션 `consent_state=granted`·`consent_version`·`identity_level=verified`, 헤더 `[G2J] <이름>`, API 로그 `consent via host terms`. 미서명 페이지는 배너 그대로(G7). RPT-261019.

## 2. 사이드 임팩트
| 영역 | 영향 | 대응 |
|---|---|---|
| 다른 테넌트 | `headerGreeting` 비어 있음 = 현행 인사말, identify `name` 덮어쓰기는 **서명된 호스트가 보낸 값**만 | 스펙으로 고정 |
| 고객 레코드 | 콘솔 고객 정보의 이름이 HA 프로필을 따라 바뀜 | 의도된 동작(HA가 원천), 감사 로그 불필요(기존 identify 로그에 포함) |
| 동의 통계 | host_terms 동의는 `consent_source`로 구분 가능(기존 D9 컬럼) | — |
| 보안 | `name`은 미서명 → 표시 외 용도 금지(C2) | 코드 주석·가이드 명시 |

## 3. 리스크
- Go2Joy 서명 구현이 늦어지면 배너가 계속 보인다 — P1·P2를 먼저 끝내 두고, 서명이 붙는 순간 바로 반영되게 한다(코드·설정 대기 상태).
- HA가 `name`에 빈 문자열이나 이메일을 넣으면 헤더가 어색 — 빈 값 무시, 가이드에 "표시 이름" 명시.

## 4. 와이어프레임
```
현재(미서명)                                   변경 후(서명 identify + host_terms + headerGreeting="{name}")
┌──────────────────────────────────┐           ┌──────────────────────────────────┐
│ G2J Trung tâm hỗ trợ   (🌐VI)(⚙)(X)│           │ G2J Nguyễn Văn A       (🌐VI)(⚙)(X)│ ← 이름만
│ ┌ 개인정보 처리 안내 2026-07 ──────┐ │           │ 🤖 JoyBot - Tổng đài viên AI      │ ← 배너 없음
│ │ CCPA에 따라 … 동의하시겠습니까?  │ │           │    Xin chào Quý đối tác, …        │
│ │ • 수집 항목 … • AI 처리 …        │ │           │ (Xem đặt phòng hôm nay) (…)      │
│ │ [동의]            [거부]         │ │           └──────────────────────────────────┘
│ └──────────────────────────────────┘ │
└──────────────────────────────────┘
콘솔 › 설정 › 개인정보 안내: 동의 방식 ( )위젯 배너 (●)호스트 앱 약관   약관 URL [        ]  고지 버전 [      ]
콘솔 › 설정 › 위젯 문구: 로그인 사용자 인사말 [{name}            ]  (힌트: {name}=이름, 비우면 "Chào {name}")
HA 페이지(Go2Joy):  로그인 완료 → ShopTalk.identify({ userId, hash, name: profile.name, attributes:{hotel_id, region, role} })
```

## 5. 승인 요청
- D1ⓐ: 배너 생략은 **서명된 로그인 사용자**에게만 일어납니다. Go2Joy가 HA 서버에서 서명을 붙여야 하며, 그 전까지는 배너가 유지됩니다(D4). 미서명 전원 생략(ⓑ)을 원하시면 알려 주세요 — 동의 우회 위험을 안고 가는 결정입니다.
- 승인 시 P1·P2는 오늘 처리하고, P3 가이드를 Go2Joy에 전달할 수 있게 준비합니다.
