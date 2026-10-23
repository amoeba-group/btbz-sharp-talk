# FIX-261023 go2joy "Watch video" 링크가 빈 탭을 엶 — Notion 영상 블록 ID 변경

- 작성일: 2026-10-23 · 대상: 스테이징 go2joy(테넌트 4) · 관련: PLN-261006-KB-Video-Links, FIX/PR #648(노션 토큰 교체)
- 상태: **수정 완료** — F1·F2 스테이징 데이터 적용(2026-10-23), F3 재발 방지 코드(본 PR)

## 1. 증상

AI 답변의 "Knowledge referenced"에서 **Watch video**를 누르면 새 탭에
"This video cannot be played right now. Please try again later."만 표시된다.
예: `GET /api/v1/kb-videos/2644?t=4&sig=…` → **503**.

## 2. 원인 (로그·재현으로 확정)

1. 링크 경로: `kb-videos/:id` → `KbVideoService.resolve` → 문서 `video_ref = notion:<blockId>` →
   테넌트의 Notion 토큰으로 `GET /blocks/<blockId>` → 파일 URL로 302.
2. 스테이징 API 로그:
   `kb video unavailable: notion Could not find block with ID: cba8fee0-…-81a7ea779bf2. Make sure the relevant pages and databases are shared with your integration "HA-UserGuide". (doc 2644)`
3. 현재 go2joy 토큰의 통합은 **"HA-UserGuide"(워크스페이스 Go2Joy)** — 볼 수 있는 페이지는 4개뿐이고,
   10/06에 영상 블록을 읽어 온 **원본 페이지 `8968fee0bb548347a35e01756b4cc89c`와 그 블록 63개는 모두 404**.
4. 같은 영상들은 공유된 새 페이지 **"Hướng dẫn sử dụng Hotel Admin" (`bfb56ba489b9429fba706ed8f96bedde`)** 아래
   하위 페이지 구조로 옮겨져 있다. 영상 블록 **63개, 같은 순서**(Notion이 복제·이동 시 블록 ID를 새로 발급).
   - 순서 대조: Video 24=“Báo cáo đặt phòng” 일치, Video 21~23(체크인·노쇼·열 조정)=새 “Quản lý đặt phòng”,
     37~41(쿠폰)=“Quản lý khuyến mãi”, 50(직원 삭제)=“Quản lý nhân viên” — 제목 차이는 하위 페이지 재편·이모지뿐.
   - **새 블록 63개 전부 `NotionClient.videoUrl` → 실제 파일 응답(200/206) 확인.**

→ **코드 결함이 아니라 데이터(참조) 노후화**: `kb_documents.video_ref` 126건(문서 VI/EN × 63편)이 더 이상
존재하지 않는(접근 불가한) 옛 블록 ID를 가리킨다. 10/19 노션 토큰 교체(PR #648, "통합 가시범위 리셋") 이후
Go2Joy가 문서를 새 워크스페이스/페이지로 옮기면서 끊긴 것으로 판단.

영향 범위: 스테이징 테넌트 4 영상 문서 **126건 전부(100%)**. 프로덕션은 영상 문서 0건 → 영향 없음.

## 3. 수정 (2026-10-23 사용자 승인 — 1·2·3 진행)

| # | 내용 | 영향 |
|---|---|---|
| F1 | `reference/go2joy-hotel-admin-video-blocks.json` 갱신 — `blockId`=새 ID, `oldBlockId`·`notionPageId` 보존, 루트 `pageId`=`bfb56ba4…` | 저장소 데이터만 |
| F2 | 기존 `scripts/go2joy-video-refs-sql.mjs 4`로 UPDATE SQL 생성 → 스테이징 백업 후 적용(126행, external_key `GTJ-VID-NN-VI/EN`) | 재임베딩 없음(영상만 변경), 문서 id·서명 URL 불변 → **이미 나간 답변의 링크도 그대로 살아남** |
| F3 | Redis `kbvideo:4:*` 캐시는 블록 ID 키라 정리 불필요 | — |

| F3 | 재발 방지 코드 — 아래 §4 | 동작 변화: 끊긴 참조는 503 대신 404 페이지 + error 로그 |

**적용 기록 (스테이징, 2026-10-23 16:5x KST)**
- 사전 대조: 테넌트 4 `video_ref` 126행 전부가 `GTJ-VID-NN` ↔ 옛 블록 대응과 일치(불일치 0).
- 백업 `~/backups/pre-261023-go2joy-video-ref.tsv`, 적용 SQL `~/backups/261023-go2joy-video-ref-apply.sql`,
  롤백 SQL `~/backups/261023-go2joy-video-ref-rollback.sql`(행 id 단위 원복).
- 적용 후: 126행·고유 63개, 옛 워크스페이스 ID 잔존 0. 사용자 보고 링크
  `kb-videos/2644?t=4&sig=…` → **302 → Notion 파일(S3)**. 새 블록 63개 전부 파일 응답 200/206 확인.

## 4. 재발 방지

- 노션 블록 ID는 **페이지 복제·이동·워크스페이스 이전 시 바뀐다** — 토큰 교체/재공유 후에는 영상 참조 전수 점검이 필요.
- **F3-a 분류**: `KbVideoService.resolve`가 Notion `object_not_found`/404를 `broken`으로 구분 →
  고객에게는 404 "This video link is not available.", 서버에는 `logger.error("kb video ref broken … re-point video_ref")`.
  레이트리밋·네트워크 등은 기존대로 `unavailable`(503, warn).
- **F3-b 점검 CLI**: `npm run kb:video-check [-- --tenant N]` / 컨테이너 `node dist/database/kb-video-check.js --tenant 4` —
  활성 문서의 영상 참조를 캐시 없이 전수 확인(블록당 1회), 문제 행 출력·있으면 exit 1.
  **노션 토큰 교체·재공유 후 반드시 실행.**
- 재지정 절차: 새 페이지에서 영상 블록을 순서대로 읽어 `reference/go2joy-hotel-admin-video-blocks.json` 갱신 →
  `node scripts/go2joy-video-refs-sql.mjs <tenant>` → 백업 후 적용 → `kb:video-check`.

## 5. 원본 영상 링크 대응표 (Notion, 새 워크스페이스)

| Video | 제목 | 옛 블록(404) | 새 블록 | 원본 링크 |
|---|---|---|---|---|
| 0 | A walkthrough of the `Trang chủ` (Home) dashboard | `4648fee0bb548292bc6381250b79b647` | `27e6dfbd464d807c8af6cacc3d74bc65` | [열기](https://app.notion.com/p/e7eaa041138e461496050fe4e6aed4e4#27e6dfbd464d807c8af6cacc3d74bc65) |
| 1 | Opening a review's detail, then writing and sending a `Trả lời` (reply) | `3ac8fee0bb548208aca3817093a010d5` | `e580bdb1dcb04ff08b8d08ba97cf8159` | [열기](https://app.notion.com/p/412d961a21ab4858a86198a8046e9039#e580bdb1dcb04ff08b8d08ba97cf8159) |
| 2 | Setting a per-room discount rate at step 2 of creating a direct-discount program | `c118fee0bb548237907b811490142c9b` | `0128305bf3274e748917c7f595fe6f7a` | [열기](https://app.notion.com/p/2292c728cce64ac4b3be9584a58d0494#0128305bf3274e748917c7f595fe6f7a) |
| 3 | Using the direct discount's `Thiết lập hàng loạt` (Bulk setup) to apply a discount to several hotels and rooms at once | `d378fee0bb54826087a501d00a08c1cc` | `0ddbf4d790d6430e9a7755fdff490eb5` | [열기](https://app.notion.com/p/9f0d784231e64328825acd98047a2d44#0ddbf4d790d6430e9a7755fdff490eb5) |
| 4 | Adding a participating hotel to an already-created direct-discount program | `5278fee0bb54825b8c0181f91d54e2a9` | `17f55cb9a81d497eaad164a0662ca9a9` | [열기](https://app.notion.com/p/06063ea10508466eb7bd4e857496f36f#17f55cb9a81d497eaad164a0662ca9a9) |
| 5 | Editing the discount rate of an already-configured program | `4288fee0bb54835e8201819155c16ac0` | `6876c2554ef142bda35e69ce8d8794be` | [열기](https://app.notion.com/p/7bc8f92728fe4ac1a9e88195bd4bab83#6876c2554ef142bda35e69ce8d8794be) |
| 6 | Searching by name in the direct-discount program list | `7168fee0bb54827d8d7f814090cb2e5f` | `e485be1d24874c08bcea4053e05c3a77` | [열기](https://app.notion.com/p/bdd6df33ac0b4a029643585ca1c55d38#e485be1d24874c08bcea4053e05c3a77) |
| 7 | Searching by `Trạng thái` (status) in the direct-discount program list | `fe68fee0bb5482349e49018853fd3468` | `1fe2e443f05748909e88cc70995392ad` | [열기](https://app.notion.com/p/1437dc1621f7445aa00bffe92fb57913#1fe2e443f05748909e88cc70995392ad) |
| 8 | Creating an hourly (`Theo giờ`) `Flash Sale` program | `9588fee0bb5482b2910d01f099bdf875` | `a09ea9a867a34f9b88cd88a52184930e` | [열기](https://app.notion.com/p/d30ab17ac1f44dd3babd81ebc23ffd87#a09ea9a867a34f9b88cd88a52184930e) |
| 9 | Creating a Flash Sale for the `Qua đêm` (overnight) type | `7a08fee0bb54829aad028195e5197507` | `3c936074b0e9473bb2087ec3762bc616` | [열기](https://app.notion.com/p/a32d7294641a480588fee24f07b8f849#3c936074b0e9473bb2087ec3762bc616) |
| 10 | Stopping a Flash Sale (`Dừng chương trình` = Stop program) | `6378fee0bb548322ad37813d0825d810` | `62d6e7a537b74d03b563bcba8de52a7d` | [열기](https://app.notion.com/p/d2ecdc7713984c0ab55f938100d064ce#62d6e7a537b74d03b563bcba8de52a7d) |
| 11 | Creating and saving a surcharge (`Phụ thu`) schedule | `0bf8fee0bb5482cda3c501e5bc26fad1` | `3678c43145f849c3bcc273e7e85d1936` | [열기](https://app.notion.com/p/80864435733c49359dcb5661ee68d4fe#3678c43145f849c3bcc273e7e85d1936) |
| 12 | Deleting a surcharge (`Phụ thu`) schedule | `f028fee0bb5482008ee48196f3653a22` | `d09970bbec2d492086ffdc955a289a8a` | [열기](https://app.notion.com/p/80864435733c49359dcb5661ee68d4fe#d09970bbec2d492086ffdc955a289a8a) |
| 13 | Creating a room-blocking schedule: `Theo giờ` (hourly, with a specified time window) | `7ab8fee0bb548238b11d8133a2631b94` | `8d05bb4d50ef45d6b2549c1bfe86e5d5` | [열기](https://app.notion.com/p/99831012fc694448b6cea687221de3e6#8d05bb4d50ef45d6b2549c1bfe86e5d5) |
| 14 | Creating a room-blocking schedule: `Theo ngày` (daily) | `d678fee0bb5482538ce981ca65942ef3` | `47202950e4944dfe86fd647ccac1c2d8` | [열기](https://app.notion.com/p/a1be449bc1fa4a5681c9e21889493914#47202950e4944dfe86fd647ccac1c2d8) |
| 15 | Creating a room-blocking schedule: `Qua đêm` (overnight) | `ec58fee0bb5482a0b190813110190e9b` | `8f47765098734c39aa8e2f7bf0af3e7e` | [열기](https://app.notion.com/p/60e2af2fd32b4c6fb8d85d0db3ddf55c#8f47765098734c39aa8e2f7bf0af3e7e) |
| 16 | Deleting a room-blocking schedule | `b748fee0bb5482798dc10139399da4fa` | `91568cb01f644421b8d91788cfac3b5e` | [열기](https://app.notion.com/p/41627e6a5a914417b7579a71c0a40563#91568cb01f644421b8d91788cfac3b5e) |
| 17 | The basic `Huỷ đặt phòng` (cancel booking) flow: choose a specific reason, then cancel and refund immediately | `82a8fee0bb54836a9d218108a4db98b3` | `1dd6dfbd464d80c097dfcd01da7172e1` | [열기](https://app.notion.com/p/1dd6dfbd464d809dbe25e1183863cc73#1dd6dfbd464d80c097dfcd01da7172e1) |
| 18 | Requesting Go2Joy to cancel a policy-violating booking (transition to `Chờ G2J xử lý`) | `3818fee0bb54824fa96a01855cca7c28` | `1dd6dfbd464d809cacebe8d74918f412` | [열기](https://app.notion.com/p/a97ef2d2886342ff97752f88d52f9bec#1dd6dfbd464d809cacebe8d74918f412) |
| 19 | Cancelling a booking (reason `Khách sạn muốn dừng hợp tác` → immediate cancellation and refund) | `7138fee0bb548204b5a68111a39fdbe1` | `1dd6dfbd464d805192edf9b0a43f4367` | [열기](https://app.notion.com/p/fa6c6bfb44094ee1b0276a9bc4c906cf#1dd6dfbd464d805192edf9b0a43f4367) |
| 20 | Requesting cancellation of a pay-at-hotel (`Thanh toán tại khách sạn`) booking → waiting for G2J to process | `72f8fee0bb54838fb93b01574c7251ab` | `1dd6dfbd464d80779505e5f129ccfab5` | [열기](https://app.notion.com/p/ca123827236f4b7192a474191b5c9df9#1dd6dfbd464d80779505e5f129ccfab5) |
| 21 | Processing a check-in (`Nhận phòng`) | `8188fee0bb54824bbe4e0129344fac12` | `9eb5de0d82da4d24b21058de35bf2e1b` | [열기](https://app.notion.com/p/5e2e578ab5c14cf4991e63e54efbae13#9eb5de0d82da4d24b21058de35bf2e1b) |
| 22 | Reporting a no-show (`Khách không đến`) | `dab8fee0bb54834795e001304c3ed4f1` | `4810477a33774264a602da1d96878d5a` | [열기](https://app.notion.com/p/7c58d44ce42e409ea48302f82a27f06c#4810477a33774264a602da1d96878d5a) |
| 23 | Adjusting table columns (`Chỉnh cột`) — changing column visibility and order | `1de8fee0bb548242b9e0815df30d63b7` | `b9544668b9ae440090bba001311afcfb` | [열기](https://app.notion.com/p/296c2be53ffb4536abc3e663b8f780bf#b9544668b9ae440090bba001311afcfb) |
| 24 | Looking up the booking report (`Tìm kiếm`) — changing the period and searching again | `cba8fee0bb5483c7b45381a7ea779bf2` | `2ba148fd418542a6b9685947112aacd4` | [열기](https://app.notion.com/p/0d75ee517c64477785d75b216542a25c#2ba148fd418542a6b9685947112aacd4) |
| 25 | Browsing and searching the reconciliation list (`Quản lý đối soát` list/filter) | `c328fee0bb548264a0ea81ad27bb0b2a` | `800e19e7bd1f42fe953cbed385cf7a97` | [열기](https://app.notion.com/p/edd678fbe1914423b76d412cd88790b4#800e19e7bd1f42fe953cbed385cf7a97) |
| 26 | Viewing the reconciliation detail (`Chi tiết đối soát`) | `e198fee0bb548344bffb81debe69b831` | `b2469a47d31e49a083cfd8e85915f19b` | [열기](https://app.notion.com/p/c56f7e452375488799865a1c84f9b84e#b2469a47d31e49a083cfd8e85915f19b) |
| 27 | Completing a reconciliation (`Hoàn tất đối soát`) | `8e18fee0bb5483d09ce10171442d3485` | `d2113aa1d1f34ac19e10acb6a26c0e00` | [열기](https://app.notion.com/p/a228fe4fa467415bb19feeaccce8bd62#d2113aa1d1f34ac19e10acb6a26c0e00) |
| 28 | Requesting a payment-information update (`Yêu cầu cập nhật thông tin thanh toán`) | `8a78fee0bb5482de9e78815ba58be66a` | `1207264ff6bf4ff0b518ee350c22a1af` | [열기](https://app.notion.com/p/38094535ceb448d292a7dea9d812bf25#1207264ff6bf4ff0b518ee350c22a1af) |
| 29 | Filing a complaint on a booking (`Khiếu nại đặt phòng`) and sending it to Go2Joy | `2ba8fee0bb5482dd9c3b0138128ee370` | `1fcf527b4f7046c2bd50289f33c7b234` | [열기](https://app.notion.com/p/64f933abf9e54b6abccd757891b68571#1fcf527b4f7046c2bd50289f33c7b234) |
| 30 | Viewing the reconciliation history (`Lịch sử đối soát`) | `c438fee0bb5482ea88688166a715b128` | `a87656398a544be6af84c34bf1d16e84` | [열기](https://app.notion.com/p/5dab632d95614ca0b9e4771223e7fdca#a87656398a544be6af84c34bf1d16e84) |
| 31 | Checking the complaint-handling result (`Chi tiết` / result badges) | `ad78fee0bb548239b9f081fff5bedb03` | `1c8bec3c6b62463d9f4043351851d4e8` | [열기](https://app.notion.com/p/59b573ebcd1f4cbea410cf0127d445df#1c8bec3c6b62463d9f4043351851d4e8) |
| 32 | Editing product information (`Sửa sản phẩm`) | `cd18fee0bb54827692778183b52b0f53` | `d3aaa00014f3447b8276d76df7449df4` | [열기](https://app.notion.com/p/b14f4543310140368cdf89d28d55efeb#d3aaa00014f3447b8276d76df7449df4) |
| 33 | Registering a product (`Tạo sản phẩm mới` / creating a new product) | `2898fee0bb54821fbd1d01ed78dd9993` | `c54405cd138d4dc4b3389ce9da7c7da7` | [열기](https://app.notion.com/p/43946d8d7f7844d28ecfa97e4cd975df#c54405cd138d4dc4b3389ce9da7c7da7) |
| 34 | Viewing the coupon list and filtering by status / sponsorship type | `2978fee0bb54838e984c81973e2ee3d0` | `1b0c7c6844d246159c5c4d3db5a34ed3` | [열기](https://app.notion.com/p/4da3b709c218446089b71513670b140f#1b0c7c6844d246159c5c4d3db5a34ed3) |
| 35 | Registering to join a coupon (the `Đăng ký` button on the list screen) | `88b8fee0bb548306bef501390c6f30ae` | `46fd39a8abed4738b2c2b98431499619` | [열기](https://app.notion.com/p/98616b3fe56e40528c874f788669afa4#46fd39a8abed4738b2c2b98431499619) |
| 36 | Registering to join a coupon (the `Đăng ký` button on the coupon detail screen) | `05e8fee0bb54823986d7013f7951ab00` | `7027faa884d04d3982b086a33d0efb2f` | [열기](https://app.notion.com/p/98616b3fe56e40528c874f788669afa4#7027faa884d04d3982b086a33d0efb2f) |
| 37 | Registering additional hotels for a coupon (`Đăng ký thêm`) | `f278fee0bb5483079f9a8114326db532` | `d060f7adcd51417c9829781efb9cc3cd` | [열기](https://app.notion.com/p/e7c59dc70c28407d9ece8f77045b951f#d060f7adcd51417c9829781efb9cc3cd) |
| 38 | `Tạo coupon` (Create coupon) — created by the hotel itself, without a sponsor | `78e8fee0bb5483a585bb8192ef6d9b91` | `b1ff7c7439804984aea1d909c3fe567f` | [열기](https://app.notion.com/p/2c26dfbd464d8066a3c1dc0ce98314bc#b1ff7c7439804984aea1d909c3fe567f) |
| 39 | `Tạo coupon` (Create coupon) — using 100% Go2Joy sponsorship (Coupon Back) 🔥 | `96d8fee0bb548285af2801121c1e93bd` | `2c26dfbd464d80e29f54f0c35153478c` | [열기](https://app.notion.com/p/2c26dfbd464d80c3a81ccbe58500f843#2c26dfbd464d80e29f54f0c35153478c) |
| 40 | `Dừng coupon` (stopping a coupon) and `Huỷ đăng ký coupon` (cancelling a registration) | `c918fee0bb5482cf9746814d8ab9edbd` | `49022d1daaa6487b9a8cd04170814059` | [열기](https://app.notion.com/p/4bedea3b3eba48a08387fb291c60dc8f#49022d1daaa6487b9a8cd04170814059) |
| 41 | `Đăng ký coupon` (registering for a Go2Joy coupon) and `Tiếp tục chạy coupon` (resuming operation) | `2d58fee0bb548322954981351858e43e` | `8f11e4699e9649e3811637690fc8da7d` | [열기](https://app.notion.com/p/9f3138f868ff40b6bb7697e40b62c844#8f11e4699e9649e3811637690fc8da7d) |
| 42 | Viewing the detail of a notification (campaign) | `0dc8fee0bb5482a99350810f3833c60c` | `2696dfbd464d805ab6abfdef99640c28` | [열기](https://app.notion.com/p/2696dfbd464d809e89c8c714874179be#2696dfbd464d805ab6abfdef99640c28) |
| 43 | Creating a notification campaign (`Tạo chiến dịch`) | `4ee8fee0bb548341bb1f0177682d11df` | `2696dfbd464d809c986ecb4df0cf23cf` | [열기](https://app.notion.com/p/2696dfbd464d800dbc6be1d61d41c04c#2696dfbd464d809c986ecb4df0cf23cf) |
| 44 | Stopping a notification (`Dừng` from the list) | `bad8fee0bb5482628f1e01579a3ee2c7` | `2696dfbd464d80d39aaee216ba3aeac8` | [열기](https://app.notion.com/p/2696dfbd464d809db346da027a8f7ab2#2696dfbd464d80d39aaee216ba3aeac8) |
| 45 | Stopping a notification (from the detail screen) | `32f8fee0bb548321adbb017cdea916b3` | `2706dfbd464d80c7811ccc83f22ad979` | [열기](https://app.notion.com/p/2696dfbd464d809db346da027a8f7ab2#2706dfbd464d80c7811ccc83f22ad979) |
| 46 | Searching for a staff account and viewing its detail | `70a8fee0bb5483b0a5e301eb1bca48d2` | `1b8fa5730c024682a0ba88b286254728` | [열기](https://app.notion.com/p/35de374d4b92490db7c992b9036381fe#1b8fa5730c024682a0ba88b286254728) |
| 47 | Editing staff information (`Sửa thông tin nhân viên`) | `6de8fee0bb548248973581cc781729c9` | `3cab4046a06b48398e9e094233928771` | [열기](https://app.notion.com/p/27f9185b9c2e48bfa099d002930df342#3cab4046a06b48398e9e094233928771) |
| 48 | Creating a new staff member — a `Lễ tân` (front desk) account | `dc88fee0bb548355bd08817fc4a8c07e` | `a5ab0355f30e4ab2a6ce46e670d7a125` | [열기](https://app.notion.com/p/c5c7e7d03e4f4d1da657785fa6a0ac51#a5ab0355f30e4ab2a6ce46e670d7a125) |
| 49 | Creating a new staff member — a `Quản lý` (manager) account | `f1b8fee0bb5483fc95848100d2bd7be0` | `058b6bb3e3a947aeabafef0b9132d7fd` | [열기](https://app.notion.com/p/19bb8780067a4b369a97bdc0f5553802#058b6bb3e3a947aeabafef0b9132d7fd) |
| 50 | Deleting a staff member (`Xoá nhân viên`) | `f338fee0bb548282bf030189f14e8d05` | `9a774b100b44423a8a59d3c75d94af56` | [열기](https://app.notion.com/p/c3533cd8f47242b5ad0f02aa9e555fb3#9a774b100b44423a8a59d3c75d94af56) |
| 51 | Sending a message to Go2Joy (`Tin nhắn từ G2J` → `Thêm`) | `e568fee0bb54826d9395813284c8f10f` | `247dbdec56634387ab9e05041826055d` | [열기](https://app.notion.com/p/1f4e44deb64d4eff80cd30628718edb0#247dbdec56634387ab9e05041826055d) |
| 52 | Replying to a Go2Joy message (`Trả lời`) | `19c8fee0bb548299a02d8125515fc7b7` | `1092c6b613eb4c9cbf6665708dd2f8a8` | [열기](https://app.notion.com/p/1265f8e9e12449d2a47922a2f7179413#1092c6b613eb4c9cbf6665708dd2f8a8) |
| 53 | Chatting with guests (new) | `b1c8fee0bb5482c4b03d01a3eb58bb7e` | `3106dfbd464d80359422de49619c2646` | [열기](https://app.notion.com/p/30f6dfbd464d80fa8b50cb8671390236#3106dfbd464d80359422de49619c2646) |
| 54 | Editing the hotel's general information and hotel policy | `7258fee0bb5482d5906c015c7cf42b85` | `19b9bb8d36724d29b58e25174f5749a6` | [열기](https://app.notion.com/p/54c7e9a8f3f547a6abb88cee7d93001c#19b9bb8d36724d29b58e25174f5749a6) |
| 55 | Creating a new room type (`Tạo loại phòng` → `Gửi duyệt`) | `1558fee0bb548244a45a0196472bee6a` | `2176dfbd464d8027b852e5ef65d1f4f0` | [열기](https://app.notion.com/p/2166dfbd464d806dbd1ac90db23f2b2b#2176dfbd464d8027b852e5ef65d1f4f0) |
| 56 | Stopping sales of a room type | `c748fee0bb5483ca8280016d3b921997` | `2176dfbd464d80d0bfdedc1358c57a06` | [열기](https://app.notion.com/p/2166dfbd464d8083a7cdf9de3eeb359c#2176dfbd464d80d0bfdedc1358c57a06) |
| 57 | Reopening sales of a room type | `92a8fee0bb5482118f9001c67bdc40d1` | `2176dfbd464d809dbe04c77b80d133a5` | [열기](https://app.notion.com/p/2166dfbd464d80539785ed5367680bc0#2176dfbd464d809dbe04c77b80d133a5) |
| 58 | Creating a cancellation policy | `9d18fee0bb548246aef401584ef1048c` | `1d26dfbd464d801ab6b9ea49fdced0f0` | [열기](https://app.notion.com/p/1d26dfbd464d80f2b371d45e5908d98e#1d26dfbd464d801ab6b9ea49fdced0f0) |
| 59 | Editing a cancellation policy's content | `c768fee0bb5483fc8c5601bfbccdc495` | `1d26dfbd464d80d48b1ee652b288db7f` | [열기](https://app.notion.com/p/1d26dfbd464d80498fc7f7fe4489da55#1d26dfbd464d80d48b1ee652b288db7f) |
| 60 | Stopping a cancellation policy | `b278fee0bb5483fdbe6801839f3a1eeb` | `1d26dfbd464d8031a5dee935bb4110b9` | [열기](https://app.notion.com/p/1d26dfbd464d80bf9eb6d9e2687baf3f#1d26dfbd464d8031a5dee935bb4110b9) |
| 61 | Connecting a partner channel (PMS) | `3b88fee0bb5483e3833a0141a9e7c5d0` | `2176dfbd464d809f89afcfef1f676d34` | [열기](https://app.notion.com/p/2176dfbd464d809a92e6da24aa081a4d#2176dfbd464d809f89afcfef1f676d34) |
| 62 | Disconnecting a partner channel | `8008fee0bb548262a83e0182f0e6d84f` | `2176dfbd464d807eb6e1cf908ec85bd9` | [열기](https://app.notion.com/p/2176dfbd464d8062abf3c610dd596ae8#2176dfbd464d807eb6e1cf908ec85bd9) |

## 6. 배포 상태

| 항목 | 상태 |
|---|---|
| PR | #706 squash-merge → main `7516298c` (CI 통과) |
| 마이그레이션 | 없음(스키마 변경 없음) |
| 스테이징 | ✅ 데이터 F1·F2 적용 + 코드 배포(2026-10-23). api healthy·부팅 로그, `kb-video-check --tenant 4` = 126건 문제 0, 보고 링크 302 |
| 프로덕션 | ✅ `production` ff `c90cdb89..7516298c` → `deploy-self-hosted.sh --check`(누락 0) → 배포. api healthy·부팅 로그, `kb-video-check` = 영상 문서 0건(데이터 수정 불필요), 잘못된 서명 404 |
