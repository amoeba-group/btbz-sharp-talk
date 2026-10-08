# PLN-261008 — 채팅 마크다운 보기 모드 표시

- 근거: [REQ-261008-Chat-Markdown-Render](../analysis/REQ-261008-Chat-Markdown-Render.md)
- **UI 변경 있음**(§3). **스키마 변경 없음.**
- 상태: **승인 대기**

## 1. 설계
```
packages/common/src/utils/markdown-lite.ts   (순수 함수, 의존성 0)
  parseLiteMarkdown(text) → Block[]
     Block  = { type:'p', lines: Inline[][] } | { type:'ul'|'ol', items: Inline[][] }
     Inline = text | strong | em | code | link(http/https URL)
  stripLiteMarkdown(text) → 평문     (미리보기·메신저 발송용)
        │                                   │
apps/widget  <RichText>  ─┐          apps/api  messenger-outbox: 발송 직전 stripLiteMarkdown
apps/web     <RichText>  ─┘          apps/web  목록 미리보기: stripLiteMarkdown
(React 요소로만 렌더 — HTML 미해석)
```
- 지원 문법: `**굵게**`·`__굵게__`, `*기울임*`·`_기울임_`(단어 경계에서만), `` `코드` ``, 줄 시작 `- `/`* `/`• ` 글머리표, `1. ` 번호 목록, 맨 URL 자동 링크, 빈 줄 = 문단 구분, 줄바꿈 유지
- 지원하지 않음: 제목 `#`, 표, 이미지, HTML — 원문 글자로 보인다(7일간 제목 0건, 표 1건)
- 닫히지 않은 `**`(예: `**주의`)는 글자 그대로 둔다

## 2. 단계
- **S1** 파서 `markdown-lite.ts` + 단위 테스트(굵게/기울임/코드/목록/번호/URL/미닫힘/HTML 문자열/`2 * 3 * 4` 같은 오탐 방지/스트립)
- **S2** 위젯 `RichText` 컴포넌트 → `MessageBubble`(AI·상담원·시스템 메시지). **고객 메시지는 원문 그대로**(D1)
- **S3** 콘솔 `RichText` → 라이브챗 대화창 · 대화 기록 · AI 설정 미리보기 · 이슈 미리보기(같은 규칙)
- **S4** 콘솔 라이브챗 목록 한 줄 미리보기 → `stripLiteMarkdown`
- **S5** 메신저 발송 → `stripLiteMarkdown`(D2). 위젯·콘솔 저장 원문은 그대로

## 3. 와이어프레임 (위젯 말풍선 — 콘솔 대화창도 같은 렌더)
```
현재                                         변경 후
┌──────────────────────────────────────┐    ┌──────────────────────────────────────┐
│ Kính chào Quý Khách Sạn,             │    │ Kính chào Quý Khách Sạn,             │
│ **1. Đăng xuất và đăng nhập lại:**   │    │ 1. Đăng xuất và đăng nhập lại:  ← 굵게│
│ - **Email:** support@go2joy.vn       │    │  • Email: support@go2joy.vn          │
│ - **Hotline:** 1900 638 838          │    │      └ "Email:" 굵게                  │
│ Vào `Quản lý đặt phòng` > Tìm kiếm   │    │  • Hotline: 1900 638 838             │
│ https://bit.ly/3YZ8egt               │    │ Vào [Quản lý đặt phòng] > Tìm kiếm   │
└──────────────────────────────────────┘    │      └ 회색 배경 코드 서식             │
                                             │ https://bit.ly/3YZ8egt  ← 링크(새 탭) │
                                             └──────────────────────────────────────┘
라이브챗 목록 미리보기:  "**Số tài khoản:** 1913…"  →  "Số tài khoản: 1913…"
카카오/잘로 발송:       "- **Email:** support@…"   →  "• Email: support@…"
```

## 4. 영향
| 영역 | 영향 | 대응 |
|---|---|---|
| 보안(XSS) | 메시지에 HTML이 들어와도 | React 텍스트 노드로만 렌더, URL은 http/https만 |
| 위젯 번들 | 파서 수 KB | 외부 라이브러리 미사용 |
| 오탐 | `2 * 3 * 4`, `file_name_v2` | 기울임은 단어 경계·공백 규칙, 테스트로 고정 |
| 회귀 채점(R7) | 채점은 저장 원문 기준 | 변경 없음 |
| 상담원 복사·번역 | 원문 기준 | 변경 없음 |

## 5. 결정 필요
- **D1. 고객이 입력한 메시지** — 권장: **원문 그대로**(고객이 쓴 `*`가 의도치 않게 서식이 되지 않도록). AI·상담원·시스템 메시지만 서식 표시
- **D2. 메신저 채널 발송 평문화** — 권장: 포함(카카오·잘로 등에서 `**`가 그대로 보이는 문제를 같이 해결)
- **D3. 표** — 권장: 이번에는 미지원(7일간 1건). 필요해지면 후속
