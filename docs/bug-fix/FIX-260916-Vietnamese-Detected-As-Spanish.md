# FIX-260916 — Tiếng Việt có dấu bị nhận diện thành tiếng Tây Ban Nha (phiên Go2Joy tự chuyển sang ES)

- **Phát hiện**: `AN-260907-SharpTalk-Go2Joy-Side-Impact.md` §3.4 (2026-09-07) khi rà mã cho yêu cầu FR-008; xác nhận còn nguyên trên `main` `eebe9e7` ngày 2026-09-16 (`AN-260916-Go2Joy-Partnership-Fit-QuickWins.md` §4 mục 1). Là việc đầu tiên của QW1.
- **Ảnh hưởng**: tenant `go2joy` (và mọi tenant có khách viết tiếng Việt). Phiên chưa khóa ngôn ngữ (`language_locked = 0`, tức mọi phiên không chọn tay), sau **2 lượt tiếng Việt liên tiếp** bị `syncSessionLanguage` chuyển sang `ES`; từ đó prompt RAG ghi `Reply in language code: ES`, các câu hệ thống (chuyển người, ngoài giờ, đóng phiên) cũng ra tiếng Tây Ban Nha. Đường vào chỉ dùng `?locale` (web embed, Android `launchUrl()`) đều lộ; đường có bridge `ivy:command/locale` khóa ngôn ngữ nên tránh được.
- **Phạm vi sửa**: 2 file mã + 2 file test, không schema, không i18n, không env.

## Tái hiện (test đỏ trước khi sửa)

`apps/api/src/global/util/detect-language.util.spec.ts` bổ sung 9 câu tiếng Việt thật (lấy từ lưu lượng staging và kịch bản Go2Joy). Chạy trên mã cũ:

```
Tests: 15 failed, 25 passed, 40 total
Expected: "VI"  Received: "ES"   ← 'Cho tôi hỏi giá phòng qua đêm', 'Khách sạn còn phòng không?', …
Expected: "VI"  Received: "EN"   ← 'đặt phòng theo giờ' (không có dấu sắc → rơi xuống Latin = EN)
```

## Nguyên nhân gốc

`detect-language.util.ts` (PLN-260813 D1) chỉ biết ba ngôn ngữ và kiểm tra theo thứ tự Hangul → **dấu Tây Ban Nha** → chữ Latin. Tập "dấu Tây Ban Nha" là `[ñÑ¿¡áéíóúÁÉÍÓÚüÜ]`, trong đó **á é í ó ú trùng với thanh sắc tiếng Việt** trên nguyên âm thường. Không có nhánh nào tìm tiếng Việt, nên:
- câu Việt có thanh sắc → `ES`;
- câu Việt chỉ có đ/ă/ơ/ư hoặc dấu khác → `EN` (vì `LATIN_LETTER` bắt được chữ thường).

Bộ chuyển ngôn ngữ (`chat.service.ts syncSessionLanguage`) tin kết quả này khi 2 lượt liên tiếp giống nhau và khác ngôn ngữ phiên — đúng thiết kế, sai đầu vào.

## Sửa (tối thiểu)

`apps/api/src/global/util/detect-language.util.ts`
1. Thêm lớp **`VIETNAMESE_ONLY`**: đ ă ơ ư, thanh hỏi/nặng trên mọi nguyên âm, mọi thanh chồng lên ă/â/ê/ô/ơ/ư, ngã trên e/i/u/y, huyền trên y — không ngôn ngữ Latin nào khác viết các chữ này → một ký tự là đủ kết luận `VI`. Kiểm tra **trước** tiếng Tây Ban Nha.
2. Tách dấu Tây Ban Nha thành **`SPANISH_ONLY`** (ñ ¿ ¡ ü) và **`ACUTE`** (á é í ó ú — dùng chung với thanh sắc).
3. Thêm lớp **`VIETNAMESE_SHARED`** (â ê ô, dấu huyền, ngã trên a/o) — dùng chung với Bồ Đào Nha/Ý/Pháp.
4. Thêm tham số tùy chọn **`bias`** = ngôn ngữ hiện tại của phiên. Chỉ dùng cho dấu **dùng chung**: phiên `VI` → `VI`; phiên khác → giữ đúng hành vi cũ (acute → `ES`, shared-only → `EN`). Nhờ vậy:
   - "còn phòng không", "có xe máy" trên phiên Go2Joy (đã `VI` nhờ `default_language`, PR #521) **không còn bị đổi sang ES**;
   - "Não recebi meu pedido" trên ivyusa vẫn là `EN` như trước (không đẩy khách Bồ Đào Nha sang tiếng Việt);
   - "¿Cuándo llega mi pedido?" vẫn `ES` kể cả trên phiên `VI` (ñ/¿ không có trong tiếng Việt).
5. `DetectedLanguage` mở rộng `'EN' | 'ES' | 'KO' | 'VI'`; `LATIN_LETTER` mở rộng tới khối Latin Extended Additional để chữ Việt được tính là chữ Latin.

`apps/api/src/domain/chat/chat.service.ts` — hai lời gọi `detectLanguage(...)` trong `syncSessionLanguage` truyền thêm `session.language` (cả lượt hiện tại và lượt trước, để phép so "2 lượt giống nhau" dùng cùng một bias).

## Giới hạn còn lại (ghi nhận, không sửa trong FIX này)
- Câu Việt **chỉ có thanh sắc hoặc chỉ có dấu dùng chung** trên phiên **không phải VI** (ví dụ phiên EN vì `?locale=en` tường minh) vẫn đọc là `ES`/`EN` như cũ; lượt kế tiếp có bất kỳ đ/ă/ơ/ư/hỏi/nặng sẽ chuyển đúng. Đây là giới hạn của nhận diện theo dải ký tự (PLN-260813 §8), chấp nhận như đã chấp nhận với tiếng Tây Ban Nha không dấu.
- Chưa nhận diện JA/ZH (registry có, detector chưa) — không thuộc lỗi này; thêm sau theo cùng mẫu (Kana/Hán là dải rời).
- `classifyIntent()` vẫn không nhận gợi ý ngôn ngữ (AN-260907 §3.4) — việc riêng.

## Kiểm chứng
- `detect-language.util.spec.ts` + `chat.service.session-language.spec.ts`: **54/54** pass (thêm 4 ca hồi quy phiên: VI giữ VI qua 2 lượt Việt; VI giữ VI với lượt chỉ thanh sắc; EN → VI sau 2 lượt Việt; VI → EN sau 2 lượt ASCII).
- `tsc --noEmit` apps/api: pass.
- Toàn bộ jest apps/api: xem RPT/PR (chạy trước khi mở PR).
- Staging: sau khi deploy, mở widget go2joy với `?locale=en`, gõ 2 câu Việt → `sessions.language` phải là `VI` (trước đây `ES`); log `session language detected: session=… → VI`.

## Mẫu phòng ngừa
- **Bộ phân loại theo dải ký tự phải kiểm tra ngôn ngữ có tập ký tự "độc quyền" trước, và tách tập dùng chung ra riêng.** Gộp ký tự dùng chung vào dấu hiệu của một ngôn ngữ (á é í ó ú = Tây Ban Nha) là lỗi cấu trúc, không phải thiếu dữ liệu.
- **Thêm ngôn ngữ vào registry (`packages/types/src/common/language.ts`) phải kèm một ca test tiếng đó trong `detect-language.util.spec.ts`** — vi/ja/zh vào registry 2026-08-17 mà detector không đổi là khoảng trống đúng kiểu "silent fallback" của repo này (`i18n:check` không bắt được vì không phải khóa dịch). Đề xuất: khi thêm dòng registry mới, `detect-language.util.spec.ts` có một ca cho ngôn ngữ đó (pass hoặc ghi rõ là "chưa nhận diện" bằng `it.todo`).
