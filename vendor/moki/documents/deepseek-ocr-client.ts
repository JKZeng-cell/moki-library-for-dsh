import { z } from "zod";

const modelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string() }).passthrough()).optional(),
}).passthrough();

const completionResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.union([
      z.string(),
      z.array(z.object({ text: z.string().optional() }).passthrough()),
    ]) }),
  }).passthrough()).min(1),
}).passthrough();

export type DeepSeekOcrConfiguration = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey?: string | null;
  timeoutSeconds: number;
};

export type DeepSeekOcrStatus = {
  state: "ready" | "disabled" | "unavailable";
  configured: boolean;
  model: string;
  endpoint: string;
  message: string;
};

function apiUrl(baseUrl: string, suffix: "models" | "chat/completions"): string {
  const normalized = baseUrl.trim().replace(/\/+$/u, "");
  if (normalized.endsWith("/chat/completions")) {
    return suffix === "chat/completions"
      ? normalized
      : `${normalized.slice(0, -"/chat/completions".length)}/models`;
  }
  return `${normalized}/${suffix}`;
}

function requestHeaders(apiKey?: string | null): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey?.trim() || "EMPTY"}`,
  };
}

async function responseError(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`;
  try {
    const payload = await response.json() as {
      error?: string | { message?: string };
      message?: string;
    };
    if (typeof payload.error === "string") return payload.error;
    return payload.error?.message || payload.message || fallback;
  } catch {
    return fallback;
  }
}

export async function verifyDeepSeekOcr(
  configuration: DeepSeekOcrConfiguration,
  fetchImpl: typeof fetch = fetch,
): Promise<DeepSeekOcrStatus> {
  const endpoint = apiUrl(configuration.baseUrl, "models");
  if (!configuration.enabled) {
    return {
      state: "disabled",
      configured: false,
      model: configuration.model,
      endpoint,
      message: "DeepSeek OCR 已关闭",
    };
  }
  try {
    const response = await fetchImpl(endpoint, {
      headers: requestHeaders(configuration.apiKey),
      signal: AbortSignal.timeout(Math.min(configuration.timeoutSeconds * 1_000, 30_000)),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const parsed = modelsResponseSchema.parse(await response.json());
    const availableModels = parsed.data?.map((entry) => entry.id) ?? [];
    const modelAvailable = availableModels.length === 0 || availableModels.includes(configuration.model);
    return {
      state: modelAvailable ? "ready" : "unavailable",
      configured: true,
      model: configuration.model,
      endpoint,
      message: modelAvailable
        ? `DeepSeek OCR 服务可用（${configuration.model}）`
        : `服务可访问，但未发现模型 ${configuration.model}`,
    };
  } catch (error) {
    return {
      state: "unavailable",
      configured: false,
      model: configuration.model,
      endpoint,
      message: error instanceof Error
        ? `DeepSeek OCR 服务不可用：${error.message}`
        : "DeepSeek OCR 服务不可用",
    };
  }
}

export async function recognizeWithDeepSeekOcr(
  configuration: DeepSeekOcrConfiguration,
  imageDataUrl: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  if (!configuration.enabled) throw new Error("DeepSeek OCR 已关闭，请先在 AI 设置中启用");
  const response = await fetchImpl(apiUrl(configuration.baseUrl, "chat/completions"), {
    method: "POST",
    headers: requestHeaders(configuration.apiKey),
    body: JSON.stringify({
      model: configuration.model,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl } },
          { type: "text", text: "<|grounding|>Convert the document to markdown." },
        ],
      }],
      temperature: 0,
      max_tokens: 8_192,
      extra_body: {
        skip_special_tokens: false,
        vllm_xargs: {
          ngram_size: 30,
          window_size: 90,
          whitelist_token_ids: [128821, 128822],
        },
      },
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(configuration.timeoutSeconds * 1_000)]) : AbortSignal.timeout(configuration.timeoutSeconds * 1_000),
  });
  if (!response.ok) throw new Error(`DeepSeek OCR 识别失败：${await responseError(response)}`);
  const parsed = completionResponseSchema.parse(await response.json());
  const content = parsed.choices[0]?.message.content;
  const text = typeof content === "string"
    ? content
    : content?.map((part) => part.text ?? "").filter(Boolean).join("\n") ?? "";
  if (!text.trim()) throw new Error("DeepSeek OCR 未返回识别文本");
  return text.trim();
}
