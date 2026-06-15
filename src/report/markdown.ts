import type { RunSummary } from "./score";
import { activeParamsB, summarizeRun } from "./score";

const rankEmoji = ["🏆", "🔥", "⚡", "❌"];

function dur(ms: number | null): string {
  if (ms == null) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function markdownReport(runId: number): string {
  const s = summarizeRun(runId);
  return render(s);
}

function render(s: RunSummary): string {
  const { run, machine, questions, models } = s;
  const cats = ["logic", "code", "math"];
  const catCounts = Object.fromEntries(
    cats.map((c) => [c, questions.filter((q) => q.category === c).length]),
  );
  const completed = models.filter((m) => m.status !== "crashed");
  const lines: string[] = [];

  const machineLine = [
    machine.hostname,
    machine.chip,
    machine.perf_cores != null
      ? `${machine.cpu_cores} CPU cores (${machine.perf_cores}P+${machine.eff_cores}E)`
      : `${machine.cpu_cores} CPU cores`,
    machine.gpu_cores ? `${machine.gpu_cores} GPU cores` : machine.gpu,
    `${machine.ram_gb} GB RAM`,
    `${machine.os} (${machine.arch})`,
  ]
    .filter(Boolean)
    .join(" · ");

  lines.push(`# 🧠 ${models.length} Local LLMs Benchmarked on ${questions.length} Questions — ${run.label}`);
  lines.push("");
  lines.push(`**Test:** ${catCounts.logic} Logic + ${catCounts.code} Coding + ${catCounts.math} Math questions (set: \`${run.question_set}\`)`);
  lines.push(`**Trials per question:** ${run.trials}${run.trials > 1 ? " (majority vote)" : ""}`);
  lines.push(`**Sampling:** temperature ${run.temperature}, max_tokens ${run.max_tokens}`);
  lines.push(`**Grading:** auto-match + ${run.judge_model ? `judge fallback (\`${run.judge_model}\` via ${run.judge_provider})` : "manual fallback"}`);
  lines.push(`**Date:** ${run.started_at ?? run.created_at}`);
  lines.push(`**Hardware:** ${machineLine}`);
  if (s.pendingReview > 0) {
    lines.push("");
    lines.push(`> ⚠️ ${s.pendingReview} response(s) still need manual review (\`bun run grade -- ${run.id}\`). Scores below treat them as incorrect.`);
  }
  lines.push("");

  // ----- Rankings -----
  lines.push(`## ${rankEmoji[0]} Full Rankings (${questions.length} questions)`);
  lines.push("");
  lines.push(`| Rank | Provider | Model | Params | Quant | Ctx | Score | Logic (${catCounts.logic}) | Code (${catCounts.code}) | Math (${catCounts.math}) | Avg tok/s | Median tok/s | Peak tok/s | TTFT (med) | Speed | Notes |`);
  lines.push(`|:----:|----------|-------|-------:|-------|----:|:-----:|:---------:|:--------:|:--------:|----------:|------------:|-----------:|-----------:|:-----:|-------|`);
  let rank = 0;
  let prevScore = -1;
  let shown = 0;
  for (const m of models) {
    shown++;
    let rankCell: string;
    if (m.status === "crashed") {
      rankCell = "X";
    } else {
      if (m.total !== prevScore) rank = shown;
      prevScore = m.total;
      rankCell = String(rank);
    }
    const ctx = m.loadedContext ?? m.requestedContext;
    const scoreCell =
      m.status === "crashed" ? "Crashed" : `${m.total}/${questions.length}`;
    const cat = (c: string) =>
      m.status === "crashed" ? "-" : `${m.byCategory[c]?.score ?? 0}/${m.byCategory[c]?.outOf ?? 0}`;
    lines.push(
      `| ${rankCell} | ${m.provider} | ${m.modelId} | ${m.params ?? "?"} | ${m.quant ?? "-"} | ${ctx} | ${scoreCell} | ${cat("logic")} | ${cat("code")} | ${cat("math")} | ${m.avgTokPerSec ?? "-"} | ${m.medianTokPerSec ?? "-"} | ${m.peakTokPerSec ?? "-"} | ${dur(m.medianTtftMs)} | ${m.speedBucket} | ${m.error ?? ""} |`,
    );
  }
  lines.push("");

  // ----- Key findings -----
  lines.push("## 🔥 Key Findings");
  lines.push("");
  if (completed.length >= 2) {
    const best = completed[0];
    const worst = completed[completed.length - 1];
    lines.push(`### 1. Top performer`);
    lines.push(`- **${best.modelId}** (${best.params ?? "?"}, ${best.provider}) scored **${best.total}/${questions.length}** at ${best.avgTokPerSec ?? best.medianTokPerSec ?? "?"} tok/s avg.`);
    lines.push(`- Spread across the field: ${best.total} (best) vs ${worst.total} (worst) out of ${questions.length}.`);
    lines.push("");
  }

  const withActive = completed
    .map((m) => ({ m, active: activeParamsB(m.params) }))
    .filter((x): x is { m: (typeof completed)[number]; active: number } => x.active != null);
  if (withActive.length >= 2) {
    withActive.sort((a, b) => b.m.total / b.active - a.m.total / a.active);
    lines.push("### 2. Parameter efficiency (active params)");
    lines.push("");
    lines.push("| Model | Active | Score | Score/B |");
    lines.push("|-------|-------:|:-----:|:-------:|");
    for (const { m, active } of withActive.slice(0, 6)) {
      lines.push(`| ${m.modelId} | ${active}B | ${m.total} | ${(m.total / active).toFixed(2)} |`);
    }
    lines.push("");
  }

  if (s.hardest.length > 0) {
    lines.push("### 3. Hardest questions");
    lines.push("");
    for (const h of s.hardest) {
      lines.push(`- **${h.qid}** (${h.label}…): ${h.failed}/${h.of} models failed`);
    }
    lines.push("");
  }

  // ----- Speed notes -----
  lines.push(`## ⚡ Speed Notes (avg tok/s across all trials)`);
  lines.push("");
  const tierOrder = ["Extremely Fast","Stupid Fast","Very Fast","Fast","Responsive","Usable","Slow","Very Slow","Painfully Slow"];
  for (const bucket of tierOrder) {
    const names = completed
      .filter((m) => m.speedBucket === bucket)
      .map((m) => `${m.modelId} (avg ${m.avgTokPerSec ?? "?"} · med ${m.medianTokPerSec ?? "?"} · peak ${m.peakTokPerSec ?? "?"} tok/s)`);
    if (names.length) lines.push(`- **${bucket}:** ${names.join(", ")}`);
  }
  const crashedModels = models.filter((m) => m.status === "crashed");
  if (crashedModels.length) {
    lines.push(`- **Failed:** ${crashedModels.map((m) => m.modelId).join(", ")}`);
  }
  lines.push("");
  lines.push("> Speed tiers: Extremely Fast (200+ tok/s) · Stupid Fast (100–200) · Very Fast (60–100) · Fast (40–60) · Responsive (25–40) · Usable (15–25) · Slow (5–15) · Very Slow (1–5) · Painfully Slow (<1)");
  lines.push("");

  // ----- Models to avoid -----
  const avoid = models.filter(
    (m) => m.status === "crashed" || m.total <= Math.floor(questions.length * 0.4),
  );
  if (avoid.length) {
    lines.push("## ❌ Models to Avoid");
    lines.push("");
    for (const m of avoid) {
      const why =
        m.status === "crashed"
          ? m.error ?? "crashed during the run"
          : `scored ${m.total}/${questions.length}`;
      lines.push(`- **${m.modelId}** — ${why}`);
    }
    lines.push("");
  }

  // ----- Per-question matrix -----
  lines.push("## 📊 Results Matrix (✓ correct · ✗ incorrect · ⚠ error)");
  lines.push("");
  lines.push(`| Model | ${questions.map((q) => q.qid).join(" | ")} | Score |`);
  lines.push(`|-------|${questions.map(() => ":--:").join("|")}|:-----:|`);
  for (const m of models) {
    const cells = questions.map((q) => {
      const o = m.outcomes.get(q.qid);
      if (!o || o.trials.length === 0) return "·";
      if (o.errored) return "⚠";
      return o.correct ? "✓" : "✗";
    });
    const score = m.status === "crashed" ? "X" : `${m.total}/${questions.length}`;
    lines.push(`| ${m.modelId} | ${cells.join(" | ")} | ${score} |`);
  }
  lines.push("");

  // ----- Test details -----
  lines.push("---");
  lines.push("");
  lines.push("## Test Details");
  lines.push("");
  lines.push("### 📋 Test Questions");
  lines.push("");
  const byCat: Record<string, string> = {
    logic: "GENERAL INTELLIGENCE (Logic & Reasoning)",
    code: "CODING",
    math: "MATHEMATICS",
  };
  let lastCat = "";
  for (const q of questions) {
    if (q.category !== lastCat) {
      lines.push(`#### ${byCat[q.category] ?? q.category.toUpperCase()}`);
      lines.push("");
      lastCat = q.category;
    }
    lines.push(`${q.qid}. ${q.text}`);
    lines.push("");
  }
  lines.push("### ✅ Answer Key");
  lines.push("");
  lines.push("| Question | Correct Answer |");
  lines.push("|----------|----------------|");
  for (const q of questions) lines.push(`| ${q.qid} | ${q.answer.replace(/\|/g, "\\|")} |`);
  lines.push("");
  lines.push("### Scoring Notes");
  lines.push("");
  lines.push(`- Models were instructed to end replies with \`FINAL ANSWER: <answer>\`; that line is auto-matched against per-question rules.`);
  lines.push(`- When auto-match can't decide, ${run.judge_model ? `a judge model (\`${run.judge_model}\`) grades the response` : "the response is flagged for manual review"}.`);
  lines.push(`- With ${run.trials} trial(s) per question${run.trials > 1 ? ", a question counts as correct when the majority of trials are correct" : ""}.`);
  lines.push(`- A model is marked **crashed** after 3 consecutive request errors.`);
  lines.push("");
  return lines.join("\n");
}
