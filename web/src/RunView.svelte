<script lang="ts">
  import { api } from "./lib/api";

  let { runId, onBack }: { runId: number; onBack: () => void } = $props();

  let status: any = $state(null);
  let summary: any = $state(null);
  let pending: any[] = $state([]);
  let responses: any[] | null = $state(null);
  let auditLoading = $state(false);
  let expandedRow: string | null = $state(null);
  let cancelling = $state(false);
  let error = $state("");
  let timer: ReturnType<typeof setInterval> | null = null;

  const isActive = $derived(
    status?.run?.status === "running" || status?.run?.status === "pending",
  );
  const pct = $derived(
    status?.progress?.total
      ? Math.round((status.progress.completed / status.progress.total) * 100)
      : 0,
  );

  async function refresh() {
    try {
      status = await api.runStatus(runId);
      summary = await api.runSummary(runId);
      if (!isActive) {
        pending = await api.runPending(runId);
        cancelling = false;
        stopPolling();
      }
      error = "";
    } catch (e) {
      error = String(e);
    }
  }

  function stopPolling() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  $effect(() => {
    refresh();
    timer = setInterval(refresh, 1500);
    return stopPolling;
  });

  async function grade(responseId: number, verdict: "correct" | "incorrect") {
    await api.grade(responseId, verdict);
    pending = pending.filter((p) => p.id !== responseId);
    summary = await api.runSummary(runId);
  }

  async function loadAudit() {
    auditLoading = true;
    try {
      responses = await api.runResponses(runId);
    } catch (e) {
      error = String(e);
    } finally {
      auditLoading = false;
    }
  }

  function toggleAuditRow(key: string) {
    expandedRow = expandedRow === key ? null : key;
  }

  function cellFor(model: any, qid: string) {
    const o = model.outcomes?.[qid];
    if (!o || o.trials.length === 0) return { mark: "·", cls: "none", tip: "not yet run" };
    if (o.errored) return { mark: "⚠", cls: "err", tip: tip(o) };
    return o.correct
      ? { mark: "✓", cls: "ok", tip: tip(o) }
      : { mark: "✗", cls: "bad", tip: tip(o) };
  }
  function tip(o: any): string {
    return o.trials
      .map((t: any, i: number) => `T${i + 1}: ${t.verdict} (${t.method})${t.extracted ? ` — ${t.extracted.slice(0, 50)}` : ""}`)
      .join("\n");
  }
  function dur(ms: number | null): string {
    if (ms == null) return "–";
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  }
  function durRun(started: string | null, finished: string | null): string {
    if (!started || !finished) return "–";
    const s = new Date(started + "Z");
    const f = new Date(finished + "Z");
    const diffMs = f.getTime() - s.getTime();
    const secs = Math.round(diffMs / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    return `${mins}m ${secs % 60}s`;
  }
  function fmt1(n: number | null | undefined): string {
    if (n == null) return "–";
    return n.toFixed(1);
  }
  function verdictStyle(v: string): string {
    if (v === "correct") return "color: var(--color-ok)";
    if (v === "incorrect") return "color: var(--color-bad)";
    if (v === "error") return "color: var(--color-amber)";
    return "color: var(--color-muted)";
  }
  function ctxMismatch(m: any): boolean {
    return m.loadedContext != null && m.requestedContext != null && m.loadedContext < m.requestedContext;
  }
</script>

<section class="space-y-5">
  <!-- Header -->
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div class="flex items-center gap-3">
      <button class="btn" onclick={onBack}>← Runs</button>
      <h2 class="text-base font-semibold">
        #{runId} · {status?.run?.label ?? "…"}
        <span class="tag ml-2" style={status?.run?.status === "done" ? "color: var(--color-ok)" : status?.run?.status === "running" ? "color: var(--color-amber)" : ""}>
          {status?.run?.status ?? "…"}
        </span>
      </h2>
    </div>
    <div class="flex items-center gap-2">
      {#if isActive}
        <button
          class="btn"
          style={cancelling ? "color: var(--color-amber)" : ""}
          disabled={cancelling}
          onclick={async () => { cancelling = true; await api.cancel(runId); }}
        >
          {cancelling ? "Cancelling…" : "Cancel run"}
        </button>
      {/if}
      <a class="btn" href={`/api/runs/${runId}/report.md`} download>↓ Markdown</a>
      <a class="btn" href={`/api/runs/${runId}/report.html`} target="_blank" rel="noopener">HTML report ↗</a>
    </div>
  </div>

  <!-- Run metadata -->
  {#if status?.run}
    {@const r = status.run}
    <div class="panel p-4">
      <h3 class="text-sm font-semibold tracking-wide mb-2">Run details</h3>
      <div class="grid gap-x-6 gap-y-1 text-xs" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))">
        <div><span style="color: var(--color-muted)">Question set:</span> <span class="font-mono">{r.question_set}</span></div>
        <div><span style="color: var(--color-muted)">Trials:</span> <span class="font-mono">{r.trials}</span></div>
        <div><span style="color: var(--color-muted)">Temperature:</span> <span class="font-mono">{r.temperature}</span></div>
        {#if r.top_p != null}<div><span style="color: var(--color-muted)">Top-p:</span> <span class="font-mono">{r.top_p}</span></div>{/if}
        {#if r.seed != null}<div><span style="color: var(--color-muted)">Seed:</span> <span class="font-mono">{r.seed}</span></div>{/if}
        <div><span style="color: var(--color-muted)">Max tokens:</span> <span class="font-mono">{r.max_tokens}</span></div>
        <div><span style="color: var(--color-muted)">Started:</span> <span class="font-mono">{r.started_at ?? "–"}</span></div>
        <div><span style="color: var(--color-muted)">Finished:</span> <span class="font-mono">{r.finished_at ?? "–"}</span></div>
        <div><span style="color: var(--color-muted)">Duration:</span> <span class="font-mono">{durRun(r.started_at, r.finished_at)}</span></div>
        {#if r.judge_model}<div><span style="color: var(--color-muted)">Judge:</span> <span class="font-mono">[{r.judge_provider}] {r.judge_model}</span></div>{/if}
      </div>
      {#if summary?.machine}
        {@const mc = summary.machine}
        <p class="text-xs mt-2" style="color: var(--color-muted)">
          Machine: {mc.chip} · {mc.cpu_cores} CPU · {mc.ram_gb} GB RAM
          {#if mc.vram_gb != null} · {mc.vram_gb} GB VRAM{/if}
          {#if mc.gpu} · {mc.gpu}{mc.gpu_cores ? ` (${mc.gpu_cores} cores)` : ""}{/if}
          · {mc.hostname}
        </p>
      {/if}
    </div>
  {/if}

  <!-- Progress bar -->
  {#if isActive && status}
    <div class="panel p-4" style={cancelling ? "border-color: var(--color-amber)" : ""}>
      <div class="flex items-center justify-between text-sm">
        <span class="font-mono text-xs" style="color: var(--color-muted)">
          {#if cancelling}
            <span style="color: var(--color-amber)">Cancelling — waiting for current response to abort…</span>
          {:else}
            {status.progress.completed} / {status.progress.total} responses
            {#if status.live}
              · now: {status.live.modelId} · {status.live.qid} t{status.live.trial}
              {#if status.live.tokPerSec}· {status.live.tokPerSec} tok/s{/if}
            {/if}
          {/if}
        </span>
        <span class="font-mono text-sm font-semibold">{pct}%</span>
      </div>
      <div class="h-1.5 rounded mt-2" style="background: var(--color-line)">
        <div class="h-full rounded transition-all" style="width: {pct}%; background: {cancelling ? 'var(--color-bad)' : 'var(--color-amber)'}"></div>
      </div>
    </div>
  {/if}

  {#if summary?.models?.length}
    <!-- Results matrix -->
    <div class="panel p-4">
      <h3 class="text-sm font-semibold tracking-wide mb-1">Results matrix</h3>
      <p class="text-xs mb-3" style="color: var(--color-muted)">✓ correct · ✗ incorrect · ⚠ errored · hover for trial detail</p>
      <div class="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th class="th">Provider</th>
              <th class="th">Model</th>
              {#each summary.questions as q}
                <th class="th text-center" title={q.text.slice(0, 140)}>{q.qid}</th>
              {/each}
              <th class="th text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {#each summary.models as m (m.runModelId)}
              <tr>
                <td class="td text-xs"><span class="tag">{m.provider}</span></td>
                <td class="td font-mono text-xs whitespace-nowrap pr-4">{m.modelId}</td>
                {#each summary.questions as q}
                  {@const c = cellFor(m, q.qid)}
                  <td
                    class="td text-center font-mono font-semibold w-9"
                    title={c.tip}
                    style={c.cls === "ok"
                      ? "background: var(--color-ok-soft); color: var(--color-ok)"
                      : c.cls === "bad"
                        ? "background: var(--color-bad-soft); color: var(--color-bad)"
                        : c.cls === "err"
                          ? "background: var(--color-amber-soft); color: var(--color-amber)"
                          : "color: var(--color-muted)"}
                  >{c.mark}</td>
                {/each}
                <td class="td text-right font-mono font-semibold">
                  {m.status === "crashed" ? "✕" : `${m.total}/${summary.questions.length}`}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Rankings -->
    <div class="panel p-4">
      <h3 class="text-sm font-semibold tracking-wide mb-1">Rankings</h3>
      <p class="text-xs mb-3" style="color: var(--color-muted)">
        Speed = median generation rate · variance = ±σ across all trials · peak = fastest single response · ctx ⚠ = loaded context was capped below requested
      </p>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr>
              <th class="th">#</th><th class="th">Provider</th><th class="th">Model</th>
              <th class="th">Params</th><th class="th">Quant</th><th class="th">Ctx</th>
              <th class="th">Score</th><th class="th">Logic</th><th class="th">Code</th><th class="th">Math</th>
              <th class="th">Tokens/Q</th><th class="th">Time/Q</th>
              <th class="th">tok/s (med)</th><th class="th">Peak</th><th class="th">±σ</th>
              <th class="th">TTFT</th><th class="th">Speed</th>
            </tr>
          </thead>
          <tbody>
            {#each summary.models as m, i (m.runModelId)}
              <tr style={m.status === "crashed" ? "opacity: 0.55" : ""}>
                <td class="td font-mono">{m.status === "crashed" ? "✕" : i + 1}</td>
                <td class="td"><span class="tag">{m.provider}</span></td>
                <td class="td font-mono text-xs">
                  {m.modelId}
                  {#if m.error}<div class="text-xs" style="color: var(--color-bad)">{m.error}</div>{/if}
                </td>
                <td class="td font-mono text-xs">{m.params ?? "?"}</td>
                <td class="td font-mono text-xs">{m.quant ?? "–"}</td>
                <td class="td font-mono text-xs">
                  {(m.loadedContext ?? m.requestedContext)?.toLocaleString()}
                  {#if ctxMismatch(m)}<span title="loaded context ({m.loadedContext?.toLocaleString()}) less than requested ({m.requestedContext?.toLocaleString()})" style="color: var(--color-amber)"> ⚠</span>{/if}
                </td>
                <td class="td font-mono font-semibold">{m.status === "crashed" ? "—" : `${m.total}/${summary.questions.length}`}</td>
                <td class="td font-mono text-xs">{m.byCategory?.logic ? `${m.byCategory.logic.score}/${m.byCategory.logic.outOf}` : "–"}</td>
                <td class="td font-mono text-xs">{m.byCategory?.code ? `${m.byCategory.code.score}/${m.byCategory.code.outOf}` : "–"}</td>
                <td class="td font-mono text-xs">{m.byCategory?.math ? `${m.byCategory.math.score}/${m.byCategory.math.outOf}` : "–"}</td>
                <td class="td font-mono text-xs">{m.avgTokensPerQ ?? "–"}</td>
                <td class="td font-mono text-xs">{dur(m.avgMsPerQ)}</td>
                <td class="td font-mono text-xs">{fmt1(m.medianTokPerSec)}</td>
                <td class="td font-mono text-xs">{fmt1(m.peakTokPerSec)}</td>
                <td class="td font-mono text-xs">{m.stddevTokPerSec != null ? `±${m.stddevTokPerSec}` : "–"}</td>
                <td class="td font-mono text-xs">{dur(m.medianTtftMs)}</td>
                <td class="td text-xs"
                  title={[m.speedAssessment, m.speedFitForPurpose, m.speedRange].filter(Boolean).join(" · ")}>
                  {m.speedBucket}
                  {#if m.medianTokPerSec != null}
                    <span class="font-mono" style="color: var(--color-muted)">({fmt1(m.medianTokPerSec)})</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- Manual review -->
  {#if pending.length > 0}
    <div class="panel p-4" style="border-color: var(--color-amber)">
      <h3 class="text-sm font-semibold tracking-wide mb-1">Manual review ({pending.length})</h3>
      <p class="text-xs mb-3" style="color: var(--color-muted)">
        These responses couldn't be auto-graded and no judge verdict landed. They count as incorrect until graded.
      </p>
      {#each pending as p (p.id)}
        <div class="border rounded-md p-3 mb-3" style="border-color: var(--color-line)">
          <div class="flex items-center justify-between mb-2">
            <span class="font-mono text-xs font-semibold">{p.model_id} · {p.qid}</span>
            <span class="flex gap-2">
              <button class="btn" style="color: var(--color-ok)" onclick={() => grade(p.id, "correct")}>✓ Correct</button>
              <button class="btn" style="color: var(--color-bad)" onclick={() => grade(p.id, "incorrect")}>✗ Incorrect</button>
            </span>
          </div>
          {#if p.question_text}
            <p class="text-xs mb-1">
              <span class="font-semibold" style="color: var(--color-muted)">Question:</span>
              <span style="color: var(--color-muted)">{p.question_text}</span>
            </p>
          {/if}
          {#if p.expected_answer}
            <p class="text-xs mb-2">
              <span style="color: var(--color-muted)">Expected answer:</span>
              <span class="font-mono font-semibold" style="color: var(--color-ok)">{p.expected_answer}</span>
            </p>
          {/if}
          {#if p.extracted_answer}
            <p class="text-xs mb-2">
              <span style="color: var(--color-muted)">Model's extracted answer:</span>
              <span class="font-mono font-semibold">{p.extracted_answer}</span>
            </p>
          {/if}
          <pre class="text-xs whitespace-pre-wrap max-h-48 overflow-y-auto font-mono" style="color: var(--color-muted)">{(p.response ?? "").slice(0, 2000)}</pre>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Response Audit -->
  <div class="panel p-4">
    <div class="flex items-center justify-between mb-2">
      <div>
        <h3 class="text-sm font-semibold tracking-wide">Response audit</h3>
        <p class="text-xs" style="color: var(--color-muted)">Full response from every model for every question — click a row to expand.</p>
      </div>
      {#if responses === null}
        <button class="btn" onclick={loadAudit} disabled={auditLoading}>
          {auditLoading ? "Loading…" : "Load responses"}
        </button>
      {/if}
    </div>

    {#if responses !== null}
      <div class="overflow-x-auto mt-3">
        <table class="w-full">
          <thead>
            <tr>
              <th class="th">Provider</th>
              <th class="th">Model</th>
              <th class="th">QID</th>
              <th class="th">Cat</th>
              <th class="th">Trial</th>
              <th class="th">Verdict</th>
              <th class="th">Method</th>
              <th class="th">Tokens</th>
              <th class="th">Time</th>
              <th class="th">tok/s</th>
              <th class="th">TTFT</th>
            </tr>
          </thead>
          <tbody>
            {#each responses as r (r.id)}
              {@const rowKey = String(r.id)}
              {@const expanded = expandedRow === rowKey}
              <tr
                class="cursor-pointer"
                style="background: {expanded ? 'var(--color-line)' : ''}"
                onclick={() => toggleAuditRow(rowKey)}
              >
                <td class="td text-xs"><span class="tag">{r.provider}</span></td>
                <td class="td font-mono text-xs max-w-40 truncate" title={r.model_id}>{r.model_id}</td>
                <td class="td font-mono text-xs font-semibold">{r.qid}</td>
                <td class="td text-xs"><span class="tag">{r.question_category ?? "–"}</span></td>
                <td class="td font-mono text-xs text-center">{r.trial}</td>
                <td class="td font-mono text-xs font-semibold" style={verdictStyle(r.verdict ?? "pending")}>
                  {r.verdict ?? "pending"}
                </td>
                <td class="td font-mono text-xs" style="color: var(--color-muted)">{r.method ?? "–"}</td>
                <td class="td font-mono text-xs">{r.completion_tokens ?? "–"}</td>
                <td class="td font-mono text-xs">{dur(r.total_ms)}</td>
                <td class="td font-mono text-xs">{fmt1(r.tok_per_sec)}</td>
                <td class="td font-mono text-xs">{dur(r.ttft_ms)}</td>
              </tr>
              {#if expanded}
                <tr>
                  <td colspan="11" class="td p-0">
                    <div class="p-3 space-y-2 text-xs" style="background: var(--color-line); border-top: 1px solid var(--color-line)">
                      {#if r.question_text}
                        <p><span class="font-semibold" style="color: var(--color-muted)">Question:</span> {r.question_text}</p>
                      {/if}
                      {#if r.expected_answer}
                        <p>
                          <span style="color: var(--color-muted)">Expected:</span>
                          <span class="font-mono font-semibold" style="color: var(--color-ok)">{r.expected_answer}</span>
                        </p>
                      {/if}
                      {#if r.extracted_answer}
                        <p>
                          <span style="color: var(--color-muted)">Extracted:</span>
                          <span class="font-mono font-semibold">{r.extracted_answer}</span>
                        </p>
                      {/if}
                      {#if r.detail}
                        <p>
                          <span style="color: var(--color-muted)">Grading rationale:</span>
                          <span class="font-mono">{r.detail}</span>
                        </p>
                      {/if}
                      {#if r.error}
                        <p style="color: var(--color-bad)">Error: {r.error}</p>
                      {/if}
                      <div>
                        <p class="font-semibold mb-1" style="color: var(--color-muted)">Full response:</p>
                        <pre class="whitespace-pre-wrap font-mono max-h-64 overflow-y-auto text-xs p-2 rounded" style="background: var(--color-bg); border: 1px solid var(--color-line)">{(r.response ?? "(no response)").slice(0, 4000)}</pre>
                      </div>
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-xs mt-2" style="color: var(--color-muted)">{responses.length} response{responses.length === 1 ? "" : "s"} total</p>
    {/if}
  </div>

  {#if error}
    <div class="panel p-3 text-sm" style="border-color: var(--color-bad); color: var(--color-bad)">{error}</div>
  {/if}
</section>
