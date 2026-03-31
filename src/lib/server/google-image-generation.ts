import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  createPartFromBase64,
  createPartFromText,
  createPartFromUri,
  type Part,
  type SafetySetting,
} from "@google/genai";

const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const MAX_REFERENCE_IMAGES = 5;
const REFERENCE_FETCH_TIMEOUT_MS = 20_000;
const REFERENCE_FETCH_RETRIES = 2;
const GENERATION_MAX_RETRIES = 2;
const GENERATION_RETRY_BASE_DELAY_MS = 1_500;

const SUPPORTED_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

const SUPPORTED_IMAGE_SIZES = ["1K", "2K", "4K"] as const;
const SUPPORTED_IMAGE_MODELS = [
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
] as const;

const QUOTA_FALLBACK_MODELS: Record<
  (typeof SUPPORTED_IMAGE_MODELS)[number],
  Array<(typeof SUPPORTED_IMAGE_MODELS)[number]>
> = {
  "gemini-3-pro-image-preview": ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"],
  "gemini-3.1-flash-image-preview": ["gemini-2.5-flash-image"],
  "gemini-2.5-flash-image": [],
};

type SupportedAspectRatio = (typeof SUPPORTED_ASPECT_RATIOS)[number];
type SupportedImageSize = (typeof SUPPORTED_IMAGE_SIZES)[number];
type SupportedImageModel = (typeof SUPPORTED_IMAGE_MODELS)[number];

export type GoogleImageGenerationPayload = {
  prompt: string;
  model?: string;
  aspect_ratio?: string;
  output_format?: string;
  output_resolution?: string;
  image_size?: string;
  image_input?: string[];
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
};

export type GeneratedGoogleImageResult = {
  buffer: Buffer;
  mimeType: string;
  model: SupportedImageModel;
  imageSize: SupportedImageSize;
  generatedText?: string;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const getErrorNumericCode = (error: unknown): number | null => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as { code?: unknown; status?: unknown };
  if (typeof candidate.code === "number" && Number.isFinite(candidate.code)) {
    return candidate.code;
  }
  if (typeof candidate.status === "number" && Number.isFinite(candidate.status)) {
    return candidate.status;
  }

  return null;
};

const getEmbeddedHttpCode = (message: string): number | null => {
  const normalized = message.replace(/\\/g, "");
  const codeMatch = normalized.match(/"code"\s*:\s*(\d{3})/i);
  if (codeMatch?.[1]) {
    const parsed = Number.parseInt(codeMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const isQuotaExhaustedError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  if (
    /(resource[_\s-]*exhausted|rate\s*limit|too many requests|quota|throttl|service unavailable)/i.test(
      message,
    )
  ) {
    return true;
  }

  const numericCode = getErrorNumericCode(error);
  if (numericCode === 429) return true;

  const embeddedCode = getEmbeddedHttpCode(message);
  return embeddedCode === 429;
};

const isRetryableGenerationError = (error: unknown): boolean => {
  const message = getErrorMessage(error);
  const lowered = message.toLowerCase();
  const transientPhrases = [
    "resource_exhausted",
    "resource exhausted",
    "rate limit",
    "too many requests",
    "temporarily unavailable",
    "deadline exceeded",
    "service unavailable",
    "internal error",
    "unavailable",
  ];

  if (transientPhrases.some((phrase) => lowered.includes(phrase))) {
    return true;
  }

  const codeFromObject = getErrorNumericCode(error);
  if (codeFromObject !== null && [429, 500, 502, 503, 504].includes(codeFromObject)) {
    return true;
  }

  const codeFromMessage = getEmbeddedHttpCode(message);
  return codeFromMessage !== null && [429, 500, 502, 503, 504].includes(codeFromMessage);
};

const isUnsupportedOutputMimeTypeError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("outputmimetype parameter is not supported") ||
    (message.includes("outputmimetype") && message.includes("not supported"))
  );
};

const normalizeAspectRatio = (value: string | undefined): SupportedAspectRatio | undefined => {
  if (!value || value === "match_input_image") {
    return undefined;
  }

  if (SUPPORTED_ASPECT_RATIOS.includes(value as SupportedAspectRatio)) {
    return value as SupportedAspectRatio;
  }

  throw new Error(`Unsupported aspect_ratio: ${value}`);
};

const normalizeImageSize = (
  imageSize: string | undefined,
  outputResolution: string | undefined,
): SupportedImageSize => {
  const value = (imageSize || outputResolution || "1K").trim().toUpperCase();

  if (SUPPORTED_IMAGE_SIZES.includes(value as SupportedImageSize)) {
    return value as SupportedImageSize;
  }

  throw new Error(`Unsupported image size: ${value}`);
};

const normalizeOutputMimeType = (value: string | undefined): string => {
  const format = (value || "png").trim().toLowerCase();

  if (format === "png") return "image/png";
  if (format === "jpg" || format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";

  throw new Error(`Unsupported output_format: ${value}`);
};

export const getFileExtensionForMimeType = (mimeType: string): string => {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
};

const normalizeMimeType = (value: string | null): string | null => {
  if (!value) return null;
  const mimeType = value.split(";")[0]?.trim().toLowerCase() || "";
  return mimeType.startsWith("image/") ? mimeType : null;
};

const guessMimeTypeFromUri = (uri: string): string => {
  try {
    const parsedUrl = new URL(uri);
    const extension = parsedUrl.pathname.split(".").pop()?.toLowerCase();
    if (extension === "png") return "image/png";
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "webp") return "image/webp";
    if (extension === "heic") return "image/heic";
    if (extension === "heif") return "image/heif";
  } catch {
    const extension = uri.split(".").pop()?.toLowerCase();
    if (extension === "png") return "image/png";
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "webp") return "image/webp";
    if (extension === "heic") return "image/heic";
    if (extension === "heif") return "image/heif";
  }

  return "image/jpeg";
};

const parseDataUri = (uri: string): { mimeType: string; data: string } | null => {
  const match = uri.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  const mimeType = match[1]?.trim().toLowerCase();
  const data = match[2]?.trim();

  if (!mimeType || !data || !mimeType.startsWith("image/")) {
    return null;
  }

  return { mimeType, data };
};

const isRetryableReferenceFetchStatus = (status: number): boolean => {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
};

const fetchReferenceImage = async (
  input: string,
): Promise<{ buffer: Buffer; mimeType: string }> => {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= REFERENCE_FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(input, {
        signal: AbortSignal.timeout(REFERENCE_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        if (isRetryableReferenceFetchStatus(response.status) && attempt < REFERENCE_FETCH_RETRIES) {
          const delayMs = 500 * (attempt + 1) + Math.floor(Math.random() * 250);
          await sleep(delayMs);
          continue;
        }
        throw new Error(`Failed to fetch reference image: ${response.status}`);
      }

      const contentType = normalizeMimeType(response.headers.get("content-type"));
      const mimeType = contentType || guessMimeTypeFromUri(input);
      const buffer = Buffer.from(await response.arrayBuffer());
      return { buffer, mimeType };
    } catch (error) {
      lastError = error;
      if (attempt >= REFERENCE_FETCH_RETRIES) {
        break;
      }

      const errorMessage = getErrorMessage(error).toLowerCase();
      const isTimeout = errorMessage.includes("aborted") || errorMessage.includes("timeout");
      const isNetwork = errorMessage.includes("fetch failed") || errorMessage.includes("network");
      if (!isTimeout && !isNetwork) {
        break;
      }

      const delayMs = 500 * (attempt + 1) + Math.floor(Math.random() * 250);
      await sleep(delayMs);
    }
  }

  throw new Error(`Failed to fetch reference image: ${getErrorMessage(lastError)}`);
};

const toImagePart = async (input: string): Promise<Part> => {
  if (input.startsWith("gs://")) {
    return createPartFromUri(input, guessMimeTypeFromUri(input));
  }

  const dataUri = parseDataUri(input);
  if (dataUri) {
    return createPartFromBase64(dataUri.data, dataUri.mimeType);
  }

  if (input.startsWith("http://") || input.startsWith("https://")) {
    const { buffer, mimeType } = await fetchReferenceImage(input);
    return createPartFromBase64(buffer.toString("base64"), mimeType);
  }

  throw new Error("Unsupported image_input format. Use gs://, data URI, or http(s) URL.");
};

const buildReferenceImageParts = async (imageInput: string[] | undefined): Promise<Part[]> => {
  const validInputs = (Array.isArray(imageInput) ? imageInput : [])
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .slice(0, MAX_REFERENCE_IMAGES);

  const parts: Part[] = [];
  for (const item of validInputs) {
    parts.push(await toImagePart(item));
  }

  return parts;
};

const buildSafetySettings = (): SafetySetting[] => {
  return [
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.OFF,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.OFF,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.OFF,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.OFF,
    },
  ];
};

const getGoogleApiKey = (): string | null => {
  return (
    process.env.GOOGLE_CLOUD_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.NANO_BANANA_API_KEY ||
    null
  );
};

export const hasDirectGoogleImageGeneration = (): boolean => {
  return Boolean(getGoogleApiKey());
};

const getGoogleClient = (): GoogleGenAI => {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    throw new Error(
      "Missing Google image API credentials. Set GOOGLE_CLOUD_API_KEY, GOOGLE_API_KEY, GEMINI_API_KEY, or NANO_BANANA_API_KEY.",
    );
  }

  return new GoogleGenAI({ apiKey });
};

const resolveModel = (value: string | undefined): SupportedImageModel => {
  const requestedModel =
    typeof value === "string" && value.trim().length > 0 ? value.trim() : DEFAULT_IMAGE_MODEL;

  if (SUPPORTED_IMAGE_MODELS.includes(requestedModel as SupportedImageModel)) {
    return requestedModel as SupportedImageModel;
  }

  return DEFAULT_IMAGE_MODEL;
};

const getFallbackImageSize = (
  requestedImageSize: SupportedImageSize,
  model: SupportedImageModel,
): SupportedImageSize => {
  if (requestedImageSize === "4K" && model !== "gemini-3-pro-image-preview") {
    return "2K";
  }

  return requestedImageSize;
};

const collectCandidateParts = (response: {
  parts?: Part[];
  candidates?: Array<{ content?: { parts?: Part[] } }>;
}): Part[] => {
  const directParts = Array.isArray(response.parts) ? response.parts : [];
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const candidateParts = candidates.flatMap((candidate) => candidate.content?.parts || []);
  return [...directParts, ...candidateParts];
};

const extractGeneratedImage = (
  response: {
    text?: string;
    parts?: Part[];
    candidates?: Array<{ content?: { parts?: Part[] } }>;
  },
  fallbackMimeType: string,
): { buffer: Buffer; mimeType: string; generatedText?: string } => {
  const parts = collectCandidateParts(response);

  for (const part of parts) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || fallbackMimeType;
      return {
        buffer: Buffer.from(part.inlineData.data, "base64"),
        mimeType,
        generatedText: response.text?.trim(),
      };
    }
  }

  const text = response.text?.trim() || "";
  const modelHint =
    "Model returned no image data. Ensure an image-capable model is used (gemini-3.1-flash-image-preview / gemini-3-pro-image-preview / gemini-2.5-flash-image).";

  throw new Error(
    text.length > 0
      ? `No image returned by Google model: ${text}. ${modelHint}`
      : `No image returned by Google model. ${modelHint}`,
  );
};

const generateImageAttempt = async (
  payload: GoogleImageGenerationPayload,
  model: SupportedImageModel,
  imageSize: SupportedImageSize,
  client: GoogleGenAI,
): Promise<{ buffer: Buffer; mimeType: string; generatedText?: string }> => {
  const aspectRatio = normalizeAspectRatio(payload.aspect_ratio);
  const outputMimeType = normalizeOutputMimeType(payload.output_format);
  const referenceImageParts = await buildReferenceImageParts(payload.image_input);
  const imageConfig: Record<string, unknown> = {
    aspectRatio,
    imageSize,
  };

  const baseConfig = {
    temperature: typeof payload.temperature === "number" ? payload.temperature : 1,
    topP: typeof payload.top_p === "number" ? payload.top_p : 0.95,
    maxOutputTokens:
      typeof payload.max_output_tokens === "number" ? payload.max_output_tokens : 32768,
    responseModalities: ["IMAGE"],
    safetySettings: buildSafetySettings(),
  };

  const requestBody = {
    model,
    contents: [
      {
        role: "user",
        parts: [...referenceImageParts, createPartFromText(payload.prompt)],
      },
    ],
    config: {
      ...baseConfig,
      imageConfig,
    },
  };

  let response;
  try {
    response = await client.models.generateContent(requestBody);
  } catch (error) {
    if (imageConfig.outputMimeType && isUnsupportedOutputMimeTypeError(error)) {
      response = await client.models.generateContent({
        ...requestBody,
        config: {
          ...baseConfig,
          imageConfig: {
            aspectRatio,
            imageSize,
          },
        },
      });
    } else {
      throw error;
    }
  }

  return extractGeneratedImage(response, outputMimeType);
};

export const generateGoogleImage = async (
  payload: GoogleImageGenerationPayload,
): Promise<GeneratedGoogleImageResult> => {
  const client = getGoogleClient();
  const requestedImageSize = normalizeImageSize(payload.image_size, payload.output_resolution);
  const primaryModel = resolveModel(payload.model);
  const attempts: Array<{ model: SupportedImageModel; imageSize: SupportedImageSize }> = [
    {
      model: primaryModel,
      imageSize: requestedImageSize,
    },
    ...QUOTA_FALLBACK_MODELS[primaryModel].map((fallbackModel) => ({
      model: fallbackModel,
      imageSize: getFallbackImageSize(requestedImageSize, fallbackModel),
    })),
  ];

  let lastError: unknown = null;

  for (const attempt of attempts) {
    let retryCount = 0;

    while (retryCount <= GENERATION_MAX_RETRIES) {
      try {
        const generated = await generateImageAttempt(payload, attempt.model, attempt.imageSize, client);
        return {
          ...generated,
          model: attempt.model,
          imageSize: attempt.imageSize,
        };
      } catch (error) {
        lastError = error;

        if (isQuotaExhaustedError(error)) {
          break;
        }

        if (!isRetryableGenerationError(error) || retryCount >= GENERATION_MAX_RETRIES) {
          throw error;
        }

        const delayMs =
          GENERATION_RETRY_BASE_DELAY_MS * 2 ** retryCount + Math.floor(Math.random() * 300);
        await sleep(delayMs);
        retryCount += 1;
      }
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
};
