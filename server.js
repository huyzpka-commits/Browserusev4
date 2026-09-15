/**
 * server.js — Web app phân tích file qua Browser Use Cloud API (v4)
 *
 * Luồng xử lý POST /api/process:
 *   1. Nhận file upload (multer, lưu trong bộ nhớ — không ghi đĩa)
 *   2. Tạo Workspace trên Browser Use        → POST   /workspaces
 *   3. Đăng ký & tải file lên Workspace       → POST   /workspaces/{id}/files/upload (presigned PUT)
 *   4. Tạo Run (agent bắt đầu phân tích)      → POST   /runs  { task, workspaceId, attachedFileIds }
 *   5. Chờ Run về trạng thái terminal         → GET    /runs/{id}/status (poll)
 *   6. Lấy kết quả chi tiết                   → GET    /runs/{id}
 *   7. Trả JSON (kết quả text + raw) về UI, dọn dẹp Workspace
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const multer = require('multer');

/* ============================== CẤU HÌNH ============================== */

const config = {
  port: Number(process.env.PORT || 3000),
  apiKey: (process.env.BROWSER_USE_API_KEY || '').trim(),
  // API v4, auth bằng header X-Browser-Use-API-Key (không dùng "Bearer")
  apiBaseUrl: (process.env.BROWSER_USE_BASE_URL || 'https://api.browser-use.com/api/v4').replace(/\/+$/, ''),
  model: (process.env.BROWSER_USE_MODEL || '').trim(),
  pollIntervalMs: Math.max(1000, Number(process.env.POLL_INTERVAL_MS || 2000)),
  taskTimeoutMs: Math.max(10000, Number(process.env.TASK_TIMEOUT_MS || 300000)),
  maxFileSizeBytes: Number(process.env.MAX_FILE_SIZE_BYTES || 10 * 1024 * 1024),
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

// Giới hạn 50MB/file của Workspace Upload API bên Browser Use
const BROWSER_USE_MAX_FILE_BYTES = 50 * 1024 * 1024;
// Trạng thái terminal của một Run theo API v4
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

/* ============================== TIỆN ÍCH ============================== */

class ApiError extends Error {
  /**
   * @param {number} status HTTP status trả về client
   * @param {string} message Thông báo lỗi tiếng Việt
   * @param {object} [details] Thông tin bổ sung (runId, response của API...)
   */
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tạo prompt cho agent dựa trên file đã upload vào workspace */
function buildTaskPrompt(fileName) {
  return [
    'Bạn là trợ lý phân tích dữ liệu. Trong workspace của run này có một file được đính kèm.',
    `Tên file: "${fileName}" (nằm trong thư mục uploads/).`,
    'Hãy thực hiện các bước sau:',
    '1. Đọc và hiểu toàn bộ nội dung file.',
    '2. Tóm tắt ngắn gọn nội dung chính của file.',
    '3. Nêu các điểm quan trọng, số liệu nổi bật hoặc vấn đề phát hiện được (nếu có).',
    '4. Đưa ra nhận xét và đề xuất cải thiện (nếu phù hợp).',
    'Trả lời bằng tiếng Việt, trình bày rõ ràng, có cấu trúc, dễ đọc.',
  ].join('\n');
}

/**
 * Bọc một bước gọi API: nếu lỗi thì gắn ngữ cảnh bước đó vào thông báo lỗi
 * để người dùng biết thất bại ở khâu nào.
 */
async function withStep(context, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.response) {
      const normalized = normalizeUpstreamError(err);
      throw new ApiError(normalized.status, `${context} thất bại: ${normalized.message}`, normalized.details);
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new ApiError(504, `${context} thất bại: quá thời gian chờ kết nối.`);
    }
    throw new ApiError(502, `${context} thất bại: ${err.message}`);
  }
}

/** Chuẩn hóa lỗi HTTP trả về từ Browser Use API thành ApiError tiếng Việt */
function normalizeUpstreamError(err) {
  const status = err.response ? err.response.status : 0;
  const rawBody = err.response ? err.response.data : null;
  let detail = '';
  if (rawBody) {
    if (typeof rawBody.detail === 'string') detail = rawBody.detail;
    else if (rawBody.detail && typeof rawBody.detail.message === 'string') detail = rawBody.detail.message;
    else if (typeof rawBody.message === 'string') detail = rawBody.message;
    else {
      try {
        detail = JSON.stringify(rawBody).slice(0, 300);
      } catch {
        detail = '';
      }
    }
  }

  if (status === 401 || status === 403) {
    return { status: 502, message: `Browser Use API từ chối truy cập (HTTP ${status}). Kiểm tra lại BROWSER_USE_API_KEY.`, details: detail };
  }
  if (status === 402) {
    return { status: 402, message: 'Tài khoản Browser Use hết credits hoặc API key đã chạm hạn mức chi tiêu tháng.', details: detail };
  }
  if (status === 429) {
    return { status: 429, message: 'Browser Use API yêu cầu gửi chậm lại (rate limit). Vui lòng thử lại sau ít phút.', details: detail };
  }
  if (status === 404) {
    return { status: 502, message: 'Browser Use API không tìm thấy tài nguyên (HTTP 404). Kiểm tra BROWSER_USE_BASE_URL.', details: detail };
  }
  if (status === 409) {
    return { status: 502, message: 'Browser Use API trả về xung đột (HTTP 409). Run/session có thể đang bận.', details: detail };
  }
  if (status >= 400 && status < 500) {
    return { status: 502, message: `Browser Use API trả về lỗi HTTP ${status}.`, details: detail };
  }
  return { status: 502, message: `Browser Use API lỗi hệ thống (HTTP ${status || 'không rõ'}). Thử lại sau.`, details: detail };
}

/* ============================== BROWSER USE API CLIENT ============================== */

// Client mặc định cho các API cần key (workspaces, runs)
const buApi = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 30000,
  headers: {
    'X-Browser-Use-API-Key': config.apiKey,
    'Content-Type': 'application/json',
  },
});

/**
 * Chờ Run về trạng thái terminal (completed/failed/cancelled).
 * - Poll endpoint nhẹ GET /runs/{id}/status theo POLL_INTERVAL_MS
 * - Tôn trọng 429 (Retry-After / retry_after_seconds)
 * - Chấp nhận tối đa 3 lần poll lỗi liên tiếp rồi mới bỏ cuộc
 * - Quá TASK_TIMEOUT_MS → 504 (run phía Browser Use có thể vẫn đang chạy)
 */
async function waitForRunCompletion(runId) {
  const deadline = Date.now() + config.taskTimeoutMs;
  let consecutiveFailures = 0;

  while (Date.now() < deadline) {
    try {
      const { data } = await buApi.get(`/runs/${runId}/status`);
      consecutiveFailures = 0;
      if (TERMINAL_STATUSES.includes(data.status)) return data.status;
    } catch (err) {
      if (err.response && err.response.status === 429) {
        const bodyRetry = err.response.data && err.response.data.retry_after_seconds;
        const retrySeconds = Number(err.response.headers['retry-after'] || bodyRetry || 5);
        await sleep(Math.min(Math.max(retrySeconds * 1000, 1000), 30000));
        continue;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) {
        const normalized = normalizeUpstreamError(err);
        throw new ApiError(normalized.status, `Không lấy được trạng thái run: ${normalized.message}`, normalized.details);
      }
    }
    await sleep(config.pollIntervalMs);
  }

  const timeoutError = new ApiError(
    504,
    `Agent chưa hoàn thành sau ${Math.round(config.taskTimeoutMs / 1000)} giây. Run vẫn có thể đang chạy trên Browser Use — kiểm tra dashboard với Run ID.`,
    { runId }
  );
  // Giữ lại workspace để run có thể tiếp tục chạy phía cloud
  timeoutError.keepWorkspace = true;
  throw timeoutError;
}

/* ============================== APP ============================== */

const app = express();

// CORS — cho frontend gọi từ domain khác (khi deploy/tunnel)
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// Frontend tĩnh
app.use(express.static(path.join(__dirname, 'public')));

// Upload file: lưu trong RAM (memoryStorage), không ghi ra đĩa
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileSizeBytes },
});

/* GET /api/health — health check cho monitor / tunnel */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    apiKeyConfigured: Boolean(config.apiKey),
    model: config.model || '(default của Browser Use)',
    maxFileSizeBytes: config.maxFileSizeBytes,
    taskTimeoutMs: config.taskTimeoutMs,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/* POST /api/process — nhận file, gửi Browser Use phân tích, chờ và trả kết quả */
app.post('/api/process', upload.single('file'), async (req, res, next) => {
  const startedAt = Date.now();
  let workspaceId = null;
  let lastError = null;

  try {
    // --- Kiểm tra đầu vào ---
    if (!config.apiKey) {
      throw new ApiError(500, 'Chưa cấu hình BROWSER_USE_API_KEY. Thêm key vào file .env (xem .env.example) rồi khởi động lại server.');
    }
    if (!req.file) {
      throw new ApiError(400, 'Không nhận được file. Gửi request dạng multipart/form-data với field tên "file".');
    }
    if (req.file.size > BROWSER_USE_MAX_FILE_BYTES) {
      throw new ApiError(400, 'File vượt quá giới hạn 50MB của Browser Use Workspace.');
    }
    if (req.file.size === 0) {
      throw new ApiError(400, 'File rỗng (0 byte). Vui lòng chọn file có nội dung.');
    }

    const file = {
      name: req.file.originalname,
      contentType: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
    };
    const task = buildTaskPrompt(file.name);

    // --- Bước 1: Tạo workspace ---
    const workspaceRes = await withStep('Tạo workspace trên Browser Use', () =>
      buApi.post('/workspaces', { name: `webapp-${Date.now()}` })
    );
    workspaceId = workspaceRes.data.id;
    if (!workspaceId) throw new ApiError(502, 'Browser Use không trả về workspace id.');

    // --- Bước 2: Xin presigned URL rồi PUT file bytes lên đó ---
    const uploadRes = await withStep('Đăng ký upload file', () =>
      buApi.post(`/workspaces/${workspaceId}/files/upload`, {
        files: [{ name: file.name, contentType: file.contentType, size: file.size }],
      })
    );
    const fileInfo = uploadRes.data.files && uploadRes.data.files[0];
    if (!fileInfo || !fileInfo.uploadUrl) {
      throw new ApiError(502, 'Browser Use không trả về presigned upload URL.');
    }

    await withStep('Tải file lên Browser Use', () =>
      axios.put(fileInfo.uploadUrl, req.file.buffer, {
        // Presigned URL bị ghim theo Content-Type + Content-Length khai báo
        headers: {
          'Content-Type': file.contentType,
          'Content-Length': String(file.size),
        },
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      })
    );

    // --- Bước 3: Tạo run (agent bắt đầu làm việc) ---
    const runBody = { task, workspaceId, attachedFileIds: [fileInfo.id] };
    if (config.model) runBody.model = config.model;

    const runRes = await withStep('Tạo run trên Browser Use', () => buApi.post('/runs', runBody));
    const runId = runRes.data.id;
    if (!runId) throw new ApiError(502, 'Browser Use không trả về run id.', { response: runRes.data });

    // --- Bước 4 + 5: Chờ agent hoàn thành rồi lấy kết quả ---
    await withStep('Chờ agent phân tích', () => waitForRunCompletion(runId));

    const summaryRes = await withStep('Lấy kết quả run', () => buApi.get(`/runs/${runId}`));
    const run = summaryRes.data;

    if (run.status !== 'completed') {
      throw new ApiError(502, `Run kết thúc với trạng thái "${run.status}"${run.error ? `: ${run.error}` : ' (không có thông tin lỗi).'}`, {
        runId,
        run,
      });
    }

    // --- Trả kết quả về UI ---
    res.json({
      success: true,
      runId,
      status: run.status,
      result: {
        text: run.result && String(run.result).trim() ? run.result : '(Agent hoàn thành nhưng không trả về nội dung.)',
        inputTokens: run.totalInputTokens,
        outputTokens: run.totalOutputTokens,
        costUsd: run.totalCostUsd,
      },
      file,
      elapsedMs: Date.now() - startedAt,
      run,
    });
  } catch (err) {
    lastError = err;
    if (workspaceId) {
      err.details = { ...(err.details || {}), workspaceId };
    }
    next(err);
  } finally {
    // Dọn dẹp: archive workspace sau khi xong.
    // Giữ lại workspace nếu client timeout nhưng run vẫn đang chạy phía cloud.
    if (workspaceId && !(lastError && lastError.keepWorkspace)) {
      buApi.delete(`/workspaces/${workspaceId}`).catch(() => {});
    }
  }
});

/* 404 cho các API lạ (không ảnh hưởng static) */
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `Không tìm thấy endpoint API: ${req.method} ${req.originalUrl}` });
});

/* ============================== ERROR HANDLER CHUNG ============================== */

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = 500;
  let message = err.message || 'Lỗi máy chủ nội bộ.';
  let details = err.details;

  // Lỗi upload của multer
  if (err.name === 'MulterError') {
    const limitMb = config.maxFileSizeBytes / 1024 / 1024;
    const limitDesc = limitMb >= 1 ? `${Math.round(limitMb)}MB` : `${Math.round(config.maxFileSizeBytes / 1024)}KB`;
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      message = `File vượt quá giới hạn ${limitDesc} cho phép của server.`;
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      status = 400;
      message = 'Field upload không đúng. Chỉ gửi 1 file với field tên "file".';
    } else {
      status = 400;
      message = `Lỗi upload file: ${err.message}`;
    }
  } else if (err.response) {
    // Lỗi HTTP từ Browser Use API
    const normalized = normalizeUpstreamError(err);
    status = normalized.status;
    message = normalized.message;
    details = normalized.details;
  } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
    status = 504;
    message = 'Kết nối tới Browser Use API quá thời gian chờ.';
  } else if (err.request) {
    // Request đã gửi nhưng không nhận được response (mạng, DNS...)
    status = 502;
    message = 'Không kết nối được tới Browser Use API (lỗi mạng). Kiểm tra kết nối internet và BROWSER_USE_BASE_URL.';
  } else if (!(err instanceof ApiError)) {
    status = 500;
  } else {
    status = err.status;
  }

  console.error(`[ERROR] ${req.method} ${req.originalUrl} -> ${status} :: ${message}`);
  res.status(status).json({ success: false, error: message, ...(details ? { details } : {}) });
});

/* ============================== KHỞI ĐỘNG ============================== */

app.listen(config.port, () => {
  console.log(`Server chạy tại: http://localhost:${config.port}`);
  if (!config.apiKey) {
    console.warn('[WARN] Chưa cấu hình BROWSER_USE_API_KEY — app sẽ chạy nhưng POST /api/process sẽ báo lỗi. Tạo file .env từ .env.example.');
  }
  console.log(`Browser Use API: ${config.apiBaseUrl} | Model: ${config.model || 'default'}`);
});

module.exports = app;