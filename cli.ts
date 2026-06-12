#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { scanProviders, providers } from "./src/providers";
import { detectMachine, machineSummary } from "./src/sysinfo";
import { prepareRun, executeRun } from "./src/runner";
import { listQuestionSets, loadQuestionSet, questionSetPath, validateQuestionSet } from "./src/questions";
import { markdownReport } from "./src/report/markdown";
import { htmlReport } from "./src/report/html";
import { db, listRuns, setGrade } from "./src/db";
import type { RunConfig, RunModelConfig } from "./src/types";

const [cmd, ...args] = process.argv.slice(2);

/* ----------------------------- prompt utils ----------------------------- */

async function ask(question: string, fallback = ""): Promise<string> {
  process.stdout.write(`${question}${fallback ? ` [${fallback}]` : ""}: `);
  for await (const line of console) {
    const v = line.trim();
    return v === "" ? fallback : v;
  }
  return fallback;
}

async function askNumber(q: string, fallback: number): Promise<number> {
  const v = await ask(q, String(fallback));
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse selections like "1,3,5-8" or "all" against a list length. */
function parseSelection(input: string, max: number): number[] {
  if (/^a(ll)?$/i.test(input.trim())) return Array.from({ length: max }, (_, i) => i);
  const out = new Set<number>();
  for (const part of input.split(",")) {
    const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      for (let i = Number(range[1]); i <= Number(range[2]); i++) {
        if (i >= 1 && i <= max) out.add(i - 1);
      }
    } else {
      const n = Number(part.trim());
      if (n >= 1 && n <= max) out.add(n - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/* -------------------------------- commands ------------------------------- */

async function cmdScan() {
  console.log("Scanning local providers…\n");
  const results = await scanProviders(baseUrlOverridesFromArgs());
  for (const r of results) {
    const status = r.reachable ? `✓ ${r.models.length} model(s)` : "✗ unreachable";
    console.log(`${r.label.padEnd(10)} ${r.baseUrl.padEnd(28)} ${status}`);
    for (const m of r.models) {
      const meta = [m.params, m.quant, m.maxContext ? `ctx ${m.maxContext}` : null, m.state]
        .filter(Boolean)
        .join(" · ");
      console.log(`   - ${m.id}${meta ? `  (${meta})` : ""}`);
    }
  }
}

function baseUrlOverridesFromArgs(): Record<string, string> {
  // e.g. --lmstudio http://10.0.0.5:1234 --ollama http://localhost:11434
  const overrides: Record<string, string> = {};
  for (let i = 0; i < args.length - 1; i++) {
    const flag = args[i].replace(/^--/, "");
    if (flag in providers) overrides[flag] = args[i + 1];
  }
  return overrides;
}

async function cmdRun() {
  const machine = await detectMachine();
  console.log(`Machine: ${machineSummary(machine)}\n`);

  console.log("Scanning providers…");
  const scans = (await scanProviders(baseUrlOverridesFromArgs())).filter((s) => s.reachable);
  if (scans.length === 0) {
    console.error("No providers reachable. Start LM Studio / Ollama / vLLM / llama.cpp / mlx_lm.server first,");
    console.error("or pass custom base URLs, e.g.:  bun cli.ts run --lmstudio http://192.168.1.20:1234");
    process.exit(1);
  }

  // Flatten provider/model pairs into a numbered menu
  const menu: { provider: string; baseUrl: string; id: string; params?: string; quant?: string; format?: string; maxContext?: number }[] = [];
  for (const s of scans) {
    for (const m of s.models) {
      menu.push({ provider: s.provider, baseUrl: s.baseUrl, id: m.id, params: m.params, quant: m.quant, format: m.format, maxContext: m.maxContext });
    }
  }
  console.log("\nAvailable models:");
  menu.forEach((m, i) => {
    const meta = [m.params, m.quant, m.maxContext ? `ctx ≤${m.maxContext}` : null].filter(Boolean).join(" · ");
    console.log(`  ${String(i + 1).padStart(3)}. [${m.provider}] ${m.id}${meta ? `  (${meta})` : ""}`);
  });

  const picked = parseSelection(await ask('\nSelect models to test (e.g. "1,3,5-7" or "all")', "all"), menu.length);
  if (picked.length === 0) {
    console.error("Nothing selected.");
    process.exit(1);
  }

  const sets = listQuestionSets();
  const setName = await ask(`Question set (${sets.join(" / ")})`, sets.includes("default") ? "default" : sets[0]);
  await loadQuestionSet(setName); // validate early
  const defaultCtx = await askNumber("Context length for all models (per-model override next)", 16384);

  const models: RunModelConfig[] = [];
  for (const idx of picked) {
    const m = menu[idx];
    const ctx = await askNumber(`  ctx for [${m.provider}] ${m.id}`, Math.min(defaultCtx, m.maxContext ?? defaultCtx));
    models.push({ provider: m.provider, baseUrl: m.baseUrl, modelId: m.id, context: ctx, params: m.params, quant: m.quant, format: m.format });
  }

  const manageModels = (await ask("Unload previous model before loading the next? (y/n)", "y")).toLowerCase().startsWith("y");
  const trials = await askNumber("Trials per question (odd numbers vote cleanly)", 1);
  const temperature = await askNumber("Temperature", 0);
  const maxTokens = await askNumber("Max tokens per answer", 4096);
  const timeoutMs = (await askNumber("Per-request timeout (seconds)", 300)) * 1000;

  let judge: RunConfig["judge"] = null;
  const wantJudge = (await ask("Use an LLM judge for non-auto-gradable answers? (y/n)", "y")).toLowerCase().startsWith("y");
  if (wantJudge) {
    console.log("\nPick a judge (ideally your strongest local model — it can be one of the tested models):");
    menu.forEach((m, i) => console.log(`  ${String(i + 1).padStart(3)}. [${m.provider}] ${m.id}`));
    const j = parseSelection(await ask("Judge #", "1"), menu.length)[0];
    if (j != null) {
      judge = { provider: menu[j].provider, baseUrl: menu[j].baseUrl, modelId: menu[j].id };
    }
  }

  const label = await ask("Run label", `${setName} @ ${machine.hostname}`);
  const cfg: RunConfig = { label, questionSet: setName, trials, temperature, maxTokens, timeoutMs, judge, manageModels, models };

  const runId = await prepareRun(cfg);
  console.log(`\nRun #${runId} created. ${models.length} model(s) × ${trials} trial(s). Starting…\n`);

  await executeRun(runId, (e) => {
    const pct = String(Math.round((e.step / e.totalSteps) * 100)).padStart(3);
    if (e.trial === 0 && e.verdict?.startsWith("judge:")) {
      console.log(`[${pct}%] ⚖ ${e.modelId} · ${e.qid} → ${e.verdict.slice(6)}`);
      return;
    }
    const mark = e.error ? "⚠" : e.verdict === "correct" ? "✓" : e.verdict === "incorrect" ? "✗" : e.verdict === "queued" ? "⏳" : "?";
    const speed = e.tokPerSec ? ` ${e.tokPerSec} tok/s` : "";
    console.log(`[${pct}%] ${mark} ${e.modelId} · ${e.qid} t${e.trial}${speed}${e.error ? ` — ${e.error}` : ""}`);
  });

  console.log("\nRun complete. Generating reports…");
  await cmdReport([String(runId)]);
}

async function cmdReport(a: string[] = args) {
  const runId = Number(a[0]);
  if (!Number.isFinite(runId)) {
    console.error("Usage: bun cli.ts report <runId>");
    process.exit(1);
  }
  mkdirSync("reports", { recursive: true });
  const md = markdownReport(runId);
  const html = htmlReport(runId);
  const mdPath = join("reports", `run-${runId}.md`);
  const htmlPath = join("reports", `run-${runId}.html`);
  await Bun.write(mdPath, md);
  await Bun.write(htmlPath, html);
  console.log(`Wrote ${mdPath} and ${htmlPath}`);
}

function cmdList() {
  const runs = listRuns();
  if (runs.length === 0) return console.log("No runs yet. Try: bun cli.ts run");
  for (const r of runs) {
    console.log(`#${r.id}  ${r.status.padEnd(9)} ${r.label}  (${r.model_count} models, ${r.question_set}, ${r.hostname}/${r.chip}) ${r.created_at}`);
  }
}

/** Interactive review of responses graded as pending (judge unavailable/failed). */
async function cmdGrade() {
  const runId = Number(args[0]);
  if (!Number.isFinite(runId)) {
    console.error("Usage: bun cli.ts grade <runId>");
    process.exit(1);
  }
  const pending = db
    .query(
      `SELECT resp.id, resp.qid, resp.response, rm.model_id
       FROM responses resp
       JOIN run_models rm ON rm.id = resp.run_model_id
       JOIN grades g ON g.response_id = resp.id
       WHERE rm.run_id = ? AND g.method = 'pending'
       ORDER BY rm.id, resp.qid`,
    )
    .all(runId) as any[];
  if (pending.length === 0) return console.log("Nothing pending review for this run.");

  // Question text + answer key from the run's snapshot, shown for each review.
  const runRow = db.query(`SELECT questions_json FROM runs WHERE id = ?`).get(runId) as
    | { questions_json: string }
    | null;
  const byQid = new Map<string, { text: string; answer: string }>(
    runRow
      ? (JSON.parse(runRow.questions_json) as { qid: string; text: string; answer: string }[]).map(
          (q) => [q.qid, { text: q.text, answer: q.answer }],
        )
      : [],
  );

  console.log(`${pending.length} response(s) to review. (c)orrect / (i)ncorrect / (s)kip\n`);
  for (const p of pending) {
    const q = byQid.get(p.qid);
    console.log("─".repeat(70));
    console.log(`${p.model_id} · ${p.qid}`);
    if (q) {
      console.log(`Q: ${q.text}`);
      console.log(`Expected answer: ${q.answer}\n`);
    }
    console.log((p.response ?? "").slice(0, 1500));
    const v = (await ask("Verdict (c/i/s)", "s")).toLowerCase();
    if (v.startsWith("c")) setGrade(p.id, "correct", "manual");
    else if (v.startsWith("i")) setGrade(p.id, "incorrect", "manual");
  }
  console.log("\nDone. Re-generate the report: bun cli.ts report " + runId);
}

async function cmdQuestions() {
  for (const name of listQuestionSets()) {
    const set = await loadQuestionSet(name).catch(() => null);
    const problems = set ? validateQuestionSet(set) : ["unreadable JSON"];
    const status = problems.length === 0 ? "✓ valid" : `⚠ ${problems.length} problem(s)`;
    console.log(`${name.padEnd(16)} ${String(set?.questions.length ?? 0).padStart(3)} questions  ${status}`);
    console.log(`  ${questionSetPath(name)}`);
    for (const pb of problems) console.log(`    - ${pb}`);
  }
  console.log("\nEdit sets in the web UI (bun cli.ts serve → Questions tab) or edit the JSON directly.");
}

function help() {
  console.log(`llm-bench — local LLM benchmark harness

Usage:
  bun cli.ts scan                Probe LM Studio / Ollama / vLLM / llama.cpp / mlx and list models
  bun cli.ts run                 Interactive: pick models, ctx, trials, judge — then run & report
  bun cli.ts report <runId>      Regenerate markdown + HTML reports for a run
  bun cli.ts list                List past runs
  bun cli.ts grade <runId>       Manually review responses the judge couldn't grade
  bun cli.ts questions           List question sets, file paths, and validation status
  bun cli.ts serve               Start the web UI (same engine, browser-based config)

Custom base URLs (scan/run): --lmstudio URL --ollama URL --vllm URL --llamacpp URL --mlx URL
Database path: set LLM_BENCH_DB (default ./bench.db)`);
}

switch (cmd) {
  case "scan": await cmdScan(); break;
  case "run": await cmdRun(); break;
  case "report": await cmdReport(); break;
  case "list": cmdList(); break;
  case "grade": await cmdGrade(); break;
  case "questions": await cmdQuestions(); break;
  case "serve": await import("./server.ts"); break;
  default: help();
}
