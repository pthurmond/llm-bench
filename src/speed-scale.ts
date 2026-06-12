/**
 * Token Speed Rating Scale
 * Based on community consensus and practical evaluation workflows
 * Used for rating local LLM inference speed during model evaluation
 */

export interface SpeedTier {
  label: string;
  minTokensPerSecond: number;
  maxTokensPerSecond: number;
  assessment: string;
  fitForPurpose: string;
  hardwareExamples: string[];
}

export const TOKEN_SPEED_SCALE: SpeedTier[] = [
  {
    label: "Painfully Slow",
    minTokensPerSecond: 0,
    maxTokensPerSecond: 1,
    assessment: "Basically unusable for evaluation",
    fitForPurpose: "Don't use for evaluation",
    hardwareExamples: [],
  },
  {
    label: "Very Slow",
    minTokensPerSecond: 1,
    maxTokensPerSecond: 5,
    assessment: "Extreme patience required; batch-only viable",
    fitForPurpose: "Overnight batch only; not iterative",
    hardwareExamples: ["CPU-only (old i7)", "No GPU"],
  },
  {
    label: "Slow",
    minTokensPerSecond: 5,
    maxTokensPerSecond: 15,
    assessment: "Frustrating but tolerable; acceptable for CPU-only",
    fitForPurpose: "Batch-friendly; morning/evening runs",
    hardwareExamples: ["CPU-only (modern Ryzen)", "Integrated GPU", "Mobile GPU (older)"],
  },
  {
    label: "Usable",
    minTokensPerSecond: 15,
    maxTokensPerSecond: 25,
    assessment: "Noticeable lag; breaks interactive iteration",
    fitForPurpose: "Practical iteration; 30–50 questions per session",
    hardwareExamples: ["iPhone/iPad with on-device LLM", "Old mobile GPU", "Budget consumer GPU"],
  },
  {
    label: "Responsive",
    minTokensPerSecond: 25,
    maxTokensPerSecond: 40,
    assessment: "Acceptable for development; some patience required",
    fitForPurpose: "Comfortable dev; active testing",
    hardwareExamples: ["RTX 3070", "RTX 4070", "M2 MacBook Pro", "Mid-range consumer GPU"],
  },
  {
    label: "Fast",
    minTokensPerSecond: 40,
    maxTokensPerSecond: 60,
    assessment: "Smooth and responsive; ideal for active development",
    fitForPurpose: "Ideal for development; 100+ questions/session",
    hardwareExamples: ["RTX 4090", "M3 MacBook Pro", "M4 MacBook Pro", "M4 Max with 32GB"],
  },
  {
    label: "Very Fast",
    minTokensPerSecond: 60,
    maxTokensPerSecond: 100,
    assessment: "Highly responsive; no practical constraints",
    fitForPurpose: "No practical constraints; multi-model evaluation",
    hardwareExamples: ["Server GPU", "Mac Studio M4 Max (128GB)", "High-end consumer setup"],
  },
  {
    label: "Stupid Fast",
    minTokensPerSecond: 100,
    maxTokensPerSecond: 200,
    assessment: "Quantized small models or heavily optimized hardware",
    fitForPurpose: "Massive scale; production pipelines",
    hardwareExamples: ["A100", "H100", "Specialized inference hardware", "Groq LPU (330+ t/s for 70B)"],
  },
  {
    label: "Extremely Fast",
    minTokensPerSecond: 200,
    maxTokensPerSecond: Infinity,
    assessment: "Edge cases with tiny models or enterprise hardware",
    fitForPurpose: "Massive scale; production inference pipelines",
    hardwareExamples: ["A100/H100 clusters", "Groq on 8B models (750+ t/s)", "Specialized inference platforms"],
  },
];

export function getSpeedTier(tokensPerSecond: number): SpeedTier {
  const tier = TOKEN_SPEED_SCALE.find(
    (t) => tokensPerSecond >= t.minTokensPerSecond && tokensPerSecond < t.maxTokensPerSecond,
  );
  if (!tier && tokensPerSecond >= 200) return TOKEN_SPEED_SCALE[TOKEN_SPEED_SCALE.length - 1];
  return tier ?? TOKEN_SPEED_SCALE[0];
}

export function formatSpeedRating(tokensPerSecond: number): string {
  const tier = getSpeedTier(tokensPerSecond);
  return `${tier.label} (${tier.fitForPurpose})`;
}

export function estimateEvalTime(
  questionCount: number,
  tokensPerSecond: number,
  avgTokensPerQuestion = 300,
): string {
  const totalTokens = questionCount * avgTokensPerQuestion;
  const secondsNeeded = totalTokens / tokensPerSecond;
  const minutes = Math.round(secondsNeeded / 60);
  if (minutes < 1) return `${Math.round(secondsNeeded)}s`;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
