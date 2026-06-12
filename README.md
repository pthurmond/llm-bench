# llm-bench

A local LLM benchmark harness. Scan your local inference servers, pick models and context lengths, run a question set with configurable trials, grade automatically (with an LLM-judge fallback), and get reports in the style of the community "12 Small LLMs" benchmark — backed by SQLite so every raw response is kept and re-gradable.

**Providers:** LM Studio · Ollama · vLLM · llama.cpp (llama-server) · mlx-lm (`mlx_lm.server`)
**Stack:** Bun + TypeScript, `bun:sqlite`, Svelte 5 + Tailwind 4 web UI. No cloud calls — works air-gapped.

## Quick start

```bash
bun run setup          # installs root + web deps and builds the UI (once)

bun run scan        # see what's running and which models are available
bun run run         # interactive: pick models, ctx, trials, judge → run → reports
bun run serve       # or do all of the above in the browser at http://localhost:4400
```

Reports land in `reports/run-<id>.md` and `reports/run-<id>.html`. All data lives in `bench.db` (override with `LLM_BENCH_DB=...`).

## Typical workflow

1. Load/serve the models you want to test in LM Studio, Ollama, etc.
2. `bun run run` (or the web UI): scan finds every model on every reachable provider, with params/quant/max-context inferred or reported.
3. Pick models, set a context length per model, choose trials (3 is a good default — questions are scored by majority vote), and pick a judge model (your strongest local model; it grades only the answers the auto-matcher can't decide).
4. Watch the matrix fill in. When done, download the markdown/HTML report.
5. If any responses are flagged for manual review (judge unavailable or unparseable), grade them in the web UI or with `bun run grade -- <runId>`, then regenerate: `bun run report -- <runId>`.

To benchmark **another machine**, run the providers there and point this harness at them: `bun run run -- --lmstudio http://192.168.1.20:1234` (the report records the machine where *llm-bench* runs — for true remote benchmarking, copy the repo to that machine and run it locally so hardware detection is accurate).

## CLI command shortcuts

Use these package scripts instead of typing `bun cli.ts ...`:

```bash
bun run help
bun run scan
bun run run
bun run list
bun run report -- <runId>
bun run grade -- <runId>
bun run questions
bun run serve
```

## How grading works

- Models are prompted to end with `FINAL ANSWER: <answer>`; that line is extracted (thinking blocks `<think>…</think>` are stripped first).
- Each question carries a match rule (`number`, `fraction`, `list`, `text`, `keyword_all/any`, or `judge`) — see `questions/*.json`.
- If the rule can't decide confidently, the response goes to the judge model with the question + answer key, which must return `{"verdict": "...", "reason": "..."}`.
- If the judge fails too, the response is marked **pending** and counts as incorrect until you grade it manually.
- A model is marked **crashed** after 3 consecutive request errors and skipped.

## Question sets

- `questions/default.json` — the original S1–S15 set, kept verbatim for comparability with prior community runs.
- `questions/variants.json` — the same skills with changed numbers/entities. The famous riddles (lake doubling, fathers-and-sons) are heavily represented in training data; a model that aces `default` but drops on `variants` likely memorized rather than reasoned. Run both for any model you're seriously considering.

### Editing questions

The **Questions** tab in the web UI (`bun cli.ts serve`) is a full editor: create a set, duplicate an existing one, add/remove/reorder questions, and edit each question's text, answer key, and auto-grading rule with type-appropriate fields (expected number, fraction, ordered list, accepted strings, keywords, or judge-only). Saves are validated server-side — duplicate qids, empty fields, and malformed rules are rejected with a list of what to fix, and a set with problems is flagged ⚠ in both the editor and the run-setup dropdown.

Prefer files? Sets are plain JSON in `questions/` — hand-editing works identically, and `bun run questions` lists every set with its file path and validation status.

Two safety properties worth knowing: every run snapshots its questions into the DB, so editing or deleting a set never changes a past run's report; and starting a run validates the chosen set first, so a half-finished set can't silently produce a broken benchmark. The editor warns before you modify `default`, since changing it breaks comparability with community results — duplicate it instead.

## Model lifecycle (memory management)

By default ("Unload previous model before loading the next", on unless you turn it off), the runner manages provider memory so back-to-back models don't OOM a 32 GB machine:

1. **Before each model** — everything resident on that server is unloaded, then the target model is explicitly loaded. On LM Studio 0.4.0+ this uses `POST /api/v1/models/unload` / `POST /api/v1/models/load` — and the load passes your **requested context length**, so it's actually honored. Older LM Studio falls back to the bundled `lms` CLI when the server is local (`lms unload --all`, `lms load --context-length`); failing that, JIT loading takes over (context not guaranteed, and a warning is recorded in the model's Notes).
2. **After each model** — it's unloaded immediately.
3. **Judging happens last** — all judge grading is deferred until **every** model has been tested and unloaded. Before grading, the runner explicitly unloads anything still resident and loads the judge at a bounded context (8K), so a big judge (e.g. Gemma 4 12B/26B) never trips LM Studio's "insufficient system resources" guardrail by JIT-loading at full context alongside a test model. If the judge still fails to load, affected responses are marked **pending** for manual review instead of silently counting as wrong. The judge is unloaded when grading finishes.
4. **Ollama** — unloaded after each model via the documented `keep_alive: 0` request; context is honored per-request via `num_ctx`.
5. **llama.cpp / vLLM / mlx-lm** — single model fixed at launch; nothing to manage (set `-c` / `--max-model-len` / server flags yourself).

If a model fails to *load* (e.g. requested context doesn't fit in RAM), it's marked **crashed** with the load error and the run continues with the next model.

If LM Studio requires an API token, set `LMSTUDIO_API_TOKEN` in the environment.

## Context length caveats (provider-specific)

| Provider  | Requested context honored? | Notes                                                              |
|-----------|----------------------------|--------------------------------------------------------------------|
| LM Studio | ✅ yes (0.4.0+)             | applied via `/api/v1/models/load`; recorded from the load response |
| Ollama    | ✅ yes                      | sent as `num_ctx` via the native API                               |
| llama.cpp | ⚠️ launch-time             | set with `-c` when starting `llama-server`; recorded from `/props` |
| vLLM      | ⚠️ launch-time             | `--max-model-len`; reported via `/v1/models`                       |
| mlx-lm    | ⚠️ launch-time             | configured when starting `mlx_lm.server`                           |

The report shows the **loaded** context when detectable, otherwise the requested one — so cross-run comparisons stay honest.

## Speed measurement

tok/s and TTFT are measured per response (server-reported token counts where available: `usage` on OpenAI-compatible streams, `eval_count`/`eval_duration` on Ollama; estimated otherwise). The report buckets median tok/s: very fast ≥40 · fast 20–40 · normal 8–20 · slow <8 — same labels as the original template, but derived from data, so they're comparable across machines.

## Project layout

```
cli.ts               interactive CLI (scan / run / report / list / grade / serve)
server.ts            Bun API server + serves web/dist
src/
  db.ts              bun:sqlite schema & queries (machines, runs, run_models, responses, grades)
  sysinfo.ts         machine detection (Apple Silicon P/E + GPU cores, Linux CPU + nvidia-smi)
  providers/         one adapter per provider + OpenAI-compatible streaming chat
  grader.ts          answer extraction, auto-match rules, judge fallback
  runner.ts          orchestration: models × questions × trials, progress, crash handling
  report/            score aggregation, markdown + self-contained HTML reports
questions/           question sets (JSON)
web/                 Svelte 5 + Tailwind 4 UI (Vite build → web/dist)
test/smoke.ts        end-to-end test against a mock provider (bun test/smoke.ts)
```

## Dev

```bash
bun run serve        # API on :4400
bun run web:dev      # Vite dev server with /api proxy (hot reload)
bun run typecheck    # typecheck backend
bun run smoke        # end-to-end smoke test
```
