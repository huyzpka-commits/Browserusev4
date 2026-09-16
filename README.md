# Browser Use File Analyzer

Web app upload file → AI agent trên **Browser Use Cloud API (v4)** phân tích → hiển thị kết quả JSON/Text. Chạy được local và **công khai trên internet** qua tunnel hoặc deploy.

![Stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express%20%2B%20TailwindCSS-blue)

## Tính năng

- Kéo-thả / chọn file (tối đa 10MB mặc định, mọi định dạng: CSV, TXT, JSON, PDF, ảnh…)
- **Hỗ trợ file .zip**: server tự giải nén trong RAM rồi upload từng file vào workspace (tối đa 50 file, 100MB sau giải nén; chống zip bomb) — agent thấy từng file thay vì file nén
- **Ô "Yêu cầu xử lý" tuỳ chọn**: viết yêu cầu riêng cho agent — phân tích, viết code xử lý file, chuyển đổi dữ liệu… (để trống → phân tích tổng quát)
- File được **upload thật lên Workspace** của Browser Use và đính kèm vào Run (`attachedFileIds`) — agent đọc được nội dung gốc của file
- **% tiến trình theo thời gian thực**: progress bar + % + thông điệp hoạt động gần nhất của agent ("Agent: …"), tính từ Run Events thật của API v4
- **Task lâu không bị lỗi**: timeout 2 tầng — sau 15 phút chỉ cảnh báo "đang lâu hơn dự kiến" và tiếp tục chờ, tới 30 phút mới dừng (cấu hình được)
- Refresh trang không mất job — UI tự nối lại job đang chạy qua `localStorage`
- Kết quả hiển thị 2 tab: **Kết quả** (text tiếng Việt) và **JSON** (response đầy đủ của API)
- **Tải kết quả về máy ngay trên web**: sau khi hoàn thành có 2 nút "Tải .txt" / "Tải .json" — server lưu sẵn vào thư mục `outputs/` (giữ 24h)
- Chip thông tin: model, tokens input/output, chi phí USD, thời gian chạy, Run ID, số file ZIP đã giải nén
- Xử lý lỗi đầy đủ (API key sai, hết credits, rate limit, timeout, file quá lớn, ZIP hỏng…) — thông báo tiếng Việt
- CORS mở sẵn cho frontend gọi cross-origin

## Kiến trúc & luồng (job-based, v1.1.0)

```
┌─────────────┐ multipart(file+instructions) ┌──────────────┐  202 {jobId}  ┌──────────┐
│  index.html │ ──── POST /api/process ────▶ │              │ ────────────▶ │ UI poll  │
│ (Tailwind/  │                              │  server.js   │               │ 1.5s/lần │
│  vanilla JS)│                              │  (Express)   │ ◀──────────── │ GET /api/│
└─────────────┘                              │              │ phase, %,     │ jobs/{id}│
                                              │   JOB NỀN:   │ message, kết  └──────────┘
                                              │  1. POST /workspaces         │ REST v4 (X-Browser-Use-API-Key)
                                              │  2. POST /workspaces/{id}/files/upload
                                              │  3. PUT bytes → presigned URL│
                                              │  4. POST /runs (task+file)   ▼
                                              │  5. GET /runs/{id}/status (poll 2s)  ┌─────────────────┐
                                              │  6. GET /runs/{id}/events?after=... ▶ │ Browser Use Cloud│
                                              │  7. GET /runs/{id} (kết quả)  ◀────  │ (AI Agent+Browser)│
                                              └──────────────────────────────        └─────────────────┘
```

## Cấu trúc thư mục

```
.
├── server.js           # Backend Express — toàn bộ luồng gọi Browser Use API
├── public/
│   └── index.html      # Frontend — TailwindCSS + vanilla JS
├── test/
│   └── mock-api.js     # Mock Browser Use API v4 để test offline
├── .env.example        # Mẫu biến môi trường
├── REQUIREMENTS.md     # Yêu cầu app (source of truth)
├── CHANGELOG.md        # Lịch sử thay đổi theo từng lượt
├── README.md           # File này
└── package.json
```

## Cài đặt

Yêu cầu **Node.js ≥ 18**.

```bash
npm install
cp .env.example .env    # Windows: copy .env.example .env
```

Lấy API key tại **[cloud.browser-use.com](https://cloud.browser-use.com)** → *Settings → API Keys*, rồi điền vào `.env`:

```env
BROWSER_USE_API_KEY=bu_đây_là_key_của_bạn
```

## Chạy

```bash
npm start          # http://localhost:3000
npm run dev        # chế độ dev, tự restart khi sửa code
```

## Test offline không tốn credits (mock API)

```bash
npm run mock                                                        # terminal 1: mock API ở cổng 4545
BROWSER_USE_BASE_URL=http://localhost:4545 BROWSER_USE_API_KEY=test-key npm start   # terminal 2
```

Mở http://localhost:3000, upload file — mock sẽ mô phỏng agent chạy ~4 giây rồi trả kết quả.
*(PowerShell: chạy 2 dòng trên trong 2 cửa sổ riêng, đặt biến bằng `$env:BROWSER_USE_API_KEY="test-key"` trước `npm start`.)*

## Chạy công khai trên internet

### Cách 1 — Tunnel từ máy bạn

| Công cụ | Lệnh | Ghi chú |
|---|---|---|
| **cloudflared** (khuyến nghị) | `cloudflared tunnel --url http://localhost:3000` | Free, không cần đăng ký, nhận URL `*.trycloudflare.com` |
| ngrok | `ngrok http 3000` | Cần tài khoản + authtoken |
| localtunnel | `npx localtunnel --port 3000` | Free, không cần tài khoản |

### Cách 2 — Deploy lên host công khai

Deploy trực tiếp repo (Render, Railway, Fly.io…):

- Build command: `npm install` — Start command: `npm start`
- Thêm biến môi trường `BROWSER_USE_API_KEY` (và `CORS_ORIGIN` nếu cần chặn origin)
- Ví dụ Render: tạo Web Service → connect repo → Start command `npm start`

> **Lưu ý (không còn áp dụng cho luồng chính):** từ v1.1.0 app dùng job + poll ngắn (mỗi request < 2s) nên **không bị** giới hạn ~100 giây của proxy Cloudflare nữa — chạy qua tunnel thoải mái kể cả task dài.

## API nội bộ

### `GET /api/health`

```json
{ "ok": true, "apiKeyConfigured": true, "model": "(default của Browser Use)", "maxFileSizeBytes": 10485760, "uptimeSeconds": 12 }
```

### `POST /api/process` — `multipart/form-data`, field `file` (bắt buộc) + `instructions` (tuỳ chọn)

Trả về **202 ngay lập tức**:

```json
{ "success": true, "jobId": "9b2c…", "message": "Đã nhận job. Theo dõi tiến trình qua GET /api/jobs/{jobId}." }
```

Lỗi đầu vào (thiếu file, thiếu key, file quá lớn…) vẫn trả đồng bộ: `{ "success": false, "error": "…", "details": { } }`

### `GET /api/jobs/{jobId}` — poll tiến trình (UI gọi mỗi 1.5s)

**Đang xử lý:**

```json
{
  "success": true, "jobId": "9b2c…", "status": "processing",
  "phase": "running", "progress": 66,
  "message": "Agent: Đang tổng hợp kết quả",
  "runId": "1a2b…", "stepCount": 8, "elapsedMs": 21300
}
```

**Hoàn tất** (giữ nguyên shape kết quả như v1.0.0):

```json
{
  "success": true, "runId": "9b2c…", "status": "completed", "jobId": "…", "progress": 100,
  "result": { "text": "Tóm tắt nội dung file…", "inputTokens": 1234, "outputTokens": 567, "costUsd": "0.012" },
  "file": { "name": "data.zip", "contentType": "application/zip", "size": 2048,
            "isZip": true, "extractedCount": 3,
            "extractedFiles": [{ "name": "a.csv", "size": 1024 }, { "name": "b.txt", "size": 512 }, { "name": "c.json", "size": 512 }] },
  "elapsedMs": 45000,
  "run": { "…": "RunSummary đầy đủ từ Browser Use API v4" }
}
```

*(File thường: object `file` chỉ gồm `name`, `contentType`, `size` — không có các field ZIP.)*

**Thất bại:** `{ "success": false, "jobId": "…", "status": "failed", "error": "thông báo tiếng Việt", "details": { } }` · **Job hết hạn / server restart:** 404.

### `GET /api/jobs/{jobId}/download?type=txt|json` — tải kết quả về máy

Sau khi job hoàn thành, bấm nút **"Tải .txt" / "Tải .json"** trên web hoặc gọi trực tiếp:

```bash
curl -OJ "http://localhost:3000/api/jobs/<jobId>/download?type=txt"
```

- Server ghi sẵn `outputs/<jobId>.txt` (kết quả + header metadata) và `outputs/<jobId>.json` (response đầy đủ); file giữ 24h rồi tự xoá.
- Link tải vẫn hoạt động sau khi job hết hạn trong RAM.

Test bằng curl (2 bước):

```bash
# Bước 1 — tạo job (thêm -F "instructions=<yêu cầu của bạn>" nếu muốn)
JOB_ID=$(curl -s -X POST http://localhost:3000/api/process -F "file=@data.csv" | sed -E 's/.*"jobId":"([^"]+)".*/\1/')

# Bước 2 — poll tới khi status là completed/failed
curl -s http://localhost:3000/api/jobs/$JOB_ID
```

## Xử lý lỗi (bảng ánh xạ)

| Tình huống | HTTP | Thông báo |
|---|---|---|
| Thiếu API key (server chưa cấu hình) | 500 | Hướng dẫn điền `BROWSER_USE_API_KEY` vào `.env` |
| Không có file trong request | 400 | Yêu cầu multipart/form-data field `file` |
| File quá lớn | 413 | Vượt giới hạn `MAX_FILE_SIZE_BYTES` |
| API key sai / không đủ quyền (401/403) | 502 | "Kiểm tra lại BROWSER_USE_API_KEY" |
| Hết credits / chạm hạn mức (402) | 402 | Nạp credits hoặc chờ reset hạn mức |
| Rate limit (429) | 429 | Chờ `Retry-After` rồi thử lại |
| Agent chạy quá lâu | 504 | Kèm `runId` để tra cứu dashboard |
| API 5xx / lỗi mạng | 502 | Thử lại sau |

## Khắc phục sự cố

- **"Chưa cấu hình BROWSER_USE_API_KEY"** → tạo `.env` từ `.env.example`, điền key, restart.
- **402 hết credits** → nạp thêm tại dashboard Browser Use (pay-as-you-go).
- **Kết quả text trống** → task có thể không cần duyệt web; agent vẫn trả `run.result` — xem tab JSON để kiểm tra `run.error`.
- **"Job không còn tồn tại"** → server đã khởi động lại hoặc job quá 30 phút — gửi lại yêu cầu.
- **Refresh trang giữa lúc agent đang chạy** → không sao, UI tự nối lại job qua `localStorage`.
- **ZIP bị từ chối** → ZIP phải là định dạng chuẩn, tối đa 50 file và 100MB sau giải nén; file hỏng/rỗng/lẫn `__MACOSX` sẽ được bỏ qua.
- **Task trên 15 phút** → UI hiện cảnh báo "đang lâu hơn dự kiến" nhưng vẫn chờ tới tối đa 30 phút; tăng `TASK_HARD_TIMEOUT_MS` trong `.env` nếu cần chờ lâu hơn.

## Tài liệu liên quan

- Browser Use Cloud API v4: https://docs.browser-use.com/cloud/api-v4-overview.md
- Yêu cầu app: `REQUIREMENTS.md` · Lịch sử thay đổi: `CHANGELOG.md`

## License

MIT