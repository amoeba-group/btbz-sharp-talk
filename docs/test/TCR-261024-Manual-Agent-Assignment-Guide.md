# TCR-261024 — 사용자 매뉴얼 07 상담원 배정 가이드

- PLN: `docs/plan/PLN-261024-Manual-Agent-Assignment-Guide.md` (D1~D5 권장안 승인)
- 실행일: 2026-10-24
- 환경: 로컬 API :3197 + 콘솔 :5183 + 위젯 :5186. 중간에 다른 세션이 :3099를 종료해 포트를 옮김.

## 1. 캡처 (Playwright, 17개 장면 × ko/en = 34장)

시연 데이터
- 팀: North(hn), South(hcm)
- 라벨: CS(cs), Sales(sa)
- 상담원
  - Minh Le: 로그인 계정, 팀 South, 라벨 Counsels·CS·Sales
  - Linh Tran: 시연 계정을 활성화, 팀 North, 라벨 Counsels·CS
- 상담카테고리: Customer Services / Business Support(언어별 이름 포함)
- 규칙: CS_North / CS_South / BS_North / BS_South / Default

| 장면 | 파일 | 확인 |
|---|---|---|
| 사용자 목록 · 사용자 편집 · 라벨 탭 · 팀 탭 | asg-users-list / user-edit / labels-units / units | 라벨·팀·active 표시 |
| 상담카테고리 관리 | asg-categories | 노출·언어별 이름·사용처 |
| 규칙 목록 · 규칙 편집 · 배정 확인 · 경고 | asg-rules-list / rule-edit / routing-check / rule-warnings | 배정 확인 "Customer Services · 남부 → #2 CS_South → Minh Le", BS_North 0명 경고 |
| 위젯 A 경로 | asg-widget-before / widget-connecting | 교환·반품 시나리오 답 → [상담원 연결] 칩 → 카드 → 고객 지원 → 연결 안내 |
| 위젯 B 경로 | asg-widget-after | "상담원 연결해 주세요" → AI 인계 + 카드 → 선택 시 재연결 |
| 알람(내 배정) | asg-alarm-mine | Saigon Riverside Hotel · 남부 · 배정: 나 · CS_South |
| 알람(다른 상담원) | asg-alarm-other | Hanoi Garden Hotel · 북부 · 배정: Linh Tran · 상담카테고리 선택으로 재연결 · CS_North |
| 알람센터 · 알람 설정 · 라이브챗 | asg-alarm-center / alarm-settings / livechat-assigned | 상담: Customer Services 배지와 시스템 줄 |

실제 배정 결과도 캡처와 일치했다.
- 남부 + Customer Services → CS_South → Minh Le
- 북부 + 인계 후 Customer Services → Default에서 CS_North로 재연결 → Linh Tran

캡처 중 바로잡은 것
- **인사말만으로 AI가 인계한 대화가 A 경로 장면에 섞였다.** 정형 시나리오(교환·반품) 답 뒤의 [상담원 연결] 칩으로 바꿨다.
- **경고·편집 장면이 바깥 카드를 잡아 엉뚱한 위치에서 찍혔다.** 선택자를 가장 안쪽 카드로 바꿨다.

## 2. 문서
- **본문**: ko 원문, en/vi 번역. 장·소절 수(11장)와 그림 17개, 표·체크리스트·FAQ 개수가 세 언어 모두 같다.
- **화면 문구**: en/vi는 콘솔·위젯의 locale 표기와 대조했다.
- **HTML 변환**: `scripts/manual-md2html.mjs`에 DOC_META를 추가하고 3개 언어를 생성했다(각 11장, 그림 17개). 위젯 그림 3개는 최대 폭 400px로 했다.
- **이미지 경로**: 모든 경로의 파일이 실제로 있음을 확인했다.
- **/manual 목록**: 카드 07과 3개 언어 문구를 추가했다. 언어 전환 시 링크가 바뀌는 것을 확인했다.
- **기존 매뉴얼 링크**: 통합 매뉴얼 14.1절과 지식·AI 매뉴얼 5.1a절에 링크를 달았다(ko/en/vi, md와 html).
- **로컬 렌더링**: 목록 카드, ko 본문, vi 본문의 그림을 확인했다.

## 3. 정리
시연 데이터를 원래대로 되돌렸다.
- 계정의 이름·팀·라벨과 활성 상태
- 시연용 팀·라벨, 상담카테고리, 배정 규칙(테스트 전과 비교해 일치)
- 테스트 대화·알림·세션, 개인 알람 설정과 읽음 기록
