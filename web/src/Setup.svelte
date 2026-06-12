<script lang="ts">
  import { api, type ScanResult, type QuestionSetMeta } from "./lib/api";

  let { onStarted }: { onStarted: (runId: number) => void } = $props();

  let scans: ScanResult[] = $state([]);
  let scanning = $state(false);
  let scanned = $state(false);
  let urlOverrides: Record<string, string> = $state({});
  let sets: QuestionSetMeta[] = $state([]);
  let error = $state("");

  interface Row {
    key: string;
    provider: string;
    baseUrl: string;
    id: string;
    params?: string;
    quant?: string;
    format?: string;
    maxContext?: number;
    state?: string;
    selected: boolean;
    ctx: number;
  }
  let rows: Row[] = $state([]);

  // Run config
  let label = $state("");
  let questionSet = $state("default");
  let trials = $state(1);
  let temperature = $state(0);
  let topP = $state<number | "">("");
  let seed = $state<number | "">("");
  let maxTokens = $state(4096);
  let timeoutSec = $state(300);
  let defaultCtx = $state(16384);
  let judgeKey = $state("");
  let manageModels = $state(true);
  let starting = $state(false);

  const selected = $derived(rows.filter((r) => r.selected));

  async function loadSets() {
    sets = await api.questionSets();
    if (!sets.find((s) => s.name === questionSet)) questionSet = sets[0]?.name ?? "default";
  }
  loadSets().catch((e) => (error = String(e)));

  async function scan() {
    scanning = true;
    error = "";
    try {
      scans = await api.scan(
        Object.fromEntries(Object.entries(urlOverrides).filter(([, v]) => v?.trim())),
      );
      const prev = new Map(rows.map((r) => [r.key, r]));
      rows = scans.flatMap((s) =>
        s.models.map((m) => {
          const key = `${s.provider}|${m.id}`;
          const old = prev.get(key);
          return {
            key,
            provider: s.provider,
            baseUrl: s.baseUrl,
            id: m.id,
            params: m.params,
            quant: m.quant,
            format: m.format,
            maxContext: m.maxContext,
            state: m.state,
            selected: old?.selected ?? false,
            ctx: old?.ctx ?? Math.min(defaultCtx, m.maxContext ?? defaultCtx),
          };
        }),
      );
      scanned = true;
    } catch (e) {
      error = String(e);
    } finally {
      scanning = false;
    }
  }

  function applyDefaultCtx() {
    rows = rows.map((r) => ({ ...r, ctx: Math.min(defaultCtx, r.maxContext ?? defaultCtx) }));
  }

  function toggleAll(on: boolean) {
    rows = rows.map((r) => ({ ...r, selected: on }));
  }

  async function start() {
    starting = true;
    error = "";
    try {
      const judge = judgeKey
        ? (() => {
            const r = rows.find((x) => x.key === judgeKey)!;
            return { provider: r.provider, baseUrl: r.baseUrl, modelId: r.id };
          })()
        : null;
      const { runId } = await api.startRun({
        label: label || `${questionSet} run`,
        questionSet,
        trials,
        temperature,
        topP: topP === "" ? undefined : topP,
        seed: seed === "" ? undefined : seed,
        maxTokens,
        timeoutMs: timeoutSec * 1000,
        judge,
        manageModels,
        models: selected.map((r) => ({
          provider: r.provider,
          baseUrl: r.baseUrl,
          modelId: r.id,
          context: r.ctx,
          params: r.params,
          quant: r.quant,
          format: r.format,
        })),
      });
      onStarted(runId);
    } catch (e) {
      error = String(e);
    } finally {
      starting = false;
    }
  }
</script>

<section class="space-y-5">
  <!-- Providers -->
  <div class="panel p-4">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <h2 class="text-sm font-semibold tracking-wide">1 · Providers</h2>
      <button class="btn primary" onclick={scan} disabled={scanning}>
        {scanning ? "Scanning…" : scanned ? "Rescan" : "Scan local providers"}
      </button>
    </div>
    <div class="grid gap-2 mt-3 md:grid-cols-2 lg:grid-cols-3">
      {#each ["lmstudio", "ollama", "vllm", "llamacpp", "mlx"] as p}
        {@const found = scans.find((s) => s.provider === p)}
        <label class="flex items-center gap-2">
          <span class="tag w-20 text-center">{p}</span>
          <input
            class="input"
            placeholder={found?.baseUrl ?? "default URL"}
            bind:value={urlOverrides[p]}
          />
          {#if scanned}
            <span class="text-xs font-mono {found?.reachable ? 'text-ok' : 'text-muted'}">
              {found?.reachable ? `✓ ${found.models.length}` : "✗"}
            </span>
          {/if}
        </label>
      {/each}
    </div>
    <p class="text-xs mt-2" style="color: var(--color-muted)">
      Leave URLs blank for defaults. Enter a LAN address to benchmark another machine's server.
    </p>
  </div>

  <!-- Models -->
  {#if scanned}
    <div class="panel p-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <h2 class="text-sm font-semibold tracking-wide">2 · Models ({selected.length} selected)</h2>
        <div class="flex items-center gap-2">
          <span class="text-xs" style="color: var(--color-muted)">ctx for all:</span>
          <input class="input !w-28" type="number" bind:value={defaultCtx} step="1024" min="512" />
          <button class="btn" onclick={applyDefaultCtx}>Apply</button>
          <button class="btn" onclick={() => toggleAll(true)}>All</button>
          <button class="btn" onclick={() => toggleAll(false)}>None</button>
        </div>
      </div>
      {#if rows.length === 0}
        <p class="text-sm mt-3" style="color: var(--color-muted)">
          No models found. Start a provider, then rescan.
        </p>
      {:else}
        <div class="overflow-x-auto mt-3">
          <table class="w-full">
            <thead>
              <tr>
                <th class="th w-8"></th>
                <th class="th">Provider</th>
                <th class="th">Model</th>
                <th class="th">Params</th>
                <th class="th">Quant</th>
                <th class="th">Max ctx</th>
                <th class="th">Test ctx</th>
              </tr>
            </thead>
            <tbody>
              {#each rows as r (r.key)}
                <tr class={r.selected ? "bg-accent-soft/40" : ""}>
                  <td class="td"><input type="checkbox" bind:checked={r.selected} class="accent-[#0f6b66]" /></td>
                  <td class="td"><span class="tag">{r.provider}</span></td>
                  <td class="td font-mono text-xs">
                    {r.id}
                    {#if r.state === "loaded"}<span class="tag ml-1" style="color: var(--color-ok)">loaded</span>{/if}
                  </td>
                  <td class="td font-mono text-xs">{r.params ?? "?"}</td>
                  <td class="td font-mono text-xs">{r.quant ?? "–"}</td>
                  <td class="td font-mono text-xs">{r.maxContext?.toLocaleString() ?? "–"}</td>
                  <td class="td"><input class="input !w-28" type="number" bind:value={r.ctx} step="1024" min="512" disabled={!r.selected} /></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    <!-- Config -->
    <div class="panel p-4">
      <h2 class="text-sm font-semibold tracking-wide">3 · Run configuration</h2>
      <div class="grid gap-4 mt-3 md:grid-cols-3">
        <label class="block">
          <span class="text-xs font-semibold" style="color: var(--color-muted)">Label</span>
          <input class="input mt-1" placeholder="e.g. M1 Max 32GB — round 2" bind:value={label} />
        </label>
        <label class="block">
          <span class="text-xs font-semibold" style="color: var(--color-muted)">Question set</span>
          <select class="input mt-1" bind:value={questionSet}>
            {#each sets as s}
              <option value={s.name}>{s.name} ({s.count} questions){s.valid === false ? " ⚠ invalid" : ""}</option>
            {/each}
          </select>
        </label>
        <label class="block">
          <span class="text-xs font-semibold" style="color: var(--color-muted)">Trials per question</span>
          <input class="input mt-1" type="number" min="1" max="9" bind:value={trials} />
        </label>
        <label class="block">
          <span class="text-xs font-semibold" style="color: var(--color-muted)">Temperature</span>
          <input class="input mt-1" type="number" min="0" max="2" step="0.1" bind:value={temperature} />
        </label>
        <label class="block">
          <span class="text-xs font-semibold" style="color: var(--color-muted)">Top-p <span style="font-weight: normal">(blank = provider default)</span></span>
          <input class="input mt-1" type="number" min="0" max="1" step="0.05" placeholder="e.g. 0.9" bind:value={topP} />
        </label>
        <label class="block">
          <span class="text-xs font-semibold" style="color: var(--color-muted)">Seed <span style="font-weight: normal">(blank = random)</span></span>
          <input class="input mt-1" type="number" min="0" step="1" placeholder="e.g. 42" bind:value={seed} />
        </label>
        <label class="block">
          <span class="text-xs font-semibold" style="color: var(--color-muted)">Max tokens</span>
          <input class="input mt-1" type="number" min="256" step="256" bind:value={maxTokens} />
        </label>
        <label class="block">
          <span class="text-xs font-semibold" style="color: var(--color-muted)">Timeout (s)</span>
          <input class="input mt-1" type="number" min="30" step="30" bind:value={timeoutSec} />
        </label>
        <label class="flex items-center gap-2 md:col-span-3">
          <input type="checkbox" bind:checked={manageModels} class="accent-[#0f6b66]" />
          <span class="text-sm">Unload previous model before loading the next
            <span class="text-xs block" style="color: var(--color-muted)">
              Frees memory between models (LM Studio: also loads each model at your requested context; Ollama: keep_alive 0). The judge runs after each model unloads, so it never competes for RAM.
            </span>
          </span>
        </label>
        <label class="block md:col-span-3">
          <span class="text-xs font-semibold" style="color: var(--color-muted)">
            Judge model (grades answers the auto-matcher can't decide)
          </span>
          <select class="input mt-1" bind:value={judgeKey}>
            <option value="">No judge — flag for manual review</option>
            {#each rows as r (r.key)}
              <option value={r.key}>[{r.provider}] {r.id}</option>
            {/each}
          </select>
        </label>
      </div>
      {#if questionSet && sets.find((s) => s.name === questionSet)?.description}
        <p class="text-xs mt-3" style="color: var(--color-muted)">
          {sets.find((s) => s.name === questionSet)?.description}
        </p>
      {/if}
      <div class="flex items-center gap-3 mt-4">
        <button class="btn primary" onclick={start} disabled={starting || selected.length === 0}>
          {starting ? "Starting…" : `Start run (${selected.length} model${selected.length === 1 ? "" : "s"} × ${trials} trial${trials === 1 ? "" : "s"})`}
        </button>
        {#if selected.length === 0}
          <span class="text-xs" style="color: var(--color-muted)">Select at least one model.</span>
        {/if}
      </div>
    </div>
  {/if}

  {#if error}
    <div class="panel p-3 text-sm" style="border-color: var(--color-bad); color: var(--color-bad)">{error}</div>
  {/if}
</section>
