# RPT-261023 — 콘솔 목록(라이브챗 세션 목록·고객 목록) 마스킹 해제

- 요청(2026-10-23): `/live-chat` 세션 목록과 `/customers` 고객 목록은 마스킹할 필요 없음. **마스킹은 대화방 안과 외부 AI 전달 시에만.**
- 이전 결정과의 관계: REQ/PLN/RPT-260920(PR #545/#548)의 "콘솔 고객정보는 서버가 마스킹, 평문은 감사되는 열람으로만" 중 **목록 화면 부분을 되돌림**. 대화방 안·AI 전송·로그 마스킹은 그대로.

## 1. 범위
| 화면 / 경로 | 변경 전 | 변경 후 |
|---|---|---|
| 라이브챗 세션 목록 `GET /agent/sessions` — 고객 이름·이메일, claimed 이름 | 마스킹 | **평문** |
| 고객 목록 `GET /customers` — 이름·이메일 | 마스킹 + 눈 아이콘 열람(감사) | **평문**, 열람 버튼·마스킹 안내 제거. 전화번호는 목록에 계속 없음(PRV-002) |
| 고객 › 기업고객 탭 — 담당자 이름, 고객사 상세의 대화 목록 | 마스킹 | **평문** |
| 대화방 안 — 대화 헤더 이름, 고객 패널, 서명 속성 이름, "이 호텔의 다른 대화" | 마스킹 | **마스킹 유지** (고객 패널 열람 = 감사 유지) |
| 외부 AI 전송 `scrubPii` · 로그 `maskPii` | 마스킹 | 유지 |
| 그 밖(그룹 멤버, 만족도 목록, 통계, 감사 로그 표시) | 마스킹 | 유지 — 요청 범위 밖 |

## 2. 변경 파일
- API: `customer/customer.mapper.ts`(목록 `reveal: true`, 전화 제외 유지), `agent/agent.mapper.ts`(세션 목록 평문, `toIdentityResponse(…, { masked })`), `company/company.mapper.ts`·`company.service.ts`(고객 화면 평문, 대화방 패널 `conversationsOf`는 마스킹)
- Web: `customers/CustomersPage.tsx`(열람 버튼·TTL·안내 제거), `customers.hooks.ts`(미사용 `useRevealCustomer` 제거), `CompaniesPanel.tsx` 주석, `customers.json` 6개 언어 `companyHint`에서 마스킹 문장 제거
- 스키마 변경 없음. `GET /customers/:id/reveal` 라우트는 남김(전화번호 포함 단건, 감사).

## 3. 테스트
- `customer-masking.spec` 목록 기대값 평문으로, `listsessions.spec`에 "목록 평문 / 대화방 안 마스킹" 둘 다 확인
- API jest 2,481 통과 · typecheck · build · i18n:check

## 4. 배포
| 환경 | 상태 |
|---|---|
| 스테이징 | 아래 PR 머지 후 배포 |
| 프로덕션 | 미배포(확인 후 진행) |

## 5. 2차(같은 날) — 콘솔 전 화면 이름·회사명 마스킹 해제
요청: "그룹 멤버 목록, 만족도 목록, 통계 화면의 고객 이름 모두 해제. 마스킹은 대화방에서 고객과의 대화 시 필요한 사항과 외부 유출 대비만. 샵톡 어드민 업무 화면의 고객 이름/회사명은 마스킹 불필요." 대화방 범위 확인 → **이름·회사명만 해제(권장안 선택)**.

| 화면 / 경로 | 변경 후 |
|---|---|
| 그룹 상세 멤버 `toGroupDetailResponse` | 이름 평문 |
| 만족도 목록 `agent.service` (CSAT) | 이름 평문 |
| 대화 이력·통계 `analytics.service.customerNames` | 이름 평문 |
| 작업 로그 호스트 사용자 `audit.service` | 이름 평문 |
| 대화방 헤더·고객 패널 이름, 서명 속성 이름(`toIdentityResponse`), "이 호텔의 다른 대화" | 이름 평문 |
| 고객 단건 `GET /customers/:id`, 등급 변경 응답 | 이름 평문 |
| **유지** | 고객 패널·단건의 **이메일·전화 마스킹 + 감사되는 열람**, AI 전송 `scrubPii`, 로그 `maskPii` |

`maskName`은 이제 콘솔 응답 어디서도 쓰지 않음(유틸은 남김). 스펙 5건 기대값을 평문으로 갱신, API jest 2,481 통과.
