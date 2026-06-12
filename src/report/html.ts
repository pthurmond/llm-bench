import type { RunSummary } from "./score";
import { summarizeRun } from "./score";

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function dur(ms: number | null): string {
  if (ms == null) return "–";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function htmlReport(runId: number): string {
  const s = summarizeRun(runId);
  return render(s);
}

function render(s: RunSummary): string {
  const { run, machine, questions, models } = s;
  const completed = models.filter((m) => m.status !== "crashed");
  const maxTok = Math.max(1, ...completed.map((m) => m.medianTokPerSec ?? 0));

  const machineLine = [
    machine.hostname,
    machine.chip,
    machine.perf_cores != null
      ? `${machine.cpu_cores} CPU (${machine.perf_cores}P+${machine.eff_cores}E)`
      : `${machine.cpu_cores} CPU cores`,
    machine.gpu_cores ? `${machine.gpu_cores}-core GPU` : machine.gpu,
    `${machine.ram_gb} GB RAM`,
    `${machine.os} (${machine.arch})`,
  ]
    .filter(Boolean)
    .join(" · ");

  const rankingRows = models
    .map((m, i) => {
      const ctx = m.loadedContext ?? m.requestedContext;
      const crashed = m.status === "crashed";
      const pct = crashed ? 0 : (m.total / questions.length) * 100;
      const barW = m.medianTokPerSec ? Math.max(3, (m.medianTokPerSec / maxTok) * 100) : 0;
      return `<tr class="${crashed ? "crashed" : ""}">
        <td class="rank">${crashed ? "✕" : i + 1}</td>
        <td><span class="chip">${esc(m.provider)}</span></td>
        <td class="model">${esc(m.modelId)}${m.error ? `<div class="err">${esc(m.error)}</div>` : ""}</td>
        <td>${esc(m.params ?? "?")}</td>
        <td>${esc(m.quant ?? "–")}</td>
        <td class="num">${ctx.toLocaleString()}</td>
        <td class="score"><b>${crashed ? "—" : `${m.total}/${questions.length}`}</b>
          <span class="meter"><i style="width:${pct}%"></i></span></td>
        <td class="num">${crashed ? "–" : `${m.byCategory.logic?.score ?? 0}/${m.byCategory.logic?.outOf ?? 0}`}</td>
        <td class="num">${crashed ? "–" : `${m.byCategory.code?.score ?? 0}/${m.byCategory.code?.outOf ?? 0}`}</td>
        <td class="num">${crashed ? "–" : `${m.byCategory.math?.score ?? 0}/${m.byCategory.math?.outOf ?? 0}`}</td>
        <td class="num">${m.medianTokPerSec ?? "–"}
          <span class="meter speed"><i style="width:${barW}%"></i></span></td>
        <td class="num">${dur(m.medianTtftMs)}</td>
        <td>${esc(m.speedBucket)}</td>
      </tr>`;
    })
    .join("\n");

  const matrixHead = questions.map((q) => `<th title="${esc(q.text.slice(0, 120))}">${esc(q.qid)}</th>`).join("");
  const matrixRows = models
    .map((m) => {
      const cells = questions
        .map((q) => {
          const o = m.outcomes.get(q.qid);
          if (!o || o.trials.length === 0) return `<td class="cell none">·</td>`;
          const cls = o.errored ? "err" : o.correct ? "ok" : "bad";
          const mark = o.errored ? "⚠" : o.correct ? "✓" : "✗";
          const tip = o.trials
            .map((t, i) => `T${i + 1}: ${t.verdict} (${t.method})${t.extracted ? ` — ${t.extracted.slice(0, 60)}` : ""}`)
            .join("\n");
          return `<td class="cell ${cls}" title="${esc(tip)}">${mark}</td>`;
        })
        .join("");
      return `<tr><td class="model">${esc(m.modelId)}</td>${cells}<td class="num"><b>${m.status === "crashed" ? "✕" : m.total}</b></td></tr>`;
    })
    .join("\n");

  const hardest = s.hardest
    .map((h) => `<li><b>${esc(h.qid)}</b> — ${esc(h.label)}… <span class="muted">(${h.failed}/${h.of} models failed)</span></li>`)
    .join("");

  const answerRows = questions
    .map((q) => `<tr><td><b>${esc(q.qid)}</b></td><td class="qtext">${esc(q.text.split("\n")[0])}</td><td>${esc(q.answer)}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(run.label)} — llm-bench report</title>
<style>
  :root {
    --bg: #f3f5f7; --panel: #ffffff; --ink: #161a1f; --muted: #5d6b7a;
    --line: #dde3e9; --accent: #0f6b66; --warn: #b3590f; --bad: #a8323a;
    --ok-bg: #e3f2e9; --ok-fg: #1c6b3c; --bad-bg: #fbe7e7; --bad-fg: #a8323a;
    --err-bg: #fdf1e0; --err-fg: #9a5b00;
    --mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
    --sans: -apple-system, "Segoe UI", system-ui, Roboto, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--sans); }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 32px 20px 80px; }
  header { border-bottom: 3px solid var(--ink); padding-bottom: 18px; margin-bottom: 28px; }
  h1 { font-size: 26px; margin: 0 0 10px; letter-spacing: -0.02em; }
  h2 { font-size: 18px; margin: 36px 0 12px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; }
  .tag { font: 12px/1 var(--mono); background: var(--panel); border: 1px solid var(--line);
         padding: 6px 9px; border-radius: 4px; color: var(--muted); }
  .tag b { color: var(--ink); font-weight: 600; }
  table { width: 100%; border-collapse: collapse; background: var(--panel);
          border: 1px solid var(--line); font-size: 13.5px; }
  th { text-align: left; font: 600 11px/1.3 var(--mono); text-transform: uppercase;
       letter-spacing: 0.06em; color: var(--muted); padding: 9px 10px;
       border-bottom: 2px solid var(--ink); background: var(--panel); }
  td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .rank { font: 600 14px var(--mono); width: 36px; }
  .model { font-family: var(--mono); font-size: 12.5px; }
  .num { font-family: var(--mono); font-size: 12.5px; text-align: right; white-space: nowrap; }
  .chip { font: 11px var(--mono); background: var(--bg); border: 1px solid var(--line);
          padding: 2px 6px; border-radius: 3px; }
  .err { color: var(--bad); font-size: 11px; margin-top: 3px; }
  .crashed { opacity: 0.55; }
  .meter { display: block; height: 4px; background: var(--line); border-radius: 2px;
           margin-top: 5px; min-width: 70px; }
  .meter i { display: block; height: 100%; background: var(--accent); border-radius: 2px; }
  .meter.speed i { background: var(--warn); }
  .cell { text-align: center; font: 600 13px var(--mono); width: 34px; }
  .cell.ok { background: var(--ok-bg); color: var(--ok-fg); }
  .cell.bad { background: var(--bad-bg); color: var(--bad-fg); }
  .cell.err { background: var(--err-bg); color: var(--err-fg); }
  .cell.none { color: var(--muted); }
  .muted { color: var(--muted); }
  .note { background: var(--err-bg); border: 1px solid #e8cfa3; padding: 10px 14px;
          border-radius: 6px; margin: 16px 0; font-size: 14px; }
  .qtext { color: var(--muted); font-size: 12.5px; }
  ul { padding-left: 20px; }
  .scroll { overflow-x: auto; }
  @media print { body { background: #fff; } .wrap { padding: 0; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>🧠 ${esc(run.label)}</h1>
    <div class="meta">
      <span class="tag">set <b>${esc(run.question_set)}</b></span>
      <span class="tag">questions <b>${questions.length}</b></span>
      <span class="tag">trials <b>${run.trials}</b></span>
      <span class="tag">temp <b>${run.temperature}</b></span>
      <span class="tag">max_tokens <b>${run.max_tokens}</b></span>
      <span class="tag">judge <b>${esc(run.judge_model ?? "manual")}</b></span>
      <span class="tag">date <b>${esc(run.started_at ?? run.created_at)}</b></span>
    </div>
    <div class="meta" style="margin-top:8px">
      <span class="tag">🖥 <b>${esc(machineLine)}</b></span>
    </div>
  </header>

  ${s.pendingReview > 0 ? `<div class="note">⚠ ${s.pendingReview} response(s) still need manual review — scores treat them as incorrect. Run <code>bun cli.ts grade ${run.id}</code>.</div>` : ""}

  <h2>🏆 Rankings</h2>
  <div class="scroll">
  <table>
    <thead><tr>
      <th>#</th><th>Provider</th><th>Model</th><th>Params</th><th>Quant</th><th>Ctx</th>
      <th>Score</th><th>Logic</th><th>Code</th><th>Math</th><th>tok/s</th><th>TTFT</th><th>Speed</th>
    </tr></thead>
    <tbody>${rankingRows}</tbody>
  </table>
  </div>

  <h2>📊 Results Matrix</h2>
  <p class="muted">✓ correct · ✗ incorrect · ⚠ all trials errored · hover a cell for trial details</p>
  <div class="scroll">
  <table>
    <thead><tr><th>Model</th>${matrixHead}<th>Σ</th></tr></thead>
    <tbody>${matrixRows}</tbody>
  </table>
  </div>

  ${s.hardest.length ? `<h2>🔥 Hardest Questions</h2><ul>${hardest}</ul>` : ""}

  <h2>✅ Answer Key</h2>
  <div class="scroll">
  <table>
    <thead><tr><th>ID</th><th>Question</th><th>Answer</th></tr></thead>
    <tbody>${answerRows}</tbody>
  </table>
  </div>

  <p class="muted" style="margin-top:40px">Generated by llm-bench · run #${run.id} · speed buckets: very fast ≥40 tok/s, fast 20–40, normal 8–20, slow &lt;8</p>
</div>
</body>
</html>`;
}
