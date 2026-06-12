# llm-bench

Run a structured reasoning benchmark against any local LLM — logic, coding, and math questions, automatic scoring, and detailed reports — all without sending data to the cloud.

You point it at your local inference server (LM Studio, Ollama, etc.), pick which models to test, and let it run. When it's done you get a results matrix, a ranked table, per-response timing, and downloadable markdown/HTML reports. Every raw response is stored in SQLite so you can re-grade, re-report, or dig into individual answers at any time.

**Supported inference servers:** LM Studio · Ollama · vLLM · llama.cpp (`llama-server`) · mlx-lm (`mlx_lm.server`)

## History

This project was started after I saw [this post on Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1o9xq9j/12_small_llms_benchmarked_on_15_reasoning_questions/) about benchmarking local LLMs and wanted to create a more comprehensive and automated solution. At first it was just a simple template I would fill out manually, but I realized that I'm lazy and I don't want to do all that manually. So I created this tool to automate the process (with the help of AI of course because lazy and why not). The default questions, as you will see, are direct copies from that post.

---

## Prerequisites

Before you start, you need:

1. **[Bun](https://bun.sh)** — the JavaScript runtime this tool runs on. Install it with:
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```
2. **A running local inference server** — at least one of LM Studio, Ollama, etc., with the models you want to test already loaded (or at least downloaded).
3. **Git** — to clone this repo.

> **What is a context length?**  
> Context length (or "context window") is how many tokens a model can hold in memory at once — both your question and its answer count toward this limit. Larger contexts use more RAM. A safe default for most reasoning tasks is **8192** tokens.

> **What are tok/s and TTFT?**  
> - **tok/s** (tokens per second) — how fast the model generates text. Higher is better.  
> - **TTFT** (time to first token) — how long before the model starts responding. Indicates whether the model is loading or just thinking.

---

## Quick start

```bash
git clone <repo-url> llm-bench && cd llm-bench
bun run setup       # installs all dependencies and builds the web UI (do this once)

bun run serve       # start the server and open http://localhost:4400 in your browser
```

That's it. The web UI is the recommended way to run benchmarks.

If you prefer the command line:
```bash
bun run scan        # see which inference servers are reachable and what models are available
bun run run         # interactive: pick models, context lengths, trials, and a judge → runs the benchmark
```

Reports are saved to `reports/run-<id>.md` and `reports/run-<id>.html`. All data lives in `bench.db` (change the location with `LLM_BENCH_DB=/path/to/your.db`).

---

## Typical workflow

1. **Load your models** — open LM Studio (or start Ollama / llama-server) and make sure the models you want to test are available.
2. **Start the harness** — run `bun run serve` and open `http://localhost:4400`.
3. **Run a benchmark** — click **New Run**, pick models, set context lengths, choose how many trials per question (3 is a good default — scores are settled by majority vote), and optionally pick a judge model (see [How grading works](#how-grading-works)).
4. **Watch it run** — the results matrix fills in live. You can cancel a run at any time; the cancel button shows "Cancelling…" while the current response finishes.
5. **Review results** — when done, expand the **Rankings** table for timing stats, or open the **Response audit** panel to inspect every individual response.
6. **Download reports** — use the **↓ Markdown** or **HTML report ↗** buttons on the run page.
7. **Manual grading (if needed)** — if any responses couldn't be auto-graded and no judge was configured, they appear in the **Manual review** panel with the question, expected answer, and the model's extracted answer shown side-by-side. Grade them there (or with `bun run grade -- <runId>` in the CLI), then re-download the report.

> **Benchmarking another machine?**  
> Run the inference server on the remote machine and point the harness at it:  
> `bun run run -- --lmstudio http://192.168.1.20:1234`  
> For accurate hardware info in the report, copy the repo to the remote machine and run everything locally there instead.

---

## Web UI features

The web UI (served at `http://localhost:4400`) covers the full workflow without needing the CLI:

- **Dashboard** — list of all past runs with status, model count, and hardware summary.
- **New Run** — scan all reachable providers, select models, set per-model context, configure trials / temperature / top-p / seed / judge, and start.
- **Run page**
  - Live progress bar with current model, question, and tok/s.
  - Cancel button with visual feedback while the in-flight request finishes.
  - **Run details** — question set, trials, temperature, timing, judge info, and the machine hardware profile.
  - **Results matrix** — a grid of ✓/✗/⚠ per model × question (hover a cell for per-trial detail).
  - **Speed scale reference** — collapsible table mapping tok/s ranges to plain-English labels with hardware examples (Painfully Slow → Extremely Fast).
  - **Rankings** — full stats per model: score by category, avg tokens/question, time/question, total model test time, median/peak tok/s, ±σ, TTFT, and speed label.
  - **Response audit** — every response from every model, paginated, sortable, with click-to-expand rows showing the full response, expected answer, extracted answer, and grading rationale.
  - **Manual review** — responses that need human grading, with question and expected answer shown.
- **Questions** — full CRUD editor for question sets (create, duplicate, edit, validate, delete).

---

## CLI reference

Every command is available as a `bun run` script:

| Command                     | What it does                                                     |
|-----------------------------|------------------------------------------------------------------|
| `bun run scan`              | Scan all providers and list available models                     |
| `bun run run`               | Interactive benchmark wizard (models → questions → run → report) |
| `bun run list`              | Show all past runs                                               |
| `bun run report -- <runId>` | Re-generate the markdown + HTML report for a completed run       |
| `bun run grade -- <runId>`  | Manually grade pending responses in the terminal                 |
| `bun run questions`         | List all question sets with file paths and validation status     |
| `bun run serve`             | Start the API server + web UI at `http://localhost:4400`         |
| `bun run help`              | Print all available commands                                     |

Pass provider overrides directly to `scan` or `run`:
```bash
bun run run -- --lmstudio http://192.168.1.20:1234 --ollama http://localhost:11434
```

---

## How grading works

Each question has a **match rule** that the auto-grader checks first:

| Rule                          | Used for                                                    |
|-------------------------------|-------------------------------------------------------------|
| `number`                      | Exact numeric answer (with optional tolerance)              |
| `fraction`                    | Fractional answer like `2/9` (equivalent decimals accepted) |
| `list`                        | Ordered numeric list like `[4, 16, 36]`                     |
| `text`                        | Substring match against accepted strings                    |
| `keyword_all` / `keyword_any` | All/any keywords must appear in the answer                  |
| `judge`                       | Always sent to the judge model (no auto rule)               |

**The pipeline for each response:**

1. Thinking blocks (`<think>…</think>`) are stripped from the response.
2. The line `FINAL ANSWER: <answer>` is extracted — models are instructed to end with this.
3. The auto-grader applies the match rule. If it can decide → done.
4. If not, and a judge model is configured, the response is queued for judge grading (see below).
5. If no judge, or the judge fails, the response is marked **pending** and counts as incorrect until you grade it manually.
6. A model is marked **crashed** and skipped after 3 consecutive request errors.

**Judge grading** is always deferred until every model has finished testing (see [Model lifecycle](#model-lifecycle-memory-management)). The judge is shown the question, the answer key, and the model's full response, and must return `{"verdict": "correct"|"incorrect", "reason": "..."}`.

---

## Question sets

- `questions/default.json` — the original S1–S15 set (5 logic · 5 code · 5 math), kept verbatim for comparability with community runs.
- `questions/variants.json` — the same 15 skills with different numbers and wording. A model that aces `default` but drops on `variants` likely memorized rather than reasoned — run both when evaluating a model seriously.

### Editing question sets

The **Questions** tab in the web UI is a full editor: create a set, duplicate an existing one, add/remove/reorder questions, and edit each question's text, answer key, and grading rule with type-appropriate form fields. Saves are validated server-side — duplicate IDs, empty fields, and malformed rules are rejected with an explanation.

Prefer editing files directly? Question sets are plain JSON in `questions/` — hand-editing works identically. Use `bun run questions` to list every set with its path and validation status.

Two safety properties worth knowing:
- Every run **snapshots** its question set into the database at start time, so editing or deleting a set never alters a past run's report.
- Starting a run **validates** the chosen set first, so a broken set can't silently produce a bad benchmark.

> **Don't modify `default.json`** — doing so breaks comparability with community results. Duplicate it and modify the copy instead (the editor warns you before letting you edit it).

---

## Model lifecycle (memory management)

Managing memory is important when benchmarking multiple models on a machine with limited RAM. By default, the runner handles this automatically ("Unload previous model before loading the next" — on unless you disable it):

1. **Before each model** — everything currently loaded on that inference server is unloaded, then the target model is explicitly loaded at your **requested context length**. On LM Studio 0.4.0+ this uses the REST API (`POST /api/v1/models/unload` / `POST /api/v1/models/load`). Older LM Studio falls back to the bundled `lms` CLI if the server is running locally; if that also fails, the model is loaded on-demand (context length not guaranteed, and a warning is recorded).
2. **After each model** — it's unloaded immediately before the next model loads, so only one model is ever resident during testing.
3. **Judging happens last** — all judge grading runs in one batch **after every test model has been unloaded**. Before judging, the runner explicitly unloads any remaining resident model, then loads the judge at a bounded 8K context. This prevents the judge from competing with test models for RAM, and avoids the "insufficient system resources" error that occurs when LM Studio tries to JIT-load a large model at its full default context while another model is still resident. If the judge still fails to load, affected responses are marked **pending** for manual review rather than silently counting as incorrect. The judge is unloaded when grading finishes.
4. **Ollama** — unloaded after each model via `keep_alive: 0`; context length is honored per-request via `num_ctx`.
5. **llama.cpp / vLLM / mlx-lm** — these servers are single-model and fixed at launch; nothing to manage. Set context length via `-c` / `--max-model-len` / server flags when starting the server.

If a model **fails to load** (e.g. the requested context doesn't fit in RAM), it's marked **crashed** with the error message and the run continues with the next model.

> **LM Studio API token:** if your LM Studio instance requires authentication, set `LMSTUDIO_API_TOKEN=<token>` in your environment before running.

---

## Context length caveats

The context length you request isn't always honored — it depends on the provider:

| Provider         | Context length honored? | How                                                                    |
|------------------|-------------------------|------------------------------------------------------------------------|
| LM Studio 0.4.0+ | ✅ Yes                   | Passed in `POST /api/v1/models/load`; confirmed from the load response |
| Ollama           | ✅ Yes                   | Sent as `num_ctx` on every request                                     |
| llama.cpp        | ⚠️ Launch-time only     | Set with `-c` when starting `llama-server`; read from `/props`         |
| vLLM             | ⚠️ Launch-time only     | Set with `--max-model-len`; reported via `/v1/models`                  |
| mlx-lm           | ⚠️ Launch-time only     | Configured when starting `mlx_lm.server`                               |

Reports always show the **loaded** context when detectable, falling back to the requested value — so cross-run comparisons stay honest. A ⚠ icon in the Rankings table flags any model where the loaded context was capped below what you requested.

---

## Speed measurement

tok/s (tokens per second) and TTFT (time to first token) are measured per response using server-reported token counts where available (`usage` on OpenAI-compatible streams, `eval_count`/`eval_duration` on Ollama), and estimated from response length otherwise.

The web UI's **Speed scale reference** table (collapsible, in the run Rankings section) maps median tok/s to plain-English labels:

| Label          | tok/s range | Example hardware                          |
|----------------|-------------|-------------------------------------------|
| Painfully Slow | 0–1         | —                                         |
| Very Slow      | 1–5         | CPU-only (old i7), no GPU                 |
| Slow           | 5–15        | CPU Ryzen, integrated GPU                 |
| Usable         | 15–25       | iPhone/iPad LLM, budget GPU               |
| Responsive     | 25–40       | RTX 3070/4070, M2 MacBook Pro             |
| Fast           | 40–60       | RTX 4090, M3/M4 MacBook Pro, M4 Max 32 GB |
| Very Fast      | 60–100      | Mac Studio M4 Max 128 GB, server GPU      |
| Stupid Fast    | 100–200     | A100, H100, Groq LPU                      |
| Extremely Fast | 200+        | A100/H100 clusters, Groq 8B (750+ tok/s)  |

The Rankings table also shows **peak tok/s**, **±σ** (standard deviation across all trials), **average tokens per question**, and **average time per question**.

---

## Run configuration options

| Option         | Default | Description                                                                               |
|----------------|---------|-------------------------------------------------------------------------------------------|
| `trials`       | 1       | How many times each question is asked per model. 3 recommended — scored by majority vote. |
| `temperature`  | 0       | Sampling temperature. 0 = deterministic (best for benchmarking).                          |
| `topP`         | —       | Nucleus sampling cutoff. Leave unset unless you have a specific reason to change it.      |
| `seed`         | —       | Random seed for reproducibility (provider support varies).                                |
| `maxTokens`    | 4096    | Maximum tokens the model can generate per response.                                       |
| `timeoutMs`    | 300000  | Per-request timeout in milliseconds (5 minutes).                                          |
| `manageModels` | true    | Whether to unload/load models automatically between tests.                                |

---

## Project layout

```
cli.ts               interactive CLI (scan / run / report / list / grade / questions / serve)
server.ts            Bun HTTP server — REST API + serves web/dist
src/
  db.ts              SQLite schema and queries (machines, runs, run_models, responses, grades)
  sysinfo.ts         hardware detection (Apple Silicon P/E cores + GPU, Linux + nvidia-smi)
  types.ts           shared TypeScript types
  providers/         one adapter per inference server + shared OpenAI-compatible streaming
  grader.ts          answer extraction, auto-match rules, judge fallback
  runner.ts          orchestration: models × questions × trials, lifecycle, cancellation
  report/            score aggregation, markdown + self-contained HTML reports
questions/           question set JSON files (default, variants)
web/                 Svelte 5 + Tailwind 4 web UI (built to web/dist by bun run setup)
test/smoke.ts        end-to-end smoke test against a mock provider
reports/             generated reports (created on first run, git-ignored)
bench.db             SQLite database (created automatically, git-ignored)
```

---

## Development

```bash
bun run serve        # API + UI at http://localhost:4400
bun run web:dev      # Vite dev server with hot reload (proxies /api/* to :4400)
bun run typecheck    # TypeScript typecheck (backend)
bun run smoke        # end-to-end smoke test against a mock provider
bun run setup        # (re-)install all deps and rebuild the web UI
```

The smoke test spins up a mock LM Studio server, runs a full benchmark with two test models and a judge, and asserts scoring, model lifecycle order, judge context, and question set CRUD — no real inference server required.


## How You Can Help

Ok, so this is just for funzies right now. If you have any ideas or want to contribute, please do so! I'm open to suggestions and improvements. Throw a PR my way or an issue if you have any ideas.


## Licensing

This project is licensed under the MIT License. Do whatever you want with it, I just don't accept any liability for any damages that may occur as a result of using this software. And maybe throw some credit my way if you use it. That would be lovely, thank you!
