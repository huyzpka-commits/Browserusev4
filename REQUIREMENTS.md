# REQUIREMENTS.md — Yêu cầu ứng dụng

**Tên app:** Browser Use File Analyzer
**Phiên bản yêu cầu:** 1.2.1 · **Cập nhật:** 2026-09-16

> File này là **nguồn chân lý (source of truth)** cho mọi yêu cầu của app.
> Mọi thay đổi trong các lượt làm việc sau **phải** được ghi vào `CHANGELOG.md` và nếu làm thay đổi hành vi thì cập nhật lại file này.

---

## 1. Mục tiêu

Xây dựng một web app **chạy công khai trên internet**, cho phép người dùng:

1. Upload một file bất kỳ (CSV, TXT, JSON, PDF, ảnh…).
2. **Viết yêu cầu xử lý tuỳ chọn** (phân tích, viết code, chuyển đổi dữ liệu…) — để trống thì agent phân tích tổng quát.
3. Backend gửi file + yêu cầu tới **Browser Use Cloud API (v4)** để AI agent thực hiện.
4. Theo dõi **% tiến trình** trong lúc agent chạy và hiển thị kết quả JSON/Text khi xong.

## 2. Công nghệ (bắt buộc)

| Thành phần | Công nghệ |
|---|---|
| Backend | Node.js (≥ 18) + Express |
| Frontend | HTML + JavaScript thuần + TailwindCSS (CDN) |
| API ngoài | Browser Use Cloud API **v4** (`https://api.browser-use.com/api/v4`), auth bằng header `X-Browser-Use-API-Key` |
| Thư viện | `express`, `cors`, `multer`, `dotenv`, `axios` |

## 3. Luồng xử lý (bắt buộc) — mô hình JOB-BASED từ v1.1.0

```
[UI: chọn file + viết yêu cầu]
   │ POST /api/process (multipart: file + instructions)
   ▼                                    ┌──────────────────── server.js (nền) ────────────────────┐
[Backend] ──202 {jobId}──▶ [UI poll]    │ 1. Tạo workspace      POST /workspaces                  │
                           GET /api/    │ 2. Xin presigned URL  POST /workspaces/{id}/files/upload │
                           jobs/{id}    │ 3. PUT bytes file     (presigned URL)                    │
                           mỗi 1.5s     │ 4. Tạo run            POST /runs (task + attachedFileIds)│
     ◀── progress %, message, kết quả ──│ 5. Poll status        GET /runs/{id}/status              │
                                        │ 6. Poll events        GET /runs/{id}/events?after=cursor  │
                                        │    → tính % + tin nhắn hoạt động của agent              │
                                        │ 7. Lấy kết quả        GET /runs/{id}                     │
                                        └─────────────────────────────────────────────────────────┘
[UI: progress bar % → khi xong hiển thị tab "Kết quả" (text) và "JSON"]
```

- `POST /api/process` phải trả **202 + jobId ngay lập tức** (không giữ request dài).
- Tiến trình % do server tính từ **số event thật** của run (không fake theo thời gian).
- Job kết thúc lưu trong RAM **30 phút** cho UI tra cứu; UI lưu jobId trong `localStorage` để nối lại sau khi refresh trang.

## 4. Yêu cầu chức năng

| ID | Yêu cầu |
|---|---|
| FR-1 | UI có **form upload file** (click + kéo-thả) và **nút "Xử lý"** |
| FR-2 | Nút "Xử lý" gọi `POST /api/process` với `multipart/form-data`, field `file` (bắt buộc) và `instructions` (tuỳ chọn) |
| FR-3 | **Loading state**: spinner + đếm giây + disable nút + disable dropzone khi đang xử lý |
| FR-4 | **Vùng hiển thị kết quả**: 2 tab — "Kết quả" (text) và "JSON" (raw đầy đủ), kèm chip thông tin (model, tokens, chi phí, thời gian) và nút Copy |
| FR-5 | `GET /api/health` health check (trạng thái server, đã cấu hình API key chưa) |
| FR-6 | Giới hạn file mặc định **10MB** (cấu hình được qua `MAX_FILE_SIZE_BYTES`; trần Browser Use là 50MB) |
| FR-7 | **Ô "Yêu cầu xử lý"** (textarea, tuỳ chọn, tối đa 5000 ký tự): người dùng viết yêu cầu riêng (viết code, xử lý dữ liệu…); để trống → prompt phân tích tổng quát mặc định. Yêu cầu được nhúng nguyên văn vào `task` gửi cho agent |
| FR-8 | **Hiển thị % tiến trình**: progress bar + số % + thông điệp hoạt động gần nhất của agent + số bước/elapsed, cập nhật qua `GET /api/jobs/{jobId}` (UI poll 1.5s/lần). % tính từ event thật của run, chỉ đạt 100% khi run terminal |
| FR-9 | **Nối lại job sau refresh**: UI lưu `jobId` trong `localStorage`, mở lại trang sẽ tiếp tục poll job đang chạy |
| FR-10 | **Xử lý file .zip**: server giải nén trong RAM (adm-zip) rồi upload từng file vào workspace (lô ≤10 file/request theo API v4, đính kèm `attachedFileIds` ≤20). Bảo vệ: bỏ đường dẫn (chống path traversal), tự đổi tên trùng, bỏ `__MACOSX`/`.DS_Store`/file rỗng, giới hạn `MAX_ZIP_FILES` (50) và `MAX_ZIP_TOTAL_EXTRACT_BYTES` (100MB), chặn entry khai báo size vượt giới hạn trước khi giải nén (chống zip bomb). Prompt liệt kê danh sách file đã giải nén; UI hiển thị chip "ZIP → N file đã giải nén" |
| FR-11 | **Link tải kết quả trên web sau khi hoàn thành**: server ghi `outputs/<jobId>.txt` (kết quả có header metadata) và `outputs/<jobId>.json` (response đầy đủ) khi job completed; UI hiển thị 2 nút **"Tải .txt" / "Tải .json"** trỏ tới `GET /api/jobs/{jobId}/download?type=txt\|json`. File sống sót sau khi job hết hạn trong RAM; tự xoá sau `OUTPUT_FILE_TTL_MS` (24h); chỉ đụng file `<uuid>.txt/.json` khi dọn dẹp |

## 5. Yêu cầu phi chức năng

| ID | Yêu cầu |
|---|---|
| NFR-1 | **CORS**: bật qua middleware `cors`, origin cấu hình bằng `CORS_ORIGIN` (mặc định `*`) |
| NFR-2 | **Xử lý lỗi API** đầy đủ: thiếu API key, 401/403 (key sai), 402 (hết credits), 404, 409, 422, 429 (rate limit — tôn trọng `Retry-After`), 5xx, lỗi mạng, timeout — trả thông báo tiếng Việt rõ ràng |
| NFR-3 | **Timeout 2 tầng (v1.2.0)**: `TASK_TIMEOUT_MS` mềm (mặc định 15 phút) — qua ngưỡng chỉ hiện cảnh báo "đang lâu hơn dự kiến" trên UI rồi **tiếp tục chờ**; `TASK_HARD_TIMEOUT_MS` cứng (mặc định 30 phút) — job mới dừng 504 kèm runId. UI poll không có timeout phía client, chịu tối đa 5 lần lỗi poll liên tiếp |
| NFR-4 | **Bảo mật**: API key chỉ đọc từ `.env` (không hardcode); file upload giữ trong RAM (`memoryStorage`), không ghi đĩa |
| NFR-5 | Workspace được **archive (dọn dẹp)** sau khi run kết thúc; giữ lại nếu run còn chạy do timeout |
| NFR-6 | **Chạy public trên internet**: hỗ trợ tunnel (cloudflared / ngrok / localtunnel) và deploy (Render/Railway/Fly) — hướng dẫn trong `README.md` |
| NFR-7 | 404 JSON cho endpoint API lạ; global error handler trả JSON thống nhất `{ success, error, details? }` |

## 6. API nội bộ của app

| Endpoint | Method | Mô tả |
|---|---|---|
| `/` | GET | Giao diện (index.html) |
| `/api/health` | GET | Health check |
| `/api/process` | POST | Nhận file + instructions → trả **202 `{ jobId }`** ngay. Lỗi đầu vào (thiếu file, thiếu key, file quá lớn…) vẫn trả đồng bộ 400/413/500 |
| `/api/jobs/{jobId}` | GET | Trạng thái job. `processing` → `{ status, phase, progress, message, runId, stepCount, elapsedMs }` · `completed` → kết quả đầy đủ như v1.0.0 `{ success, runId, status, result: { text, inputTokens, outputTokens, costUsd }, file, elapsedMs, run }` · `failed` → `{ success: false, error, details }` · hết hạn/không có → 404 |
| `/api/jobs/{jobId}/download?type=txt\|json` | GET | Tải file kết quả về máy (Content-Disposition attachment). Ưu tiên file trong `outputs/`; nếu chưa có thì sinh tại chỗ từ job trong RAM. type sai → 400, job chưa xong/thất bại/hết hạn → 404 |

## 7. Biến môi trường (`.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BROWSER_USE_API_KEY` | — | API key từ cloud.browser-use.com (**bắt buộc**) |
| `BROWSER_USE_BASE_URL` | `https://api.browser-use.com/api/v4` | Base URL API (đổi sang mock khi test) |
| `BROWSER_USE_MODEL` | (default) | Model cho agent, ví dụ `gpt-5.6-luna` |
| `PORT` | `3000` | Cổng server |
| `CORS_ORIGIN` | `*` | Origin được phép CORS |
| `POLL_INTERVAL_MS` | `2000` | Chu kỳ poll trạng thái run |
| `TASK_TIMEOUT_MS` | `900000` | Timeout **mềm** (15 phút) — chỉ cảnh báo, không lỗi |
| `TASK_HARD_TIMEOUT_MS` | `1800000` | Timeout **cứng** (30 phút) — job dừng 504 kèm runId |
| `MAX_FILE_SIZE_BYTES` | `10485760` | Giới hạn dung lượng file upload (zip tính theo dung lượng nén) |
| `MAX_ZIP_FILES` | `50` | Giới hạn số file sau giải nén |
| `MAX_ZIP_TOTAL_EXTRACT_BYTES` | `104857600` | Giới hạn tổng dung lượng sau giải nén (100MB) |
| `OUTPUT_DIR` | `outputs/` | Thư mục lưu file kết quả để tải về |
| `OUTPUT_FILE_TTL_MS` | `86400000` | Thời gian giữ file kết quả trước khi tự xoá (24h) |

## 8. Tiêu chí nghiệm thu

- [x] Upload file → thấy loading state (spinner + đếm giây) → nhận được kết quả hiển thị ở cả 2 tab
- [x] **% tiến trình tăng dần theo event thật của agent** (progress bar + message "Agent: …"), đạt 100% khi xong
- [x] **Viết yêu cầu trong ô "Yêu cầu xử lý" → agent thực hiện đúng yêu cầu** (đã test: yêu cầu viết code/tính toán trên file)
- [x] Refresh trang giữa chừng → UI nối lại job đang chạy qua jobId trong localStorage
- [x] **Sau khi hoàn thành, web hiển thị nút "Tải .txt" / "Tải .json"** — bấm tải file về máy (file `<jobId>.txt/.json` thật trong `outputs/`); link vẫn tải được sau khi job hết hạn trong RAM
- [x] Download `type` sai → 400; jobId không hợp lệ/không có kết quả → 404 JSON
- [x] **Upload file .zip → server giải nén, agent nhận được từng file trong workspace** (test mock + test thật với 2 file trong zip); prompt liệt kê đúng danh sách file; UI có chip "ZIP → N file"
- [x] ZIP rỗng / hỏng / quá 50 file / quá 100MB sau giải nén → lỗi 400 tiếng Việt rõ ràng
- [x] **Task chạy lâu không lỗi sớm**: qua 15 phút chỉ cảnh báo rồi tiếp tục chờ, tới 30 phút mới 504 (hành vi kiểm tra bằng unit quan sát deadline, mặc định cấu hình)
- [x] Upload file thường vẫn hoạt động như cũ (hồi quy)
- [x] Không chọn file / file quá lớn / file rỗng → báo lỗi rõ ràng trên UI
- [x] Thiếu API key → server trả lỗi tiếng Việt hướng dẫn cấu hình
- [x] API key sai → lỗi 401 từ Browser Use được dịch thành thông báo "Kiểm tra lại BROWSER_USE_API_KEY" (trả qua job failed)
- [x] Gọi cross-origin (từ tunnel/domain khác) không bị chặn CORS
- [x] Test end-to-end offline thành công với mock API (`npm run mock`) — mock có cả endpoint events

## 9. Phạm vi KHÔNG làm (tránh đi lạc hướng)

- Không làm auth/đăng nhập cho người dùng cuối
- Không lưu trữ file hay kết quả vào database (job chỉ nằm trong RAM, TTL 30 phút)
- Không làm streaming/SSE — UI poll `GET /api/jobs/{id}` theo chu kỳ (đủ cho progress %)
- Không dùng SDK `browser-use-sdk` — gọi REST trực tiếp bằng axios
- Không upload nhiều file cùng lúc — chỉ 1 file/lần xử lý
- Không tính % tiến trình theo thời gian (fake) — chỉ tính từ event thật của run