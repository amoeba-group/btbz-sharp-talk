# PLN-261023 — 위젯 하단 AI 고지 문구 테넌트 설정 (go2joy)

- REQ: `docs/analysis/REQ-261023-Widget-Disclosure-Line-Copy.md`
- 상태: **승인됨 (2026-10-23, 권장안 D1~D4)**

## 결정 사항

| # | 결정 | 권장안 | 대안 |
|---|---|---|---|
| D1 | 적용 범위 | **테넌트 설정(`widget_copy.disclosureLine`, 언어별)** — go2joy만 바뀌고 다른 테넌트는 현행 | 위젯 기본 문구 자체를 교체(전 테넌트 변경, 약관 링크 없는 테넌트엔 어색) |
| D2 | 링크 위치 표시 | **대괄호로 링크 부분 표시**: `Created by AI; apply [terms of service]` → 대괄호 안이 약관 링크. 대괄호가 없으면 문구 뒤에 지금처럼 ` · 이용약관` 링크 | 문구 전체를 링크로 / 링크 문구 칸을 따로 둠 |
| D3 | 처리 지역 표기 | **새 문구 그대로(지역 생략)** — 동의 안내 본문에 "미국 소재 AI 제공자 처리"가 남아 지역 고지는 유지 | 문구 끝에 지역 자동 덧붙임 |
| D4 | 상단 배치 테넌트 | **같은 설정이 상단 고지 줄에도 적용**(배치만 다르고 같은 고지) | 하단 전용 |

## 화면 (ASCII 와이어프레임)

### 콘솔 설정 › 위젯 › 동작 카드 (기존 언어 탭 문구 목록에 한 줄 추가)
```
 [EN] [ES] [KO] [VI] [JA] [ZH]
 ...
 AI 발신자 이름      [______________________]
 상담원 발신자 이름   [______________________]
 런처 말풍선         [______________________]
 AI 고지 문구        [Created by AI; apply [terms of service]        ]   ← 신규
   채팅 상단/하단 AI 안내 줄. [대괄호] 부분이 약관 링크가 됩니다. 비우면 기본 문구.
   기본 문구: AI-generated replies · processed in the United States
                                                         [저장]
```

### 위젯 하단 (go2joy, EN)
```
현행                                                   변경 후
│ [메시지를 입력하세요…]               (➤) │          │ [Type a message…]                    (➤) │
│ AI-generated replies · processed in the │          │  Created by AI; apply terms of service   │
│   United States · terms of service      │          │                       ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾ 링크│
```
VI `Được tạo bởi AI, áp dụng [điều khoản dịch vụ]` · KO `AI가 생성함, [서비스 이용 약관]이 적용됩니다`
링크 → `https://go2joy.vn/vi-vn/policy?tab=terms-of-use` (새 탭).

## 단계
### S1 — 타입·API (스키마 변경 없음)
- `WidgetCopy.disclosureLine?: WidgetCopyText` (packages/types), API DTO `disclosure_line_{en,es,ko,vi,ja,zh}`(최대 160자), 서비스 setLang·정리 루프·mapper·세션 응답 `widgetCopy`에 포함 — 기존 `launcherTeaser` 경로 그대로.
- 단위 테스트: 저장·빈 값 제거·응답 포함.

### S2 — 위젯
- `ChatTab.tsx` 상·하단 고지 줄: `pickCopy(widgetCopy.disclosureLine, language)` 있으면 그 문구.
  - `[…]` 첫 쌍 → 약관 링크(`termsUrl || privacyPolicyUrl`), 링크 URL이 없으면 대괄호만 지우고 평문.
  - 대괄호 없으면 문구 + 기존 ` · 이용약관` 링크.
  - #724의 "개인정보 설정" 링크(설정 버튼 숨김 시)는 그대로 뒤에 붙음.
- 텍스트는 React 텍스트 노드로만 렌더(HTML 해석 없음).

### S3 — 콘솔
- 동작 카드 `copyLine('disclosureLine', 160)` + 기본 문구 표시, 라벨·힌트 6개 언어, `i18n:check`.

### S4 — go2joy 설정 적용 (스테이징 → 프로덕션)
- 콘솔(또는 API)로 EN/VI/KO 문구 저장, 약관 URL `https://go2joy.vn/vi-vn/policy?tab=terms-of-use` 확인·설정.
- 실측: go2joy 임베드 페이지에서 언어별 하단 줄·링크 이동 확인.

### S5 — TCR → RPT

## 사이드 임팩트
| 영역 | 영향 |
|---|---|
| 다른 테넌트 | 없음(설정 없으면 기본 문구) |
| 설정 스냅샷·디자인 패키지 | `widget_copy` 통째 저장이라 키 추가만으로 따라감 |
| 지역 고지(G7) | go2joy 하단 줄에서 지역 빠짐 — 동의 안내 본문에는 유지(D3) |
| #724 | 같은 고지 줄을 건드림 → #724 머지 후 main에서 분기 |

## 배포
스키마 변경 없음 → SQL 선적용 불필요. 코드 배포 후 go2joy 설정 저장(운영 데이터 변경).
