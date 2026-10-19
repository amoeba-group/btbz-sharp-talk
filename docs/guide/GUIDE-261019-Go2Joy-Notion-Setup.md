# GUIDE-261019 Go2Joy 노션 지식 연동 — 설정 가이드 (Go2Joy 측 작업 사항, KO/VI)

- 대상: Go2Joy 노션 워크스페이스 관리자 (통합 "HA-UserGuide" 소유자)
- 근거: `docs/analysis/REQ-261019-Notion-Sync-500-Error-Reporting.md`, 스테이징 실측 2026-10-19
- 이전 안내: `GUIDE-260828-Go2Joy-Notion-Connection.md` (통합 "Truc connection" 기준 — 10/16 토큰 교체로 내용이 바뀌어 본 문서로 대체)

---

## 1. 현재 상태 / Tình trạng hiện tại (2026-10-19 실측)

**KO** — SharpTalk 쪽 설정은 모두 정상입니다. 토큰은 유효하고, 통합의 정체와 접근 범위를 Notion API로 직접 확인했습니다.

| 항목 | 확인 결과 |
|---|---|
| 등록된 통합 | **"HA-UserGuide"** (10/16 교체) |
| 통합이 속한 워크스페이스 | **Go2Joy** |
| 통합이 볼 수 있는 페이지 | **1건뿐** — "Hướng dẫn sử dụng Hotel Admin" (ID `bfb56ba4…`) |

SharpTalk에 등록된 노션 소스 3건은 **전부 동기화 실패** 상태이며, 원인은 모두 같습니다 — **해당 페이지가 "HA-UserGuide" 통합에 연결(Connections)되어 있지 않습니다.**

| # | SharpTalk 소스 이름 | 등록된 노션 대상 | 상태 |
|---|---|---|---|
| 1 | Go2Joy Hotel FAQ (Notion) | `hotel-go2joy.notion.site/FAQ-f03737634c38…` | ❌ 미연결 |
| 2 | Hướng dẫn sử dụng Hotel Admin | `…8968fee0bb548347a35e01756b4cc89c` | ❌ 미연결 (※ 통합에는 같은 제목의 다른 ID `bfb56ba4…`만 보임 — §2-D) |
| 3 | Hướng dẫn đăng ký khách sạn trên Go2Joy | `…2026dfbd464d800085cedea4c57f8d15` | ❌ 미연결 |

**VI** — Cấu hình phía SharpTalk đã hoàn tất và hợp lệ. Chúng tôi đã kiểm tra trực tiếp qua Notion API: integration **"HA-UserGuide"** thuộc workspace **Go2Joy** và hiện **chỉ nhìn thấy 1 trang** ("Hướng dẫn sử dụng Hotel Admin", ID `bfb56ba4…`). Cả 3 nguồn Notion đã đăng ký trong SharpTalk đều **đồng bộ thất bại** vì cùng một lý do: **trang chưa được kết nối (Connections) với integration "HA-UserGuide"**.

---

## 2. Go2Joy에서 해야 할 작업 / Việc cần làm phía Go2Joy

### A. 페이지 3건을 통합에 연결 / Kết nối 3 trang với integration  ⏱ 페이지당 약 1분

**KO** — 아래 3개 페이지 각각에서:
1. 노션에서 페이지를 엽니다.
2. 우측 상단 **`⋯`(더보기)** → 아래쪽 **`연결(Connections)`**.
3. 검색란에 **`HA-UserGuide`** 입력 → 선택 → 액세스 허용 **확인**.
4. `⋯ → 연결` 목록에 "HA-UserGuide"가 보이면 완료.

대상 페이지 / Các trang cần kết nối:
- **Go2Joy Hotel FAQ** — `https://hotel-go2joy.notion.site/FAQ-f03737634c3848339910d50f7e77bf7b`
- **Hướng dẫn sử dụng Hotel Admin** — ID `8968fee0bb548347a35e01756b4cc89c` (§2-D 참고)
- **Hướng dẫn đăng ký khách sạn trên Go2Joy** — ID `2026dfbd464d800085cedea4c57f8d15`

> 📌 하위 페이지는 자동 상속됩니다 — 상위 페이지 1곳만 연결하면 그 아래 페이지는 따로 연결할 필요가 없습니다.
> 📌 Các trang con tự động kế thừa — chỉ cần kết nối trang cha.

**VI** — Với từng trang: mở trang → bấm **`⋯`** góc trên phải → **`Connections`** → gõ **`HA-UserGuide`** → chọn → **xác nhận**. Khi "HA-UserGuide" xuất hiện trong danh sách Connections của trang là xong.

### B. "웹에 공개"는 연결이 아닙니다 / "Publish to web" không phải là kết nối

**KO** — FAQ 페이지는 `hotel-go2joy.notion.site` 주소로 **웹에 공개(Publish)** 되어 있습니다. 공개 페이지는 브라우저로는 누구나 볼 수 있지만, **Notion API는 공개 여부와 무관하게 "통합에 연결된 페이지"만 읽을 수 있습니다.** 따라서 공개 페이지라도 §2-A의 연결 작업이 반드시 필요합니다.

**VI** — Trang FAQ đang được **publish** tại `hotel-go2joy.notion.site`. Publish chỉ cho phép xem bằng trình duyệt; **Notion API chỉ đọc được trang đã được kết nối với integration**, bất kể trang có public hay không. Vì vậy vẫn phải làm bước §2-A.

### C. 워크스페이스 확인 / Kiểm tra workspace

**KO** — 통합 "HA-UserGuide"는 **Go2Joy 워크스페이스**에 설치되어 있습니다(실측). 위 3개 페이지가 모두 **Go2Joy 워크스페이스 안에** 있어야 연결 목록에 "HA-UserGuide"가 나타납니다. 검색해도 나오지 않으면 그 페이지는 다른 워크스페이스에 있는 것입니다 → 페이지를 Go2Joy 워크스페이스로 옮기거나, 그 워크스페이스에 통합을 새로 만들고 토큰을 SharpTalk에 다시 등록해야 합니다(§2-E 주의).

**VI** — Integration "HA-UserGuide" được cài trong workspace **Go2Joy**. Cả 3 trang phải nằm trong workspace này thì "HA-UserGuide" mới xuất hiện khi tìm trong Connections. Nếu không tìm thấy, trang đang ở workspace khác → chuyển trang sang Go2Joy, hoặc tạo integration mới trong workspace đó và đăng ký lại token (xem §2-E).

### D. "Hướng dẫn sử dụng Hotel Admin" — 어느 페이지가 맞는지 확인 / Xác nhận đúng trang

**KO** — SharpTalk에 등록된 ID는 `8968fee0…`인데, 현재 통합에 연결된 페이지는 같은 제목의 **`bfb56ba4…`** 입니다. 두 경우 중 하나입니다.
- 페이지가 복제/이동되어 ID가 바뀜 → **`bfb56ba4…`가 최신본**이면 알려주세요. SharpTalk 소스의 대상 ID를 바꿔 드립니다(Go2Joy 작업 없음).
- 두 페이지가 별개 → `8968fee0…` 페이지도 §2-A대로 연결해 주세요.

확인 방법: 노션에서 그 페이지를 열고 브라우저 주소창 끝의 **32자리 영숫자**를 보면 됩니다.

**VI** — ID đăng ký trong SharpTalk là `8968fee0…`, nhưng integration hiện chỉ thấy trang cùng tên có ID **`bfb56ba4…`**. Nếu `bfb56ba4…` là bản mới nhất (trang đã được nhân bản/di chuyển), chỉ cần báo chúng tôi — chúng tôi sẽ đổi ID nguồn. Nếu là 2 trang khác nhau, vui lòng kết nối cả trang `8968fee0…` theo §2-A. Cách kiểm tra: mở trang trong Notion và xem **32 ký tự cuối** trên thanh địa chỉ.

### E. 토큰(통합)을 바꿀 때 주의 / Lưu ý khi thay token (integration)

**KO** — 10/16에 통합이 "Truc connection"에서 "HA-UserGuide"로 바뀌면서, **이전 통합에 연결해 둔 페이지는 전부 새 통합에서 보이지 않게 되었습니다.** 연결은 통합별로 따로 관리되기 때문입니다. 앞으로 토큰을 교체할 일이 있으면:
1. 새 통합을 만들고,
2. **SharpTalk 소스로 쓰는 모든 페이지에 새 통합을 다시 연결**한 뒤,
3. SharpTalk 콘솔에 새 토큰을 등록해 주세요.

가능하면 토큰은 바꾸지 말고 유지하는 것이 가장 안전합니다.

**VI** — Ngày 16/10 integration đổi từ "Truc connection" sang "HA-UserGuide" nên **mọi trang đã kết nối với integration cũ không còn hiển thị với integration mới** (Connections được quản lý riêng theo từng integration). Nếu sau này cần đổi token: tạo integration mới → **kết nối lại tất cả trang** đang dùng làm nguồn SharpTalk → đăng ký token mới trong console. Tốt nhất là giữ nguyên token.

---

## 3. 연결 후 확인 — Go2Joy가 직접 할 수 있습니다 / Sau khi kết nối — Go2Joy tự kiểm tra được

**KO**
1. SharpTalk 콘솔 → **지식** → **소스** 표 → 해당 소스 행의 **↻(동기화)** 클릭.
2. 성공: 초록 알림 "동기화: 생성 N건 …" + 소스 행에 마지막 동기화 시각(검정).
3. 실패: 빨간 알림이 **원인과 조치 방법**을 그대로 보여줍니다. 예) "소스 대상에 접근할 수 없습니다 — Could not find page … shared with your integration "HA-UserGuide" → 노션에서 ⋯ → 연결에 통합 추가". 이 메시지가 나오면 §2-A가 아직 안 된 것입니다.
4. 동기화 성공 후 챗 위젯에서 해당 내용을 질문하면 답변 근거로 인용됩니다.

**VI**
1. Console SharpTalk → **Tri thức (Knowledge)** → bảng **Nguồn** → bấm **↻** ở dòng nguồn tương ứng.
2. Thành công: thông báo xanh "Đồng bộ: tạo N …" và thời gian đồng bộ (màu đen) trên dòng nguồn.
3. Thất bại: thông báo đỏ hiển thị **nguyên nhân và cách xử lý**. Nếu thấy "… shared with your integration "HA-UserGuide"" nghĩa là bước §2-A chưa xong.
4. Sau khi đồng bộ thành công, hỏi thử trong chat widget — AI sẽ trích dẫn nội dung trang.

---

## 4. 수집 범위와 제약 / Phạm vi & giới hạn

| 항목 / Mục | 내용 / Nội dung |
|---|---|
| 수집 범위 / Phạm vi | 대상 페이지 본문 + **바로 아래 1단계 하위 페이지**. 더 깊은 중첩은 수집 안 됨 / Trang chính + trang con **cấp 1** |
| 텍스트만 / Chỉ văn bản | 문단·제목·리스트·토글·표·코드. **이미지·첨부·임베드 제외** / Không thu thập hình ảnh, tệp, embed |
| 분량 / Giới hạn | 1회 최대 200페이지, 페이지당 약 30,000자. 아주 긴 페이지는 하위 페이지로 나누는 것을 권장 / Tối đa 200 trang/lần, ~30.000 ký tự/trang; trang quá dài nên tách thành trang con |
| 수정 반영 / Cập nhật | 노션 수정은 **자동 반영 안 됨** — 콘솔에서 ↻ 다시 클릭(변경분만 갱신) / Sửa trên Notion **không tự cập nhật** — bấm ↻ lại trong console |
| 페이지 삭제 / Xóa trang | 지식에서 삭제되지 않고 **숨김** 처리 / Trang bị xóa sẽ được **ẩn**, không xóa vĩnh viễn |
| 보안 / Bảo mật | 토큰 암호화 저장, 읽기 전용. **연결한 페이지(와 하위)만** 접근 가능 / Token mã hóa, chỉ đọc; chỉ truy cập trang đã kết nối |

---

## 5. 회신 체크리스트 / Danh sách phản hồi

**KO**
- [ ] FAQ 페이지(`f0373763…`)에 HA-UserGuide 연결 완료
- [ ] "Hướng dẫn đăng ký khách sạn…"(`2026dfbd…`)에 HA-UserGuide 연결 완료
- [ ] "Hướng dẫn sử dụng Hotel Admin": `8968fee0…`에 연결 완료 **또는** `bfb56ba4…`가 최신본임을 회신
- [ ] 연결 목록 스크린샷 1장(선택 — 확인이 빨라집니다)

**VI**
- [ ] Đã kết nối HA-UserGuide vào trang FAQ (`f0373763…`)
- [ ] Đã kết nối HA-UserGuide vào "Hướng dẫn đăng ký khách sạn…" (`2026dfbd…`)
- [ ] "Hướng dẫn sử dụng Hotel Admin": đã kết nối `8968fee0…` **hoặc** xác nhận `bfb56ba4…` là bản mới nhất
- [ ] Ảnh chụp danh sách Connections (tùy chọn)

문의: SharpTalk 운영팀 (기존 연락 채널) / Liên hệ: đội vận hành SharpTalk (kênh liên lạc hiện có).
