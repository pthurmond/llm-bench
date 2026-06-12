export interface ModelInfo {
  id: string;
  displayName?: string;
  params?: string;
  quant?: string;
  format?: string;
  maxContext?: number;
  state?: string;
}

export interface ScanResult {
  provider: string;
  label: string;
  baseUrl: string;
  reachable: boolean;
  models: ModelInfo[];
}

export interface Machine {
  hostname: string;
  os: string;
  arch: string;
  chip: string;
  cpuCores: number;
  perfCores?: number;
  effCores?: number;
  gpu?: string;
  gpuCores?: number;
  ramGb: number;
}

export interface QuestionSetMeta {
  name: string;
  description?: string;
  count: number;
  valid?: boolean;
}

export interface Question {
  qid: string;
  category: "logic" | "code" | "math";
  text: string;
  answer: string;
  match: any;
}

export interface QuestionSet {
  name: string;
  description?: string;
  questions: Question[];
}

export interface RunRow {
  id: number;
  label: string;
  status: string;
  question_set: string;
  trials: number;
  created_at: string;
  hostname: string;
  chip: string;
  model_count: number;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export const api = {
  machine: () => j<Machine>("/api/machine"),
  scan: (overrides: Record<string, string> = {}) =>
    j<ScanResult[]>(`/api/scan?${new URLSearchParams(overrides)}`),
  questionSets: () => j<QuestionSetMeta[]>("/api/question-sets"),
  questionSet: (name: string) => j<QuestionSet>(`/api/question-sets/${name}`),
  saveQuestionSet: (name: string, set: QuestionSet) =>
    j<any>(`/api/question-sets/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(set),
    }),
  createQuestionSet: (name: string, copyFrom?: string) =>
    j<QuestionSet>("/api/question-sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, copyFrom }),
    }),
  deleteQuestionSet: (name: string) =>
    j<any>(`/api/question-sets/${name}`, { method: "DELETE" }),
  runs: () => j<RunRow[]>("/api/runs"),
  startRun: (cfg: unknown) =>
    j<{ runId: number }>("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    }),
  runStatus: (id: number) => j<any>(`/api/runs/${id}`),
  runSummary: (id: number) => j<any>(`/api/runs/${id}/summary`),
  runPending: (id: number) => j<any[]>(`/api/runs/${id}/pending`),
  runResponses: (id: number) => j<any[]>(`/api/runs/${id}/responses`),
  cancel: (id: number) => j<any>(`/api/runs/${id}/cancel`, { method: "POST" }),
  grade: (responseId: number, verdict: "correct" | "incorrect") =>
    j<any>("/api/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responseId, verdict }),
    }),
};
