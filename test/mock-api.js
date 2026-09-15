/**
 * test/mock-api.js — Mock Browser Use Cloud API v4 để test local không tốn credits.
 *
 * Chạy:            npm run mock  (mặc định cổng 4545)
 * Trỏ server tới:   BROWSER_USE_BASE_URL=http://localhost:4545 BROWSER_USE_API_KEY=test-key
 *
 * Mô phỏng đầy đủ luồng API v4:
 *   POST /workspaces                         → tạo workspace
 *   POST /workspaces/:id/files/upload       → cấp presigned URL
 *   PUT  /mock-upload/:fileId                → nhận bytes file (thay cho S3)
 *   POST /runs                               → tạo run, tự "hoàn thành" sau ~4s
 *   GET  /runs/:id/status                    → trạng thái run
 *   GET  /runs/:id                           → RunSummary (result, tokens, cost…)
 *   DELETE /workspaces/:id                   → archive workspace
 */

const express = require('express');

const PORT = Number(process.env.MOCK_PORT || 4545);
const VALID_KEY = process.env.MOCK_API_KEY || 'test-key';
const TERMINAL_DELAY_MS = Number(process.env.MOCK_RUN_DELAY_MS || 4000);

const app = express();
app.use(express.json());

const workspaces = new Map();
const runs = new Map();
let lastUploadedBytes = Buffer.alloc(0);

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Kiểm tra API key giống Browser Use (header X-Browser-Use-API-Key)
app.use((req, res, next) => {
  if (req.path.startsWith('/mock-upload')) return next(); // presigned URL không cần key
  const key = req.get('X-Browser-Use-API-Key');
  if (key !== VALID_KEY) {
    return res.status(401).json({ detail: 'Invalid or missing API key' });
  }
  next();
});

app.post('/workspaces', (req, res) => {
  const id = uuid();
  workspaces.set(id, { id, name: req.body.name || null, archived: false, createdAt: new Date().toISOString() });
  res.json({ id, name: req.body.name || null, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
});

app.post('/workspaces/:id/files/upload', (req, res) => {
  const ws = workspaces.get(req.params.id);
  if (!ws) return res.status(404).json({ detail: 'Workspace not found' });
  const items = (req.body.files || []).map((f) => ({
    id: uuid(),
    name: f.name,
    storedName: f.name,
    path: `uploads/${f.name}`,
    willOverride: false,
    uploadUrl: `http://localhost:${PORT}/mock-upload/${uuid()}`,
  }));
  res.json({ files: items });
});

// Nhận bytes như một presigned PUT lên S3
app.put('/mock-upload/:fileId', (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    lastUploadedBytes = Buffer.concat(chunks);
    res.sendStatus(200);
  });
});

app.post('/runs', (req, res) => {
  const runId = uuid();
  const run = {
    id: runId,
    task: req.body.task,
    model: req.body.model || 'gpt-5.6-luna',
    status: 'queued',
    workspaceId: req.body.workspaceId,
    uploadedBytes: lastUploadedBytes.length,
    createdAt: new Date().toISOString(),
  };
  runs.set(runId, run);

  setTimeout(() => {
    run.status = 'completed';
    run.result =
      `[MOCK] Agent đã phân tích xong file của bạn.\n` +
      `- Kích thước file nhận được: ${run.uploadedBytes} bytes\n` +
      `- Task: ${run.task.slice(0, 80)}…\n` +
      `- Thời gian mô phỏng: ${TERMINAL_DELAY_MS / 1000}s`;
  }, TERMINAL_DELAY_MS);

  res.json({ id: runId, status: run.status, model: run.model, sessionId: uuid(), workspaceId: run.workspaceId, eventsUrl: '', missingFileIds: [] });
});

app.get('/runs/:id/status', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ detail: 'Run not found' });
  res.json({ status: run.status });
});

app.get('/runs/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ detail: 'Run not found' });
  res.json({
    id: run.id,
    task: run.task,
    title: null,
    model: run.model,
    contextLimit: 128000,
    status: run.status,
    result: run.status === 'completed' ? run.result : null,
    error: null,
    sessionId: uuid(),
    workspaceId: run.workspaceId,
    attachedFileIds: null,
    judgement: null,
    totalInputTokens: 1234,
    totalOutputTokens: 567,
    totalCostUsd: '0.012',
    createdAt: run.createdAt,
    updatedAt: new Date().toISOString(),
  });
});

app.delete('/workspaces/:id', (req, res) => {
  const ws = workspaces.get(req.params.id);
  if (!ws) return res.json({ ok: true }); // idempotent như API thật
  ws.archived = true;
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Mock Browser Use API v4 chạy tại http://localhost:${PORT}`);
  console.log(`Server chính cần biến môi trường: BROWSER_USE_BASE_URL=http://localhost:${PORT} BROWSER_USE_API_KEY=${VALID_KEY}`);
});