import type { JudgeConfig, MatchRule, Question, Verdict } from "./types";
import { providers } from "./providers";

/** Strip reasoning blocks emitted by thinking models before grading. */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
}

/**
 * Models are prompted to end with "FINAL ANSWER: ...". Extract that line;
 * fall back to the last non-empty line.
 */
export function extractAnswer(raw: string): string {
  const text = stripThinking(raw);
  const matches = [...text.matchAll(/final\s*answer\s*[:\-]\s*(.+)/gi)];
  if (matches.length > 0) return matches[matches.length - 1][1].trim();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[*_`$\\]/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const squash = (s: string) => norm(s).replace(/[\s,]/g, "");

function parseNumbers(s: string): number[] {
  return [...norm(s).matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

function parseNumeric(s: string): number | null {
  const n = norm(s);
  const frac = n.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const nums = parseNumbers(n);
  return nums.length > 0 ? nums[nums.length - 1] : null;
}

/**
 * Try to grade automatically. Returns a verdict, or null when the rule
 * can't decide confidently (→ judge fallback).
 */
export function autoGrade(rule: MatchRule, extracted: string, fullText: string): Verdict | null {
  const ex = extracted || fullText;
  switch (rule.type) {
    case "judge":
      return null;
    case "number": {
      const got = parseNumeric(ex);
      if (got === null) return null;
      const tol = rule.tolerance ?? 1e-6;
      return Math.abs(got - rule.expected) <= tol ? "correct" : "incorrect";
    }
    case "fraction": {
      const [a, b] = rule.expected.split("/").map(Number);
      const expected = a / b;
      if (squash(ex).includes(squash(rule.expected))) return "correct";
      const got = parseNumeric(ex);
      if (got === null) return null;
      return Math.abs(got - expected) <= 0.001 ? "correct" : "incorrect";
    }
    case "list": {
      const got = parseNumbers(ex);
      if (got.length === 0) return null;
      const ok =
        got.length === rule.expected.length &&
        got.every((n, i) => n === rule.expected[i]);
      return ok ? "correct" : "incorrect";
    }
    case "text": {
      const s = squash(ex);
      return rule.accept.some((a) => s.includes(squash(a)))
        ? "correct"
        : null; // a miss may just be unusual formatting — let the judge decide
    }
    case "keyword_all": {
      const s = norm(stripThinking(fullText));
      return rule.keywords.every((k) => s.includes(norm(k))) ? "correct" : null;
    }
    case "keyword_any": {
      const s = norm(stripThinking(fullText));
      return rule.keywords.some((k) => s.includes(norm(k))) ? "correct" : null;
    }
  }
}

export interface JudgeOutcome {
  verdict: Verdict;
  reason: string;
}

const JUDGE_SYSTEM =
  "You are a strict grader. Compare a model's answer to the answer key. " +
  "Judge correctness of substance only — ignore formatting, verbosity, and phrasing. " +
  'Reply with ONLY a JSON object: {"verdict": "correct" | "incorrect", "reason": "<one sentence>"}';

export async function judgeGrade(
  judge: JudgeConfig,
  question: Question,
  responseText: string,
  timeoutMs: number,
  cancelSignal?: AbortSignal,
): Promise<JudgeOutcome> {
  const provider = providers[judge.provider];
  if (!provider) return { verdict: "error", reason: `unknown judge provider ${judge.provider}` };

  const prompt = [
    `QUESTION:\n${question.text}`,
    `ANSWER KEY:\n${question.answer}`,
    `MODEL'S ANSWER:\n${stripThinking(responseText).slice(0, 6000)}`,
    `Is the model's answer correct?`,
  ].join("\n\n");

  const res = await provider.chat({
    baseUrl: judge.baseUrl,
    modelId: judge.modelId,
    system: JUDGE_SYSTEM,
    prompt,
    temperature: 0,
    maxTokens: 1024,
    timeoutMs,
    cancelSignal,
  });
  if (res.error) return { verdict: "error", reason: `judge failed: ${res.error}` };

  const text = stripThinking(res.text);

  // Fast path: judge replied with only JSON (most common when model follows instructions).
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed.verdict === "correct" || parsed.verdict === "incorrect") {
      return { verdict: parsed.verdict, reason: parsed.reason ?? "" };
    }
  } catch { /* fall through */ }

  // Scan all flat {…} candidates in the text. This handles models that emit
  // reasoning text before the JSON — including when earlier {…} tokens appear
  // in that reasoning (which trips up a single non-greedy match).
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    try {
      const parsed = JSON.parse(m[0]);
      if (parsed.verdict === "correct" || parsed.verdict === "incorrect") {
        return { verdict: parsed.verdict, reason: parsed.reason ?? "" };
      }
    } catch { /* fall through */ }
  }

  // Lenient fallback if the judge didn't emit clean JSON
  const lower = text.toLowerCase();
  if (/\bincorrect\b/.test(lower)) return { verdict: "incorrect", reason: text.slice(0, 200) };
  if (/\bcorrect\b/.test(lower)) return { verdict: "correct", reason: text.slice(0, 200) };
  return { verdict: "error", reason: `unparseable judge output: ${text.slice(0, 200)}` };
}
