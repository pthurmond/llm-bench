import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { MatchRule, Question, QuestionSet } from "./types";

const QUESTIONS_DIR = join(import.meta.dir, "..", "questions");

const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;
const CATEGORIES = ["logic", "code", "math"];

export function questionSetPath(name: string): string {
  if (!NAME_RE.test(name)) throw new Error("Set name must be 1-40 chars: letters, digits, - or _");
  return join(QUESTIONS_DIR, `${name}.json`);
}

export function listQuestionSets(): string[] {
  return readdirSync(QUESTIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export async function loadQuestionSet(name: string): Promise<QuestionSet> {
  const file = Bun.file(questionSetPath(name));
  if (!(await file.exists())) {
    throw new Error(
      `Question set "${name}" not found. Available: ${listQuestionSets().join(", ")}`,
    );
  }
  const set = (await file.json()) as QuestionSet;
  if (!set.questions?.length) throw new Error(`Question set "${name}" is empty.`);
  return set;
}

function validateMatch(m: MatchRule | undefined, qid: string, errors: string[]) {
  if (!m || typeof m !== "object" || !("type" in m)) {
    errors.push(`${qid}: missing match rule`);
    return;
  }
  switch (m.type) {
    case "number":
      if (typeof m.expected !== "number" || Number.isNaN(m.expected))
        errors.push(`${qid}: number rule needs a numeric "expected"`);
      break;
    case "fraction":
      if (!/^-?\d+\s*\/\s*\d+$/.test(m.expected ?? ""))
        errors.push(`${qid}: fraction rule needs "expected" like "2/9"`);
      break;
    case "list":
      if (!Array.isArray(m.expected) || m.expected.length === 0 || m.expected.some((n) => typeof n !== "number"))
        errors.push(`${qid}: list rule needs a non-empty numeric "expected" array`);
      break;
    case "text":
      if (!Array.isArray(m.accept) || m.accept.length === 0 || m.accept.some((s) => !s?.trim()))
        errors.push(`${qid}: text rule needs a non-empty "accept" list`);
      break;
    case "keyword_all":
    case "keyword_any":
      if (!Array.isArray(m.keywords) || m.keywords.length === 0 || m.keywords.some((s) => !s?.trim()))
        errors.push(`${qid}: ${m.type} rule needs a non-empty "keywords" list`);
      break;
    case "judge":
      break;
    default:
      errors.push(`${qid}: unknown match type "${(m as any).type}"`);
  }
}

/** Returns a list of human-readable problems; empty list means valid. */
export function validateQuestionSet(set: QuestionSet): string[] {
  const errors: string[] = [];
  if (!set?.name || !NAME_RE.test(set.name)) errors.push("Set name must be 1-40 chars: letters, digits, - or _");
  if (!Array.isArray(set?.questions) || set.questions.length === 0) {
    errors.push("A set needs at least one question");
    return errors;
  }
  const seen = new Set<string>();
  for (const [i, q] of set.questions.entries()) {
    const label = q?.qid?.trim() || `question #${i + 1}`;
    if (!q?.qid?.trim()) errors.push(`${label}: missing qid`);
    else if (/[|\s]/.test(q.qid)) errors.push(`${label}: qid may not contain spaces or "|"`);
    else if (seen.has(q.qid)) errors.push(`${label}: duplicate qid`);
    seen.add(q?.qid ?? "");
    if (!CATEGORIES.includes(q?.category)) errors.push(`${label}: category must be one of ${CATEGORIES.join(", ")}`);
    if (!q?.text?.trim()) errors.push(`${label}: question text is empty`);
    if (!q?.answer?.trim()) errors.push(`${label}: answer-key entry is empty`);
    validateMatch(q?.match, label, errors);
  }
  return errors;
}

/** Validate and write a set to disk. Throws with all problems on failure. */
export async function saveQuestionSet(name: string, set: QuestionSet): Promise<void> {
  set.name = name;
  const errors = validateQuestionSet(set);
  if (errors.length) throw new Error(errors.join("; "));
  await Bun.write(questionSetPath(name), JSON.stringify(set, null, 2) + "\n");
}

/** Create a new set, optionally duplicating an existing one. */
export async function createQuestionSet(name: string, copyFrom?: string): Promise<QuestionSet> {
  const path = questionSetPath(name);
  if (await Bun.file(path).exists()) throw new Error(`Set "${name}" already exists`);
  const blank: Question = {
    qid: "Q1",
    category: "logic",
    text: "",
    answer: "",
    match: { type: "judge" },
  };
  const set: QuestionSet = copyFrom
    ? { ...(await loadQuestionSet(copyFrom)), name, description: `Copy of ${copyFrom}` }
    : { name, description: "", questions: [blank] };
  // Skip validation for fresh blanks — they're meant to be filled in via the editor.
  await Bun.write(path, JSON.stringify(set, null, 2) + "\n");
  return set;
}

export async function deleteQuestionSet(name: string): Promise<void> {
  const path = questionSetPath(name);
  if (!(await Bun.file(path).exists())) throw new Error(`Set "${name}" not found`);
  unlinkSync(path);
}
