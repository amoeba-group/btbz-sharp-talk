# TCR-260920 — 콘솔 PII 마스킹·열람 통제 테스트

- 대상: PR #545(구현) · #548(nginx 로거 수정) · REQ/PLN-260920
- 자동 테스트: `npm run test` 2,082건 통과(신규 20건) · `npm run typecheck` · `npm run build` · `npm run i18n:check` 6언어
- 실측: 스테이징 `shoptalk.amoeba.site`, 2026-09-20

## 1. 단위 테스트 (신규)

`apps/api/src/global/util/pii-display.util.spec.ts`
| # | 케이스 | 기대 |
|---|---|---|
| U-01 | `maskEmail('hong.gildong@gmail.com')` | `ho***@gmail.com` |
| U-02 | 로컬파트 1~2자(`a@x.com`, `ab@x.com`) | 앞 1자만 남김 — 짧은 주소가 통째로 드러나지 않음 |
| U-03 | 이메일이 아닌 문자열·`@x.com`·`x@` | `***`(주소처럼 보이는 값을 만들지 않음) |
| U-04 | `maskPhone('+82 10-1234-5678')` | `***-5678`, 4자리 미만이면 `***` |
| U-05 | `maskName('홍길동' / 'LISA ANDRE' / 'Bo' / 'A')` | `홍*동` / `L**A A***E` / `B*` / `*` |
| U-06 | 마스킹 결과가 원문과 같아지지 않음(1자 제외) | 패딩으로 원문이 새지 않음 |
| U-07 | null·공백 입력 | null 유지(없는 값을 있는 것처럼 만들지 않음) |

`apps/api/src/domain/customer/customer-masking.spec.ts`
| # | 케이스 | 기대 |
|---|---|---|
| U-08 | `toCustomer` 기본 | 이름·이메일·전화 마스킹, `masked: true` |
| U-09 | `toCustomer(..., { reveal: true })` | 평문, `masked: false` |
| U-10 | `toCustomerList` | `phone` 키 자체가 없음 |
| U-11 | `toCustomerSummary` | `{id, name(마스킹), tier, masked}`만 |
| U-12 | 값이 없는 고객 | null 유지 |
| U-13 | `reveal()` | `customer.pii_revealed` 감사 1행, `target=customer:7`, metadata에 원문 주소 없음 |
| U-14 | 타 테넌트 id로 `reveal()` | 예외 발생, **감사 0행**(존재를 확인해주지 않음) |

## 2. 통합 시나리오 (스테이징 실측)

| # | 시나리오 | 결과 |
|---|---|---|
| I-01 | `POST /customers/search` | `{name:'L**A H**E', email:'hy***@ivyent.com', masked:true}`, `phone` 키 없음 ✅ |
| I-02 | `GET /customers`(구 경로) | 동일하게 마스킹 ✅ |
| I-03 | `GET /customers/:id` | 마스킹 + `phone` 마스킹 ✅ |
| I-04 | `GET /customers/:id/reveal` | 평문 반환, `masked:false` ✅ |
| I-05 | 열람 직후 `GET /audit` | `customer.pii_revealed / customer:64 / success`, metadata `{email:'hy****@ivyent.com'}` ✅ |
| I-06 | `GET /agent/customers/search?q=a` | 8건 전부 마스킹 ✅ |
| I-07 | `POST /agent/customers/search` | 동일 결과, 검색어가 URL에 없음 ✅ |
| I-08 | 컨테이너 nginx 접근 로그 | 검색 이메일 0건, `"GET /api/v1/customers"`만 기록 ✅ |
| I-09 | 호스트 nginx(TLS 종단) 접근 로그 | staging·production vhost 모두 쿼리스트링 0건, 다른 사이트는 기존 포맷 유지 ✅ |

## 3. 엣지 케이스

| # | 케이스 | 처리 |
|---|---|---|
| E-01 | 이메일만 있고 이름이 없는 고객 | 이름 null, 이메일 마스킹 — 대기열 라벨은 마스킹된 주소로 대체 |
| E-02 | 매니저·스태프 계정 | 열람 버튼 비노출, `/reveal` 호출 시 403 |
| E-03 | 열람 후 5분 경과 | 해당 행이 자동으로 마스킹 상태로 복귀(타이머), 페이지 이동 시에도 초기화 |
| E-04 | 라이브챗에서 다른 대화로 이동 | 열람 상태 해제 — 열람은 특정 고객에 대한 행위 |
| E-05 | 열람 반복 호출 | 분당 30회 제한(429), 감사는 호출마다 1행 |
| E-06 | 이메일 정확 일치 검색 | 블라인드 인덱스라 마스킹과 무관하게 동작 |
| E-07 | 모더레이션 판정 | 판정은 원문으로, 저장 발췌만 스크러빙 — 차단 정확도 불변 |
| E-08 | 여정 리포트 인용 | 스크러빙된 문장으로 생성, 인용 자체는 유지 |
| E-09 | 지식 캡처에 주문번호·SKU·가격·날짜 | 경고 없음(오탐 억제), 이메일·전화·카드만 경고 |

## 4. 수동 확인이 필요한 항목

| # | 항목 | 이유 |
|---|---|---|
| M-01 | 콘솔 화면의 눈 아이콘·토스트·안내 문구(6언어) | 콘솔 로그인은 비밀번호 입력이 필요해 자동 확인에서 제외. 빌드·타입체크·i18n 검사는 통과 |
| M-02 | 지식 캡처 모달 경고·가리기 버튼 | `apps/web`에 테스트 러너가 없어 CI 미포함 |

## 5. 회귀 확인
- 기존 테스트 2,062건 그대로 통과(마스킹 도입으로 깨진 스펙 없음)
- `RetentionService` 생성자 인자 2개 추가에 따른 스펙 갱신 1건
- `CustomerService` 생성자에 `AuditService` 추가에 따른 스펙 갱신 1건
