import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { scanProviders } from "./src/providers";
import { detectMachine } from "./src/sysinfo";
import { prepareRun, executeRun, cancelRun, type ProgressEvent } from "./src/runner";
import {
  createQuestionSet,
  deleteQuestionSet,
  listQuestionSets,
  loadQuestionSet,
  saveQuestionSet,
  validateQuestionSet,
} from "./src/questions";
import { markdownReport } from "./src/report/markdown";
import { htmlReport } from "./src/report/html";
import { summarizeRun } from "./src/report/score";
import { db, listRuns, getRun, getProgress, setGrade } from "./src/db";
import type { RunConfig } from "./src/types";

const PORT = Number(process.env.PORT ?? 4400);
const WEB_DIST = join(import.meta.dir, "web", "dist");

// Latest progress event per running run, for cheap polling.
const liveProgress = new Map<number, ProgressEvent>();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      /* ------------------------------- API ------------------------------- */
      if (path === "/api/machine") {
        return json(await detectMachine());
      }

      if (path === "/api/scan") {
        const overrides = Object.fromEntries(url.searchParams.entries());
        return json(await scanProviders(overrides));
      }

      if (path === "/api/question-sets" && req.method === "GET") {
        const sets = await Promise.all(
          listQuestionSets().map(async (name) => {
            const s = await loadQuestionSet(name);
            return {
              name,
              description: s.description,
              count: s.questions.length,
              valid: validateQuestionSet(s).length === 0,
            };
          }),
        );
        return json(sets);
      }

      if (path === "/api/question-sets" && req.method === "POST") {
        const { name, copyFrom } = (await req.json()) as { name?: string; copyFrom?: string };
        if (!name) return json({ error: "name required" }, 400);
        return json(await createQuestionSet(name, copyFrom));
      }

      const setMatch = path.match(/^\/api\/question-sets\/([A-Za-z0-9_-]{1,40})$/);
      if (setMatch) {
        const name = setMatch[1];
        if (req.method === "GET") return json(await loadQuestionSet(name));
        if (req.method === "PUT") {
          const set = (await req.json()) as any;
          const problems = validateQuestionSet({ ...set, name });
          if (problems.length) return json({ error: "validation failed", problems }, 422);
          await saveQuestionSet(name, set);
          return json({ ok: true });
        }
        if (req.method === "DELETE") {
          await deleteQuestionSet(name);
          return json({ ok: true });
        }
      }

      if (path === "/api/runs" && req.method === "GET") {
        return json(listRuns());
      }

      if (path === "/api/runs" && req.method === "POST") {
        const cfg = (await req.json()) as RunConfig;
        if (!cfg.models?.length) return json({ error: "no models selected" }, 400);
        cfg.label ||= `${cfg.questionSet} run`;
        cfg.trials = Math.max(1, cfg.trials ?? 1);
        cfg.temperature ??= 0;
        cfg.maxTokens ??= 4096;
        cfg.timeoutMs ??= 300_000;
        cfg.manageModels ??= true;
        const runId = await prepareRun(cfg);
        // Fire and forget; progress is polled.
        executeRun(runId, (e) => liveProgress.set(runId, e))
          .catch((err) => console.error(`run ${runId} failed:`, err))
          .finally(() => setTimeout(() => liveProgress.delete(runId), 60_000));
        return json({ runId });
      }

      const runMatch = path.match(/^\/api\/runs\/(\d+)(\/.*)?$/);
      if (runMatch) {
        const runId = Number(runMatch[1]);
        const sub = runMatch[2] ?? "";
        const run = getRun(runId);
        if (!run) return json({ error: "not found" }, 404);

        if (sub === "" && req.method === "GET") {
          return json({ run, progress: getProgress(runId), live: liveProgress.get(runId) ?? null });
        }
        if (sub === "/cancel" && req.method === "POST") {
          cancelRun(runId);
          return json({ ok: true });
        }
        if (sub === "/summary") {
          const s = summarizeRun(runId);
          return json({
            ...s,
            models: s.models.map((m) => ({ ...m, outcomes: Object.fromEntries(m.outcomes) })),
          });
        }
        if (sub === "/report.md") {
          mkdirSync("reports", { recursive: true });
          const md = markdownReport(runId);
          await Bun.write(join("reports", `run-${runId}.md`), md);
          return new Response(md, {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Content-Disposition": `attachment; filename="run-${runId}.md"`,
            },
          });
        }
        if (sub === "/report.html") {
          mkdirSync("reports", { recursive: true });
          const html = htmlReport(runId);
          await Bun.write(join("reports", `run-${runId}.html`), html);
          return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        if (sub === "/responses") {
          const rows = db
            .query(
              `SELECT resp.id, resp.qid, resp.trial, resp.response, resp.extracted_answer,
                      resp.ttft_ms, resp.total_ms, resp.completion_tokens, resp.tok_per_sec, resp.error,
                      g.verdict, g.method, g.detail,
                      rm.model_id, rm.provider, rm.requested_context, rm.loaded_context
               FROM responses resp
               JOIN run_models rm ON rm.id = resp.run_model_id
               LEFT JOIN grades g ON g.response_id = resp.id
               WHERE rm.run_id = ?
               ORDER BY rm.id, resp.qid, resp.trial`,
            )
            .all(runId) as any[];
          const byQid = new Map<string, { text: string; answer: string; category: string }>(
            (JSON.parse(run.questions_json) as { qid: string; text: string; answer: string; category: string }[]).map(
              (q) => [q.qid, { text: q.text, answer: q.answer, category: q.category }],
            ),
          );
          return json(
            rows.map((r) => ({
              ...r,
              question_text: byQid.get(r.qid)?.text ?? null,
              expected_answer: byQid.get(r.qid)?.answer ?? null,
              question_category: byQid.get(r.qid)?.category ?? null,
            })),
          );
        }
        if (sub === "/pending") {
          const rows = db
            .query(
              `SELECT resp.id, resp.qid, resp.response, resp.extracted_answer, rm.model_id
               FROM responses resp
               JOIN run_models rm ON rm.id = resp.run_model_id
               JOIN grades g ON g.response_id = resp.id
               WHERE rm.run_id = ? AND g.method = 'pending' ORDER BY rm.id, resp.qid`,
            )
            .all(runId) as any[];
          // Attach the question text + answer key from the run's snapshot,
          // so reviewers can grade without leaving the page.
          const byQid = new Map<string, { text: string; answer: string }>(
            (JSON.parse(run.questions_json) as { qid: string; text: string; answer: string }[]).map(
              (q) => [q.qid, { text: q.text, answer: q.answer }],
            ),
          );
          return json(
            rows.map((r) => ({
              ...r,
              question_text: byQid.get(r.qid)?.text ?? null,
              expected_answer: byQid.get(r.qid)?.answer ?? null,
            })),
          );
        }
      }

      if (path === "/api/grade" && req.method === "POST") {
        const { responseId, verdict } = (await req.json()) as {
          responseId?: number;
          verdict?: string;
        };
        if (
          typeof responseId !== "number" ||
          (verdict !== "correct" && verdict !== "incorrect")
        ) {
          return json({ error: "responseId and verdict (correct|incorrect) required" }, 400);
        }
        setGrade(responseId, verdict, "manual");
        return json({ ok: true });
      }

      /* ---------------------------- static UI ---------------------------- */
      if (existsSync(WEB_DIST)) {
        const filePath = path === "/" ? "/index.html" : path;
        const file = Bun.file(join(WEB_DIST, filePath));
        if (await file.exists()) return new Response(file);
        // SPA fallback
        return new Response(Bun.file(join(WEB_DIST, "index.html")));
      }
      return new Response(
        "Web UI not built yet. Run: cd web && bun install && bun run build\nAPI is live under /api/*",
        { status: 200 },
      );
    } catch (e: any) {
      console.error(e);
      return json({ error: String(e?.message ?? e) }, 500);
    }
  },
});

console.log(`llm-bench server → http://localhost:${PORT}`);
