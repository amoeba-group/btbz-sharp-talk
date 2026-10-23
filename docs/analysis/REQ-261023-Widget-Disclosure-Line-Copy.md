# REQ-261023 — 위젯 하단 AI 고지 문구 테넌트 설정 (go2joy)

## 요구사항 (원문)
> 채팅 위젯 하단에 `AI-generated replies · processed in the United States` 위치에 아래 문구 적용 (영어/베트남어/한국어)
> - Created by AI; apply terms of service
> - Được tạo bởi AI, áp dụng điều khoản dịch vụ
> - AI가 생성함, 서비스 이용 약관이 적용됩니다
>
> 약관 링크: https://go2joy.vn/vi-vn/policy?tab=terms-of-use

## AS-IS
- 하단 고지 줄(`disclosurePlacement=bottom`, go2joy) = `chat.aiDisclosureShort` + (약관 URL이 있으면) ` · terms of service` 링크
  — `apps/widget/src/components/chat/ChatTab.tsx` 하단 블록.
- 문구는 **위젯 번들 고정**(6개 언어 공통). 테넌트가 바꿀 수 있는 설정이 없음.
  - en `AI-generated replies · processed in {{region}}` / vi `Được tạo bởi AI · xử lý tại {{region}}` / ko `AI가 생성한 답변 · {{region}}에서 처리`
- 약관 URL = `tenants.terms_url`(콘솔 개인정보 고지 화면에서 설정), 없으면 개인정보처리방침 URL.
- 테넌트별 위젯 문구는 `tenants.widget_copy`(언어별 bag: headerTitle·headerGreeting·aiSenderName·agentSenderName·launcherTeaser)에 있고, 콘솔 설정 › 위젯 › 동작 카드에서 언어 탭별로 편집.

## TO-BE
1. 테넌트가 고지 줄 문구를 언어별로 지정 → 지정한 언어는 그 문구, 나머지 언어는 기본 문구.
2. 문구 안의 "terms of service / điều khoản dịch vụ / 서비스 이용 약관" 부분이 약관 링크.
3. go2joy(스테이징·프로덕션)에 EN/VI/KO 문구 + 약관 URL 적용.

## 갭
| # | 갭 | 영향 |
|---|---|---|
| G1 | 고지 줄 문구 테넌트 설정 없음 | 타입·API·콘솔·위젯 |
| G2 | 문구 일부를 링크로 만드는 방법 없음(현재는 뒤에 붙는 별도 링크) | 위젯 렌더 |
| G3 | 새 문구에는 처리 지역(미국)이 빠짐 | 지역 고지(REQ-260913 G7) — 동의 안내 본문("미국 소재 AI 제공자가 처리")에는 그대로 남음 |
| G4 | go2joy 약관 URL 값 확인·설정 | 운영 설정(스테이징·프로덕션) |

## 사용자 흐름
운영자 → 설정 › 위젯 › 동작 카드 → 언어 탭 EN → "AI 고지 문구"에 `Created by AI; apply [terms of service]` → VI·KO도 입력 → 저장(토스트)
→ 개인정보 고지 화면에서 약관 URL 입력 → 위젯 하단 줄이 새 문구, 대괄호 부분이 약관 링크.

## 제약
- 다른 테넌트 무영향(설정 없으면 현행 기본 문구).
- i18n 6개 언어(콘솔 라벨), 저장 토스트 필수. JSON 컬럼 키 추가라 스키마 변경 없음.
