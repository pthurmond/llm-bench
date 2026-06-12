<script lang="ts">
  import { api, type QuestionSet, type QuestionSetMeta } from "./lib/api";

  let sets: QuestionSetMeta[] = $state([]);
  let current: QuestionSet | null = $state(null);
  let currentName = $state("");
  let dirty = $state(false);
  let saving = $state(false);
  let error = $state("");
  let problems: string[] = $state([]);
  let savedFlash = $state(false);

  // Match-rule fields are edited as strings, keyed by question index.
  let ruleText: Record<number, string> = $state({});

  const CATEGORIES = ["logic", "code", "math"] as const;
  const RULE_TYPES = [
    { value: "number", label: "Number — final numeric answer must equal…" },
    { value: "fraction", label: "Fraction — e.g. 2/9 (decimals accepted)" },
    { value: "list", label: "Number list — exact ordered match, e.g. 4, 16, 36" },
    { value: "text", label: "Text — answer must contain one of…" },
    { value: "keyword_all", label: "Keywords (all) — response must mention every…" },
    { value: "keyword_any", label: "Keywords (any) — response must mention one of…" },
    { value: "judge", label: "Judge only — always graded by the judge model" },
  ];

  async function loadSets() {
    sets = await api.questionSets();
  }
  loadSets().catch((e) => (error = String(e)));

  function ruleToText(match: any): string {
    switch (match?.type) {
      case "number": return String(match.expected ?? "");
      case "fraction": return match.expected ?? "";
      case "list": return (match.expected ?? []).join(", ");
      case "text": return (match.accept ?? []).join("\n");
      case "keyword_all":
      case "keyword_any": return (match.keywords ?? []).join("\n");
      default: return "";
    }
  }

  function textToRule(type: string, text: string): any {
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    switch (type) {
      case "number": return { type, expected: Number(text.trim()) };
      case "fraction": return { type, expected: text.trim() };
      case "list": return { type, expected: text.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) };
      case "text": return { type, accept: lines };
      case "keyword_all":
      case "keyword_any": return { type, keywords: lines };
      default: return { type: "judge" };
    }
  }

  async function open(name: string) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    error = ""; problems = [];
    current = await api.questionSet(name).catch((e) => { error = String(e); return null; });
    currentName = name;
    dirty = false;
    ruleText = Object.fromEntries((current?.questions ?? []).map((q, i) => [i, ruleToText(q.match)]));
  }

  function markDirty() { dirty = true; problems = []; }

  function setRuleType(i: number, type: string) {
    if (!current) return;
    current.questions[i].match = textToRule(type, ruleText[i] ?? "");
    markDirty();
  }
  function setRuleText(i: number, text: string) {
    if (!current) return;
    ruleText[i] = text;
    current.questions[i].match = textToRule(current.questions[i].match?.type ?? "judge", text);
    markDirty();
  }

  function addQuestion() {
    if (!current) return;
    const used = new Set(current.questions.map((q) => q.qid));
    let n = current.questions.length + 1;
    while (used.has(`Q${n}`)) n++;
    current.questions.push({ qid: `Q${n}`, category: "logic", text: "", answer: "", match: { type: "judge" } });
    ruleText[current.questions.length - 1] = "";
    markDirty();
  }

  function removeQuestion(i: number) {
    if (!current) return;
    if (current.questions[i].text && !confirm(`Delete ${current.questions[i].qid}?`)) return;
    current.questions.splice(i, 1);
    ruleText = Object.fromEntries(current.questions.map((q, idx) => [idx, ruleToText(q.match)]));
    markDirty();
  }

  function move(i: number, dir: -1 | 1) {
    if (!current) return;
    const j = i + dir;
    if (j < 0 || j >= current.questions.length) return;
    [current.questions[i], current.questions[j]] = [current.questions[j], current.questions[i]];
    [ruleText[i], ruleText[j]] = [ruleText[j], ruleText[i]];
    markDirty();
  }

  async function save() {
    if (!current) return;
    saving = true; error = ""; problems = [];
    try {
      await api.saveQuestionSet(currentName, current);
      dirty = false;
      savedFlash = true;
      setTimeout(() => (savedFlash = false), 1800);
      await loadSets();
    } catch (e: any) {
      const msg = String(e);
      // 422 payload contains the validation problems
      try {
        const parsed = JSON.parse(msg.replace(/^\d+:\s*/, ""));
        problems = parsed.problems ?? [];
      } catch { /* not json */ }
      if (problems.length === 0) error = msg;
    } finally {
      saving = false;
    }
  }

  async function createSet(copyFrom?: string) {
    const name = prompt(copyFrom ? `Name for the copy of "${copyFrom}":` : "Name for the new set (letters, digits, - or _):");
    if (!name) return;
    try {
      await api.createQuestionSet(name.trim(), copyFrom);
      await loadSets();
      await open(name.trim());
    } catch (e) { error = String(e); }
  }

  async function removeSet(name: string) {
    if (!confirm(`Delete the set "${name}"? Past runs keep their own snapshot and are unaffected.`)) return;
    try {
      await api.deleteQuestionSet(name);
      if (currentName === name) { current = null; currentName = ""; }
      await loadSets();
    } catch (e) { error = String(e); }
  }
</script>

<section class="grid gap-5 lg:grid-cols-[230px_1fr]">
  <!-- Set list -->
  <div class="panel p-3 self-start">
    <div class="flex items-center justify-between mb-2">
      <h2 class="text-sm font-semibold tracking-wide">Sets</h2>
      <button class="btn !px-2 !py-1" onclick={() => createSet()}>+ New</button>
    </div>
    {#each sets as s (s.name)}
      <div class="flex items-center gap-1 mb-1">
        <button
          class="btn flex-1 text-left !font-mono !text-xs {currentName === s.name ? 'primary' : ''}"
          onclick={() => open(s.name)}
        >
          {s.name} <span class="opacity-60">({s.count})</span>
          {#if s.valid === false}<span title="has validation problems"> ⚠</span>{/if}
        </button>
      </div>
    {/each}
    <p class="text-xs mt-3" style="color: var(--color-muted)">
      Sets live as JSON in <code>questions/</code> — hand-editing works too. Runs snapshot their questions, so editing never changes past reports.
    </p>
  </div>

  <!-- Editor -->
  {#if current}
    <div class="space-y-4">
      <div class="panel p-4">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <h2 class="text-base font-semibold font-mono">{currentName}.json {#if dirty}<span class="tag" style="color: var(--color-amber)">unsaved</span>{/if}{#if savedFlash}<span class="tag" style="color: var(--color-ok)">saved ✓</span>{/if}</h2>
          <div class="flex gap-2">
            <button class="btn" onclick={() => createSet(currentName)}>Duplicate set</button>
            <button class="btn" style="color: var(--color-bad)" onclick={() => removeSet(currentName)}>Delete set</button>
            <button class="btn primary" onclick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
        {#if currentName === "default"}
          <p class="text-xs mt-2" style="color: var(--color-amber)">
            Heads up: <b>default</b> mirrors the community benchmark. Edit it and your scores stop being comparable to prior runs and other people's results — consider <i>Duplicate set</i> instead.
          </p>
        {/if}
        <label class="block mt-3">
          <span class="text-xs font-semibold" style="color: var(--color-muted)">Description</span>
          <input class="input mt-1" bind:value={current.description} oninput={markDirty} />
        </label>
      </div>

      {#if problems.length}
        <div class="panel p-3" style="border-color: var(--color-bad)">
          <b class="text-sm" style="color: var(--color-bad)">Fix before saving:</b>
          <ul class="text-xs mt-1 list-disc pl-5" style="color: var(--color-bad)">
            {#each problems as p}<li>{p}</li>{/each}
          </ul>
        </div>
      {/if}

      {#each current.questions as q, i (i)}
        <div class="panel p-4">
          <div class="flex items-center gap-2 flex-wrap">
            <input class="input !w-20" bind:value={q.qid} oninput={markDirty} aria-label="Question ID" />
            <select class="input !w-28" bind:value={q.category} onchange={markDirty}>
              {#each CATEGORIES as c}<option value={c}>{c}</option>{/each}
            </select>
            <span class="flex-1"></span>
            <button class="btn !px-2 !py-1" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
            <button class="btn !px-2 !py-1" onclick={() => move(i, 1)} disabled={i === current.questions.length - 1} aria-label="Move down">↓</button>
            <button class="btn !px-2 !py-1" style="color: var(--color-bad)" onclick={() => removeQuestion(i)}>Delete</button>
          </div>
          <label class="block mt-3">
            <span class="text-xs font-semibold" style="color: var(--color-muted)">Question (markdown/code blocks fine — sent verbatim to the model)</span>
            <textarea class="input mt-1 font-mono !text-xs" rows={Math.min(10, Math.max(3, q.text.split("\n").length + 1))} bind:value={q.text} oninput={markDirty}></textarea>
          </label>
          <div class="grid gap-3 mt-3 md:grid-cols-2">
            <label class="block">
              <span class="text-xs font-semibold" style="color: var(--color-muted)">Answer key (shown in reports, given to the judge)</span>
              <input class="input mt-1" bind:value={q.answer} oninput={markDirty} />
            </label>
            <label class="block">
              <span class="text-xs font-semibold" style="color: var(--color-muted)">Auto-grading rule</span>
              <select class="input mt-1" value={q.match?.type ?? "judge"} onchange={(e) => setRuleType(i, (e.target as HTMLSelectElement).value)}>
                {#each RULE_TYPES as rt}<option value={rt.value}>{rt.label}</option>{/each}
              </select>
            </label>
          </div>
          {#if q.match?.type && q.match.type !== "judge"}
            <label class="block mt-2">
              <span class="text-xs font-semibold" style="color: var(--color-muted)">
                {#if q.match.type === "number"}Expected number
                {:else if q.match.type === "fraction"}Expected fraction (e.g. 2/9)
                {:else if q.match.type === "list"}Expected numbers, comma-separated, in order
                {:else if q.match.type === "text"}Accepted strings — one per line (whitespace/case ignored)
                {:else}Keywords — one per line{/if}
              </span>
              {#if q.match.type === "text" || q.match.type === "keyword_all" || q.match.type === "keyword_any"}
                <textarea class="input mt-1 font-mono !text-xs" rows="3" value={ruleText[i] ?? ""} oninput={(e) => setRuleText(i, (e.target as HTMLTextAreaElement).value)}></textarea>
              {:else}
                <input class="input mt-1 font-mono" value={ruleText[i] ?? ""} oninput={(e) => setRuleText(i, (e.target as HTMLInputElement).value)} />
              {/if}
            </label>
          {:else}
            <p class="text-xs mt-2" style="color: var(--color-muted)">
              No auto-rule — every response goes to the judge model (or manual review if no judge is set).
            </p>
          {/if}
        </div>
      {/each}

      <div class="flex gap-3">
        <button class="btn" onclick={addQuestion}>+ Add question</button>
        <button class="btn primary" onclick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  {:else}
    <div class="panel p-8 text-center text-sm self-start" style="color: var(--color-muted)">
      Pick a set on the left, or create a new one. Tip: duplicate <b>default</b> to make a custom variant while keeping the original comparable.
    </div>
  {/if}

  {#if error}
    <div class="panel p-3 text-sm lg:col-span-2" style="border-color: var(--color-bad); color: var(--color-bad)">{error}</div>
  {/if}
</section>
