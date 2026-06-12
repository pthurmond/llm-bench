// Shared types for llm-bench

export type Category = "logic" | "code" | "math";

export type MatchRule =
  | { type: "number"; expected: number; tolerance?: number }
  | { type: "fraction"; expected: string } // e.g. "2/9" — accepts equivalent decimals
  | { type: "list"; expected: number[] } // ordered numeric list e.g. [4,16,36]
  | { type: "text"; accept: string[] } // normalized substring match, any of
  | { type: "keyword_all"; keywords: string[] }
  | { type: "keyword_any"; keywords: string[] }
  | { type: "judge" }; // no auto rule — always goes to the judge

export interface Question {
  qid: string; // stable ID, e.g. "S1"
  category: Category;
  text: string;
  answer: string; // human-readable answer key entry
  match: MatchRule;
}

export interface QuestionSet {
  name: string;
  description?: string;
  questions: Question[];
}

export interface ModelInfo {
  id: string;
  displayName?: string;
  params?: string; // e.g. "26B", "4B", "35B MoE"
  quant?: string; // e.g. "Q4_K_M", "4bit", "QAT"
  format?: string; // e.g. "gguf", "mlx", "safetensors"
  maxContext?: number; // max context the model supports / is loaded at
  state?: string; // e.g. "loaded" (LM Studio)
  sizeBytes?: number;
}

export interface ProviderRef {
  provider: string; // "lmstudio" | "ollama" | "vllm" | "llamacpp" | "mlx"
  baseUrl: string;
}

export interface ChatResult {
  text: string;
  ttftMs: number | null;
  totalMs: number;
  completionTokens: number | null;
  tokPerSec: number | null;
  error?: string;
}

export interface RunModelConfig extends ProviderRef {
  modelId: string;
  context: number; // requested context length
  params?: string;
  quant?: string;
  format?: string;
}

export interface JudgeConfig extends ProviderRef {
  modelId: string;
}

export interface RunConfig {
  label: string;
  questionSet: string;
  trials: number;
  temperature: number;
  topP?: number;
  seed?: number;
  maxTokens: number;
  timeoutMs: number;
  judge: JudgeConfig | null;
  /** Unload the previous model before loading the next (default true). */
  manageModels?: boolean;
  models: RunModelConfig[];
  notes?: string;
}

export type Verdict = "correct" | "incorrect" | "error";
export type GradeMethod = "auto" | "judge" | "manual" | "pending";

export interface MachineProfile {
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
  vramGb?: number;
}
