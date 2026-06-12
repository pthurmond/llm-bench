import type { Question, RunConfig } from "./types";
import {
  createRun,
  getRun,
  getRunModels,
  insertResponse,
  setGrade,
  setRunModelStatus,
  setRunStatus,
  upsertMachine,
} from "./db";
import { detectMachine } from "./sysinfo";
import { loadQuestionSet, validateQuestionSet } from "./questions";
import { providers } from "./providers";
import { autoGrade, extractAnswer, judgeGrade } from "./grader";

/** Context the judge is loaded at — judge prompts are small, so this stays cheap. */
const JUDGE_CONTEXT = 8192;

const SYSTEM_PROMPT =
  "You are taking a timed reasoning test. Answer the question accurately. " +
  "You may reason briefly, but you MUST end your reply with a single line of the exact form:\n" +
  "FINAL ANSWER: <your concise answer>";

export interface ProgressEvent {
  runId: number;
  modelId: string;
  provider: string;
  qid: string;
  trial: number;
  totalSteps: number;
  step: number;
  verdict?: string;
  tokPerSec?: number | null;
  error?: string;
}

export type ProgressFn = (e: ProgressEvent) => void;

/** Create a run row (+ machine + question snapshot) without starting it. */
export async function prepareRun(cfg: RunConfig): Promise<number> {
  const machine = await detectMachine();
  const machineId = upsertMachine(machine);
  const set = await loadQuestionSet(cfg.questionSet);
  const problems = validateQuestionSet(set);
  if (problems.length) {
    throw new Error(`Question set "${cfg.questionSet}" has problems: ${problems.join("; ")}`);
  }
  return createRun(machineId, cfg, JSON.stringify(set.questions));
}

const cancelled = new Set<number>();
const runControllers = new Map<number, AbortController>();

export function cancelRun(runId: number) {
  cancelled.add(runId);
  runControllers.get(runId)?.abort();
}

/** Execute a prepared run. Models run sequentially to avoid memory contention. */
export async function executeRun(runId: number, onProgress?: ProgressFn) {
  const run = getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  const questions: Question[] = JSON.parse(run.questions_json);
  const models = getRunModels(runId);
  const judge =
    run.judge_provider && run.judge_model
      ? {
          provider: run.judge_provider,
          baseUrl: run.judge_base_url,
          modelId: run.judge_model,
        }
      : null;

  const totalSteps = models.length * questions.length * run.trials;
  let step = 0;
  setRunStatus(runId, "running");

  const controller = new AbortController();
  runControllers.set(runId, controller);
  const cancelSignal = controller.signal;
  const manage = run.manage_models !== 0;
  // Judge calls are deferred until ALL models have been tested and unloaded,
  // so the judge never competes with any model under test for memory.
  const judgeQueue: {
    responseId: number;
    question: Question;
    text: string;
    modelId: string;
    provider: string;
  }[] = [];

  try {
    for (const m of models) {
      if (cancelled.has(runId)) break;
      const provider = providers[m.provider];
      if (!provider) {
        setRunModelStatus(m.id, "skipped", `unknown provider ${m.provider}`);
        continue;
      }
      setRunModelStatus(m.id, "running");

      // ---- prepare: free the previous model's memory, load this one ----
      let instanceId = m.model_id;
      let loadedCtx: number | null = null;
      let prepareWarning: string | undefined;
      if (manage && provider.prepare) {
        try {
          const prep = await provider.prepare(m.base_url, m.model_id, m.requested_context);
          instanceId = prep.instanceId ?? m.model_id;
          loadedCtx = prep.loadedContext ?? null;
          prepareWarning = prep.warning;
        } catch (e: any) {
          // Loading failed outright (OOM, missing model, …) — record and skip.
          setRunModelStatus(m.id, "crashed", `load failed: ${String(e?.message ?? e)}`);
          step += questions.length * run.trials;
          onProgress?.({
            runId, modelId: m.model_id, provider: m.provider,
            qid: "-", trial: 0, totalSteps, step,
            error: `load failed: ${String(e?.message ?? e)}`,
          });
          continue;
        }
      }
      if (loadedCtx === null && provider.loadedContext) {
        loadedCtx = await provider.loadedContext(m.base_url, m.model_id).catch(() => null);
      }
      if (m.provider === "ollama") loadedCtx = m.requested_context; // num_ctx is honored per-request

      let consecutiveErrors = 0;
      let crashed = false;

      for (const q of questions) {
        if (cancelled.has(runId) || crashed) break;
        for (let trial = 1; trial <= run.trials; trial++) {
          if (cancelled.has(runId)) break;
          step++;
          const res = await provider.chat({
            baseUrl: m.base_url,
            modelId: m.model_id,
            system: SYSTEM_PROMPT,
            prompt: q.text,
            temperature: run.temperature,
            topP: run.top_p ?? undefined,
            seed: run.seed ?? undefined,
            maxTokens: run.max_tokens,
            timeoutMs: run.timeout_ms,
            context: m.requested_context,
            cancelSignal,
          });

          const extracted = res.error ? null : extractAnswer(res.text);
          const responseId = insertResponse({
            runModelId: m.id,
            qid: q.qid,
            trial,
            response: res.text || null,
            extractedAnswer: extracted,
            ttftMs: res.ttftMs,
            totalMs: res.totalMs,
            completionTokens: res.completionTokens,
            tokPerSec: res.tokPerSec,
            error: res.error ?? null,
          });

          let verdict: string;
          if (res.error) {
            verdict = "error";
            setGrade(responseId, "error", "auto", res.error);
            consecutiveErrors++;
            if (consecutiveErrors >= 3) {
              crashed = true;
              setRunModelStatus(m.id, "crashed", `3 consecutive errors; last: ${res.error}`);
            }
          } else {
            consecutiveErrors = 0;
            const auto = autoGrade(q.match, extracted ?? "", res.text);
            if (auto !== null) {
              verdict = auto;
              setGrade(responseId, auto, "auto");
            } else if (judge) {
              verdict = "queued";
              setGrade(responseId, "incorrect", "pending", "awaiting judge");
              judgeQueue.push({
                responseId,
                question: q,
                text: res.text,
                modelId: m.model_id,
                provider: m.provider,
              });
            } else {
              verdict = "pending";
              setGrade(responseId, "incorrect", "pending", "needs manual review");
            }
          }

          onProgress?.({
            runId,
            modelId: m.model_id,
            provider: m.provider,
            qid: q.qid,
            trial,
            totalSteps,
            step,
            verdict,
            tokPerSec: res.tokPerSec,
            error: res.error,
          });
        }
      }
      if (!crashed) {
        setRunModelStatus(m.id, "done", prepareWarning, loadedCtx ?? undefined);
      }

      // ---- cleanup: unload this model BEFORE the next load ----
      if (manage && provider.cleanup) {
        await provider.cleanup(m.base_url, instanceId).catch((e) =>
          console.error(`cleanup failed for ${m.model_id}:`, e),
        );
      }
    }

    // ---- deferred judge pass: AFTER all models are tested and unloaded ----
    if (judge && judgeQueue.length > 0 && !cancelled.has(runId)) {
      const jp = providers[judge.provider];
      let judgeInstanceId = judge.modelId;
      let judgeLoadFailed: string | null = null;

      // Explicitly free whatever is still resident (the last test model, or
      // anything loaded outside the run), then load the judge at a bounded
      // context — JIT-loading a big judge at its full default context is what
      // triggers "insufficient system resources" guardrail failures.
      if (jp?.prepare) {
        try {
          const prep = await jp.prepare(judge.baseUrl, judge.modelId, JUDGE_CONTEXT);
          judgeInstanceId = prep.instanceId ?? judge.modelId;
        } catch (e: any) {
          judgeLoadFailed = `judge load failed: ${String(e?.message ?? e)}`;
          console.error(judgeLoadFailed);
        }
      }

      for (const item of judgeQueue) {
        if (cancelled.has(runId)) break;
        if (judgeLoadFailed) {
          // Leave these as pending so they show up for manual review.
          setGrade(item.responseId, "incorrect", "pending", judgeLoadFailed);
          onProgress?.({
            runId,
            modelId: item.modelId,
            provider: item.provider,
            qid: item.question.qid,
            trial: 0, // 0 marks a judge event, not a new response
            totalSteps,
            step,
            verdict: "pending",
          });
          continue;
        }
        const j = await judgeGrade(judge, item.question, item.text, run.timeout_ms, cancelSignal);
        setGrade(
          item.responseId,
          j.verdict,
          j.verdict === "error" ? "pending" : "judge",
          j.reason,
        );
        onProgress?.({
          runId,
          modelId: item.modelId,
          provider: item.provider,
          qid: item.question.qid,
          trial: 0, // 0 marks a judge event, not a new response
          totalSteps,
          step,
          verdict: j.verdict === "error" ? "pending" : `judge:${j.verdict}`,
        });
      }

      // Free the judge's memory once grading is finished.
      if (!judgeLoadFailed && jp?.cleanup) {
        await jp.cleanup(judge.baseUrl, judgeInstanceId).catch(() => {});
      }
    }

    setRunStatus(runId, cancelled.has(runId) ? "cancelled" : "done");
  } catch (e) {
    setRunStatus(runId, "failed");
    throw e;
  } finally {
    cancelled.delete(runId);
    runControllers.delete(runId);
  }
}
