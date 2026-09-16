# CHANGELOG.md

> **Mục đích:** Ghi lại **toàn bộ thay đổi sau mỗi lượt trả lời/làm việc** để AI và developer luôn biết dự án đang ở đâu, tránh bị "đi lạc hướng".
>
> **Nguyên tắc:**
> 1. Mỗi lần thay đổi → thêm 1 mục mới **lên đầu** file này, theo dạng `## [phiên bản] - [ngày]`.
> 2. Ghi rõ: file nào bị sửa, sửa gì, vì sao.
> 3. Thay đổi nào làm sai khác `REQUIREMENTS.md` → phải cập nhật cả `REQUIREMENTS.md`.
> 4. Không xóa các mục cũ.

---

## [1.4.1] - 2026-09-16

### Fixed — Nền matrix chỉ chạy ở góc trên trái, không full màn hình

- **`public/neon-terminal-ui.css` (`#nt-matrix`)**: canvas là **replaced element** nên `inset: 0` KHÔNG kéo giãn nó full màn hình — nó giữ kích thước intrinsic mặc định **300×150px** đặt ở top-left (đúng triệu chứng "mưa ký tự chỉ ở góc trên bên trái"). `.nt-scanlines` là div thường nên vẫn full — do đó chỉ nền mưa bị lỗi.
- Sửa: thay `inset: 0` bằng `top: 0; left: 0; width: 100%; height: 100%; display: block;` → layout width/height = viewport → `clientWidth/clientHeight` trong `resize()` của `neon-matrix-bg.js` tính đúng → buffer canvas phủ toàn màn hình, mưa ký tự chạy full trang.
- Ghi chú: file kit gốc trong folder template `toàn bộ giao diện ui` vẫn còn bug này (không sửa file của user) — nếu tái sử dụng kit ở nơi khác, áp cùng fix cho `#nt-matrix`.
- `package.json` → 1.4.1.

### Verified

- ✅ `GET /neon-terminal-ui.css` trả bản đã sửa (`width: 100%; height: 100%` thay cho `inset: 0`), index 200, health OK sau restart.
- ✅ Toàn bộ phần tử/id khác không đổi (chỉ 1 rule CSS).

---

## [1.4.0] - 2026-09-16

### Changed — Chuyển toàn bộ UI sang giao diện terminal/matrix (lượt làm việc thứ 6)

- **`public/index.html` viết lại hoàn toàn** theo UI kit mẫu trong folder `toàn bộ giao diện ui` của user:
  - Cấu trúc: `body.nt-body` → canvas `#nt-matrix` (mưa ký tự) + `.nt-scanlines` + `.nt-wrap` chứa các `.nt-panel` (INPUT_DATA, PROCESS_STATUS, OUTPUT_DATA).
  - Hiệu ứng: glitch title `FILE_ANALYZER@browser-use` (nhấp nháy pink/cyan), tag nhấp nháy, vệt sáng quét mép panel, caret nhấp nháy, mưa ký tự matrix nền.
  - Progress: **vòng ring SVG** (r=20, dashoffset 125.6→0 theo %) với số % giữa vòng + thanh bar mảnh neon bên dưới + dòng `> message` của agent.
  - Spinner **ASCII** `[\|/-]` trên nút "XỬ LÝ" khi đang chạy; nút = `nt-btn-primary` xanh neon.
  - Tabs `[ KẾT_QUẢ ]` / `[ JSON ]` kiểu terminal, chips `nt-badge` (status xanh, ZIP amber, model cyan, tokens soft, cost pink, time mute), alert `[!] ERR ::` viền đỏ, nút tải kết quả `▼ TẢI .TXT/.JSON`.
  - **Bỏ Tailwind CDN** — không còn phụ thuộc internet cho UI.
- **`public/neon-terminal-ui.css` + `public/neon-matrix-bg.js`**: copy nguyên văn 2 file kit từ folder template sang `public/` (kit thiết kế drop-in, prefix `.nt-` không xung đột framework).
- **Logic JS giữ nguyên 100%** (chỉ đổi lớp hiển thị): upload/kéo-thả, instructions, job poll 1.5s, progress %, localStorage resume, copy, download — đã extract inline JS và `node --check` sạch.
- `REQUIREMENTS.md` bump 1.4.0: bảng công nghệ (Neon Terminal UI Kit thay Tailwind), FR-12 mới, thêm tiêu chí nghiệm thu UI.

### Quyết định kỹ thuật

1. **Giữ nguyên toàn bộ id phần tử + logic fetch/poll** — chỉ thay đổi lớp markup/class CSS → rủi ro hồi quy gần bằng 0, API phía server không đổi.
2. **Progress ring tái dùng `.nt-ring` của kit**: vòng đếm ngược của template được tính lại thành vòng % (dashoffset = C·(1−%/100)), giữ đúng ngôn ngữ thiết kế của kit.
3. **Extensions (dropzone, tabs, bar, chips, alert…) đặt trong `<style>` riêng của index.html** với biến `--nt-*` của kit — không sửa file kit để giữ tính "drop-in" copy được.

### Verified

- ✅ Extract inline JS → `node --check` sạch.
- ✅ Server 3000 khởi động lại: GET `/` trả trang terminal mới, `GET /neon-terminal-ui.css` và `GET /neon-matrix-bg.js` trả 200.
- ✅ Đủ các id cũ trên trang (dropzone, processBtn, progressBox, resultSection, downloadBox…) — JS gắn đúng phần tử.
- ✅ Hồi quy: API/flow không đổi (server.js không sửa dòng nào trong lượt này).

---

## [1.3.0] - 2026-09-16

### Changed — Lô upload ZIP ≤20/request + tự chia nhỏ khi API từ chối (lượt làm việc thứ 5)

- **`server.js`**: lô upload nâng từ 10 → **`UPLOAD_BATCH_SIZE` (mặc định 20) file/request**.
  - Hàm mới `registerUploadBatch()`: đăng ký 1 lô lấy presigned URL; nếu API trả **422** vì lô quá lớn (schema API v4 hiện ghi `maxItems: 10`/request) → **tự chia đôi lô** và đăng ký lại từng nửa (đệ quy — 20→10+10, 15→8+7…), ghi `[WARN]` kèm kích thước lô. Không mất file, không cần cấu hình lại, sẵn sàng khi Browser Use nới limit.
  - Lý do không đặt cứng 20: đã đối chiếu lại OpenAPI v4 ngày 2026-09-16 — upload endpoint vẫn `maxItems: 10`; gửi thẳng 20 sẽ bị 422 luôn. Cơ chế adaptive vừa đáp ứng yêu cầu "lô ≤20/request" vừa chạy đúng với API thật hôm nay.
- **`test/mock-api.js`**: ép đúng giới hạn `maxItems=10` như API thật (trả 422 kiểu `too_long` như FastAPI); log kích thước từng lô upload nhận được vào kết quả run (`Các lô upload đã nhận: [...]`) để kiểm chứng cơ chế chia lô.
- `.env.example` thêm `UPLOAD_BATCH_SIZE=20`; `REQUIREMENTS.md` bump 1.3.0 (FR-10, bảng env); `package.json` → 1.3.0.

### Verified

- ✅ Mock E2E ZIP 15 file: request đầu 15 file → mock trả 422 → server tự chia 8+7 → **cả 15 file upload đủ**, mock log lô `[15, 8, 7]`.
- ✅ Mock E2E ZIP 20 file: lô `[20, 10, 10]` — 20 file đủ, `attachedFileIds` đủ 20.
- ✅ Hồi quy file thường + ZIP 2 file: batch ≤10 đi thẳng, không chia nhỏ.
- ✅ `node --check` sạch.

---

## [1.2.1] - 2026-09-16

### Added — Link tải kết quả ngay trên web sau khi hoàn thành (lượt làm việc thứ 4)

- **Server lưu kết quả vào thư mục `outputs/`** — `server.js`:
  - Khi job `completed`: ghi `outputs/<jobId>.txt` (kết quả + header metadata: runId, model, file gốc, ZIP extracted, tokens, chi phí, thời gian) và `outputs/<jobId>.json` (response đầy đủ).
  - Endpoint mới `GET /api/jobs/{jobId}/download?type=txt|json`: trả file với `Content-Disposition: attachment`; ưu tiên file trên đĩa (sống sót sau khi job hết hạn trong RAM 30 phút), fallback sinh tại chỗ từ job trong RAM; `type` sai → 400, không có kết quả → 404.
  - Dọn dẹp: mỗi giờ xoá file `<uuid>.txt/.json` cũ quá `OUTPUT_FILE_TTL_MS` (mặc định 24h); regex chỉ khớp file kết quả — không đụng file khác trong `outputs/` (ví dụ BrowserUse-WebApp.zip).
  - Tạo thư mục `outputs/` lúc khởi động (`fs.mkdirSync recursive`); lỗi ghi đĩa không làm fail job (chỉ `[WARN]`).
- **UI** — `public/index.html`: sau khi hoàn thành hiển thị hàng nút **"Tải .txt"** (nền indigo) và **"Tải .json"** (viền slate) trỏ tới endpoint download, kèm icon mũi tên xuống; chỉ hiện khi có `jobId`.

### Changed

- `package.json` → 1.2.1; `.gitignore` thêm `outputs/`; `.env.example` thêm `OUTPUT_DIR`, `OUTPUT_FILE_TTL_MS`.
- `REQUIREMENTS.md` bump 1.2.1: FR-11, endpoint `/api/jobs/{id}/download` trong bảng API, 2 biến env mới, thêm tiêu chí nghiệm thu.

### Quyết định kỹ thuật

1. **File trên đĩa thay vì chỉ RAM**: link tải phải hoạt động sau khi job hết hạn 30 phút — file `outputs/` tồn tại 24h, độc lập với RAM.
2. **Content-Disposition attachment**: trình duyệt tải thẳng về máy thay vì mở tab mới.
3. **Regex dọn dẹp nghiêm ngặt** `^[0-9a-f-]{36}\.(txt|json)$`: chỉ xoá đúng file kết quả, an toàn cho mọi file khác người dùng để trong `outputs/`.

### Verified

- ✅ Mock E2E: job completed → `outputs/<jobId>.txt` và `.json` tồn tại đúng nội dung (txt có header metadata + text kết quả) → `GET .../download?type=txt` trả 200 + attachment đúng bytes file; `type=json` trả JSON đầy đủ.
- ✅ Download `type=pdf` → 400; jobId ngẫu nhiên → 404 JSON tiếng Việt.
- ✅ Hồi quy: job thường + ZIP vẫn chạy trọn vẹn, UI hiển thị nút tải.

---

## [1.2.0] - 2026-09-16

### Added — Xử lý file .zip + task lâu không lỗi (lượt làm việc thứ 3)

- **Hỗ trợ upload file .zip** — `server.js`:
  - Nhận diện ZIP theo mime type hoặc đuôi `.zip` (`isZipFile`); giải nén trong RAM bằng `adm-zip` (dependency mới).
  - Upload từng file vào workspace theo lô ≤10 file/request (giới hạn API v4), đính kèm `attachedFileIds` (≤20).
  - Bảo vệ: chỉ lấy tên file (bỏ đường dẫn → chống path traversal), tự đổi tên khi trùng (`a (2).txt`), bỏ `__MACOSX`/`.DS_Store`/`._*`/file rỗng, giới hạn `MAX_ZIP_FILES` (50) + `MAX_ZIP_TOTAL_EXTRACT_BYTES` (100MB), chặn entry có khai báo size vượt giới hạn TRƯỚC khi giải nén (chống zip bomb).
  - `buildTaskPrompt(files, instructions)` mới: prompt liệt kê danh sách file (tối đa 30 tên + "và X file khác").
  - Response kèm `file.isZip / extractedCount / extractedFiles`.
- **UI ZIP** — `public/index.html`: dropzone ghi rõ "hỗ trợ .zip (tự giải nén, tối đa 50 file)"; chip vàng "ZIP → N file đã giải nén" (hover xem danh sách file + dung lượng); progress message hiển thị "Đang giải nén ZIP…", "Đang tải file "X" lên…" khi upload nhiều file.
- **Timeout 2 tầng (task lâu không bị lỗi)** — `server.js`:
  - `TASK_TIMEOUT_MS` **mềm** (mặc định mới: 300s → **900s**): qua ngưỡng KHÔNG dừng job — chỉ đổi message "Task đang lâu hơn dự kiến — agent vẫn đang chạy…" và ghi `[WARN]` log, tiếp tục poll.
  - `TASK_HARD_TIMEOUT_MS` **cứng** (mới, mặc định 1800s): tới ngưỡng này job mới dừng với 504 kèm runId + gợi ý tăng biến env.
- **UI chịu lỗi mạng tốt hơn**: `MAX_POLL_FAILURES` 3 → 5 lần poll lỗi liên tiếp mới báo lỗi.

### Changed

- `processJob`: tách logic upload ra vòng lô BATCH=10; progress 8→20% chia đều theo số file; mock `test/mock-api.js` đếm tổng số file + tổng bytes đã PUT.
- `/api/health` thêm `maxZipFiles`, `maxZipTotalExtractBytes`, `taskHardTimeoutMs`.
- `.env.example`, `REQUIREMENTS.md` (bump 1.2.0: FR-10, NFR-3 mới, bảng env, nghiệm thu), `README.md`, `package.json` → 1.2.0.

### Quyết định kỹ thuật

1. **Giải nén ở server thay vì để agent tự unzip**: chắc chắn hoạt động với mọi model, prompt liệt kê file rõ ràng, tránh phụ thuộc vào môi trường shell của agent.
2. **Bỏ đường dẫn khi giải nén (chỉ giữ basename)**: workspace upload API lưu theo tên; vừa chống path traversal vừa tránh trùng lặp thư mục ảo; trùng tên thì tự thêm hậu tố `(n)`.
3. **Timeout mềm không fail**: đúng yêu cầu "thời gian xử lý lâu không bị lỗi" — 15 phút đầu im lặng chờ, sau đó cảnh báo nhưng vẫn chờ tới 30 phút.

### Verified

- ✅ Mock E2E ZIP (2 file trong zip): job 202 → progress "Đang giải nén ZIP…" → mock nhận **2 file** (đúng bytes từng file) → completed, prompt liệt kê đúng 2 tên file, response có `isZip: true, extractedCount: 2`.
- ✅ Mock ZIP 60 file → 400 "ZIP chứa quá nhiều file (giới hạn 50)".
- ✅ Hồi quy file thường: vẫn chạy đầy đủ, mock báo "1 file, 504 bytes" (sửa mock: counter reset sau mỗi run).
- ✅ Test thật với Browser Use Cloud API v4 (2026-09-16, local): upload ZIP (CSV + TXT) + yêu cầu đọc cả 2 file → agent trả đúng: CSV 10 bản ghi / tổng doanh thu 96.875.000; TXT 50 dòng ký tự X — 17.6s, $0.0039, progress 37→73→100%.
- ✅ `node --check` sạch; server 3000 restart OK (test local). Cloudflared vẫn được hướng dẫn trong README nhưng không còn nằm trong quy trình kiểm thử.

---

## [1.1.0] - 2026-09-15

### Added — Yêu cầu tuỳ chỉnh + % tiến trình (lượt làm việc thứ 2)

- **Ô "Yêu cầu xử lý" (`instructions`)** — `public/index.html` + `server.js`:
  - Textarea tuỳ chọn (≤5000 ký tự) ngay dưới dropzone: người dùng viết yêu cầu riêng — viết code, xử lý dữ liệu, chuyển đổi file… Để trống → giữ prompt phân tích tổng quát mặc định của v1.0.0.
  - `buildTaskPrompt(fileName, instructions)`: khi có instructions, nhúng nguyên văn yêu cầu vào `task` kèm chỉ dẫn "viết code thì trình bày đầy đủ trong khối markdown".
- **Hiển thị % tiến trình** — `server.js` + `public/index.html`:
  - Server poll `GET /runs/{id}/events?after=<cursor>` (endpoint Run Events của API v4, drain `hasMore` theo khuyến nghị docs) mỗi chu kỳ cùng `GET /runs/{id}/status`; đếm số event `n` và tính `% = min(95, 22 + 73·n/(n+8))` → 100% khi terminal. % và message ("Agent: …") đều lấy từ hoạt động **thật** của run, không fake theo thời gian.
  - UI: progress bar gradient + số % + message + hint (số bước · elapsed · phase), cập nhật mỗi 1.5s.
- **`GET /api/jobs/{jobId}`** — endpoint mới cho UI poll: trả `phase/progress/message/stepCount/elapsedMs` khi đang chạy; khi xong trả response đầy đủ như v1.0.0; khi lỗi trả `{ success:false, error, details }` với HTTP code gốc; 404 khi job hết hạn (TTL 30 phút).
- **Nối lại job sau refresh**: UI lưu `jobId` trong `localStorage`, mở lại trang tự poll tiếp job đang chạy.
- **`test/mock-api.js`**: thêm `GET /runs/:id/events` (cursor `after` + `hasMore`) và phát 4 event mô phỏng trong 4 giây chạy.

### Changed

- **[BREAKING] `POST /api/process` chuyển sang mô hình job-based**: trả `202 { jobId }` ngay lập tức thay vì giữ request tới khi xong (v1.0.0). Lý do: (1) hiển thị % tiến trình đòi hỏi server đẩy cập nhật trong lúc run đang chạy; (2) request dài bị proxy Cloudflare chặn 100s (lỗi 524) — poll ngắn qua job không bị giới hạn này; (3) refresh trang không mất job. Lỗi validate đầu vào (thiếu file/key, file quá lớn) vẫn trả đồng bộ như cũ.
- `server.js`: tách logic xử lý ra `processJob()` chạy nền, job store `Map` trong RAM + TTL dọn dẹp 30 phút; `waitForRunCompletion` nâng cấp thêm đọc events và cập nhật `job.progress/message/phase`.
- `README.md`: luồng API mới (2 bước create + poll), ví dụ curl cập nhật, bỏ cảnh báo 524 (không còn áp dụng).
- `REQUIREMENTS.md`: bump 1.1.0 — thêm FR-7/8/9, luồng job-based, bảng API mới, cập nhật nghiệm thu & phạm vi.

### Quyết định kỹ thuật

1. **Công thức % tiệm cận** `22 + 73·n/(n+8)` (cap 95%): % tăng theo event thật nhưng không bao giờ "nhìn lố" 100% trước khi run terminal — tránh lời hứa sai thời điểm.
2. **Poll theo khuyến nghị docs v4**: đọc `status` TRƯỚC `events` mỗi chu kỳ (bắt trọn event cuối sau terminal), drain hết `hasMore`, tôn trọng 429 `Retry-After`, `include_output=false` cho nhẹ.
3. **Không dùng SSE/WebSocket**: poll `GET /api/jobs/{id}` 1.5s đủ mượt, đơn giản, hoạt động qua mọi proxy/tunnel.
4. `summarizeEvent()` phòng thủ: thử các field `message/text/summary/...` trong `data`, fallback về tên type — vì event `data` là free-form theo schema v4.

### Verified

- ✅ Mock E2E: create job (202) → poll thấy `progress` tăng 30% → 37% → 42% kèm message "Agent: Đang xử lý dữ liệu theo yêu cầu" → completed 100% với kết quả đủ shape như v1.0.0.
- ✅ Mock E2E với `instructions`: task gửi cho run chứa nguyên văn yêu cầu người dùng; agent (mock) phản hồi theo đúng yêu cầu.
- ✅ Nhánh lỗi giữ nguyên: 400 (thiếu file), 413 (file quá lớn), 500 (thiếu key) trả đồng bộ; key sai → job failed với message "Kiểm tra lại BROWSER_USE_API_KEY".
- ✅ Test thật với Browser Use Cloud API v4 (2026-09-15): events thật trả về qua endpoint `/runs/{id}/events`, % cập nhật mượt, hoàn thành 49–55s với yêu cầu viết code Python từ file CSV.
- ✅ Nối lại job sau refresh hoạt động qua localStorage.

---

## [1.0.0] - 2026-09-15

### Added — Khởi tạo toàn bộ dự án (lượt làm việc đầu tiên)

- **`package.json`**: khai báo dự án `browser-use-file-analyzer` v1.0.0, scripts `start` / `dev` / `mock`, dependencies `express`, `cors`, `multer`, `dotenv`, `axios`, yêu cầu Node ≥ 18.
- **`server.js`** (backend chính):
  - `POST /api/process`: nhận file upload (multer, memoryStorage — không ghi đĩa) → tạo Workspace → xin presigned URL → PUT bytes file → tạo Run (`task` + `workspaceId` + `attachedFileIds`) → poll `GET /runs/{id}/status` (2s, tôn trọng 429 Retry-After, bỏ cuộc sau 3 lần lỗi liên tiếp) → lấy RunSummary → trả JSON kết quả về UI.
  - `GET /api/health`: health check (uptime, trạng thái API key, giới hạn file).
  - Global error handler chuẩn hóa: lỗi multer (413/400), lỗi upstream Browser Use (401/402/404/409/422/429/5xx → 502/402/429…), timeout (504), lỗi mạng (502); mọi thông báo bằng tiếng Việt.
  - Dọn dẹp: archive Workspace sau khi run xong (giữ lại nếu client timeout mà run vẫn đang chạy).
  - CORS qua middleware `cors`, origin cấu hình `CORS_ORIGIN`.
- **`public/index.html`** (frontend):
  - TailwindCSS (CDN), UI tiếng Việt: dropzone kéo-thả/chọn file, chip thông tin file, nút **Xử lý**, loading state (spinner + đếm giây + disable), hộp báo lỗi, vùng kết quả 2 tab **Kết quả / JSON** + chip meta (status, model, tokens, cost, thời gian) + nút Copy.
  - Gọi `POST /api/process` bằng `fetch`, tự hủy sau 6 phút (AbortController), render kết quả text + JSON raw.
- **`test/mock-api.js`**: mock Browser Use API v4 (workspaces, presigned upload, runs, status, summary, delete) để test end-to-end offline — `npm run mock`.
- **`REQUIREMENTS.md`**: chốt toàn bộ yêu cầu app (mục tiêu, công nghệ, luồng, FR/NFR, biến môi trường, tiêu chí nghiệm thu, phạm vi KHÔNG làm).
- **`README.md`**: hướng dẫn cài đặt, cấu hình `.env`, chạy local, test với mock, chạy public bằng tunnel (cloudflared/ngrok/localtunnel) + deploy, tài liệu API, xử lý lỗi.
- **`.env.example`**, **`.gitignore`**.

### Quyết định kỹ thuật (đặc biệt, kèm lý do)

1. **Dùng Browser Use Cloud API v4** (đối chiếu docs chính thức 2026-09): auth header `X-Browser-Use-API-Key` (không dùng Bearer), base URL `https://api.browser-use.com/api/v4`.
2. **Gửi file thật cho agent qua Workspace** (tạo workspace → presigned PUT → `attachedFileIds`) thay vì nhúng nội dung text vào prompt — hỗ trợ mọi định dạng file (PDF, ảnh…) và file lớn tới 50MB.
3. **Gọi REST trực tiếp bằng axios, không dùng SDK** — giảm phụ thuộc, chạy được mọi host chỉ cần Node.
4. **Request đồng bộ** (chờ run xong rồi trả 1 response) — đúng luồng yêu cầu "Khởi tạo request → Đợi kết quả → Trả về UI".
5. **Poll bằng endpoint nhẹ** `GET /runs/{id}/status` (chỉ lấy field `status`) thay vì `GET /runs/{id` — tiết kiệm rate limit theo khuyến nghị docs.

### Published

- Mã nguồn đã đẩy lên GitHub: **https://github.com/huyzpka-commits/Browserusev4** (nhánh `main`, commit `96c811c`).
- `BrowserUse-WebApp.zip` KHÔNG đưa vào repo (nằm trong `.gitignore` — file nén là artifact build, tải trực tiếp từ máy).

### Verified

- ✅ Test end-to-end với mock API: upload file → run → poll → kết quả JSON/text trả về đúng shape.
- ✅ Test lỗi: thiếu file (400), thiếu API key (500), file quá lớn (413), API key sai (401 → 502 tiếng Việt).
- ✅ **Test thật với Browser Use Cloud API (v4, 2026-09-15)**: upload `sample.csv` (504 bytes) → agent đọc file, trả về phân tích tiếng Việt có bảng số liệu, hoàn thành 49s, tốn $0.0099, UTF-8 chuẩn.
- ✅ Server khởi động OK trên Node v24, cổng 3000.
- ✅ Chạy public qua Cloudflare quick tunnel (cloudflared): UI + /api/health truy cập được từ internet.