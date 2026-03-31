export type ImageGenerationBackend = "cloud-run";

export interface ImageGenerationJobPayload {
  prompt: string;
  model?: string;
  aspect_ratio?: string;
  output_format?: string;
  output_resolution?: string;
  image_size?: string;
  image_input?: string[];
  dbImageId: number;
  user_id: string;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
}

interface CloudRunResult {
  success?: boolean;
  error?: string;
  storagePath?: string;
  dbImageId?: number;
  sourceImageUrl?: string;
  [key: string]: unknown;
}

interface WaitDispatchResult {
  backend: ImageGenerationBackend;
  runId?: string;
  output: CloudRunResult;
}

const DEFAULT_CLOUD_RUN_URL = "https://generate-image-1025866730634.us-central1.run.app";
const IMAGE_GENERATION_BACKEND: ImageGenerationBackend = "cloud-run";
const CLOUD_RUN_FETCH_TIMEOUT_MS = 45_000;
const CLOUD_RUN_FETCH_RETRIES = 2;
const RETRYABLE_CLOUD_RUN_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const getCloudRunErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const cause =
      error.cause instanceof Error
        ? error.cause.message
        : typeof error.cause === "string"
          ? error.cause
          : "";

    return cause && !error.message.includes(cause) ? `${error.message}: ${cause}` : error.message;
  }

  return String(error);
};

const isRetryableCloudRunFetchError = (error: unknown): boolean => {
  const message = getCloudRunErrorMessage(error).toLowerCase();
  return /(fetch failed|network|timed out|timeout|socket|econnreset|eai_again|temporarily unavailable)/i.test(
    message,
  );
};

const isLocalCloudRunUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return ["127.0.0.1", "localhost", "0.0.0.0", "::1"].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
};

const getCloudRunUrl = (): string => {
  const url =
    process.env.GOOGLE_CLOUD_RUN_GENERATE_IMAGE_URL ||
    process.env.NEXT_PUBLIC_GOOGLE_CLOUD_RUN_GENERATE_IMAGE_URL ||
    DEFAULT_CLOUD_RUN_URL;

  if (!url) {
    throw new Error("Missing Cloud Run URL for image generation");
  }

  return url;
};

const getCloudRunHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const secretToken = process.env.CLOUD_RUN_SECRET_TOKEN;
  if (secretToken) {
    headers.Authorization = `Bearer ${secretToken}`;
  }

  return headers;
};

const performCloudRunRequest = async (
  cloudRunUrl: string,
  payload: ImageGenerationJobPayload,
): Promise<CloudRunResult> => {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= CLOUD_RUN_FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(cloudRunUrl, {
        method: "POST",
        headers: getCloudRunHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(CLOUD_RUN_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Cloud Run service failed with status ${response.status}: ${errorText}`);

        if (
          RETRYABLE_CLOUD_RUN_STATUS_CODES.has(response.status) &&
          attempt < CLOUD_RUN_FETCH_RETRIES
        ) {
          await sleep(500 * (attempt + 1));
          continue;
        }

        throw error;
      }

      return (await response.json()) as CloudRunResult;
    } catch (error) {
      lastError = error;
      if (attempt >= CLOUD_RUN_FETCH_RETRIES || !isRetryableCloudRunFetchError(error)) {
        break;
      }

      await sleep(500 * (attempt + 1));
    }
  }

  throw new Error(`Cloud Run request failed after retries: ${getCloudRunErrorMessage(lastError)}`);
};

const callCloudRun = async (payload: ImageGenerationJobPayload): Promise<CloudRunResult> => {
  const cloudRunUrl = getCloudRunUrl();

  try {
    return await performCloudRunRequest(cloudRunUrl, payload);
  } catch (error) {
    if (!isLocalCloudRunUrl(cloudRunUrl) || cloudRunUrl === DEFAULT_CLOUD_RUN_URL) {
      throw error;
    }

    console.warn("Local Cloud Run URL unreachable, falling back to hosted endpoint", {
      configuredUrl: cloudRunUrl,
      fallbackUrl: DEFAULT_CLOUD_RUN_URL,
      message: getCloudRunErrorMessage(error),
    });

    return await performCloudRunRequest(DEFAULT_CLOUD_RUN_URL, payload);
  }
};

export const runImageGenerationAndWait = async (
  payload: ImageGenerationJobPayload,
  options?: { pollIntervalMs?: number },
): Promise<WaitDispatchResult> => {
  void options;

  const output = await callCloudRun(payload);
  return {
    backend: IMAGE_GENERATION_BACKEND,
    output,
  };
};
