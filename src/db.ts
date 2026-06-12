import { Database } from "bun:sqlite";
import type {
  MachineProfile,
  RunConfig,
  Verdict,
  GradeMethod,
} from "./types";

const DB_PATH = process.env.LLM_BENCH_DB ?? "bench.db";

export const db = new Database(DB_PATH, { create: true });
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA foreign_keys = ON;");

db.run(`
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY,
  fingerprint TEXT UNIQUE NOT NULL,
  hostname TEXT NOT NULL,
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  chip TEXT NOT NULL,
  cpu_cores INTEGER NOT NULL,
  perf_cores INTEGER,
  eff_cores INTEGER,
  gpu TEXT,
  gpu_cores INTEGER,
  ram_gb REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  label TEXT NOT NULL,
  question_set TEXT NOT NULL,
  questions_json TEXT NOT NULL,        -- snapshot for reproducible re-grading
  trials INTEGER NOT NULL,
  temperature REAL NOT NULL,
  max_tokens INTEGER NOT NULL,
  timeout_ms INTEGER NOT NULL,
  judge_provider TEXT,
  judge_base_url TEXT,
  judge_model TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|done|failed|cancelled
  notes TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS run_models (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model_id TEXT NOT NULL,
  params TEXT,
  quant TEXT,
  format TEXT,
  requested_context INTEGER NOT NULL,
  loaded_context INTEGER,              -- what the provider reports, when detectable
  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|done|crashed|skipped
  error TEXT
);
CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY,
  run_model_id INTEGER NOT NULL REFERENCES run_models(id),
  qid TEXT NOT NULL,
  trial INTEGER NOT NULL,
  response TEXT,
  extracted_answer TEXT,
  ttft_ms REAL,
  total_ms REAL,
  completion_tokens INTEGER,
  tok_per_sec REAL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(run_model_id, qid, trial)
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY,
  response_id INTEGER UNIQUE NOT NULL REFERENCES responses(id),
  verdict TEXT NOT NULL,               -- correct|incorrect|error
  method TEXT NOT NULL,                -- auto|judge|manual|pending
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Lightweight migrations for databases created by older versions.
const runCols = db.query("PRAGMA table_info(runs)").all() as { name: string }[];
if (!runCols.some((c) => c.name === "manage_models")) {
  db.run("ALTER TABLE runs ADD COLUMN manage_models INTEGER NOT NULL DEFAULT 1");
}
if (!runCols.some((c) => c.name === "top_p")) {
  db.run("ALTER TABLE runs ADD COLUMN top_p REAL");
}
if (!runCols.some((c) => c.name === "seed")) {
  db.run("ALTER TABLE runs ADD COLUMN seed INTEGER");
}

const machineCols = db.query("PRAGMA table_info(machines)").all() as { name: string }[];
if (!machineCols.some((c) => c.name === "vram_gb")) {
  db.run("ALTER TABLE machines ADD COLUMN vram_gb REAL");
}

// ---------- machines ----------

export function upsertMachine(p: MachineProfile): number {
  const fingerprint = `${p.hostname}|${p.chip}|${p.ramGb}`;
  const existing = db
    .query<{ id: number }, [string]>(
      "SELECT id FROM machines WHERE fingerprint = ?",
    )
    .get(fingerprint);
  if (existing) return existing.id;
  const res = db
    .query(
      `INSERT INTO machines (fingerprint, hostname, os, arch, chip, cpu_cores, perf_cores, eff_cores, gpu, gpu_cores, ram_gb, vram_gb)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      fingerprint,
      p.hostname,
      p.os,
      p.arch,
      p.chip,
      p.cpuCores,
      p.perfCores ?? null,
      p.effCores ?? null,
      p.gpu ?? null,
      p.gpuCores ?? null,
      p.ramGb,
      p.vramGb ?? null,
    ) as { id: number };
  return res.id;
}

export function getMachine(id: number) {
  return db.query("SELECT * FROM machines WHERE id = ?").get(id) as any;
}

// ---------- runs ----------

export function createRun(
  machineId: number,
  cfg: RunConfig,
  questionsJson: string,
): number {
  const run = db
    .query(
      `INSERT INTO runs (machine_id, label, question_set, questions_json, trials, temperature, top_p, seed, max_tokens, timeout_ms,
        judge_provider, judge_base_url, judge_model, notes, manage_models)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      machineId,
      cfg.label,
      cfg.questionSet,
      questionsJson,
      cfg.trials,
      cfg.temperature,
      cfg.topP ?? null,
      cfg.seed ?? null,
      cfg.maxTokens,
      cfg.timeoutMs,
      cfg.judge?.provider ?? null,
      cfg.judge?.baseUrl ?? null,
      cfg.judge?.modelId ?? null,
      cfg.notes ?? null,
      cfg.manageModels === false ? 0 : 1,
    ) as { id: number };

  const insertModel = db.prepare(
    `INSERT INTO run_models (run_id, provider, base_url, model_id, params, quant, format, requested_context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const m of cfg.models) {
    insertModel.run(
      run.id,
      m.provider,
      m.baseUrl,
      m.modelId,
      m.params ?? null,
      m.quant ?? null,
      m.format ?? null,
      m.context,
    );
  }
  return run.id;
}

export function setRunStatus(runId: number, status: string) {
  if (status === "running") {
    db.run(
      "UPDATE runs SET status = ?, started_at = datetime('now') WHERE id = ?",
      [status, runId],
    );
  } else if (status === "done" || status === "failed" || status === "cancelled") {
    db.run(
      "UPDATE runs SET status = ?, finished_at = datetime('now') WHERE id = ?",
      [status, runId],
    );
  } else {
    db.run("UPDATE runs SET status = ? WHERE id = ?", [status, runId]);
  }
}

export function getRun(runId: number) {
  return db.query("SELECT * FROM runs WHERE id = ?").get(runId) as any;
}

export function listRuns() {
  return db
    .query(
      `SELECT r.*, m.hostname, m.chip,
        (SELECT COUNT(*) FROM run_models rm WHERE rm.run_id = r.id) AS model_count
       FROM runs r JOIN machines m ON m.id = r.machine_id
       ORDER BY r.id DESC`,
    )
    .all() as any[];
}

export function getRunModels(runId: number) {
  return db
    .query("SELECT * FROM run_models WHERE run_id = ? ORDER BY id")
    .all(runId) as any[];
}

export function setRunModelStatus(
  id: number,
  status: string,
  error?: string,
  loadedContext?: number,
) {
  db.run(
    "UPDATE run_models SET status = ?, error = COALESCE(?, error), loaded_context = COALESCE(?, loaded_context) WHERE id = ?",
    [status, error ?? null, loadedContext ?? null, id],
  );
}

// ---------- responses & grades ----------

export function insertResponse(r: {
  runModelId: number;
  qid: string;
  trial: number;
  response: string | null;
  extractedAnswer: string | null;
  ttftMs: number | null;
  totalMs: number | null;
  completionTokens: number | null;
  tokPerSec: number | null;
  error: string | null;
}): number {
  const row = db
    .query(
      `INSERT OR REPLACE INTO responses
        (run_model_id, qid, trial, response, extracted_answer, ttft_ms, total_ms, completion_tokens, tok_per_sec, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      r.runModelId,
      r.qid,
      r.trial,
      r.response,
      r.extractedAnswer,
      r.ttftMs,
      r.totalMs,
      r.completionTokens,
      r.tokPerSec,
      r.error,
    ) as { id: number };
  return row.id;
}

export function setGrade(
  responseId: number,
  verdict: Verdict,
  method: GradeMethod,
  detail?: string,
) {
  db.run(
    `INSERT INTO grades (response_id, verdict, method, detail) VALUES (?, ?, ?, ?)
     ON CONFLICT(response_id) DO UPDATE SET verdict=excluded.verdict, method=excluded.method, detail=excluded.detail, created_at=datetime('now')`,
    [responseId, verdict, method, detail ?? null],
  );
}

export function getRunResults(runId: number) {
  return db
    .query(
      `SELECT rm.id AS run_model_id, rm.provider, rm.model_id, rm.params, rm.quant, rm.format,
              rm.requested_context, rm.loaded_context, rm.status AS model_status, rm.error AS model_error,
              resp.id AS response_id, resp.qid, resp.trial, resp.response, resp.extracted_answer,
              resp.ttft_ms, resp.total_ms, resp.completion_tokens, resp.tok_per_sec, resp.error AS response_error,
              g.verdict, g.method, g.detail
       FROM run_models rm
       LEFT JOIN responses resp ON resp.run_model_id = rm.id
       LEFT JOIN grades g ON g.response_id = resp.id
       WHERE rm.run_id = ?
       ORDER BY rm.id, resp.qid, resp.trial`,
    )
    .all(runId) as any[];
}

export function getProgress(runId: number) {
  const expected = db
    .query(
      `SELECT (SELECT COUNT(*) FROM run_models WHERE run_id = ?) *
              (SELECT trials FROM runs WHERE id = ?) *
              (SELECT json_array_length(questions_json) FROM runs WHERE id = ?) AS total`,
    )
    .get(runId, runId, runId) as { total: number };
  const done = db
    .query(
      `SELECT COUNT(*) AS n FROM responses resp
       JOIN run_models rm ON rm.id = resp.run_model_id WHERE rm.run_id = ?`,
    )
    .get(runId) as { n: number };
  return { total: expected.total ?? 0, completed: done.n ?? 0 };
}
