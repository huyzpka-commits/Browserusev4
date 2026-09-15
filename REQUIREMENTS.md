# REQUIREMENTS.md — Yêu cầu ứng dụng

**Tên app:** Browser Use File Analyzer
**Phiên bản yêu cầu:** 1.0.0 · **Cập nhật:** 2026-09-15

> File này là **nguồn chân lý (source of truth)** cho mọi yêu cầu của app.
> Mọi thay đổi trong các lượt làm việc sau **phải** được ghi vào `CHANGELOG.md` và nếu làm thay đổi hành vi thì cập nhật lại file này.

---

## 1. Mục tiêu

Xây dựng một web app **chạy công khai trên internet**, cho phép người dùng:

1. Upload một file bất kỳ (CSV, TXT, JSON, PDF, ảnh…).
2. Backend gửi file tới **Browser Use Cloud API (v4)** để AI agent phân tích.
3. Chờ agent chạy xong và **hiển thị kết quả JSON/Text** trên UI.

## 2. Công nghệ (bắt buộc)

| Thành phần | Công nghệ |
|---|---|
| Backend | Node.js (≥ 18) + Express |
| Frontend | HTML + JavaScript thuần + TailwindCSS (CDN) |
| API ngoài | Browser Use Cloud API **v4** (`https://api.browser-use.com/api/v4`), auth bằng header `X-Browser-Use-API-Key` |
| Thư viện | `express`, `cors`, `multer`, `dotenv`, `axios` |

## 3. Luồng xử lý (bắt buộc)

```
[UI: chọn/kéo-thả file] ──POST /api/process (multipart)──▶ [Backend]
                                                            │ 1. Tạo workspace        POST /workspaces
                                                            │ 2. Xin presigned URL    POST /workspaces/{id}/files/upload
                                                            │ 3. PUT bytes file lên presigned URL
                                                            │ 4. Tạo run              POST /runs { task, workspaceId, attachedFileIds }
                                                            │ 5. Poll trạng thái      GET /runs/{id}/status (2s/lần)
                                                            │ 6. Lấy kết quả          GET /runs/{id}
                                                            ◀── JSON: result.text + run raw + tokens/cost──
[UI: hiển thị tab "Kết quả" (text) và tab "JSON"]
```

## 4. Yêu cầu chức năng

| ID | Yêu cầu |
|---|---|
| FR-1 | UI có **form upload file** (click + kéo-thả) và **nút "Xử lý"** |
| FR-2 | Nút "Xử lý" gọi `POST /api/process` với `multipart/form-data`, field `file` |
| FR-3 | **Loading state**: spinner + đếm giây + disable nút + disable dropzone khi đang xử lý |
| FR-4 | **Vùng hiển thị kết quả**: 2 tab — "Kết quả" (text) và "JSON" (raw đầy đủ), kèm chip thông tin (model, tokens, chi phí, thời gian) và nút Copy |
| FR-5 | `GET /api/health` health check (trạng thái server, đã cấu hình API key chưa) |
| FR-6 | Giới hạn file mặc định **10MB** (cấu hình được qua `MAX_FILE_SIZE_BYTES`; trần Browser Use là 50MB) |

## 5. Yêu cầu phi chức năng

| ID | Yêu cầu |
|---|---|
| NFR-1 | **CORS**: bật qua middleware `cors`, origin cấu hình bằng `CORS_ORIGIN` (mặc định `*`) |
| NFR-2 | **Xử lý lỗi API** đầy đủ: thiếu API key, 401/403 (key sai), 402 (hết credits), 404, 409, 422, 429 (rate limit — tôn trọng `Retry-After`), 5xx, lỗi mạng, timeout — trả thông báo tiếng Việt rõ ràng |
| NFR-3 | **Timeout**: poll mỗi `POLL_INTERVAL_MS` (2s), chờ tối đa `TASK_TIMEOUT_MS` (5 phút) → lỗi 504 kèm runId |
| NFR-4 | **Bảo mật**: API key chỉ đọc từ `.env` (không hardcode); file upload giữ trong RAM (`memoryStorage`), không ghi đĩa |
| NFR-5 | Workspace được **archive (dọn dẹp)** sau khi run kết thúc; giữ lại nếu run còn chạy do timeout |
| NFR-6 | **Chạy public trên internet**: hỗ trợ tunnel (cloudflared / ngrok / localtunnel) và deploy (Render/Railway/Fly) — hướng dẫn trong `README.md` |
| NFR-7 | 404 JSON cho endpoint API lạ; global error handler trả JSON thống nhất `{ success, error, details? }` |

## 6. API nội bộ của app

| Endpoint | Method | Mô tả |
|---|---|---|
| `/` | GET | Giao diện (index.html) |
| `/api/health` | GET | Health check |
| `/api/process` | POST | Upload file + phân tích. Request: multipart `file`. Response: `{ success, runId, status, result: { text, inputTokens, outputTokens, costUsd }, file, elapsedMs, run }` |

## 7. Biến môi trường (`.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BROWSER_USE_API_KEY` | — | API key từ cloud.browser-use.com (**bắt buộc**) |
| `BROWSER_USE_BASE_URL` | `https://api.browser-use.com/api/v4` | Base URL API (đổi sang mock khi test) |
| `BROWSER_USE_MODEL` | (default) | Model cho agent, ví dụ `gpt-5.6-luna` |
| `PORT` | `3000` | Cổng server |
| `CORS_ORIGIN` | `*` | Origin được phép CORS |
| `POLL_INTERVAL_MS` | `2000` | Chu kỳ poll trạng thái run |
| `TASK_TIMEOUT_MS` | `300000` | Thời gian chờ tối đa cho 1 run |
| `MAX_FILE_SIZE_BYTES` | `10485760` | Giới hạn dung lượng file upload |

## 8. Tiêu chí nghiệm thu

- [x] Upload file → thấy loading state (spinner + đếm giây) → nhận được kết quả hiển thị ở cả 2 tab
- [x] Không chọn file / file quá lớn / file rỗng → báo lỗi rõ ràng trên UI
- [x] Thiếu API key → server trả lỗi tiếng Việt hướng dẫn cấu hình
- [x] API key sai → lỗi 401 từ Browser Use được dịch thành thông báo "Kiểm tra lại BROWSER_USE_API_KEY"
- [x] Gọi cross-origin (từ tunnel/domain khác) không bị chặn CORS
- [x] Test end-to-end offline thành công với mock API (`npm run mock`)

## 9. Phạm vi KHÔNG làm (tránh đi lạc hướng)

- Không làm auth/đăng nhập cho người dùng cuối
- Không lưu trữ file hay kết quả vào database
- Không làm streaming/SSE — request đồng bộ, chờ tới khi xong
- Không dùng SDK `browser-use-sdk` — gọi REST trực tiếp bằng axios
- Không upload nhiều file cùng lúc — chỉ 1 file/lần xử lý