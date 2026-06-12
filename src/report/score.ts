import type { Question } from "../types";
import { getMachine, getRun, getRunResults } from "../db";
import { getSpeedTier } from "../speed-scale";

export interface QuestionOutcome {
  qid: string;
  correct: boolean;
  errored: boolean;
  trials: { verdict: string; method: string; tokPerSec: number | null; extracted: string | null; responseId: number }[];
}

export interface ModelScore {
  runModelId: number;
  provider: string;
  modelId: string;
  params: string | null;
  quant: string | null;
  format: string | null;
  requestedContext: number;
  loadedContext: number | null;
  status: string;
  error: string | null;
  total: number;
  byCategory: Record<string, { score: number; outOf: number }>;
  outcomes: Map<string, QuestionOutcome>;
  // Speed — median / peak / variance
  medianTokPerSec: number | null;
  peakTokPerSec: number | null;
  minTokPerSec: number | null;
  maxTokPerSec: number | null;
  stddevTokPerSec: number | null;
  medianTtftMs: number | null;
  // Speed tier from the rating scale
  speedBucket: string;
  speedAssessment: string;
  speedFitForPurpose: string;
  speedRange: string;
  // Token / time stats
  totalCompletionTokens: number;
  avgTokensPerQ: number | null;
  avgMsPerQ: number | null;
}

export interface RunSummary {
  run: any;
  machine: any;
  questions: Question[];
  models: ModelScore[];
  hardest: { qid: string; label: string; failed: number; of: number }[];
  pendingReview: number;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stddev(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

export function summarizeRun(runId: number): RunSummary {
  const run = getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  const machine = getMachine(run.machine_id);
  const questions: Question[] = JSON.parse(run.questions_json);
  const rows = getRunResults(runId);

  const byModel = new Map<number, ModelScore>();
  for (const r of rows) {
    if (!byModel.has(r.run_model_id)) {
      byModel.set(r.run_model_id, {
        runModelId: r.run_model_id,
        provider: r.provider,
        modelId: r.model_id,
        params: r.params,
        quant: r.quant,
        format: r.format,
        requestedContext: r.requested_context,
        loadedContext: r.loaded_context,
        status: r.model_status,
        error: r.model_error,
        total: 0,
        byCategory: {},
        outcomes: new Map(),
        medianTokPerSec: null,
        peakTokPerSec: null,
        minTokPerSec: null,
        maxTokPerSec: null,
        stddevTokPerSec: null,
        medianTtftMs: null,
        speedBucket: "n/a",
        speedAssessment: "",
        speedFitForPurpose: "",
        speedRange: "",
        totalCompletionTokens: 0,
        avgTokensPerQ: null,
        avgMsPerQ: null,
      });
    }
    const m = byModel.get(r.run_model_id)!;
    if (r.response_id == null) continue;
    if (!m.outcomes.has(r.qid)) {
      m.outcomes.set(r.qid, { qid: r.qid, correct: false, errored: false, trials: [] });
    }
    m.outcomes.get(r.qid)!.trials.push({
      verdict: r.verdict ?? "pending",
      method: r.method ?? "pending",
      tokPerSec: r.tok_per_sec,
      extracted: r.extracted_answer,
      responseId: r.response_id,
    });
  }

  let pendingReview = 0;
  const failCounts = new Map<string, number>();
  const gradedModels: ModelScore[] = [];

  for (const m of byModel.values()) {
    const speeds: number[] = [];
    const ttfts: number[] = [];
    let totalMs = 0;
    let totalMsCount = 0;

    for (const q of questions) {
      const cat = q.category;
      m.byCategory[cat] ??= { score: 0, outOf: 0 };
      m.byCategory[cat].outOf++;
      const outcome = m.outcomes.get(q.qid);
      if (!outcome) continue;
      const correctVotes = outcome.trials.filter((t) => t.verdict === "correct").length;
      const errorVotes = outcome.trials.filter((t) => t.verdict === "error").length;
      pendingReview += outcome.trials.filter((t) => t.method === "pending").length;
      outcome.correct = correctVotes > outcome.trials.length / 2;
      outcome.errored = errorVotes === outcome.trials.length;
      if (outcome.correct) {
        m.total++;
        m.byCategory[cat].score++;
      } else if (!outcome.errored) {
        failCounts.set(q.qid, (failCounts.get(q.qid) ?? 0) + 1);
      }
      for (const t of outcome.trials) if (t.tokPerSec != null) speeds.push(t.tokPerSec);
    }

    const rowsForModel = rows.filter((r) => r.run_model_id === m.runModelId && r.response_id != null);
    for (const r of rowsForModel) {
      if (r.ttft_ms != null) ttfts.push(r.ttft_ms);
      if (r.completion_tokens != null) m.totalCompletionTokens += r.completion_tokens;
      if (r.total_ms != null) { totalMs += r.total_ms; totalMsCount++; }
    }

    m.medianTokPerSec = median(speeds);
    m.peakTokPerSec = speeds.length > 0 ? Math.max(...speeds) : null;
    m.minTokPerSec = speeds.length > 0 ? Math.min(...speeds) : null;
    m.maxTokPerSec = m.peakTokPerSec;
    m.stddevTokPerSec = stddev(speeds);
    m.medianTtftMs = median(ttfts);
    m.avgTokensPerQ = rowsForModel.length > 0 ? Math.round(m.totalCompletionTokens / rowsForModel.length) : null;
    m.avgMsPerQ = totalMsCount > 0 ? Math.round(totalMs / totalMsCount) : null;

    if (m.status === "crashed") {
      m.speedBucket = "failed";
      m.speedAssessment = "";
      m.speedFitForPurpose = "";
      m.speedRange = "";
    } else if (m.medianTokPerSec === null) {
      m.speedBucket = "n/a";
      m.speedAssessment = "";
      m.speedFitForPurpose = "";
      m.speedRange = "";
    } else {
      const tier = getSpeedTier(m.medianTokPerSec);
      m.speedBucket = tier.label;
      m.speedAssessment = tier.assessment;
      m.speedFitForPurpose = tier.fitForPurpose;
      m.speedRange = tier.maxTokensPerSecond === Infinity
        ? `${tier.minTokensPerSecond}+ tok/s`
        : `${tier.minTokensPerSecond}–${tier.maxTokensPerSecond} tok/s`;
    }

    gradedModels.push(m);
  }

  gradedModels.sort((a, b) => {
    if (a.status === "crashed" && b.status !== "crashed") return 1;
    if (b.status === "crashed" && a.status !== "crashed") return -1;
    if (b.total !== a.total) return b.total - a.total;
    return (b.medianTokPerSec ?? 0) - (a.medianTokPerSec ?? 0);
  });

  const completedCount = gradedModels.filter((m) => m.status !== "crashed").length;
  const hardest = [...failCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([qid, failed]) => ({
      qid,
      label: questions.find((q) => q.qid === qid)?.text.split("\n")[0].slice(0, 60) ?? qid,
      failed,
      of: completedCount,
    }));

  return { run, machine, questions, models: gradedModels, hardest, pendingReview };
}

/** "26B MoE (A4B)" → active params in B for score-per-B math. */
export function activeParamsB(params: string | null): number | null {
  if (!params) return null;
  const active = params.match(/A(\d+(?:\.\d+)?)B/i);
  if (active) return Number(active[1]);
  const main = params.match(/(\d+(?:\.\d+)?)B/i);
  return main ? Number(main[1]) : null;
}
