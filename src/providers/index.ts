import type { ModelInfo, ProviderRef } from "../types";
import {
  type Provider,
  type ChatOptions,
  openAiChat,
  fetchJson,
  guessParams,
  guessQuant,
} from "./types";

/* ----------------------------- LM Studio ----------------------------- */
// Rich metadata via the native REST API (/api/v0/models): quant, arch,
// max_context_length, loaded state. Chat via OpenAI-compatible /v1.
// Model lifecycle (LM Studio 0.4.0+): POST /api/v1/models/load with
// context_length, POST /api/v1/models/unload with instance_id. Older
// versions fall back to the `lms` CLI when the server is local.

function lmsHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.LMSTUDIO_API_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** POST to /api/v1/models/{path}. Returns null when the endpoint doesn't exist (pre-0.4.0). */
async function lmsV1(
  baseUrl: string,
  path: "load" | "unload",
  body: Record<string, unknown>,
  timeoutMs = 300_000, // big models take a while to load
): Promise<any | null> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/models/${path}`, {
    method: "POST",
    headers: lmsHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) return null; // v1 API not available
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LM Studio ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function isLocalHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host);
  } catch {
    return false;
  }
}

/** Fallback for LM Studio < 0.4.0: drive the bundled `lms` CLI (local only). */
async function lmsCli(args: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn(["lms", ...args], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false; // lms not on PATH
  }
}

async function lmstudioUnloadAll(baseUrl: string): Promise<string | undefined> {
  const rich = await fetchJson(`${baseUrl}/api/v0/models`);
  const loaded = (rich?.data ?? []).filter(
    (m: any) => m.state === "loaded" && (m.type === "llm" || m.type === "vlm"),
  );
  for (const m of loaded) {
    const res = await lmsV1(baseUrl, "unload", { instance_id: m.id }).catch(() => undefined);
    if (res === null) {
      // v1 unsupported → one CLI call clears everything
      if (isLocalHost(baseUrl) && (await lmsCli(["unload", "--all"]))) return undefined;
      return "LM Studio <0.4.0 without local `lms` CLI: cannot unload previous models automatically";
    }
  }
  return undefined;
}

const lmstudio: Provider = {
  name: "lmstudio",
  label: "LM Studio",
  defaultBaseUrl: "http://localhost:1234",
  async listModels(baseUrl) {
    const rich = await fetchJson(`${baseUrl}/api/v0/models`);
    if (rich?.data) {
      return rich.data
        .filter((m: any) => m.type === "llm" || m.type === "vlm")
        .map(
          (m: any): ModelInfo => ({
            id: m.id,
            displayName: m.display_name ?? m.id,
            params: guessParams(m.id),
            quant: m.quantization ?? guessQuant(m.id),
            format: m.format ?? (m.arch ? `${m.arch}` : undefined),
            maxContext: m.max_context_length ?? m.loaded_context_length,
            state: m.state, // "loaded" | "not-loaded"
          }),
        );
    }
    const basic = await fetchJson(`${baseUrl}/v1/models`);
    return (basic?.data ?? []).map(
      (m: any): ModelInfo => ({
        id: m.id,
        params: guessParams(m.id),
        quant: guessQuant(m.id),
      }),
    );
  },
  async loadedContext(baseUrl, modelId) {
    const rich = await fetchJson(`${baseUrl}/api/v0/models/${modelId}`);
    return rich?.loaded_context_length ?? rich?.max_context_length ?? null;
  },
  async prepare(baseUrl, modelId, context) {
    // 1) Free memory: unload everything currently resident.
    const unloadWarning = await lmstudioUnloadAll(baseUrl);

    // 2) Explicitly load the target model at the requested context length.
    const loaded = await lmsV1(baseUrl, "load", {
      model: modelId,
      context_length: context,
      echo_load_config: true,
    });
    if (loaded === null) {
      // v1 unsupported → try the CLI, else let JIT load on first request
      // (context length not guaranteed in that case).
      if (
        isLocalHost(baseUrl) &&
        (await lmsCli(["load", modelId, "--context-length", String(context), "-y"]))
      ) {
        return { instanceId: modelId, loadedContext: context, warning: unloadWarning };
      }
      return {
        instanceId: modelId,
        warning:
          unloadWarning ??
          "LM Studio <0.4.0: model will JIT-load; requested context length not guaranteed",
      };
    }
    return {
      instanceId: loaded.instance_id ?? modelId,
      loadedContext: loaded.load_config?.context_length ?? context,
      warning: unloadWarning,
    };
  },
  async cleanup(baseUrl, instanceId) {
    const res = await lmsV1(baseUrl, "unload", { instance_id: instanceId });
    if (res === null && isLocalHost(baseUrl)) await lmsCli(["unload", "--all"]);
  },
  chat: (opts) => openAiChat(opts),
};

/* ------------------------------- Ollama ------------------------------ */
// Native /api/tags + /api/show for metadata. Chat via the native /api/chat
// so num_ctx (context length) is actually honored per-request.
const ollama: Provider = {
  name: "ollama",
  label: "Ollama",
  defaultBaseUrl: "http://localhost:11434",
  async cleanup(baseUrl, instanceId) {
    // Documented unload: empty generate request with keep_alive: 0.
    await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: instanceId, keep_alive: 0 }),
      signal: AbortSignal.timeout(60_000),
    });
  },
  async listModels(baseUrl) {
    const tags = await fetchJson(`${baseUrl}/api/tags`);
    return (tags?.models ?? []).map(
      (m: any): ModelInfo => ({
        id: m.name,
        params: m.details?.parameter_size ?? guessParams(m.name),
        quant: m.details?.quantization_level ?? guessQuant(m.name),
        format: m.details?.format,
        sizeBytes: m.size,
      }),
    );
  },
  async chat(opts: ChatOptions) {
    const url = `${opts.baseUrl.replace(/\/$/, "")}/api/chat`;
    const start = performance.now();
    let res: Response;
    try {
      const ollamaSignal = opts.cancelSignal
        ? AbortSignal.any([AbortSignal.timeout(opts.timeoutMs), opts.cancelSignal])
        : AbortSignal.timeout(opts.timeoutMs);
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: opts.modelId,
          messages: [
            ...(opts.system ? [{ role: "system", content: opts.system }] : []),
            { role: "user", content: opts.prompt },
          ],
          stream: true,
          options: {
            temperature: opts.temperature,
            num_predict: opts.maxTokens,
            ...(opts.topP != null ? { top_p: opts.topP } : {}),
            ...(opts.seed != null ? { seed: opts.seed } : {}),
            ...(opts.context ? { num_ctx: opts.context } : {}),
          },
        }),
        signal: ollamaSignal,
      });
    } catch (e: any) {
      const wasCancelled = opts.cancelSignal?.aborted;
      return {
        text: "",
        ttftMs: null,
        totalMs: performance.now() - start,
        completionTokens: null,
        tokPerSec: null,
        error: wasCancelled ? "cancelled" : e?.name === "TimeoutError" ? "timeout" : String(e),
      };
    }
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => "");
      return {
        text: "",
        ttftMs: null,
        totalMs: performance.now() - start,
        completionTokens: null,
        tokPerSec: null,
        error: `HTTP ${res.status}: ${t.slice(0, 300)}`,
      };
    }
    let text = "";
    let ttftMs: number | null = null;
    let evalCount: number | null = null;
    let evalDurationNs: number | null = null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let json: any;
        try {
          json = JSON.parse(line);
        } catch {
          continue;
        }
        const delta = json?.message?.content ?? "";
        if (delta) {
          if (ttftMs === null) ttftMs = performance.now() - start;
          text += delta;
        }
        if (json?.done) {
          evalCount = json.eval_count ?? null;
          evalDurationNs = json.eval_duration ?? null;
        }
      }
    }
    const totalMs = performance.now() - start;
    const tokens = evalCount ?? Math.max(1, Math.round(text.length / 4));
    const tokPerSec =
      evalCount != null && evalDurationNs
        ? Math.round((evalCount / (evalDurationNs / 1e9)) * 10) / 10
        : ttftMs != null && totalMs > ttftMs
          ? Math.round((tokens / ((totalMs - ttftMs) / 1000)) * 10) / 10
          : null;
    return { text, ttftMs, totalMs, completionTokens: tokens, tokPerSec };
  },
};

/* -------------------------------- vLLM ------------------------------- */
const vllm: Provider = {
  name: "vllm",
  label: "vLLM",
  defaultBaseUrl: "http://localhost:8000",
  async listModels(baseUrl) {
    const data = await fetchJson(`${baseUrl}/v1/models`);
    return (data?.data ?? []).map(
      (m: any): ModelInfo => ({
        id: m.id,
        params: guessParams(m.id),
        quant: guessQuant(m.id),
        maxContext: m.max_model_len,
      }),
    );
  },
  chat: (opts) => openAiChat(opts),
};

/* ----------------------------- llama.cpp ----------------------------- */
// llama-server. Context is fixed at launch (-c); /props reports n_ctx.
const llamacpp: Provider = {
  name: "llamacpp",
  label: "llama.cpp",
  defaultBaseUrl: "http://localhost:8080",
  async listModels(baseUrl) {
    const data = await fetchJson(`${baseUrl}/v1/models`);
    const props = await fetchJson(`${baseUrl}/props`);
    return (data?.data ?? []).map(
      (m: any): ModelInfo => ({
        id: m.id,
        params: guessParams(m.id),
        quant: guessQuant(m.id),
        format: "gguf",
        maxContext: props?.default_generation_settings?.n_ctx ?? undefined,
      }),
    );
  },
  async loadedContext(baseUrl) {
    const props = await fetchJson(`${baseUrl}/props`);
    return props?.default_generation_settings?.n_ctx ?? null;
  },
  chat: (opts) => openAiChat(opts),
};

/* ------------------------------- mlx-lm ------------------------------ */
// `mlx_lm.server` exposes an OpenAI-compatible API (default port 8080;
// commonly run on 8081 to avoid clashing with llama.cpp).
const mlx: Provider = {
  name: "mlx",
  label: "mlx-lm",
  defaultBaseUrl: "http://localhost:8081",
  async listModels(baseUrl) {
    const data = await fetchJson(`${baseUrl}/v1/models`);
    return (data?.data ?? []).map(
      (m: any): ModelInfo => ({
        id: m.id,
        params: guessParams(m.id),
        quant: guessQuant(m.id),
        format: "mlx",
      }),
    );
  },
  chat: (opts) => openAiChat(opts),
};

/* ------------------------------ registry ----------------------------- */

export const providers: Record<string, Provider> = {
  lmstudio,
  ollama,
  vllm,
  llamacpp,
  mlx,
};

export interface ScanResult extends ProviderRef {
  label: string;
  reachable: boolean;
  models: ModelInfo[];
}

/** Probe every provider (default or supplied base URLs) and list models. */
export async function scanProviders(
  overrides: Partial<Record<string, string>> = {},
): Promise<ScanResult[]> {
  const entries = Object.values(providers).map(async (p): Promise<ScanResult> => {
    const baseUrl = overrides[p.name] ?? p.defaultBaseUrl;
    try {
      const models = await p.listModels(baseUrl);
      return {
        provider: p.name,
        label: p.label,
        baseUrl,
        reachable: models.length > 0,
        models,
      };
    } catch {
      return { provider: p.name, label: p.label, baseUrl, reachable: false, models: [] };
    }
  });
  return Promise.all(entries);
}
