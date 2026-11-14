import { execFile } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';
import { promisify } from 'node:util';
import {
  BUILTIN_MODEL_CATALOG,
  discoverModels,
  type ModelCatalogEntry,
} from './catalog.js';
import { resolveProviderBaseUrl } from './openai-compatible.js';

const execFileAsync = promisify(execFile);

export type HardwareTier = 'low' | 'medium' | 'high' | 'workstation';

export interface GPUInfo {
  name: string;
  vramMB?: number;
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown';
}

export interface HardwareProfile {
  platform: NodeJS.Platform;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalRamGB: number;
  freeRamGB: number;
  gpus: GPUInfo[];
  bestVramGB: number;
  tier: HardwareTier;
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  ollamaBaseUrl: string;
  installedOllamaModels: string[];
}

export interface LocalModelSpec {
  modelId: string;
  name: string;
  parameterSize: string;
  estimatedDownloadGB: number;
  minRamGB: number;
  recommendedVramGB: number;
  supportsToolCalling: boolean;
  description: string;
}

export interface LocalModelRecommendation {
  modelId: string;
  name: string;
  parameterSize: string;
  estimatedDownloadGB: number;
  minRamGB: number;
  recommendedVramGB: number;
  supportsToolCalling: boolean;
  fitStatus: 'optimal' | 'compatible' | 'too_heavy';
  installed: boolean;
  reason: string;
  pullCommand: string;
}

export interface HardwareAdvisorReport {
  profile: HardwareProfile;
  recommendedLocalModels: LocalModelRecommendation[];
  bestLocalModel?: LocalModelRecommendation;
  onlineFreeModels: ModelCatalogEntry[];
  summaryAdvice: string;
}

export const CURATED_OLLAMA_MODELS: LocalModelSpec[] = [
  {
    modelId: 'qwen2.5-coder:1.5b',
    name: 'Qwen 2.5 Coder 1.5B',
    parameterSize: '1.5B',
    estimatedDownloadGB: 1.0,
    minRamGB: 4,
    recommendedVramGB: 2,
    supportsToolCalling: true,
    description: 'Ultra-lightweight coding & tool-calling model for low-RAM machines',
  },
  {
    modelId: 'llama3.2:3b',
    name: 'Llama 3.2 3B',
    parameterSize: '3B',
    estimatedDownloadGB: 2.0,
    minRamGB: 6,
    recommendedVramGB: 3,
    supportsToolCalling: true,
    description: 'Compact general instruction & tool-calling model',
  },
  {
    modelId: 'qwen2.5-coder:7b',
    name: 'Qwen 2.5 Coder 7B',
    parameterSize: '7B',
    estimatedDownloadGB: 4.7,
    minRamGB: 8,
    recommendedVramGB: 6,
    supportsToolCalling: true,
    description: 'Balanced coding, refactoring & agentic tool-calling model',
  },
  {
    modelId: 'llama3.1:8b',
    name: 'Llama 3.1 8B',
    parameterSize: '8B',
    estimatedDownloadGB: 4.9,
    minRamGB: 8,
    recommendedVramGB: 6,
    supportsToolCalling: true,
    description: 'Versatile 8B instruction & tool-calling model',
  },
  {
    modelId: 'qwen2.5-coder:14b',
    name: 'Qwen 2.5 Coder 14B',
    parameterSize: '14B',
    estimatedDownloadGB: 9.0,
    minRamGB: 16,
    recommendedVramGB: 10,
    supportsToolCalling: true,
    description: 'High-accuracy local coding & architectural reasoning model',
  },
  {
    modelId: 'deepseek-r1:14b',
    name: 'DeepSeek R1 14B',
    parameterSize: '14B',
    estimatedDownloadGB: 9.0,
    minRamGB: 16,
    recommendedVramGB: 10,
    supportsToolCalling: false,
    description: 'Deep reasoning model (best for pure analysis; limited tool-calling)',
  },
  {
    modelId: 'qwen2.5-coder:32b',
    name: 'Qwen 2.5 Coder 32B',
    parameterSize: '32B',
    estimatedDownloadGB: 20.0,
    minRamGB: 32,
    recommendedVramGB: 20,
    supportsToolCalling: true,
    description: 'Workstation-class local coding & multi-file audit model',
  },
];

export function classifyHardwareTier(totalRamGB: number, bestVramGB: number): HardwareTier {
  if (bestVramGB >= 16 || totalRamGB >= 32) {
    return 'workstation';
  }
  if (bestVramGB >= 8 || totalRamGB >= 16) {
    return 'high';
  }
  if (bestVramGB >= 4 || totalRamGB >= 8) {
    return 'medium';
  }
  return 'low';
}

function detectGpuVendor(name: string): GPUInfo['vendor'] {
  const lower = name.toLowerCase();
  if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('rtx') || lower.includes('quadro') || lower.includes('tesla')) {
    return 'nvidia';
  }
  if (lower.includes('amd') || lower.includes('radeon')) {
    return 'amd';
  }
  if (lower.includes('intel') || lower.includes('arc') || lower.includes('uhd') || lower.includes('iris')) {
    return 'intel';
  }
  if (lower.includes('apple')) {
    return 'apple';
  }
  return 'unknown';
}

async function probeSystemGpus(): Promise<GPUInfo[]> {
  const gpus: GPUInfo[] = [];

  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 2000 }
    );
    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split(',');
      const name = parts[0]?.trim();
      const vramVal = Number(parts[1]?.trim());
      if (name) {
        gpus.push({
          name,
          vramMB: Number.isFinite(vramVal) && vramVal > 0 ? Math.round(vramVal) : undefined,
          vendor: 'nvidia',
        });
      }
    }
    if (gpus.length > 0) {
      return gpus;
    }
  } catch {
    // nvidia-smi not installed or no NVIDIA GPU present
  }

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress',
        ],
        { timeout: 2500 }
      );
      const trimmed = stdout.trim();
      if (trimmed) {
        const parsed = JSON.parse(trimmed) as
          | { Name?: string; AdapterRAM?: number }
          | Array<{ Name?: string; AdapterRAM?: number }>;
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          if (!item?.Name) continue;
          const vramMB =
            typeof item.AdapterRAM === 'number' && item.AdapterRAM > 0
              ? Math.round(item.AdapterRAM / (1024 * 1024))
              : undefined;
          gpus.push({
            name: item.Name.trim(),
            vramMB,
            vendor: detectGpuVendor(item.Name),
          });
        }
      }
    } catch {
      // PowerShell / CIM probe failed; continue gracefully
    }
  }

  return gpus;
}

function toOllamaRootUrl(ollamaBaseUrl: string): string {
  return ollamaBaseUrl.trim().replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
}

async function probeOllamaStatus(
  ollamaBaseUrl: string,
  timeoutMs: number,
  skipSystemProbe: boolean
): Promise<{ installed: boolean; running: boolean; models: string[] }> {
  const rootUrl = toOllamaRootUrl(ollamaBaseUrl);
  const models: string[] = [];
  const seen = new Set<string>();
  let running = false;

  const pushModel = (id: string) => {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    models.push(trimmed);
  };

  // Probe /api/tags first
  {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${rootUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (res.ok) {
        running = true;
        const payload = (await res.json()) as {
          models?: Array<{ name?: string; model?: string }>;
        };
        if (Array.isArray(payload.models)) {
          for (const m of payload.models) {
            const id = m.name ?? m.model;
            if (typeof id === 'string') pushModel(id);
          }
        }
      }
    } catch {
      // Ollama /api/tags offline
    } finally {
      clearTimeout(timer);
    }
  }

  // Fallback or supplement with OpenAI-compatible /v1/models
  {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${rootUrl}/v1/models`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (res.ok) {
        running = true;
        const payload = (await res.json()) as { data?: Array<{ id?: string }> };
        if (Array.isArray(payload.data)) {
          for (const m of payload.data) {
            if (typeof m.id === 'string') pushModel(m.id);
          }
        }
      }
    } catch {
      // /v1/models offline
    } finally {
      clearTimeout(timer);
    }
  }

  if (running) {
    return { installed: true, running: true, models };
  }

  if (!skipSystemProbe) {
    try {
      await execFileAsync('ollama', ['--version'], { timeout: 1500 });
      return { installed: true, running: false, models: [] };
    } catch {
      // ollama binary not on PATH
    }
  }

  return { installed: false, running: false, models: [] };
}

export interface DetectHardwareOptions {
  ollamaBaseUrl?: string;
  timeoutMs?: number;
  skipSystemProbe?: boolean;
  overrideRamGB?: number;
  overrideVramGB?: number;
}

/**
 * Inspects local CPU, RAM, GPU/VRAM, and Ollama installation/model state.
 */
export async function detectHardwareProfile(
  options: DetectHardwareOptions = {}
): Promise<HardwareProfile> {
  const skipSystemProbe = options.skipSystemProbe ?? false;
  const timeoutMs = options.timeoutMs ?? 1500;
  const ollamaBaseUrl = resolveProviderBaseUrl('ollama', options.ollamaBaseUrl);

  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model?.trim() || 'Unknown CPU';
  const cpuCores = cpus.length || 1;

  const totalRamGB =
    options.overrideRamGB !== undefined
      ? Math.round(options.overrideRamGB * 10) / 10
      : Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10;
  const freeRamGB =
    options.overrideRamGB !== undefined
      ? totalRamGB
      : Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10;

  const gpus = skipSystemProbe ? [] : await probeSystemGpus();
  const maxVramMB = gpus.reduce((max, g) => Math.max(max, g.vramMB ?? 0), 0);
  const bestVramGB =
    options.overrideVramGB !== undefined
      ? Math.round(options.overrideVramGB * 10) / 10
      : Math.round((maxVramMB / 1024) * 10) / 10;

  const tier = classifyHardwareTier(totalRamGB, bestVramGB);
  const ollamaStatus = await probeOllamaStatus(ollamaBaseUrl, timeoutMs, skipSystemProbe);

  return {
    platform: process.platform,
    arch: os.arch(),
    cpuModel,
    cpuCores,
    totalRamGB,
    freeRamGB,
    gpus,
    bestVramGB,
    tier,
    ollamaInstalled: ollamaStatus.installed,
    ollamaRunning: ollamaStatus.running,
    ollamaBaseUrl,
    installedOllamaModels: ollamaStatus.models,
  };
}

function isModelInstalled(modelId: string, installedModels: string[]): boolean {
  const normalizedTarget = modelId.toLowerCase();
  return installedModels.some((installed) => {
    const norm = installed.toLowerCase();
    return norm === normalizedTarget || (!normalizedTarget.includes(':') && norm === `${normalizedTarget}:latest`);
  });
}

function evaluateModelFit(
  spec: LocalModelSpec,
  profile: HardwareProfile
): { fitStatus: LocalModelRecommendation['fitStatus']; reason: string } {
  const ram = profile.totalRamGB;
  const vram = profile.bestVramGB;

  if (vram >= spec.recommendedVramGB && ram >= spec.minRamGB) {
    return {
      fitStatus: 'optimal',
      reason: `GPU VRAM (${vram} GB) dan RAM (${ram} GB) mencukupi untuk akselerasi GPU optimal.`,
    };
  }

  if (ram < spec.minRamGB && vram < spec.recommendedVramGB) {
    return {
      fitStatus: 'too_heavy',
      reason: `Membutuhkan minimal ${spec.minRamGB} GB RAM atau ${spec.recommendedVramGB} GB VRAM (tersedia ${ram} GB RAM / ${vram} GB VRAM).`,
    };
  }

  if (spec.minRamGB <= ram * 0.55) {
    return {
      fitStatus: 'optimal',
      reason: `RAM sistem (${ram} GB) sangat longgar untuk menjalankan model ${spec.parameterSize} secara lancar.`,
    };
  }

  return {
    fitStatus: 'compatible',
    reason:
      vram > 0
        ? `Dapat berjalan dengan RAM ${ram} GB + offload VRAM ${vram} GB (disarankan tutup aplikasi berat).`
        : `Dapat berjalan via CPU pada RAM ${ram} GB (kecepatan lebih lambat dibanding GPU).`,
  };
}

export interface RecommendModelsOptions {
  includeOnlineFree?: boolean;
  openRouterBaseUrl?: string;
  timeoutMs?: number;
}

/**
 * Evaluates curated local Ollama models against the detected hardware profile and
 * gathers available online free/BYOK-free-tier cloud models as fallback or complement.
 */
export async function recommendModelsForHardware(
  profile: HardwareProfile,
  options: RecommendModelsOptions = {}
): Promise<HardwareAdvisorReport> {
  const recommendedLocalModels: LocalModelRecommendation[] = CURATED_OLLAMA_MODELS.map((spec) => {
    const { fitStatus, reason } = evaluateModelFit(spec, profile);
    const installed = isModelInstalled(spec.modelId, profile.installedOllamaModels);
    return {
      modelId: spec.modelId,
      name: spec.name,
      parameterSize: spec.parameterSize,
      estimatedDownloadGB: spec.estimatedDownloadGB,
      minRamGB: spec.minRamGB,
      recommendedVramGB: spec.recommendedVramGB,
      supportsToolCalling: spec.supportsToolCalling,
      fitStatus,
      installed,
      reason,
      pullCommand: `almudaya bot pull ${spec.modelId}`,
    };
  });

  const eligible = recommendedLocalModels.filter((m) => m.fitStatus !== 'too_heavy');
  eligible.sort((a, b) => {
    if (a.fitStatus !== b.fitStatus) {
      return a.fitStatus === 'optimal' ? -1 : 1;
    }
    if (a.supportsToolCalling !== b.supportsToolCalling) {
      return a.supportsToolCalling ? -1 : 1;
    }
    if (b.recommendedVramGB !== a.recommendedVramGB) {
      return b.recommendedVramGB - a.recommendedVramGB;
    }
    return a.installed === b.installed ? 0 : a.installed ? -1 : 1;
  });
  const bestLocalModel = eligible[0];

  const openRouterModels = await discoverModels({
    provider: 'openrouter',
    openRouterBaseUrl: options.openRouterBaseUrl,
    includeLiveDiscovery: options.includeOnlineFree ?? true,
    timeoutMs: options.timeoutMs ?? 1800,
  });
  const nvidiaModels = BUILTIN_MODEL_CATALOG.filter((m) => m.provider === 'nvidia');

  const onlineSeen = new Set<string>();
  const onlineFreeModels: ModelCatalogEntry[] = [];
  for (const m of [...openRouterModels, ...nvidiaModels]) {
    const key = `${m.provider}:${m.id}`;
    if (onlineSeen.has(key)) continue;
    onlineSeen.add(key);
    onlineFreeModels.push(m);
  }

  const tierLabel = profile.tier.toUpperCase();
  const ollamaNote = profile.ollamaRunning
    ? `Ollama aktif (${profile.installedOllamaModels.length} model lokal terpasang).`
    : profile.ollamaInstalled
      ? 'Ollama terpasang tetapi layanan belum berjalan (jalankan `ollama serve`).'
      : 'Ollama belum terdeteksi; gunakan model cloud gratis (OpenRouter / NVIDIA NIM) atau instal Ollama.';

  const bestModelNote = bestLocalModel
    ? `Rekomendasi model lokal terbaik: ${bestLocalModel.modelId} (${bestLocalModel.fitStatus}, ~${bestLocalModel.estimatedDownloadGB} GB).`
    : 'Hardware saat ini terlalu terbatas untuk model lokal; disarankan menggunakan model cloud gratis seperti OpenRouter (:free) atau NVIDIA NIM.';

  const summaryAdvice = `Hardware Tier ${tierLabel} (${profile.totalRamGB} GB RAM, ${profile.bestVramGB} GB VRAM, ${profile.cpuCores} core CPU). ${ollamaNote} ${bestModelNote}`;

  return {
    profile,
    recommendedLocalModels,
    bestLocalModel,
    onlineFreeModels,
    summaryAdvice,
  };
}

export interface PullOllamaModelOptions {
  ollamaBaseUrl?: string;
  timeoutMs?: number;
  onProgress?: (status: string, completed?: number, total?: number) => void;
  signal?: AbortSignal;
}

/**
 * Pulls (downloads) a model via the Ollama `/api/pull` streaming NDJSON API.
 */
export async function pullOllamaModel(
  modelId: string,
  options: PullOllamaModelOptions = {}
): Promise<{ modelId: string; status: string; success: boolean }> {
  const trimmedModel = modelId.trim();
  if (!trimmedModel) {
    throw new Error('Model ID is required for Ollama pull.');
  }
  if (options.signal?.aborted) {
    throw new Error('Operation aborted');
  }

  const baseUrl = resolveProviderBaseUrl('ollama', options.ollamaBaseUrl);
  const rootUrl = toOllamaRootUrl(baseUrl);
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const res = await fetch(`${rootUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedModel, stream: true }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Ollama pull failed (${res.status}): ${errBody.slice(0, 300)}`);
    }

    let lastStatus = 'success';
    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: { status?: string; completed?: number; total?: number; error?: string };
      try {
        parsed = JSON.parse(trimmed) as {
          status?: string;
          completed?: number;
          total?: number;
          error?: string;
        };
      } catch {
        return;
      }
      if (parsed.error) {
        throw new Error(`Ollama pull error: ${parsed.error}`);
      }
      if (parsed.status) {
        lastStatus = parsed.status;
        options.onProgress?.(parsed.status, parsed.completed, parsed.total);
      }
    };

    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          processLine(line);
        }
      }
      if (buffer.trim()) {
        processLine(buffer);
      }
    } else {
      const rawText = await res.text();
      for (const line of rawText.split(/\r?\n/)) {
        processLine(line);
      }
    }

    return {
      modelId: trimmedModel,
      status: lastStatus,
      success: true,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Formats a streaming Ollama pull progress event into a human-readable line.
 */
export function formatPullProgress(status: string, completed?: number, total?: number): string {
  if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
    const pct = Math.min(100, Math.round((completed / total) * 100));
    const mbDone = (completed / (1024 * 1024)).toFixed(1);
    const mbTotal = (total / (1024 * 1024)).toFixed(1);
    return `${status} (${pct}% — ${mbDone}/${mbTotal} MB)`;
  }
  return status;
}

/**
 * Formats a HardwareAdvisorReport into printable terminal/console lines.
 */
export function formatHardwareAdvisorReport(report: HardwareAdvisorReport): string[] {
  const { profile } = report;
  const lines: string[] = [];

  lines.push(`=== Hardware Spec & AI Model Advisor ===`);
  lines.push(`  OS / Arch:   ${profile.platform} (${profile.arch})`);
  lines.push(`  CPU:         ${profile.cpuModel} (${profile.cpuCores} cores)`);
  lines.push(`  RAM:         ${profile.totalRamGB} GB total (${profile.freeRamGB} GB free)`);
  if (profile.gpus.length > 0) {
    for (const gpu of profile.gpus) {
      const vramLabel = gpu.vramMB !== undefined ? `${(gpu.vramMB / 1024).toFixed(1)} GB VRAM` : 'VRAM unknown';
      lines.push(`  GPU:         ${gpu.name} [${gpu.vendor}] (${vramLabel})`);
    }
  } else {
    lines.push(`  GPU:         Tidak terdeteksi GPU diskret (0 GB VRAM)`);
  }
  lines.push(`  Tier:        ${profile.tier.toUpperCase()}`);
  lines.push(
    `  Ollama:      ${profile.ollamaRunning ? 'Running' : profile.ollamaInstalled ? 'Installed (Not Running)' : 'Not Detected'} (${profile.ollamaBaseUrl})`
  );
  if (profile.installedOllamaModels.length > 0) {
    lines.push(`  Terpasang:   ${profile.installedOllamaModels.join(', ')}`);
  }

  lines.push('');
  lines.push(`Rekomendasi Model Lokal (Ollama):`);
  for (const m of report.recommendedLocalModels) {
    const badge = m.fitStatus.toUpperCase();
    const installedTag = m.installed ? ' [INSTALLED]' : '';
    const toolTag = m.supportsToolCalling ? 'Tools:OK' : 'Tools:Limited';
    lines.push(
      `  - [${badge}] ${m.modelId} (${m.parameterSize}, ~${m.estimatedDownloadGB} GB, Min ${m.minRamGB}GB RAM / ${m.recommendedVramGB}GB VRAM, ${toolTag})${installedTag}`
    );
    lines.push(`      ${m.reason}`);
  }

  if (report.onlineFreeModels.length > 0) {
    lines.push('');
    lines.push(`Referensi Model Cloud Gratis / Free-Tier (${report.onlineFreeModels.length}):`);
    for (const m of report.onlineFreeModels.slice(0, 10)) {
      lines.push(`  - [${m.provider}] ${m.id} — ${m.name} (${m.tier})`);
    }
  }

  lines.push('');
  lines.push(`Ringkasan: ${report.summaryAdvice}`);
  if (report.bestLocalModel && !report.bestLocalModel.installed) {
    lines.push(`Unduh model terbaik: ${report.bestLocalModel.pullCommand}`);
  }
  return lines;
}

