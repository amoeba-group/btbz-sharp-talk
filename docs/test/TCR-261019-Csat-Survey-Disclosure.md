# TCR-261019 — 만족도 3문항 설문 · AI 고지 하단 배치 테스트 케이스

- 근거: [PLN-261019-Csat-Survey-Disclosure](../plan/PLN-261019-Csat-Survey-Disclosure.md) · 구현 PR #658

## 1. 단위 테스트 (자동)
| ID | 대상 | 케이스 | 기대 | 파일 |
|---|---|---|---|---|
| U1 | `classifyOutcome` | 별점만 응답(설문 열 null) | 해결 `csat_answered`(현행) | `resolution.util.spec.ts` |
| U2 | 〃 | 설문 "해결"(csatResolved=1) + 낮은 별점 | 해결 | 〃 |
| U3 | 〃 | 설문 "미해결"(csatResolved=0) + 높은 별점 | **미해결 `customer_unresolved`** | 〃 |
| U4 | 〃 | 별점 없음 + csatResolved=0 | 기존 규칙(customer_last 등) | 〃 |
| U5 | `ChatService.rate` | rating 2 + resolved false + reason other + 전화번호 코멘트 | resolved 0·reason other·코멘트 `[PHONE]` 마스킹 | `chat.service.csat.spec.ts` |
| U6 | 〃 | rating 5 + reason slow + comment | reason·comment **null**(2점 이하만, other만) | 〃 |
| U7 | 〃 | 별점만(구 위젯) | 설문 열 전부 null | 〃 |
| U8 | `normalizeDesign` | `disclosurePlacement: top / bottom / 오타` | top·오타는 저장 안 함, bottom만 저장 | `widget-theme.spec.ts` |
| U9 | `AgentService.csatSummary` | 집계 | `resolved {yes,no}`·`reasons{5}` 추가 | `agent.service.csat.spec.ts` |
| U10 | `SessionService.privacyNotice` | 응답 | `csatMode: 'rating'`·`termsUrl: null` 기본 | `session.service.spec.ts` |
| U11 | 여정 리포트 규칙 문장 | 모든 사유 코드 포함 | `(customer_unresolved)` 포함 | `journey-report-content.spec.ts` |

## 2. 통합 시나리오 (스테이징 go2joy, 수동)
| ID | 시나리오 | 기대 |
|---|---|---|
| I1 | SQL 선적용 → 배포 | `conversations.csat_resolved/csat_reason/csat_comment`, `tenants.csat_mode/terms_url` 존재 후 API 부팅 정상 |
| I2 | `session/ensure` | `csatMode: 'survey'`, `termsUrl`, `design.disclosurePlacement: 'bottom'` |
| I3 | 패널 열기 | 상단 고지 바 없음, 입력창 아래 한 줄 "AI-generated replies · processed in …"(+ 약관 링크는 URL 있을 때만, 상담 중엔 End chat) |
| I4 | 대화 종료 후 | 설문 카드: 제목+X, Q1 라디오 2, 이모지 세그먼트 5, 제출 비활성 |
| I5 | Q1 "미해결" + 1점 | 라벨 "Very unhappy" + 사유 4종 + 기타 노출 |
| I6 | 기타 + 코멘트 50자 카운터 + 제출 | `POST /chat/csat` 201, DB: rating·resolved 0·reason other·코멘트 마스킹 |
| I7 | 4점 이상 | 사유 섹션 없음, Q1+별점만으로 제출 가능 |
| I8 | 별점 모드 테넌트(ivyusa) | 현행 1문항 카드 그대로 |
| I9 | 통계 › 만족도 | 세션별 표 해결/사유/코멘트 열, 설문 응답이 있으면 해결 여부·사유 분포 카드 |
| I10 | 통계 › 해결 렌즈 | `customer_unresolved` 사유 행 |
| I11 | 콘솔 설정 | 위젯 동작 카드 라디오 저장 토스트, 개인정보 안내 약관 URL 저장, 편집기 고지 위치 저장→라이브 반영 |

## 3. 엣지 케이스
| ID | 케이스 | 기대 |
|---|---|---|
| E1 | 구 위젯(캐시)이 신 API에 별점만 전송 | 설문 열 null, 통계 현행 |
| E2 | 신 위젯이 구 API에 설문 전송 | DTO가 모르는 필드는 `forbidNonWhitelisted` 여부에 따라 400 가능 → 배포 순서(API 먼저)로 회피 |
| E3 | 설문 제출 실패(네트워크) | 에러 문구 표시, 재제출 가능 |
| E4 | 24h 창 밖 재제출 | 409(현행) |
| E5 | 코멘트 51자 | 클라이언트 maxLength 50, 서버 MaxLength 50 → 400 |
| E6 | 코멘트에 이메일·전화 | `[EMAIL]`·`[PHONE]` 치환 후 저장 |
| E7 | termsUrl·privacyPolicyUrl 둘 다 null | 하단 줄에 링크 없음 |
| E8 | 상단 배치 테넌트 | 변화 없음(상단 바 + 상담 종료 링크) |
