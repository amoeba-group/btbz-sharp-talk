# RPT-261015 Triage of 78 Go2Joy Knowledge Conflicts (PLN-261015 D8)

- Scope: 78 `kb_conflicts` with `status=pending` for go2joy (tenant 4) on staging (as of 2026-10-15 16:40 KST)
- Basis: For each pair, we compared the source text, external key (`external_key`), category and registration date directly. The model verdict (`verdict`) was used for reference only.
- This document contains only the triage and recommended actions. No staging data was changed.

## 1. Summary

| Group | Count | Model verdict | Actual nature | Recommended action | Decision owner |
|---|---:|---|---|---|---|
| **F. Needs correction (factual mismatch)** | 3 | contradiction 2 · complementary 1 | Summary manual differs from the video guide (actual screen) | Correct the summary manual in all 3 languages | Go2Joy confirms → Amoeba corrects |
| **P. Policy documents registered twice** | 3 | duplicate 3 | The same terms text was registered twice, on 8/20 and 8/29 | Keep one set, deactivate the other | Go2Joy (which set to keep) |
| **Q. FAQ: same answer, different questions** | 32 | duplicate 32 | 2 answers copied across 13 questions | Merge into 1 document per answer; keep the questions as variants | Go2Joy (whether some questions need their own answer) |
| **T. Language versions** | 20 | duplicate 20 | ko / EN / VI versions of the same item (intended setup) | Keep both; resolve the conflict as 'keep both' | Amoeba can do this alone |
| **V. Summary manual ↔ video guide** | 11 | complementary 11 | Summary and detailed version; content matches | Keep both; resolve the conflict as 'keep both' | Amoeba can do this alone |
| **D. Different procedures** | 9 | complementary 9 | Separate procedures: hourly / by day / overnight, etc. | Keep both; resolve the conflict as 'keep both'. The BRD-1 draft needs a separate decision | Amoeba can do this alone (BRD-1: Go2Joy) |
| Total | **78** | | | | |

**Conclusion**: Only the **3 F cases** can actually produce wrong answers. The 35 P and Q cases are clean-up items where the same content exists in several copies (answers are not wrong, but they take up search result slots). The remaining 40 cases (T·V·D) are pairs where both documents are correct, so they can be resolved as 'keep both'.

## 2. F. Needs correction — 3 cases (priority 1)

### C248 Hourly flash sale: is price input "optional"?
| Document | Content |
|---|---|
| #2528 `GTJ-FLS-01-EN` Set Up Hourly Flash Sale (summary manual) | "For hourly flash sales, **price setup is optional**." |
| #2628 `GTJ-VID-08-EN` Video 8 (video guide) | Field `Giá FS cho 2 giờ đầu`\* (FS price for the first 2 hours) is **required**; `Giá FS cho 1 giờ thêm (Không bắt buộc)` (price per additional hour) is **optional** |

- Assessment: On the actual screen (video), the first-2-hours price is required. Only the additional-hour price is optional. The summary manual's "price is optional" seems not to distinguish between the two.
- Impact: If a reception staff member asks "Can I leave the price empty?", the AI may answer "It is optional."
- Recommended correction: Change the note in `GTJ-FLS-01` / `-EN` / `-VI` (#2508, #2528, #2548) to "The first-2-hours price is required; the additional-hour price is optional."

### C218 · C219 Stopping a flash sale: missing confirmation step
| Document | Content |
|---|---|
| #2510 `GTJ-FLS-03` Stop a Flash Sale (summary manual) | Select room and booking type on the timeline → details → [Stop program] → success notification |
| #2630 `GTJ-VID-10-EN` / #2578 `GTJ-VID-10-VI` (video guide) | Room type management › room type list, click the FS badge on the timeline → details modal → [Dừng chương trình] → **confirmation dialog [Xác nhận dừng]** → success notification |

- Assessment: The model judged C218 a contradiction ("the path is different") and C219 complementary, but both pairs are the same issue. The path is actually the same place (the summary's "timeline" = the timeline in the room type list). The only real difference is that **the summary lacks the confirmation dialog step**.
- Impact: The facts are not wrong, but staff may see the confirmation window and ask again, "A window popped up that is not in the manual."
- Recommended correction: In the procedure of `GTJ-FLS-03` / `-EN` / `-VI` (#2510, #2530, #2550), add the step "[Confirm/Xác nhận dừng] in the confirmation dialog", and write the path as "Room type management › Room type list › Timeline".

## 3. P. Policy documents registered twice — 3 cases

| Conflict | 8/20 version | 8/29 version | Difference |
|---|---|---|---|
| C210 | #2360 `BRD-18` Thỏa thuận dịch vụ (category `policy`) | #2565 `BRD-13` A. ĐIỀU KHOẢN SỬ DỤNG… (category `service agreement`) | Same body, 1 title line |
| C211 | #2361 `BRD-17` Chính sách bảo mật (`policy`) | #2566 `BRD-12` PHỤ LỤC I CHÍNH SÁCH BẢO MẬT… (`police_privacy`) | Same body |
| C212 | #2362 `BRD-16` Chính sách thanh toán (`policy_payment`) | #2567 `BRD-11` A. Phương thức thanh toán (`policy_price`) | Same body, only the title differs |

- Recommendation: Keep only one set. Amoeba's proposal is to **keep the 8/20 version (#2360~#2362) and deactivate the 8/29 version (#2565~#2567)**. The 8/29 version has a typo in a category name (`police_privacy`), and `policy_price` makes the payment policy look like a pricing policy.
- Go2Joy to confirm: Please confirm which source text is the latest terms. The bodies are the same now, but from now on only one set should be edited, so a master version must be chosen.

## 4. Q. FAQ: same answer, different questions — 32 cases

13 FAQ documents that differ only in the question share 2 copied answers. The 32 conflicts are the pairings among these 13 documents.

| Answer | Documents (question) |
|---|---|
| 3-step booking guide (app and web) | #2347 `BRD-31` Tôi muốn đặt phòng · #2348 `BRD-30` Tôi muốn đặt KS ở 1 đêm · #2349 `BRD-29` Cách đặt phòng · #2350 `BRD-28` Tôi muốn tìm KS ở quận 7 · #2351 `BRD-27` Bên KS mình còn phòng ko? · #2352 `BRD-26` Cho xin giá thuê KS này theo giờ ạ · #2353 `BRD-25` Có khách sạn tình yêu không? · #2354 `BRD-24` Muốn check-in lúc 12h đêm · #2355 `BRD-23` Xin giá phòng có bồn tắm · #2356 `BRD-22` Thuê phòng couple |
| Multiple rooms cannot be booked at once (book one room at a time, repeatedly) | #2357 `BRD-21` Đặt 2 phòng được không? · #2358 `BRD-20` Tôi muốn đặt nhiều phòng thì làm thế nào? · #2359 `BRD-19` Muốn đặt 2 phòng thì làm thế nào? |

Conflict IDs: C124~C155 (32 cases)

- Issue 1 (clean-up): With 10 copies of the same answer, these documents take the top search slots and push other source documents out.
- Issue 2 (content): Questions such as "I want to check in at midnight" (BRD-24), "price of a room with a bathtub" (BRD-23) and "find a hotel in District 7" (BRD-28) also get only the general booking guide. Go2Joy needs to confirm whether the answer fits the question.
- Issue 3 (scope): This FAQ is an answer for **booking customers**, but the AI agent scope of the `faq`·`policy` categories is empty (= all), so **the Hotel Admin agent also uses these documents as sources**. If a reception staff member asks "How do I make a booking?", the customer app booking guide may be returned.
- Recommendation:
  1. Keep only 1 document per answer (e.g. `BRD-29` Cách đặt phòng, `BRD-19`), move the other questions into that document's body as a "Similar questions" list, then deactivate the remaining 11.
  2. For questions that need their own answer (midnight check-in, bathtub rooms, area search, etc.), create separate documents once Go2Joy provides the answers.
  3. Decide with Go2Joy whether to narrow the AI agent scope of the `faq`·`policy` categories to the customer agents (`default`, `landing-guest`). These documents will be reused in phase 2 (per-hotel customer service agents), so do not delete them.

## 5. T. Language versions — 20 cases

These are the Korean version (no suffix), English version (`-EN`) and Vietnamese version (`-VI`) of the same item code. Matching content is expected, so they are resolved as 'keep both'.

| Conflict | Document A | Document B |
|---|---|---|
| C222 | #2517 GTJ-LCK-03 Room Lock – Overnight (Room Lock – Overnight) | #2537 GTJ-LCK-03-EN Room Lock – Overnight |
| C237 | #2524 GTJ-DIS-01-EN Create / Edit a Direct Discount Program | #2544 GTJ-DIS-01-VI Tạo / Sửa chương trình giảm giá trực tiếp (Create / Edit a Direct Disc |
| C207 | #2516 GTJ-LCK-02 Room Lock – By Day (Room Lock – By Day) | #2536 GTJ-LCK-02-EN Room Lock – By Day |
| C246 | #2528 GTJ-FLS-01-EN Set Up Hourly Flash Sale | #2548 GTJ-FLS-01-VI Thiết lập Flash Sale theo giờ (Set Up Hourly Flash Sale) |
| C244 | #2527 GTJ-DIS-04-EN Stop a Direct Discount Program | #2547 GTJ-DIS-04-VI Dừng chương trình giảm giá trực tiếp (Stop a Direct Discount Program) |
| C249 | #2529 GTJ-FLS-02-EN Set Up Overnight Flash Sale | #2549 GTJ-FLS-02-VI Thiết lập Flash Sale qua đêm (Set Up Overnight Flash Sale) |
| C243 | #2526 GTJ-DIS-03-EN View Discount Program List | #2546 GTJ-DIS-03-VI Xem danh sách chương trình giảm giá (View Discount Program List) |
| C240 | #2525 GTJ-DIS-02-EN Search Direct Discount Programs | #2545 GTJ-DIS-02-VI Tìm kiếm chương trình giảm giá trực tiếp (Search Direct Discount Progr |
| C234 | #2522 GTJ-DSH-01-EN View Dashboard | #2542 GTJ-DSH-01-VI Xem Bảng điều khiển (View Dashboard) |
| C236 | #2523 GTJ-REV-01-EN Reply to a Review | #2543 GTJ-REV-01-VI Trả lời đánh giá (Reply to a Review) |
| C225 | #2518 GTJ-LCK-04 Release Room Lock (Delete Room Lock Settings) | #2538 GTJ-LCK-04-EN Delete Room Lock Settings |
| C228 | #2519 GTJ-RPT-01 Download Special-Price Room Report (Download "Shock-Discount Room" Report) — *Needs completion (Updat | #2539 GTJ-RPT-01-EN Download "Shock-Discount Room" Report — *Pending update (Updating)* |
| C232 | #2521 GTJ-STA-01 Status Value Definitions (Status Values) | #2541 GTJ-STA-01-EN Status Values |
| C204 | #2515 GTJ-LCK-01 Room Lock – Hourly (Room Lock – Hourly) | #2555 GTJ-LCK-01-VI Khóa phòng – Theo giờ (Room Lock – Hourly) |
| C226 | #2518 GTJ-LCK-04 Release Room Lock (Delete Room Lock Settings) | #2558 GTJ-LCK-04-VI Hủy cài đặt khóa phòng (Delete Room Lock Settings) |
| C229 | #2519 GTJ-RPT-01 Download Special-Price Room Report (Download "Shock-Discount Room" Report) — *Needs completion (Updat | #2559 GTJ-RPT-01-VI Tải báo cáo "Phòng giá sốc" (Download "Shock-Discount Room" Report) —  |
| C230 | #2520 GTJ-GLS-01 Glossary (Glossary) | #2540 GTJ-GLS-01-EN Glossary |
| C233 | #2521 GTJ-STA-01 Status Value Definitions (Status Values) | #2561 GTJ-STA-01-VI Định nghĩa trạng thái (Status Values) |
| C224 | #2517 GTJ-LCK-03 Room Lock – Overnight (Room Lock – Overnight) | #2557 GTJ-LCK-03-VI Khóa phòng – Qua đêm (Room Lock – Overnight) |
| C231 | #2520 GTJ-GLS-01 Glossary (Glossary) | #2560 GTJ-GLS-01-VI Bảng thuật ngữ (Glossary) |


Note: The Korean versions (`GTJ-*` without a suffix) are the originals written by Amoeba. Vietnamese reception staff do not use them, so now that the default language is `vi`, they may only take up search slots. Whether to remove the Korean versions from the Hotel Admin scope can be decided at the operations handover (separate from this triage).

## 6. V. Summary manual ↔ video guide — 11 cases

These are summary manuals (`GTJ-DIS/FLS/SUR/DSH-*`) and video guides (`GTJ-VID-*`) for the same feature. The video guides contain more detail on screen names, input fields and example values, and no facts differ between them (pairs with differing facts were moved to F). They are resolved as 'keep both'.

| Conflict | Document A | Document B |
|---|---|---|
| C217 | #2509 GTJ-FLS-02 Set Up Overnight Flash Sale (Set Up Overnight Flash Sale) | #2629 GTJ-VID-09-EN Video 9 — Creating a Flash Sale for the Qua đêm (overnight) type |
| C238 | #2524 GTJ-DIS-01-EN Create / Edit a Direct Discount Program | #2622 GTJ-VID-02-EN Video 2 — Setting a per-room discount rate at step 2 of creating a dir |
| C241 | #2525 GTJ-DIS-02-EN Search Direct Discount Programs | #2626 GTJ-VID-06-EN Video 6 — Searching by name in the direct-discount program list |
| C239 | #2524 GTJ-DIS-01-EN Create / Edit a Direct Discount Program | #2623 GTJ-VID-03-EN Video 3 — Using the direct discount's Thiết lập hàng loạt (Bulk setup) |
| C215 | #2505 GTJ-DIS-02 Search Direct Discount Programs (Search Direct Discount Programs) | #2626 GTJ-VID-06-EN Video 6 — Searching by name in the direct-discount program list |
| C213 | #2504 GTJ-DIS-01 Create / Edit a Direct Discount Program (Create / Edit a Direct Discount Program) | #2622 GTJ-VID-02-EN Video 2 — Setting a per-room discount rate at step 2 of creating a dir |
| C242 | #2525 GTJ-DIS-02-EN Search Direct Discount Programs | #2574 GTJ-VID-06-VI Video 6 — Tìm theo tên trong danh sách chương trình giảm giá trực tiếp |
| C216 | #2505 GTJ-DIS-02 Search Direct Discount Programs (Search Direct Discount Programs) | #2574 GTJ-VID-06-VI Video 6 — Tìm theo tên trong danh sách chương trình giảm giá trực tiếp |
| C220 | #2511 GTJ-SUR-01 Set Up Surcharges (Set Up Surcharges) | #2631 GTJ-VID-11-EN Video 11 — Creating and saving a surcharge (Phụ thu) schedule |
| C214 | #2504 GTJ-DIS-01 Create / Edit a Direct Discount Program (Create / Edit a Direct Discount Program) | #2623 GTJ-VID-03-EN Video 3 — Using the direct discount's Thiết lập hàng loạt (Bulk setup) |
| C235 | #2522 GTJ-DSH-01-EN View Dashboard | #2620 GTJ-VID-00-EN Video 0 — A walkthrough of the Trang chủ (Home) dashboard |


## 7. D. Different procedures — 9 cases

Like the lock and flash sale procedures per booking type (hourly / by day / overnight), these screens only look similar; the procedures are different. They are resolved as 'keep both'.

| Conflict | Document A | Document B |
|---|---|---|
| C208 | #2516 GTJ-LCK-02 Room Lock – By Day (Room Lock – By Day) | #2517 GTJ-LCK-03 Room Lock – Overnight (Room Lock – Overnight) |
| C209 | #2516 GTJ-LCK-02 Room Lock – By Day (Room Lock – By Day) | #2537 GTJ-LCK-03-EN Room Lock – Overnight |
| C247 | #2528 GTJ-FLS-01-EN Set Up Hourly Flash Sale | #2529 GTJ-FLS-02-EN Set Up Overnight Flash Sale |
| C205 | #2515 GTJ-LCK-01 Room Lock – Hourly (Room Lock – Hourly) | #2516 GTJ-LCK-02 Room Lock – By Day (Room Lock – By Day) |
| C223 | #2517 GTJ-LCK-03 Room Lock – Overnight (Room Lock – Overnight) | #2536 GTJ-LCK-02-EN Room Lock – By Day |
| C227 | #2518 GTJ-LCK-04 Release Room Lock (Delete Room Lock Settings) | #2534 GTJ-QLK-02-EN Delete Quick Room Lock |
| C221 | #2513 GTJ-QLK-01 Set Up Quick Room Lock (Set Up Quick Room Lock) | #2563 BRD-1 Emergency Room Block Procedure (Draft) |
| C206 | #2515 GTJ-LCK-01 Room Lock – Hourly (Room Lock – Hourly) | #2517 GTJ-LCK-03 Room Lock – Overnight (Room Lock – Overnight) |
| C245 | #2527 GTJ-DIS-04-EN Stop a Direct Discount Program | #2541 GTJ-STA-01-EN Status Values |

- Exception **C221**: #2563 `BRD-1` "Emergency Room Block Procedure **(Draft)**" is an 85-character draft adopted from the knowledge board (registered 8/29). It is active and included in the Hotel Admin scope. Its content is a shortened version of #2513 `GTJ-QLK-01` Quick Room Lock. We recommend deactivating it (Go2Joy to confirm).

## 8. Action plan

| Step | Task | Target | Owner |
|---|---|---|---|
| 1 | Correct 6 summary manuals (whether price is required, confirmation step), then re-index | F: #2508 #2528 #2548 #2510 #2530 #2550 | Go2Joy confirms → Amoeba |
| 2 | Choose the master version of the policy documents; deactivate the other 3 | P: #2360~#2362 / #2565~#2567 | Go2Joy decides → Amoeba |
| 3 | Merge 13 FAQs into 2; send back the list of questions that need their own answer | Q: #2347~#2359 | Go2Joy decides → Amoeba |
| 4 | Decide the AI agent scope of the `faq`·`policy` categories | Whether to exclude Hotel Admin | Go2Joy decides |
| 5 | Deactivate the BRD-1 draft | #2563 | Go2Joy confirms |
| 6 | Resolve the 40 T·V·D conflicts as 'keep both' | The 40 relevant cases among C204~C249 | Amoeba (can do now) |

Once steps 1~5 are done, the related conflicts are cleared as the documents are deactivated or corrected. After clean-up, we run the conflict check once more to confirm the same pairs are not detected again.
