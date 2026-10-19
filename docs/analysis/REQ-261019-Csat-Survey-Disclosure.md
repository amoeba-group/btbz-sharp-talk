# REQ-261019 — 만족도 3문항 설문 · AI 고지 하단 배치 (PLN-261019 D4·D5 후속)

- 요청: PLN-261019-Go2Joy-Widget-Figma-Design 승인 시 "별도 REQ"로 분리한 두 항목 —
  Figma(Chat HA) 위젯 프레임의 **만족도 카드 3문항**(D5)과 **AI 고지 문구의 입력부 아래 한 줄 배치**(D4).
- 조사 기준: main `abdac17`(2026-10-19) · 스테이징 테넌트 4(go2joy)
- 원칙: 테넌트 옵션으로 넣고 기본값은 현행(기존 테넌트 무변화). 설문 응답은 **통계 정의(해결·만족도)를 깨지 않게** 저장.

## 1. Figma 관찰 (위젯 프레임 3장, 캡처 `docs/log/2026-10-19/figma-widget-csat.jpg`)

| 요소 | 디자인 |
|---|---|
| 카드 | 제목 "Khảo sát mức độ hài lòng"/"Satisfaction Survey" + 우측 X(닫기). 흰 카드, 얇은 외곽선 |
| Q1 | "Quý khách đã được hỗ trợ thành công chưa?" 라디오 2개: **Đã xử lý xong**(해결) / **Chưa được xử lý**(미해결) |
| Q2 | "Quý khách có hài lòng về dịch vụ hỗ trợ của Go2Joy không?" **이모지 5단 세그먼트 박스**(😣 🤔 🙂 😃 🥰), 선택 칸은 연파랑 채움, 아래 라벨 1줄("Bình thường"/"Rất không hài lòng"/"Very dissatisfied") |
| Q3 (불만족 시) | "Lý do Quý khách KHÔNG hài lòng …?" 라디오 4개: 안내가 어려움·혼란 / 지원이 오래 걸림 / 응답 없음 / 소프트웨어 오류 + "Lý do khác" 텍스트영역(0/50) |
| 제출 | 전폭 브랜드 버튼 "Gửi phản hồi"/"Submit feedback". 제출 전엔 이모지를 눌러도 바로 전송되지 않음 |
| 고지 | 입력부 아래 중앙 작은 회색 한 줄 "Được tạo bởi AI, áp dụng **điều khoản dịch vụ**"(밑줄 링크). 상단 바 없음 |

Q2에서 1·2(불만족)를 고르면 Q3가 펼쳐지는 흐름(프레임 2·3), 3 이상이면 Q3 없이 제출(프레임 1).

## 2. AS-IS

| 영역 | 현재 |
|---|---|
| 위젯 `CsatCard` | 대화 **종료 후** 24시간 안에 1회 표시. **이모지 5단 1문항**, 얼굴을 누르는 즉시 `POST /chat/csat {rating}` 전송(제출 버튼 없음), 재선택 시 덮어씀(PLN-260810 D6), 닫기 링크 |
| API | `POST /chat/csat` — `rating 1..5`만 받음(`RateChatRequest`). 저장: `conversations.csat_rating TINYINT`, `csat_rated_at`. 종료 후 24h 창, 세션 소유 검증 |
| 통계 | `agent_daily_stats.csat_avg`(상담원별 일평균), 통계 > 만족도 탭(`CsatSection`: 평균·응답 수·응답률·분포·상담원별·세션별), 대시보드 `csatAvg/csatRated`, 고객여정 타임라인 `kind:'csat'` |
| 해결 정의 | `resolution.util` — **CSAT 응답 = 해결(csat_answered)** 이 첫 번째 사유. 즉 지금은 "별점을 남겼다"가 곧 "해결"로 셈 |
| AI 고지 | 채팅 탭 **상단 바**(✦ + "이 대화는 AI가 … {region}에서 처리" + 상담 중이면 "상담 종료" 링크). 6언어 i18n. 약관 URL 필드 **없음**(`privacy_policy_url`만) |

## 3. 갭 분석

| # | 갭 | 판정 | 필요한 것 |
|---|---|---|---|
| G1 | Q1 해결 여부 | **신규 데이터** | `csat_resolved TINYINT NULL`(1/0). 해결 정의에 반영: `csat_answered`를 "응답 + Q1=해결"로 좁힐지(D1) |
| G2 | Q2 세그먼트 박스 + 라벨 + 제출 버튼 | 위젯 | 1문항 모드에선 현행(즉시 전송) 유지, 설문 모드에서만 제출형 |
| G3 | Q3 불만족 사유(선택 + 자유 50자) | **신규 데이터** | `csat_reason VARCHAR(32)`(코드) + `csat_comment VARCHAR(50)`. 사유 코드 4종 플랫폼 고정, 라벨 6언어 |
| G4 | 사유를 콘솔에서 보기 | 콘솔 | 만족도 탭 세션별 표에 해결/사유/코멘트 열, 사유 분포 카드 |
| G5 | 테넌트별 켜기 | 설정 | `tenants.csat_mode: 'rating' \| 'survey'`(기본 rating) — 콘솔 위젯 설정 카드 |
| G6 | 설문 문구 테넌트화 | 문구 | Q1·Q2 질문과 사유 라벨은 플랫폼 i18n 6언어(테넌트 편집은 이번 범위 밖 — 질문 변경은 통계 비교를 깨뜨림) |
| G7 | AI 고지 하단 한 줄 | 위젯 | 디자인 옵션 `disclosurePlacement: 'top' \| 'bottom'`(기본 top). bottom = 입력부 아래 한 줄(짧은 문구 + 링크), 상담 종료 링크는 같은 줄 우측 |
| G8 | "điều khoản dịch vụ" 링크 | 설정 | `tenants.terms_url`(선택) — 없으면 `privacy_policy_url`, 둘 다 없으면 링크 없음. 지역 고지 문구는 법적 요건이라 **짧은 문구에도 지역을 포함** |

## 4. 제약·전제

| # | 내용 |
|---|---|
| C1 | **해결률 정의 변경은 과거 수치를 바꾼다.** `csat_answered`를 Q1 기준으로 좁히면 설문 모드 테넌트의 해결률이 낮아지고, rating 모드 테넌트는 변화 없음. 두 모드가 섞인 플랫폼 합계는 정의가 둘이 됨 → D1 |
| C2 | 24h 창·세션 소유 검증·덮어쓰기 규칙은 그대로. 설문 제출도 덮어쓰기(재제출 허용) |
| C3 | 자유 코멘트 50자는 PII가 들어올 수 있음 → 저장 전 PII 마스킹(`pii-mask` 유틸, 전화·이메일) 적용, 콘솔 표시는 마스킹본 |
| C4 | 스키마 변경 → SQL `sql/261019-conv-csat-survey.sql` + PR `## Migration` + 스테이징 선적용(`DB_SYNCHRONIZE=false`) |
| C5 | 위젯 i18n: 질문 2개·사유 4개·제출/닫기·"기타 사유" = 6언어 × 9키 |
| C6 | 고지 하단 배치는 **법적 문구 축약**이 아니다 — 지역 고지는 유지하고 길이만 줄인다(한 줄 초과 시 두 줄 허용) |

## 5. 미결 결정

| # | 결정 | 선택지 | 제안 |
|---|---|---|---|
| **D1** | Q1과 해결 정의 | ⓐ 저장만(해결 정의 불변) / ⓑ `csat_answered` = 응답 **and** `csat_resolved ≠ 0` | **ⓑ** — 고객이 "미해결"이라 답한 대화를 해결로 세는 것이 정의의 취지와 어긋남. rating 모드(Q1 없음)는 현행대로 응답=해결 |
| D2 | 사유 코드 | 4종 고정(unclear / slow / no_response / software_error) + other | 고정 — 통계 비교 가능성 |
| D3 | Q3 노출 기준 | rating ≤ 2 / ≤ 3 | **≤ 2**(Figma: "Rất không hài lòng" 1단에서 노출, 3="Bình thường"은 미노출) |
| D4 | 설문 모드에서 즉시 전송 | 제출 버튼으로만 | 제출 버튼 — Q1·Q3를 함께 받아야 함 |
| D5 | 고지 하단 배치 옵션 위치 | 디자인(`WidgetDesign`) / 테넌트 설정 | **디자인** — 커스텀 위젯과 함께 이력·패키지에 담김 |
| D6 | 약관 URL | 새 필드 `terms_url` / 개인정보 URL 재사용 | **새 필드(선택)** + 폴백 |

## 6. 범위 제안

| 단계 | 내용 |
|---|---|
| P1 | 스키마·API: `csat_resolved/csat_reason/csat_comment` + `/chat/csat` 확장(선택 필드) + 해결 정의(D1ⓑ) + 단위 테스트 |
| P2 | 위젯: `csat_mode=survey` 설문 카드(Q1·Q2 세그먼트·Q3 조건부·제출) 6언어, rating 모드는 무변화 |
| P3 | 콘솔: 위젯 설정 `csat_mode`, 만족도 탭 해결/사유/코멘트 열·사유 분포 |
| P4 | 고지 하단 배치 `disclosurePlacement` + `terms_url` + 편집기 필드 |
| P5 | go2joy 스테이징 적용(survey·bottom) + 실측 + RPT |
