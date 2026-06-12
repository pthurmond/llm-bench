import type { ChatResult, ModelInfo } from "../types";

export interface ChatOptions {
  baseUrl: string;
  modelId: string;
  system?: string;
  prompt: string;
  temperature: number;
  topP?: number;
  seed?: number;
  maxTokens: number;
  timeoutMs: number;
  context?: number; // honored where the provider supports per-request context
  cancelSignal?: AbortSignal;
}

export interface PrepareResult {
  /** Identifier to pass back to cleanup() (LM Studio instance_id). */
  instanceId?: string;
  /** Context length actually applied at load, when the provider reports it. */
  loadedContext?: number;
  /** Non-fatal note (e.g. fell back to JIT loading). */
  warning?: string;
}

export interface Provider {
  name: string;
  label: string;
  defaultBaseUrl: string;
  /** List models available on the server (loaded or downloadable). */
  listModels(baseUrl: string): Promise<ModelInfo[]>;
  /** Run one chat completion, measuring TTFT and throughput. */
  chat(opts: ChatOptions): Promise<ChatResult>;
  /** Best-effort: context length the model is actually loaded with. */
  loadedContext?(baseUrl: string, modelId: string): Promise<number | null>;
  /**
   * Called before a model is benchmarked: unload whatever is resident and
   * (where supported) load the target model at the requested context length.
   */
  prepare?(baseUrl: string, modelId: string, context: number): Promise<PrepareResult>;
  /** Called after a model finishes: free its memory. */
  cleanup?(baseUrl: string, instanceId: string): Promise<void>;
}

/**
 * Streaming chat against any OpenAI-compatible /v1/chat/completions endpoint.
 * Measures TTFT from the first content delta and prefers server-reported
 * usage (via stream_options.include_usage) for token counts; falls back to
 * a chars/4 estimate when the server doesn't report usage.
 */
export async function openAiChat(
  opts: ChatOptions,
  extraBody: Record<string, unknown> = {},
): Promise<ChatResult> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const messages = [
    ...(opts.system ? [{ role: "system", content: opts.system }] : []),
    { role: "user", content: opts.prompt },
  ];

  const makeBody = (withUsage: boolean) =>
    JSON.stringify({
      model: opts.modelId,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      ...(opts.topP != null ? { top_p: opts.topP } : {}),
      ...(opts.seed != null ? { seed: opts.seed } : {}),
      stream: true,
      ...(withUsage ? { stream_options: { include_usage: true } } : {}),
      ...extraBody,
    });

  const start = performance.now();

  function makeSignal(): AbortSignal {
    const timeout = AbortSignal.timeout(opts.timeoutMs);
    return opts.cancelSignal ? AbortSignal.any([timeout, opts.cancelSignal]) : timeout;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: makeBody(true),
      signal: makeSignal(),
    });
    // Some servers 400 on unknown stream_options — retry without it.
    if (res.status === 400) {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: makeBody(false),
        signal: makeSignal(),
      });
    }
  } catch (e: any) {
    const cancelled = opts.cancelSignal?.aborted;
    return failed(start, cancelled ? "cancelled" : e?.name === "TimeoutError" ? "timeout" : String(e));
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    return failed(start, `HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  let text = "";
  let ttftMs: number | null = null;
  let completionTokens: number | null = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        let json: any;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta =
          json?.choices?.[0]?.delta?.content ??
          json?.choices?.[0]?.text ??
          "";
        if (delta) {
          if (ttftMs === null) ttftMs = performance.now() - start;
          text += delta;
        }
        if (json?.usage?.completion_tokens != null) {
          completionTokens = json.usage.completion_tokens;
        }
      }
    }
  } catch (e: any) {
    if (!text) return failed(start, `stream error: ${String(e)}`);
    // keep partial text but flag it
  }

  const totalMs = performance.now() - start;
  const tokens = completionTokens ?? Math.max(1, Math.round(text.length / 4));
  const genMs = ttftMs != null ? totalMs - ttftMs : totalMs;
  return {
    text,
    ttftMs,
    totalMs,
    completionTokens: tokens,
    tokPerSec: genMs > 0 ? Math.round((tokens / (genMs / 1000)) * 10) / 10 : null,
  };
}

function failed(start: number, error: string): ChatResult {
  return {
    text: "",
    ttftMs: null,
    totalMs: performance.now() - start,
    completionTokens: null,
    tokPerSec: null,
    error,
  };
}

export async function fetchJson(
  url: string,
  timeoutMs = 4000,
): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Guess parameter count from a model id like "gemma-4-26b-a4b-it-qat" → "26B (A4B)". */
export function guessParams(id: string): string | undefined {
  const lower = id.toLowerCase();
  const main = lower.match(/(\d{1,3}(?:\.\d)?)b/);
  const active = lower.match(/a(\d{1,2}(?:\.\d)?)b/);
  if (!main) return undefined;
  return active && active[1] !== main[1]
    ? `${main[1].toUpperCase()}B MoE (A${active[1]}B)`
    : `${main[1].toUpperCase()}B`;
}

/** Guess quantization from a model id, e.g. "...Q4_K_M", "...-4bit", "...qat". */
export function guessQuant(id: string): string | undefined {
  const m =
    id.match(/q\d_[a-z0-9_]+/i)?.[0] ??
    id.match(/\b(\d)bit\b/i)?.[0] ??
    (/(^|[-_])qat([-_]|$)/i.test(id) ? "QAT" : undefined);
  return m?.toUpperCase();
}
