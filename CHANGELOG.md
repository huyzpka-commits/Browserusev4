# CHANGELOG.md

> **Mục đích:** Ghi lại **toàn bộ thay đổi sau mỗi lượt trả lời/làm việc** để AI và developer luôn biết dự án đang ở đâu, tránh bị "đi lạc hướng".
>
> **Nguyên tắc:**
> 1. Mỗi lần thay đổi → thêm 1 mục mới **lên đầu** file này, theo dạng `## [phiên bản] - [ngày]`.
> 2. Ghi rõ: file nào bị sửa, sửa gì, vì sao.
> 3. Thay đổi nào làm sai khác `REQUIREMENTS.md` → phải cập nhật cả `REQUIREMENTS.md`.
> 4. Không xóa các mục cũ.

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