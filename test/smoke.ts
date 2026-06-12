// Smoke test: mock LM Studio server with a "smart" model (answers from the key),
// a "dumb" model (wrong half the time), and a judge that grades correctly.
import { prepareRun, executeRun } from "../src/runner";
import { scanProviders } from "../src/providers";
import { markdownReport } from "../src/report/markdown";
import { htmlReport } from "../src/report/html";
import { summarizeRun } from "../src/report/score";

const KEY: Record<string, string> = {
  "5 machines": "5", "Half of a lake": "47", "3 fathers": "4",
  "2, 6, 12": "56", "Some doctors": "Yes, this inference is valid.",
  "mystery": "[4, 16, 36]", "reduce": "16",
  "middle element": "Use two pointers — the tortoise and hare approach, O(1) space.",
  "SELECT department": "It returns departments having more than 2 employees with salary over 50000, with their counts, sorted by count descending.",
  "deleting a resource": "Use the DELETE method and return 204 No Content.",
  "log₂(64)": "9", "derivative": "6x + 2", "both are blue": "2/9",
  "3x − 7": "x = -4", "a₄": "23",
};

function answerFor(prompt: string, dumb: boolean): string {
  // judge prompts first — they embed the question text
  if (prompt.includes("ANSWER KEY:")) {
    const keyPart = prompt.split("ANSWER KEY:")[1].split("MODEL'S ANSWER:")[0].trim().toLowerCase();
    const ans = prompt.split("MODEL'S ANSWER:")[1].toLowerCase();
    const ok = keyPart.split(/[\s,]+/).filter((w) => w.length > 1).some((w) => ans.includes(w));
    return JSON.stringify({ verdict: ok ? "correct" : "incorrect", reason: "smoke judge" });
  }
  for (const [k, v] of Object.entries(KEY)) {
    if (prompt.includes(k)) {
      if (dumb && ["5 machines", "3 fathers", "both are blue", "SELECT department"].some((x) => prompt.includes(x))) {
        return "Let me think...\nFINAL ANSWER: 42";
      }
      return `Reasoning about it briefly.\nFINAL ANSWER: ${v}`;
    }
  }
}

const sse = (model: string, text: string) => {
  const chunks = text.match(/.{1,12}/gs) ?? [];
  const lines = chunks.map((c) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`,
  );
  lines.push(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { completion_tokens: Math.round(text.length / 4) } })}\n\n`);
  lines.push("data: [DONE]\n\n");
  return lines.join("");
};

export const lifecycle = { loads: [] as any[], unloads: [] as string[], order: [] as string[] };
let loadedNow = new Set<string>(["judge-26b"]); // pretend something is resident at start

const server = Bun.serve({
  port: 1234,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/v1/models/load") {
      const body = await req.json() as any;
      lifecycle.loads.push(body);
      lifecycle.order.push(`load:${body.model}`);
      loadedNow.add(body.model);
      return Response.json({
        instance_id: `${body.model}#1`,
        status: "loaded",
        load_config: { context_length: body.context_length },
      });
    }
    if (url.pathname === "/api/v1/models/unload") {
      const body = await req.json() as any;
      lifecycle.unloads.push(body.instance_id);
      lifecycle.order.push(`unload:${body.instance_id}`);
      loadedNow.delete(String(body.instance_id).replace(/#1$/, ""));
      return Response.json({ status: "unloaded" });
    }
    if (url.pathname === "/api/v0/models") {
      return Response.json({
        data: [
          { id: "smart-9b-q4_k_m", type: "llm", quantization: "Q4_K_M", max_context_length: 32768, state: loadedNow.has("smart-9b-q4_k_m") ? "loaded" : "not-loaded", arch: "llama" },
          { id: "dumb-3b-a1b-4bit", type: "llm", quantization: "4bit", max_context_length: 8192, state: loadedNow.has("dumb-3b-a1b-4bit") ? "loaded" : "not-loaded", arch: "qwen" },
          { id: "judge-26b", type: "llm", quantization: "Q8_0", max_context_length: 131072, state: loadedNow.has("judge-26b") ? "loaded" : "not-loaded", arch: "gemma" },
        ],
      });
    }
    if (url.pathname === "/v1/chat/completions") {
      const body = await req.json() as any;
      const prompt = body.messages.at(-1).content as string;
      const text = answerFor(prompt, body.model.startsWith("dumb"));
      await Bun.sleep(5);
      return new Response(sse(body.model, text), { headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response("nf", { status: 404 });
  },
});

// ---- scan ----
const scans = await scanProviders();
const lm = scans.find((s) => s.provider === "lmstudio")!;
console.log("scan:", lm.reachable, lm.models.map((m) => `${m.id}(${m.params ?? "?"}/${m.quant})`).join(", "));
if (!lm.reachable || lm.models.length !== 3) throw new Error("scan failed");

// ---- run ----
const runId = await prepareRun({
  label: "smoke test",
  questionSet: "default",
  trials: 3,
  temperature: 0,
  maxTokens: 512,
  timeoutMs: 10000,
  judge: { provider: "lmstudio", baseUrl: "http://localhost:1234", modelId: "judge-26b" },
  models: [
    { provider: "lmstudio", baseUrl: "http://localhost:1234", modelId: "smart-9b-q4_k_m", context: 16384, params: "9B", quant: "Q4_K_M" },
    { provider: "lmstudio", baseUrl: "http://localhost:1234", modelId: "dumb-3b-a1b-4bit", context: 8192, params: "3B MoE (A1B)", quant: "4BIT" },
  ],
});
let events = 0;
let judgeEvents = 0;
await executeRun(runId, (e) => (e.trial > 0 ? events++ : judgeEvents++));
console.log("run done, response events:", events, "judge events:", judgeEvents);

// ---- assertions ----
const s = summarizeRun(runId);
const smart = s.models.find((m) => m.modelId.startsWith("smart"))!;
const dumb = s.models.find((m) => m.modelId.startsWith("dumb"))!;
console.log(`smart: ${smart.total}/15 (logic ${smart.byCategory.logic.score}, code ${smart.byCategory.code.score}, math ${smart.byCategory.math.score}) ${smart.medianTokPerSec} tok/s`);
console.log(`dumb:  ${dumb.total}/15`);
if (smart.total !== 15) throw new Error(`expected smart=15, got ${smart.total}`);
if (dumb.total !== 11) throw new Error(`expected dumb=11, got ${dumb.total}`);
if (events !== 2 * 15 * 3) throw new Error(`expected 90 events, got ${events}`);
if (judgeEvents !== 6) throw new Error(`expected 6 judge events (S9 × 3 trials × 2 models), got ${judgeEvents}`);

// lifecycle: judge-26b unloaded before model 1; each model loaded at its ctx then
// unloaded; judge explicitly loaded LAST at a bounded ctx, then unloaded.
console.log("loads:", lifecycle.loads.map((l) => `${l.model}@${l.context_length}`).join(", "));
console.log("unloads:", lifecycle.unloads.join(", "));
if (lifecycle.loads.length !== 3) throw new Error(`expected 3 loads (2 models + judge), got ${lifecycle.loads.length}`);
if (lifecycle.loads[0].model !== "smart-9b-q4_k_m" || lifecycle.loads[0].context_length !== 16384) throw new Error("model 1 not loaded at requested ctx");
if (lifecycle.loads[1].model !== "dumb-3b-a1b-4bit" || lifecycle.loads[1].context_length !== 8192) throw new Error("model 2 not loaded at requested ctx");
if (lifecycle.loads[2].model !== "judge-26b") throw new Error("judge was not explicitly loaded for the deferred judge pass");
if (lifecycle.loads[2].context_length !== 8192) throw new Error(`judge not loaded at bounded ctx, got ${lifecycle.loads[2].context_length}`);
if (!lifecycle.unloads.includes("judge-26b")) throw new Error("pre-resident judge model was never unloaded before testing");
if (!lifecycle.unloads.includes("smart-9b-q4_k_m#1")) throw new Error("model 1 instance not unloaded after its run");
if (!lifecycle.unloads.includes("dumb-3b-a1b-4bit#1")) throw new Error("model 2 instance not unloaded after its run");
if (!lifecycle.unloads.includes("judge-26b#1")) throw new Error("judge instance not unloaded after grading");
const smartUnloadIdx = lifecycle.unloads.indexOf("smart-9b-q4_k_m#1");
const dumbLoadIdx = lifecycle.loads.findIndex((l) => l.model === "dumb-3b-a1b-4bit");
if (smartUnloadIdx === -1 || dumbLoadIdx !== 1) throw new Error("ordering check setup failed");
// the judge must load only after BOTH test models were unloaded
const judgeLoadOrder = lifecycle.order.indexOf("load:judge-26b");
const lastModelUnloadOrder = lifecycle.order.indexOf("unload:dumb-3b-a1b-4bit#1");
if (judgeLoadOrder === -1 || lastModelUnloadOrder === -1) throw new Error("ordering check setup failed (judge/model order)");
if (judgeLoadOrder < lastModelUnloadOrder) throw new Error("judge was loaded before the last test model was unloaded");
// loaded_context recorded
const ctxRow = s.models.find((m) => m.modelId.startsWith("smart"))!;
if (ctxRow.loadedContext !== 16384) throw new Error(`expected loadedContext 16384, got ${ctxRow.loadedContext}`);

// ---- question set editing round-trip ----
{
  const { createQuestionSet, loadQuestionSet, saveQuestionSet, deleteQuestionSet, validateQuestionSet } = await import("../src/questions");
  const tmp = await createQuestionSet("smoketmp", "default");
  tmp.questions[0].text = "Edited: what is 2 + 2?";
  tmp.questions[0].answer = "4";
  tmp.questions[0].match = { type: "number", expected: 4 };
  await saveQuestionSet("smoketmp", tmp);
  const back = await loadQuestionSet("smoketmp");
  if (back.questions[0].answer !== "4") throw new Error("question set save/load round-trip failed");
  // invalid set must be rejected
  const bad = structuredClone(back);
  bad.questions[1].qid = bad.questions[0].qid; // duplicate qid
  let rejected = false;
  await saveQuestionSet("smoketmp", bad).catch(() => (rejected = true));
  if (!rejected) throw new Error("invalid set was not rejected");
  if (validateQuestionSet(bad).length === 0) throw new Error("validator missed duplicate qid");
  await deleteQuestionSet("smoketmp");
  console.log("question set CRUD round-trip ok");
}

const md = markdownReport(runId);
const html = htmlReport(runId);
await Bun.write("reports/smoke.md", md);
await Bun.write("reports/smoke.html", html);
if (!md.includes("Full Rankings") || !md.includes("smart-9b-q4_k_m")) throw new Error("md report broken");
if (!html.includes("Results Matrix")) throw new Error("html report broken");
console.log("reports written. SMOKE TEST PASSED ✅");
server.stop();
process.exit(0);
