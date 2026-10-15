# RPT-261015 Go2Joy 지식 충돌 78건 분류 (PLN-261015 D8)

- 대상: 스테이징 go2joy(tenant 4) `kb_conflicts` 중 `status=pending` 78건 (2026-10-15 16:40 KST 기준)
- 근거: 각 쌍의 문서 원문, 외부 키(`external_key`), 카테고리, 등록일을 직접 대조했습니다. 모델 판정(`verdict`)은 참고만 했습니다.
- 이 문서는 분류와 권장 조치만 담습니다. 스테이징 데이터는 아무것도 바꾸지 않았습니다.

## 1. 요약

| 묶음 | 건수 | 모델 판정 | 실제 성격 | 권장 조치 | 결정 주체 |
|---|---:|---|---|---|---|
| **F. 수정 필요 (사실 불일치)** | 3 | 모순 2 · 보완 1 | 요약 매뉴얼이 영상 가이드(실제 화면)와 다름 | 요약 매뉴얼 3개 언어본 수정 | Go2Joy 확인 → 아메바 수정 |
| **P. 정책 문서 2벌** | 3 | 중복 3 | 같은 약관 원문이 8/20·8/29 두 번 등록됨 | 한 벌만 남기고 비활성 | Go2Joy (어느 쪽 남길지) |
| **Q. FAQ 같은 답, 다른 질문** | 32 | 중복 32 | 질문 13개에 같은 답 2종을 복사 | 답별로 1문서로 합치고 질문은 변형으로 보존 | Go2Joy (질문별 전용 답 필요 여부) |
| **T. 언어별 번역본** | 20 | 중복 20 | 같은 항목의 ko / EN / VI 버전 (의도된 구성) | 둘 다 유지, 충돌 '유지' 처리 | 아메바 단독 가능 |
| **V. 요약 매뉴얼 ↔ 영상 가이드** | 11 | 보완 11 | 요약본과 상세본, 내용 일치 | 둘 다 유지, 충돌 '유지' 처리 | 아메바 단독 가능 |
| **D. 서로 다른 절차** | 9 | 보완 9 | 시간제 / 일 단위 / 오버나이트 등 별개 절차 | 둘 다 유지, 충돌 '유지' 처리. 단 BRD-1 초안은 별도 결정 | 아메바 단독 가능 (BRD-1은 Go2Joy) |
| 합계 | **78** | | | | |

**결론**: 실제로 답변이 틀릴 수 있는 것은 **F 3건**뿐입니다. P와 Q 35건은 같은 내용이 여러 벌 있는 정리 대상이고(답이 틀리지는 않지만 검색 결과 자리를 차지합니다), 나머지 40건(T·V·D)은 둘 다 맞는 문서라 '유지' 처리하면 됩니다.

## 2. F. 수정 필요 — 3건 (우선순위 1)

### C248 시간제 플래시 세일: 가격 입력이 "선택"인가
| 문서 | 내용 |
|---|---|
| #2528 `GTJ-FLS-01-EN` Set Up Hourly Flash Sale (요약 매뉴얼) | "For hourly flash sales, **price setup is optional**." |
| #2628 `GTJ-VID-08-EN` Video 8 (영상 가이드) | 입력란 `Giá FS cho 2 giờ đầu`\* (첫 2시간 FS 가격) **필수**, `Giá FS cho 1 giờ thêm (Không bắt buộc)` (추가 1시간 가격) **선택** |

- 판단: 실제 화면(영상)에서는 첫 2시간 가격이 필수이고, 선택 항목은 추가 1시간 가격뿐입니다. 요약 매뉴얼의 "가격은 선택"은 이 둘을 구분하지 않은 표현으로 보입니다.
- 영향: 리셉션 직원이 "가격 안 넣어도 되나요?"라고 물으면 AI가 "선택입니다"라고 답할 수 있습니다.
- 권장 수정: `GTJ-FLS-01` / `-EN` / `-VI`(#2508, #2528, #2548)의 주의사항을 "첫 2시간 가격은 필수, 추가 1시간 가격은 선택"으로 바꿉니다.

### C218 · C219 플래시 세일 중지: 확인 단계 누락
| 문서 | 내용 |
|---|---|
| #2510 `GTJ-FLS-03` 플래시 세일 중지 (요약 매뉴얼) | 타임라인에서 객실·예약 유형 선택 → 상세 → [프로그램 중지] → 성공 알림 |
| #2630 `GTJ-VID-10-EN` / #2578 `GTJ-VID-10-VI` (영상 가이드) | 객실 유형 관리 › 객실 유형 목록 타임라인의 FS 배지 클릭 → 상세 모달 → [Dừng chương trình] → **확인 대화상자 [Xác nhận dừng]** → 성공 알림 |

- 판단: 모델은 C218을 "경로가 다르다"는 모순으로, C219를 보완으로 판정했지만 두 쌍은 같은 문제입니다. 경로는 실제로 같은 곳입니다(요약본의 "타임라인" = 객실 유형 목록의 타임라인). 실제 차이는 **요약본에 확인 대화상자 단계가 없는 것**뿐입니다.
- 영향: 사실이 틀린 것은 아니지만, 직원이 확인 창을 보고 "매뉴얼에 없는 창이 떴다"고 다시 물을 수 있습니다.
- 권장 수정: `GTJ-FLS-03` / `-EN` / `-VI`(#2510, #2530, #2550)의 절차에 "확인 대화상자에서 [확인/Xác nhận dừng]" 단계를 추가하고, 경로를 "객실 유형 관리 › 객실 유형 목록 › 타임라인"으로 적습니다.

## 3. P. 정책 문서 2벌 — 3건

| 충돌 | 8/20 등록본 | 8/29 등록본 | 차이 |
|---|---|---|---|
| C210 | #2360 `BRD-18` Thỏa thuận dịch vụ (카테고리 `policy`) | #2565 `BRD-13` A. ĐIỀU KHOẢN SỬ DỤNG… (카테고리 `service agreement`) | 본문 동일, 제목 줄 1행 |
| C211 | #2361 `BRD-17` Chính sách bảo mật (`policy`) | #2566 `BRD-12` PHỤ LỤC I CHÍNH SÁCH BẢO MẬT… (`police_privacy`) | 본문 동일 |
| C212 | #2362 `BRD-16` Chính sách thanh toán (`policy_payment`) | #2567 `BRD-11` A. Phương thức thanh toán (`policy_price`) | 본문 동일, 제목만 다름 |

- 권장: 문서 한 벌만 남깁니다. 아메바 안은 **8/20 등록본(#2360~#2362)을 남기고 8/29 등록본(#2565~#2567)을 비활성화**하는 것입니다. 8/29 등록본의 카테고리 이름에 오타(`police_privacy`)가 있고, `policy_price`는 결제 정책을 가격 정책처럼 보이게 하기 때문입니다.
- Go2Joy 확인: 어느 쪽 원문이 최신 약관인지 확인해 주세요. 본문은 지금 같지만, 앞으로는 한 벌만 고쳐야 하므로 기준본을 정해야 합니다.

## 4. Q. FAQ 같은 답, 다른 질문 — 32건

질문만 다른 FAQ 문서 13개가 답 2종을 복사해 쓰고 있습니다. 충돌 32건은 이 13개 문서끼리 짝지어진 결과입니다.

| 답 | 문서 (질문) |
|---|---|
| 예약 방법 3단계 (앱·웹 안내) | #2347 `BRD-31` Tôi muốn đặt phòng · #2348 `BRD-30` Tôi muốn đặt KS ở 1 đêm · #2349 `BRD-29` Cách đặt phòng · #2350 `BRD-28` Tôi muốn tìm KS ở quận 7 · #2351 `BRD-27` Bên KS mình còn phòng ko? · #2352 `BRD-26` Cho xin giá thuê KS này theo giờ ạ · #2353 `BRD-25` Có khách sạn tình yêu không? · #2354 `BRD-24` Muốn check-in lúc 12h đêm · #2355 `BRD-23` Xin giá phòng có bồn tắm · #2356 `BRD-22` Thuê phòng couple |
| 여러 객실 예약 불가 (한 객실씩 반복 예약) | #2357 `BRD-21` Đặt 2 phòng được không? · #2358 `BRD-20` Tôi muốn đặt nhiều phòng thì làm thế nào? · #2359 `BRD-19` Muốn đặt 2 phòng thì làm thế nào? |

충돌 번호: C124~C155 (32건)

- 문제 1 (정리): 같은 답이 10벌 있으면 검색 상위 자리를 이 문서들이 차지해, 다른 근거 문서가 밀려납니다.
- 문제 2 (내용): "자정에 체크인하고 싶다"(BRD-24), "욕조 있는 방 가격"(BRD-23), "7군 호텔 찾기"(BRD-28) 같은 질문에도 일반 예약 방법만 답합니다. 질문에 맞는 답인지 Go2Joy 확인이 필요합니다.
- 문제 3 (범위): 이 FAQ는 **예약 고객용** 답인데, 카테고리 `faq`·`policy`의 에이전트 범위가 비어 있어(=전체) **Hotel Admin 에이전트도 이 문서를 근거로 씁니다**. 리셉션 직원이 "예약은 어떻게 하나요?"라고 물으면 고객용 앱 예약 안내가 나갈 수 있습니다.
- 권장:
  1. 답별로 문서 1개만 남기고(예: `BRD-29` Cách đặt phòng, `BRD-19`), 다른 질문은 그 문서 본문에 "비슷한 질문" 목록으로 옮긴 뒤 나머지 11개를 비활성화합니다.
  2. 전용 답이 필요한 질문(자정 체크인, 욕조 객실, 지역 검색 등)은 Go2Joy가 답을 주면 별도 문서로 만듭니다.
  3. `faq`·`policy` 카테고리의 에이전트 범위를 고객용 에이전트(`default`, `landing-guest`)로 좁힐지 Go2Joy와 정합니다. 2단계(호텔별 고객 응대 에이전트)에서 다시 쓰일 문서이므로 지우지는 않습니다.

## 5. T. 언어별 번역본 — 20건

같은 항목 코드의 한국어본(접미사 없음) · 영어본(`-EN`) · 베트남어본(`-VI`)입니다. 내용이 같은 것이 정상이므로 '유지' 처리합니다.

| 충돌 | 문서 A | 문서 B |
|---|---|---|
| C222 | #2517 GTJ-LCK-03 객실 잠금 – 오버나이트 (Room Lock – Overnight) | #2537 GTJ-LCK-03-EN Room Lock – Overnight |
| C237 | #2524 GTJ-DIS-01-EN Create / Edit a Direct Discount Program | #2544 GTJ-DIS-01-VI Tạo / Sửa chương trình giảm giá trực tiếp (Create / Edit a Direct Disc |
| C207 | #2516 GTJ-LCK-02 객실 잠금 – 일 단위 (Room Lock – By Day) | #2536 GTJ-LCK-02-EN Room Lock – By Day |
| C246 | #2528 GTJ-FLS-01-EN Set Up Hourly Flash Sale | #2548 GTJ-FLS-01-VI Thiết lập Flash Sale theo giờ (Set Up Hourly Flash Sale) |
| C244 | #2527 GTJ-DIS-04-EN Stop a Direct Discount Program | #2547 GTJ-DIS-04-VI Dừng chương trình giảm giá trực tiếp (Stop a Direct Discount Program) |
| C249 | #2529 GTJ-FLS-02-EN Set Up Overnight Flash Sale | #2549 GTJ-FLS-02-VI Thiết lập Flash Sale qua đêm (Set Up Overnight Flash Sale) |
| C243 | #2526 GTJ-DIS-03-EN View Discount Program List | #2546 GTJ-DIS-03-VI Xem danh sách chương trình giảm giá (View Discount Program List) |
| C240 | #2525 GTJ-DIS-02-EN Search Direct Discount Programs | #2545 GTJ-DIS-02-VI Tìm kiếm chương trình giảm giá trực tiếp (Search Direct Discount Progr |
| C234 | #2522 GTJ-DSH-01-EN View Dashboard | #2542 GTJ-DSH-01-VI Xem Bảng điều khiển (View Dashboard) |
| C236 | #2523 GTJ-REV-01-EN Reply to a Review | #2543 GTJ-REV-01-VI Trả lời đánh giá (Reply to a Review) |
| C225 | #2518 GTJ-LCK-04 객실 잠금 해제 (Delete Room Lock Settings) | #2538 GTJ-LCK-04-EN Delete Room Lock Settings |
| C228 | #2519 GTJ-RPT-01 특가 객실 리포트 다운로드 (Download "Shock-Discount Room" Report) — *보완 필요 (Updat | #2539 GTJ-RPT-01-EN Download "Shock-Discount Room" Report — *Pending update (Updating)* |
| C232 | #2521 GTJ-STA-01 상태 값 정의 (Status Values) | #2541 GTJ-STA-01-EN Status Values |
| C204 | #2515 GTJ-LCK-01 객실 잠금 – 시간제 (Room Lock – Hourly) | #2555 GTJ-LCK-01-VI Khóa phòng – Theo giờ (Room Lock – Hourly) |
| C226 | #2518 GTJ-LCK-04 객실 잠금 해제 (Delete Room Lock Settings) | #2558 GTJ-LCK-04-VI Hủy cài đặt khóa phòng (Delete Room Lock Settings) |
| C229 | #2519 GTJ-RPT-01 특가 객실 리포트 다운로드 (Download "Shock-Discount Room" Report) — *보완 필요 (Updat | #2559 GTJ-RPT-01-VI Tải báo cáo "Phòng giá sốc" (Download "Shock-Discount Room" Report) —  |
| C230 | #2520 GTJ-GLS-01 용어집 (Glossary) | #2540 GTJ-GLS-01-EN Glossary |
| C233 | #2521 GTJ-STA-01 상태 값 정의 (Status Values) | #2561 GTJ-STA-01-VI Định nghĩa trạng thái (Status Values) |
| C224 | #2517 GTJ-LCK-03 객실 잠금 – 오버나이트 (Room Lock – Overnight) | #2557 GTJ-LCK-03-VI Khóa phòng – Qua đêm (Room Lock – Overnight) |
| C231 | #2520 GTJ-GLS-01 용어집 (Glossary) | #2560 GTJ-GLS-01-VI Bảng thuật ngữ (Glossary) |


참고: 한국어본(접미사 없는 `GTJ-*`)은 아메바가 작성한 원본입니다. 베트남 리셉션 직원은 쓰지 않으므로, 기본 언어를 `vi`로 바꾼 지금은 검색 자리만 차지할 수 있습니다. 운영 이관 때 한국어본을 Hotel Admin 범위에서 뺄지 정하면 됩니다(이번 분류와는 별개).

## 6. V. 요약 매뉴얼 ↔ 영상 가이드 — 11건

요약 매뉴얼(`GTJ-DIS/FLS/SUR/DSH-*`)과 같은 기능의 영상 가이드(`GTJ-VID-*`)입니다. 영상 가이드가 화면 이름·입력란·예시 값을 더 자세히 담았고, 서로 다른 사실은 없습니다(사실이 다른 쌍은 F로 옮겼습니다). '유지' 처리합니다.

| 충돌 | 문서 A | 문서 B |
|---|---|---|
| C217 | #2509 GTJ-FLS-02 오버나이트 플래시 세일 설정 (Set Up Overnight Flash Sale) | #2629 GTJ-VID-09-EN Video 9 — Creating a Flash Sale for the Qua đêm (overnight) type |
| C238 | #2524 GTJ-DIS-01-EN Create / Edit a Direct Discount Program | #2622 GTJ-VID-02-EN Video 2 — Setting a per-room discount rate at step 2 of creating a dir |
| C241 | #2525 GTJ-DIS-02-EN Search Direct Discount Programs | #2626 GTJ-VID-06-EN Video 6 — Searching by name in the direct-discount program list |
| C239 | #2524 GTJ-DIS-01-EN Create / Edit a Direct Discount Program | #2623 GTJ-VID-03-EN Video 3 — Using the direct discount's Thiết lập hàng loạt (Bulk setup) |
| C215 | #2505 GTJ-DIS-02 직접 할인 프로그램 검색 (Search Direct Discount Programs) | #2626 GTJ-VID-06-EN Video 6 — Searching by name in the direct-discount program list |
| C213 | #2504 GTJ-DIS-01 직접 할인 프로그램 생성·수정 (Create / Edit a Direct Discount Program) | #2622 GTJ-VID-02-EN Video 2 — Setting a per-room discount rate at step 2 of creating a dir |
| C242 | #2525 GTJ-DIS-02-EN Search Direct Discount Programs | #2574 GTJ-VID-06-VI Video 6 — Tìm theo tên trong danh sách chương trình giảm giá trực tiếp |
| C216 | #2505 GTJ-DIS-02 직접 할인 프로그램 검색 (Search Direct Discount Programs) | #2574 GTJ-VID-06-VI Video 6 — Tìm theo tên trong danh sách chương trình giảm giá trực tiếp |
| C220 | #2511 GTJ-SUR-01 추가 요금 설정 (Set Up Surcharges) | #2631 GTJ-VID-11-EN Video 11 — Creating and saving a surcharge (Phụ thu) schedule |
| C214 | #2504 GTJ-DIS-01 직접 할인 프로그램 생성·수정 (Create / Edit a Direct Discount Program) | #2623 GTJ-VID-03-EN Video 3 — Using the direct discount's Thiết lập hàng loạt (Bulk setup) |
| C235 | #2522 GTJ-DSH-01-EN View Dashboard | #2620 GTJ-VID-00-EN Video 0 — A walkthrough of the Trang chủ (Home) dashboard |


## 7. D. 서로 다른 절차 — 9건

예약 유형별(시간제 / 일 단위 / 오버나이트) 잠금·플래시 세일 절차처럼 화면이 비슷할 뿐 다른 절차입니다. '유지' 처리합니다.

| 충돌 | 문서 A | 문서 B |
|---|---|---|
| C208 | #2516 GTJ-LCK-02 객실 잠금 – 일 단위 (Room Lock – By Day) | #2517 GTJ-LCK-03 객실 잠금 – 오버나이트 (Room Lock – Overnight) |
| C209 | #2516 GTJ-LCK-02 객실 잠금 – 일 단위 (Room Lock – By Day) | #2537 GTJ-LCK-03-EN Room Lock – Overnight |
| C247 | #2528 GTJ-FLS-01-EN Set Up Hourly Flash Sale | #2529 GTJ-FLS-02-EN Set Up Overnight Flash Sale |
| C205 | #2515 GTJ-LCK-01 객실 잠금 – 시간제 (Room Lock – Hourly) | #2516 GTJ-LCK-02 객실 잠금 – 일 단위 (Room Lock – By Day) |
| C223 | #2517 GTJ-LCK-03 객실 잠금 – 오버나이트 (Room Lock – Overnight) | #2536 GTJ-LCK-02-EN Room Lock – By Day |
| C227 | #2518 GTJ-LCK-04 객실 잠금 해제 (Delete Room Lock Settings) | #2534 GTJ-QLK-02-EN Delete Quick Room Lock |
| C221 | #2513 GTJ-QLK-01 빠른 객실 잠금 설정 (Set Up Quick Room Lock) | #2563 BRD-1 긴급 객실 차단 절차 (초안) |
| C206 | #2515 GTJ-LCK-01 객실 잠금 – 시간제 (Room Lock – Hourly) | #2517 GTJ-LCK-03 객실 잠금 – 오버나이트 (Room Lock – Overnight) |
| C245 | #2527 GTJ-DIS-04-EN Stop a Direct Discount Program | #2541 GTJ-STA-01-EN Status Values |

- 예외 **C221**: #2563 `BRD-1` "긴급 객실 차단 절차 **(초안)**"은 지식 보드에서 채택된 85자짜리 초안(8/29 등록)이 활성 상태로 Hotel Admin 범위에 들어가 있습니다. 내용은 #2513 `GTJ-QLK-01` 빠른 객실 잠금의 축약본입니다. 비활성화를 권장합니다(Go2Joy 확인).

## 8. 처리 계획

| 순서 | 할 일 | 대상 | 담당 |
|---|---|---|---|
| 1 | 요약 매뉴얼 6개 수정(가격 필수 여부, 확인 단계) 후 재색인 | F: #2508 #2528 #2548 #2510 #2530 #2550 | Go2Joy 확인 → 아메바 |
| 2 | 정책 문서 기준본 결정, 나머지 3개 비활성 | P: #2360~#2362 / #2565~#2567 | Go2Joy 결정 → 아메바 |
| 3 | FAQ 13개 → 2개로 통합, 전용 답 필요한 질문 목록 회신 | Q: #2347~#2359 | Go2Joy 결정 → 아메바 |
| 4 | `faq`·`policy` 카테고리 에이전트 범위 결정 | Hotel Admin 제외 여부 | Go2Joy 결정 |
| 5 | BRD-1 초안 비활성 | #2563 | Go2Joy 확인 |
| 6 | T·V·D 40건 충돌을 '둘 다 유지'로 처리 | C204~C249 중 해당 40건 | 아메바 (바로 가능) |

1~5가 끝나면 해당 충돌은 문서가 비활성되거나 수정되면서 함께 정리됩니다. 정리 후 같은 쌍이 다시 검출되지 않는지 충돌 검사를 한 번 더 돌려 확인합니다.
