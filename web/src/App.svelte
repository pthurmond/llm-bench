<script lang="ts">
  import { api, type Machine, type RunRow } from "./lib/api";
  import Setup from "./Setup.svelte";
  import RunView from "./RunView.svelte";
  import Questions from "./Questions.svelte";

  let machine: Machine | null = $state(null);
  let runs: RunRow[] = $state([]);
  let view: "setup" | "runs" | "run" | "questions" = $state("setup");
  let activeRunId: number | null = $state(null);

  api.machine().then((m) => (machine = m)).catch(() => {});

  async function loadRuns() {
    runs = await api.runs();
  }

  function openRun(id: number) {
    activeRunId = id;
    view = "run";
  }

  function showRuns() {
    view = "runs";
    loadRuns();
  }

  const machineLine = $derived(
    machine
      ? [
          machine.chip,
          machine.perfCores != null
            ? `${machine.cpuCores} CPU (${machine.perfCores}P+${machine.effCores}E)`
            : `${machine.cpuCores} CPU`,
          machine.gpuCores ? `${machine.gpuCores}-core GPU` : machine.gpu,
          `${machine.ramGb} GB`,
        ]
          .filter(Boolean)
          .join(" · ")
      : "detecting…",
  );
</script>

<div class="max-w-6xl mx-auto px-5 py-8">
  <header class="pb-4 mb-6" style="border-bottom: 3px solid var(--color-ink)">
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">llm-bench</h1>
        <p class="text-sm mt-0.5" style="color: var(--color-muted)">
          Local model benchmark lab — scan, run, grade, report.
        </p>
      </div>
      <div class="flex flex-col items-end gap-1.5">
        <span class="tag">🖥 <b>{machine?.hostname ?? "…"}</b> — {machineLine}</span>
        <nav class="flex gap-2">
          <button class="btn {view === 'setup' ? 'primary' : ''}" onclick={() => (view = "setup")}>New run</button>
          <button class="btn {view === 'runs' || view === 'run' ? 'primary' : ''}" onclick={showRuns}>Past runs</button>
          <button class="btn {view === 'questions' ? 'primary' : ''}" onclick={() => (view = "questions")}>Questions</button>
        </nav>
      </div>
    </div>
  </header>

  {#if view === "setup"}
    <Setup onStarted={openRun} />
  {:else if view === "questions"}
    <Questions />
  {:else if view === "run" && activeRunId != null}
    <RunView runId={activeRunId} onBack={showRuns} />
  {:else}
    <section class="panel p-4">
      <h2 class="text-sm font-semibold tracking-wide mb-3">Past runs</h2>
      {#if runs.length === 0}
        <p class="text-sm" style="color: var(--color-muted)">
          No runs yet — start one from the New run tab.
        </p>
      {:else}
        <table class="w-full">
          <thead>
            <tr>
              <th class="th">#</th><th class="th">Label</th><th class="th">Status</th>
              <th class="th">Set</th><th class="th">Models</th><th class="th">Trials</th>
              <th class="th">Machine</th><th class="th">Created</th><th class="th"></th>
            </tr>
          </thead>
          <tbody>
            {#each runs as r (r.id)}
              <tr>
                <td class="td font-mono">{r.id}</td>
                <td class="td">{r.label}</td>
                <td class="td">
                  <span class="tag" style={r.status === "done" ? "color: var(--color-ok)" : r.status === "running" ? "color: var(--color-amber)" : ""}>{r.status}</span>
                </td>
                <td class="td font-mono text-xs">{r.question_set}</td>
                <td class="td font-mono text-xs">{r.model_count}</td>
                <td class="td font-mono text-xs">{r.trials}</td>
                <td class="td font-mono text-xs">{r.hostname}</td>
                <td class="td font-mono text-xs">{r.created_at}</td>
                <td class="td"><button class="btn" onclick={() => openRun(r.id)}>Open</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}

  <footer class="mt-10 text-xs" style="color: var(--color-muted)">
    Same engine as the CLI (<code>bun cli.ts run</code>) · data in <code>bench.db</code> · reports in <code>reports/</code>
  </footer>
</div>
