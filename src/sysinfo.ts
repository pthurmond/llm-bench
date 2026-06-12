import os from "node:os";
import { $ } from "bun";
import type { MachineProfile } from "./types";

async function sh(cmd: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return proc.exitCode === 0 ? out.trim() : null;
  } catch {
    return null;
  }
}

async function darwinProfile(base: MachineProfile): Promise<MachineProfile> {
  base.chip =
    (await sh(["sysctl", "-n", "machdep.cpu.brand_string"])) ?? base.chip;
  const perf = await sh(["sysctl", "-n", "hw.perflevel0.physicalcpu"]);
  const eff = await sh(["sysctl", "-n", "hw.perflevel1.physicalcpu"]);
  if (perf) base.perfCores = Number(perf);
  if (eff) base.effCores = Number(eff);

  // GPU name + core count via system_profiler (Apple Silicon reports sppci_cores)
  const sp = await sh([
    "system_profiler",
    "SPDisplaysDataType",
    "-json",
  ]);
  if (sp) {
    try {
      const json = JSON.parse(sp);
      const gpu = json?.SPDisplaysDataType?.[0];
      if (gpu) {
        base.gpu = gpu.sppci_model ?? gpu._name ?? base.gpu;
        const cores = Number(gpu.sppci_cores);
        if (!Number.isNaN(cores) && cores > 0) base.gpuCores = cores;
      }
    } catch {
      /* ignore */
    }
  }

  // Apple Silicon uses unified memory — RAM is VRAM.
  if (base.chip.toLowerCase().includes("apple m")) {
    base.vramGb = base.ramGb;
  }

  return base;
}

async function linuxProfile(base: MachineProfile): Promise<MachineProfile> {
  const cpuinfo = await sh(["sh", "-c", "grep -m1 'model name' /proc/cpuinfo"]);
  if (cpuinfo) base.chip = cpuinfo.split(":")[1]?.trim() ?? base.chip;
  const nvidia = await sh([
    "nvidia-smi",
    "--query-gpu=name,memory.total",
    "--format=csv,noheader",
  ]);
  if (nvidia) {
    const parts = nvidia.split("\n")[0]?.split(",");
    base.gpu = parts?.[0]?.trim() ?? base.gpu;
    const vramStr = parts?.[1]?.trim().replace(/\s*MiB$/, "");
    if (vramStr && !Number.isNaN(Number(vramStr))) {
      base.vramGb = Math.round((Number(vramStr) / 1024) * 10) / 10;
    }
  }
  return base;
}

export async function detectMachine(): Promise<MachineProfile> {
  const base: MachineProfile = {
    hostname: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    chip: os.cpus()[0]?.model ?? "unknown",
    cpuCores: os.cpus().length,
    ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
  };
  if (process.platform === "darwin") return darwinProfile(base);
  if (process.platform === "linux") return linuxProfile(base);
  return base;
}

export function machineSummary(p: MachineProfile): string {
  const cores =
    p.perfCores != null && p.effCores != null
      ? `${p.cpuCores} cores (${p.perfCores}P + ${p.effCores}E)`
      : `${p.cpuCores} cores`;
  const gpu = p.gpu
    ? `, GPU: ${p.gpu}${p.gpuCores ? ` (${p.gpuCores} cores)` : ""}`
    : "";
  return `${p.hostname} — ${p.chip}, ${cores}, ${p.ramGb} GB RAM${gpu} — ${p.os} (${p.arch})`;
}
