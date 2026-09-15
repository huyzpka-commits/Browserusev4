/**
 * server.js — Web app phân tích/xử lý file qua Browser Use Cloud API (v4)
 *
 * Kiến trúc JOB-BASED (v1.1.0):
 *   POST /api/process
 *     → nhận file upload (multer, memoryStorage) + instructions (tuỳ chọn)
 *     → tạo job, trả về 202 { jobId } NGAY LẬP TỨC
 *     → xử lý ngầm:  1. Tạo Workspace            POST /workspaces
 *                    2. Xin presigned URL         POST /workspaces/{id}/files/upload
 *                    3. PUT bytes file            (presigned URL)
 *                    4. Tạo Run                   POST /runs { task, workspaceId, attachedFileIds }
 *                    5. Poll trạng thái          GET  /runs/{id}/status
 *                    6. Poll events (tiến trình)  GET  /runs/{id}/events?after=<cursor>
 *                    7. Lấy kết quả               GET  /runs/{id}
 *   GET /api/jobs/:id
 *     → UI poll endpoint này mỗi ~1.5s để nhận: phase, progress %, message, kết quả cuối.
 *
 * Lợi ích so với request đồng bộ (v1.0.0): hiển thị được % tiến trình, không bị proxy
 * Cloudflare chặn request dài (>100s), người dùng có thể refesh trang và nối lại job.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
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
// Giới hạn ô "Yêu cầu xử lý" của người dùng
const MAX_INSTRUCTIONS_CHARS = 5000;
// Job hoàn tất được giữ trong RAM 30 phút cho UI tra cứu, sau đó tự xoá
const JOB_TTL_MS = 30 * 60 * 1000;

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

/**
 * Tạo prompt cho agent:
 * - Có instructions → thực hiện đúng yêu cầu người dùng với file đính kèm
 * - Không có → prompt phân tích tổng quát (hành vi mặc định)
 */
function buildTaskPrompt(fileName, instructions) {
  if (instructions) {
    return [
      'Bạn là trợ lý AI đa năng. Trong workspace của run này có một file được đính kèm.',
      `Tên file: "${fileName}" (nằm trong thư mục uploads/).`,
      '',
      '=== YÊU CẦU TỪ NGƯỜI DÙNG ===',
      instructions,
      '=== HẾT YÊU CẦU ===',
      '',
      'Lưu ý:',
      '- Thực hiện yêu cầu trên với file đính kèm (nếu yêu cầu cần dùng file).',
      '- Nếu yêu cầu là viết code: trình bày code đầy đủ trong khối markdown, đúng ngôn ngữ lập trình, có giải thích.',
      '- Nếu yêu cầu là xử lý/số liệu: nêu rõ dữ liệu lấy từ đâu trong file.',
      '- Phần giải thích bằng tiếng Việt; giữ nguyên code, số liệu, thuật ngữ gốc.',
    ].join('\n');
  }

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

// Client cho các API cần key (workspaces, runs, events)
const buApi = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 30000,
  headers: {
    'X-Browser-Use-API-Key': config.apiKey,
    'Content-Type': 'application/json',
  },
});

/**
 * Rút gọn một event của run thành 1 dòng thông báo tiếng Việt hiển thị trên UI.
 * Event có shape: { runId, id, ts, type, data } — data là object tuỳ theo type.
 */
function summarizeEvent(event) {
  const d = event.data || {};
  const candidates = [d.message, d.text, d.summary, d.title, d.thought, d.action, d.name, d.url];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return `Agent: ${c.trim().slice(0, 140)}`;
    }
  }
  const label = String(event.type || 'hoạt động').replace(/[_-]+/g, ' ');
  return `Agent: ${label.charAt(0).toUpperCase() + label.slice(1)}`;
}

/**
 * Đọc toàn bộ event mới của run (drain các trang `hasMore` theo khuyến nghị docs)
 * rồi cập nhật % tiến trình + thông điệp cho job.
 *
 * Công thức %:  22 + 73 * n / (n + 8)   (n = số event đã thấy, tiệm cận 95%)
 * → % tăng dần theo hoạt động thật của agent, chỉ nhảy 100% khi run terminal.
 */
async function drainEventsAndUpdateProgress(job, runId) {
  let after = job.lastEventId || 0;
  let hasMore = true;

  while (hasMore) {
    const { data } = await buApi.get(`/runs/${runId}/events`, {
      params: { after, limit: 200, include_output: false },
    });
    const events = data.events || [];
    for (const ev of events) {
      if (typeof ev.id === 'number' && ev.id > after) after = ev.id;
      job.stepCount += 1;
      job.message = summarizeEvent(ev);
    }
    hasMore = data.hasMore === true;
  }
  job.lastEventId = after;

  const n = job.stepCount;
  job.progress = Math.min(95, Math.round(22 + (73 * n) / (n + 8)));
}

/**
 * Chờ Run về trạng thái terminal. Mỗi chu kỳ:
 *   1. GET /runs/{id}/status  (rẻ, endpoint poll chuyên dụng)
 *   2. GET /runs/{id}/events  (lấy delta để cập nhật tiến trình)
 * - Tôn trọng 429 (Retry-After / retry_after_seconds)
 * - Chấp nhận tối đa 3 lần poll lỗi liên tiếp rồi mới bỏ cuộc
 * - Quá TASK_TIMEOUT_MS → 504 (run phía Browser Use có thể vẫn đang chạy)
 */
async function waitForRunCompletion(job, runId) {
  const deadline = Date.now() + config.taskTimeoutMs;
  let consecutiveFailures = 0;

  while (Date.now() < deadline) {
    try {
      const { data: statusData } = await buApi.get(`/runs/${runId}/status`);
      await drainEventsAndUpdateProgress(job, runId);
      consecutiveFailures = 0;

      if (TERMINAL_STATUSES.includes(statusData.status)) return statusData.status;

      if (statusData.status === 'queued' || statusData.status === 'dispatching') {
        job.phase = 'queued';
        if (!job.message) job.message = 'Run đang trong hàng đợi…';
      } else {
        job.phase = 'running';
      }
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
        throw new ApiError(normalized.status, `Không theo dõi được run: ${normalized.message}`, normalized.details);
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

/* ============================== JOB STORE ============================== */

const jobs = new Map();

function createJob() {
  const job = {
    id: crypto.randomUUID(),
    status: 'processing', // processing | completed | failed
    phase: 'uploading',   // uploading | queued | running | done | failed
    progress: 0,
    message: 'Đang chuẩn bị…',
    runId: null,
    workspaceId: null,
    stepCount: 0,
    lastEventId: 0,
    startedAt: Date.now(),
    finishedAt: null,
    result: null, // response đầy đủ khi completed
    httpStatus: null,
    error: null,
    details: null,
  };
  jobs.set(job.id, job);
  return job;
}

// Dọn job đã kết thúc quá 30 phút (job đang chạy không bị xoá)
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'processing' && job.finishedAt && now - job.finishedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Toàn bộ pipeline xử lý 1 job — chạy nền, mọi lỗi được ghi vào job.
 */
async function processJob(job, uploadedFile, instructions) {
  let keepWorkspace = false;
  try {
    const file = {
      name: uploadedFile.originalname,
      contentType: uploadedFile.mimetype || 'application/octet-stream',
      size: uploadedFile.size,
    };
    const task = buildTaskPrompt(file.name, instructions);

    // --- Bước 1: Tạo workspace ---
    job.message = 'Tạo workspace trên Browser Use…';
    job.progress = 4;
    const workspaceRes = await withStep('Tạo workspace trên Browser Use', () =>
      buApi.post('/workspaces', { name: `webapp-${Date.now()}` })
    );
    job.workspaceId = workspaceRes.data.id;
    if (!job.workspaceId) throw new ApiError(502, 'Browser Use không trả về workspace id.');
    job.progress = 10;

    // --- Bước 2: Xin presigned URL ---
    job.message = 'Đăng ký upload file…';
    const uploadRes = await withStep('Đăng ký upload file', () =>
      buApi.post(`/workspaces/${job.workspaceId}/files/upload`, {
        files: [{ name: file.name, contentType: file.contentType, size: file.size }],
      })
    );
    const fileInfo = uploadRes.data.files && uploadRes.data.files[0];
    if (!fileInfo || !fileInfo.uploadUrl) {
      throw new ApiError(502, 'Browser Use không trả về presigned upload URL.');
    }

    // --- Bước 3: PUT bytes file ---
    job.message = 'Đang tải file lên Browser Use…';
    job.progress = 14;
    await withStep('Tải file lên Browser Use', () =>
      axios.put(fileInfo.uploadUrl, uploadedFile.buffer, {
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

    // --- Bước 4: Tạo run ---
    job.message = 'Khởi chạy agent…';
    job.progress = 20;
    const runBody = { task, workspaceId: job.workspaceId, attachedFileIds: [fileInfo.id] };
    if (config.model) runBody.model = config.model;

    const runRes = await withStep('Tạo run trên Browser Use', () => buApi.post('/runs', runBody));
    job.runId = runRes.data.id;
    if (!job.runId) throw new ApiError(502, 'Browser Use không trả về run id.', { response: runRes.data });
    job.phase = 'queued';
    job.progress = 22;
    job.message = 'Run đã được tạo — agent đang bắt đầu…';

    // --- Bước 5 + 6: Chờ agent (cập nhật tiến trình qua events) ---
    const finalStatus = await withStep('Chờ agent xử lý', () => waitForRunCompletion(job, job.runId));

    // --- Bước 7: Lấy kết quả ---
    job.message = 'Đang lấy kết quả…';
    job.progress = 97;
    const summaryRes = await withStep('Lấy kết quả run', () => buApi.get(`/runs/${job.runId}`));
    const run = summaryRes.data;

    if (finalStatus !== 'completed') {
      throw new ApiError(502, `Run kết thúc với trạng thái "${finalStatus}"${run.error ? `: ${run.error}` : ' (không có thông tin lỗi).'}`, {
        runId: job.runId,
        run,
      });
    }

    job.result = {
      success: true,
      runId: job.runId,
      status: run.status,
      result: {
        text: run.result && String(run.result).trim() ? run.result : '(Agent hoàn thành nhưng không trả về nội dung.)',
        inputTokens: run.totalInputTokens,
        outputTokens: run.totalOutputTokens,
        costUsd: run.totalCostUsd,
      },
      file,
      elapsedMs: Date.now() - job.startedAt,
      run,
    };
    job.status = 'completed';
    job.phase = 'done';
    job.progress = 100;
    job.message = 'Hoàn tất';
  } catch (err) {
    keepWorkspace = err.keepWorkspace === true;
    if (err instanceof ApiError) {
      job.httpStatus = err.status;
      job.error = err.message;
      job.details = err.details;
    } else if (err.name === 'MulterError') {
      job.httpStatus = 400;
      job.error = `Lỗi upload file: ${err.message}`;
    } else if (err.response) {
      const normalized = normalizeUpstreamError(err);
      job.httpStatus = normalized.status;
      job.error = normalized.message;
      job.details = normalized.details;
    } else {
      job.httpStatus = 502;
      job.error = err.message || 'Lỗi không xác định khi xử lý job.';
    }
    if (job.workspaceId) {
      job.details = { ...(job.details || {}), workspaceId: job.workspaceId };
    }
    job.status = 'failed';
    job.phase = 'failed';
  } finally {
    job.finishedAt = Date.now();
    // Dọn dẹp: archive workspace sau khi xong.
    // Giữ lại workspace nếu timeout nhưng run vẫn đang chạy phía cloud.
    if (job.workspaceId && !keepWorkspace) {
      buApi.delete(`/workspaces/${job.workspaceId}`).catch(() => {});
    }
  }
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

/**
 * POST /api/process — nhận file + instructions, tạo job xử lý ngầm.
 * Trả 202 { jobId } ngay; UI theo dõi qua GET /api/jobs/{jobId}.
 * Request: multipart/form-data với field `file` (bắt buộc) và `instructions` (tuỳ chọn, ≤5000 ký tự).
 */
app.post('/api/process', upload.single('file'), async (req, res, next) => {
  try {
    // --- Kiểm tra đầu vào (lỗi trả đồng bộ luôn) ---
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

    // --- Ô "Yêu cầu xử lý" (tuỳ chọn) ---
    const instructions = (typeof req.body.instructions === 'string' ? req.body.instructions : '')
      .trim()
      .slice(0, MAX_INSTRUCTIONS_CHARS);

    const job = createJob();
    // Chạy nền — lỗi được processJob ghi vào job, không ảnh hưởng response này
    processJob(job, req.file, instructions).catch(() => {});

    res.status(202).json({
      success: true,
      jobId: job.id,
      message: 'Đã nhận job. Theo dõi tiến trình qua GET /api/jobs/{jobId}.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jobs/:id — endpoint cho UI poll tiến trình.
 *   processing → { success, jobId, status, phase, progress, message, runId, stepCount, elapsedMs }
 *   completed  → response đầy đủ như v1.0.0: { success, runId, status, result, file, elapsedMs, run }
 *   failed     → { success: false, jobId, status, error, details } với HTTP code gốc của lỗi
 */
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Không tìm thấy job (đã hết hạn 30 phút hoặc server đã khởi động lại).',
    });
  }

  if (job.status === 'processing') {
    return res.json({
      success: true,
      jobId: job.id,
      status: 'processing',
      phase: job.phase,
      progress: job.progress,
      message: job.message,
      runId: job.runId,
      stepCount: job.stepCount,
      elapsedMs: Date.now() - job.startedAt,
    });
  }

  if (job.status === 'completed') {
    return res.json({ ...job.result, jobId: job.id, progress: 100 });
  }

  // failed
  return res.status(job.httpStatus || 502).json({
    success: false,
    jobId: job.id,
    status: 'failed',
    error: job.error,
    details: job.details,
  });
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