import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  generateGoogleImage,
  getFileExtensionForMimeType,
  hasDirectGoogleImageGeneration,
} from "@/lib/server/google-image-generation";
import {
  runImageGenerationAndWait,
  type ImageGenerationJobPayload,
} from "@/lib/server/image-generation-dispatcher";
import { resolveGuestUserId } from "@/lib/server/guest-user-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const STORAGE_BUCKET = "generated-images";
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const SUPPORTED_IMAGE_MODELS = [
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
] as const;
const SUPPORTED_ASPECT_RATIOS = [
  "match_input_image",
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
const QUOTA_FALLBACK_MODELS = {
  "gemini-3-pro-image-preview": ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"],
  "gemini-3.1-flash-image-preview": ["gemini-2.5-flash-image"],
  "gemini-2.5-flash-image": [],
} as const;

type SupportedImageModel = (typeof SUPPORTED_IMAGE_MODELS)[number];
type SupportedAspectRatio = (typeof SUPPORTED_ASPECT_RATIOS)[number];
type SupportedImageSize = (typeof SUPPORTED_IMAGE_SIZES)[number];
type PromptProvider = "anthropic" | "fallback";

type PromptRow = {
  variantName?: string;
  audience?: string;
  painPoint?: string;
  bodyCopy?: string;
  cta?: string;
  scene?: string;
  words?: string;
};

type CreativeVariantBody = {
  mode?: string;
  sourceId?: string;
  sourceName?: string;
  sourceDescription?: string;
  categoryName?: string;
  plannerPrompt?: string;
  rows?: PromptRow[];
  prompt?: string;
  sourceImage?: string;
  userImages?: string[];
  index?: number;
  model?: string;
  aspectRatio?: string;
  outputFormat?: string;
  imageSize?: string;
  outputResolution?: string;
};

type GenerateImageTaskOutput = {
  dbImageId?: number;
  sourceImageUrl?: string;
  storagePath?: string;
};

const PLATFORM_BRAND_PATTERN = /\bad-?styles?\b/gi;

const sanitizePromptText = (value: string): string => {
  return value.replace(PLATFORM_BRAND_PATTERN, " ").replace(/\s+/g, " ").trim();
};

const sanitizePromptList = (prompts: string[], count: number): string[] => {
  const cleaned = prompts
    .map((prompt) => sanitizePromptText(prompt))
    .filter((prompt) => prompt.length > 0);

  return cleaned.slice(0, count);
};

const parseBody = async (request: Request): Promise<CreativeVariantBody | null> => {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as CreativeVariantBody;
  } catch {
    return null;
  }
};

const isSupportedImageModel = (value: string | undefined): value is SupportedImageModel => {
  return SUPPORTED_IMAGE_MODELS.includes(value as SupportedImageModel);
};

const resolvePreferredImageModel = (value: string | undefined): SupportedImageModel => {
  return isSupportedImageModel(value) ? value : DEFAULT_IMAGE_MODEL;
};

const normalizeAspectRatio = (value: unknown): SupportedAspectRatio => {
  if (typeof value === "string" && SUPPORTED_ASPECT_RATIOS.includes(value as SupportedAspectRatio)) {
    return value as SupportedAspectRatio;
  }

  return "4:5";
};

const normalizeOutputFormat = (value: unknown): "jpg" | "png" | "webp" => {
  if (typeof value !== "string") return "jpg";
  const normalized = value.toLowerCase();
  if (normalized === "png") return "png";
  if (normalized === "webp") return "webp";
  return "jpg";
};

const normalizeImageSize = (imageSize: unknown, outputResolution: unknown): SupportedImageSize => {
  const raw =
    typeof imageSize === "string"
      ? imageSize
      : typeof outputResolution === "string"
        ? outputResolution
        : "1K";
  const normalized = raw.toUpperCase();
  if (SUPPORTED_IMAGE_SIZES.includes(normalized as SupportedImageSize)) {
    return normalized as SupportedImageSize;
  }
  return "1K";
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

const buildQuotaFallbackDispatchSequence = (
  requestedModel: string | undefined,
  requestedImageSize: SupportedImageSize,
): Array<{ model: SupportedImageModel; imageSize: SupportedImageSize }> => {
  const preferredModel = resolvePreferredImageModel(requestedModel);

  return QUOTA_FALLBACK_MODELS[preferredModel].map((fallbackModel) => ({
    model: fallbackModel,
    imageSize: getFallbackImageSize(requestedImageSize, fallbackModel),
  }));
};

const updateImageRecordAsCompleted = async (
  supabase: SupabaseClient,
  imageId: number,
  guestUserId: string,
  storagePath: string,
  model: string,
  imageSize: SupportedImageSize,
) => {
  const { error } = await supabase
    .from("generated_images")
    .update({
      status: "completed",
      storage_path: storagePath,
      updated_at: new Date().toISOString(),
      parameters: {
        guest: true,
        model,
        image_size: imageSize,
        output_resolution: imageSize,
      },
    })
    .eq("id", imageId)
    .eq("user_id", guestUserId);

  if (error) {
    throw new Error(`Failed to persist completion status: ${error.message}`);
  }
};

const getUpstreamStatusFromMessage = (message: string): number | null => {
  const normalized = message.replace(/\\/g, "");
  const statusMatch = normalized.match(/status\s+(\d{3})/i);
  if (statusMatch?.[1]) {
    const parsed = Number.parseInt(statusMatch[1], 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  const codeMatch = normalized.match(/"code"\s*:\s*(\d{3})/i);
  if (codeMatch?.[1]) {
    const parsed = Number.parseInt(codeMatch[1], 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (
    /(rate\s*limit|resource[_\s-]*exhausted|too many requests|quota|throttl|service unavailable)/i.test(
      normalized,
    )
  ) {
    return 429;
  }

  return null;
};

const isQuotaExhaustedDispatchFailure = (message: string): boolean => {
  return getUpstreamStatusFromMessage(message) === 429;
};

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const getSupabaseServiceClient = (): SupabaseClient => {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
};

const createSignedImageUrl = async (supabase: SupabaseClient, storagePath: string): Promise<string | null> => {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 60 * 60);

  if (error || !data?.signedUrl) {
    console.error("[creative-variants] Failed to create signed URL", error);
    return null;
  }

  return data.signedUrl;
};

const ensureErrorStoragePath = (value: string | null | undefined, imageId: number): string => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length > 0) {
    if (/(^|\/)pending_[^/]+$/i.test(normalized)) {
      return normalized.replace(/pending_[^/]+$/i, `failed_${imageId}`);
    }

    return normalized;
  }

  return `guest/failed_${imageId}`;
};

const slugify = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const createGuestImageRecord = async (
  supabase: SupabaseClient,
  prompt: string,
  categorySlug: string,
  referenceImageCount: number,
  model?: string,
): Promise<{ guestUserId: string; imageId: number }> => {
  const guestUserId = await resolveGuestUserId(supabase);
  const tempId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const tempStoragePath = `guest/pending_${tempId}`;
  const parameters: Record<string, unknown> = {
    guest: true,
    category: categorySlug,
    referenceImageCount,
  };

  if (model) {
    parameters.model = model;
  }

  const { data, error } = await supabase
    .from("generated_images")
    .insert({
      user_id: guestUserId,
      prompt,
      parameters,
      status: "queued",
      storage_path: tempStoragePath,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Database error: ${error?.message || "Failed to create guest image record"}`);
  }

  return { guestUserId, imageId: data.id };
};

const parsePromptArray = (raw: string): string[] => {
  const direct = raw.trim();
  const cleaned = direct
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error("Prompt response was not an array");
  }

  return parsed.filter((item): item is string => typeof item === "string");
};

const buildFallbackPrompt = (
  sourceName: string,
  sourceDescription: string,
  categoryName: string,
  plannerPrompt: string,
  row: PromptRow,
): string => {
  const detailBits = [
    `Create a premium ${categoryName.toLowerCase()} advertising image for ${sourceName}.`,
    sourceDescription ? `Product details: ${sourceDescription}.` : "",
    plannerPrompt ? `Campaign direction: ${plannerPrompt}.` : "",
    row.variantName ? `Creative angle: ${row.variantName}.` : "",
    row.audience ? `Audience: ${row.audience}.` : "",
    row.painPoint ? `Pain point: ${row.painPoint}.` : "",
    row.bodyCopy ? `Visual story: ${row.bodyCopy}.` : "",
    row.scene ? `Scene: ${row.scene}.` : "",
    row.words ? `Keywords: ${row.words}.` : "",
    row.cta ? `Call to action in the composition: ${row.cta}.` : "",
    "Keep the product prominent, social-ad ready, sharply lit, and free of logos, watermarks, or interface chrome.",
  ];

  return sanitizePromptText(detailBits.filter(Boolean).join(" "));
};

const generatePromptsWithClaude = async (
  sourceName: string,
  sourceDescription: string,
  categoryName: string,
  plannerPrompt: string,
  rows: PromptRow[],
): Promise<string[]> => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  const systemPrompt = `You are an expert ad creative director. Generate exactly ${rows.length} detailed image-generation prompts for a creative-variants sheet.

Rules:
- Return ONLY a raw JSON array of ${rows.length} strings.
- Each prompt must map to the row at the same index.
- Treat the reference image as the source product to preserve shape, finish, and label placement.
- Keep the product prominent and ad-ready for social placements.
- Do not invent brand names, logos, watermarks, UI chrome, or text overlays unless explicitly requested.
- Specify composition, framing, lighting, mood, and background details.
- Make each row distinct from the others while staying on strategy.`;

  const rowPayload = rows.map((row, index) => ({
    index: index + 1,
    variantName: row.variantName || "",
    audience: row.audience || "",
    painPoint: row.painPoint || "",
    bodyCopy: row.bodyCopy || "",
    scene: row.scene || "",
    words: row.words || "",
    cta: row.cta || "",
  }));

  const userPrompt = `Source product: ${sourceName}
Source description: ${sourceDescription}
Category: ${categoryName}
Planner brief: ${plannerPrompt}
Rows:
${JSON.stringify(rowPayload, null, 2)}

Generate one premium prompt per row in order.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 2400,
      temperature: 0.9,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ text?: string }>;
  };
  const raw = data.content?.[0]?.text?.trim() || "[]";
  return sanitizePromptList(parsePromptArray(raw), rows.length);
};

const persistGuestDispatchParameters = async (
  supabase: SupabaseClient,
  imageId: number,
  guestUserId: string,
  options: {
    categorySlug: string;
    referenceImageCount: number;
    requestedModel: string | undefined;
    requestedImageSize: SupportedImageSize;
    effectiveModel: string | undefined;
    effectiveImageSize: SupportedImageSize;
    fallbackUsed: boolean;
  },
) => {
  if (!options.fallbackUsed) return;

  const parameters: Record<string, unknown> = {
    guest: true,
    category: options.categorySlug,
    referenceImageCount: options.referenceImageCount,
    image_size: options.effectiveImageSize,
    output_resolution: options.effectiveImageSize,
    fallback_model_used: true,
    requested_image_size: options.requestedImageSize,
    fallback_image_size: options.effectiveImageSize,
    requested_model: options.requestedModel || DEFAULT_IMAGE_MODEL,
  };

  if (options.effectiveModel) {
    parameters.model = options.effectiveModel;
  }

  const { error } = await supabase
    .from("generated_images")
    .update({
      parameters,
      updated_at: new Date().toISOString(),
    })
    .eq("id", imageId)
    .eq("user_id", guestUserId);

  if (error) {
    console.error("[creative-variants] Failed to persist dispatch parameters", error);
  }
};

type DispatchResult = Awaited<ReturnType<typeof runImageGenerationAndWait>>;

const runImageGenerationWithQuotaFallback = async (
  payload: ImageGenerationJobPayload,
  options: {
    requestedModel: string | undefined;
    requestedImageSize: SupportedImageSize;
  },
): Promise<{
  execution: DispatchResult;
  effectiveModel: string | undefined;
  effectiveImageSize: SupportedImageSize;
  fallbackUsed: boolean;
}> => {
  try {
    const execution = await runImageGenerationAndWait(payload, {
      pollIntervalMs: 2000,
    });
    return {
      execution,
      effectiveModel: payload.model,
      effectiveImageSize: options.requestedImageSize,
      fallbackUsed: false,
    };
  } catch (initialError) {
    const initialMessage = initialError instanceof Error ? initialError.message : String(initialError);
    if (!isQuotaExhaustedDispatchFailure(initialMessage)) {
      throw initialError;
    }

    const fallbackSequence = buildQuotaFallbackDispatchSequence(
      options.requestedModel,
      options.requestedImageSize,
    );
    let lastError: unknown = initialError;
    const initialModel = payload.model || resolvePreferredImageModel(options.requestedModel);

    for (const fallbackAttempt of fallbackSequence) {
      const fallbackPayload: ImageGenerationJobPayload = {
        ...payload,
        model: fallbackAttempt.model,
        image_size: fallbackAttempt.imageSize,
        output_resolution: fallbackAttempt.imageSize,
      };

      console.warn("[creative-variants] Quota exhausted, retrying with fallback model", {
        dbImageId: payload.dbImageId,
        userId: payload.user_id,
        fromModel: initialModel,
        toModel: fallbackAttempt.model,
        fromImageSize: options.requestedImageSize,
        toImageSize: fallbackAttempt.imageSize,
      });

      try {
        const execution = await runImageGenerationAndWait(fallbackPayload, {
          pollIntervalMs: 2000,
        });

        return {
          execution,
          effectiveModel: fallbackAttempt.model,
          effectiveImageSize: fallbackAttempt.imageSize,
          fallbackUsed: true,
        };
      } catch (fallbackError) {
        lastError = fallbackError;
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        if (!isQuotaExhaustedDispatchFailure(fallbackMessage)) {
          throw fallbackError;
        }
      }
    }

    throw lastError;
  }
};

export async function POST(request: Request) {
  try {
    const body = await parseBody(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid or empty JSON body" }, { status: 400 });
    }

    const mode = body.mode || "prompts";

    if (mode === "prompts") {
      const sourceName = typeof body.sourceName === "string" ? body.sourceName.trim() : "";
      const sourceDescription =
        typeof body.sourceDescription === "string" ? body.sourceDescription.trim() : "";
      const categoryName = typeof body.categoryName === "string" ? body.categoryName.trim() : "Product";
      const plannerPrompt =
        typeof body.plannerPrompt === "string" ? body.plannerPrompt.trim() : "";
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5) : [];

      if (!sourceName || rows.length === 0) {
        return NextResponse.json({ error: "Missing source or rows for prompt generation" }, { status: 400 });
      }

      try {
        const prompts = await generatePromptsWithClaude(
          sourceName,
          sourceDescription,
          categoryName,
          plannerPrompt,
          rows,
        );

        return NextResponse.json({
          prompts,
          provider: "anthropic" as PromptProvider,
        });
      } catch (error) {
        console.error("[creative-variants] Prompt generation fallback", error);
        const prompts = rows.map((row) =>
          buildFallbackPrompt(sourceName, sourceDescription, categoryName, plannerPrompt, row),
        );

        return NextResponse.json({
          prompts,
          provider: "fallback" as PromptProvider,
        });
      }
    }

    if (mode === "image") {
      const prompt = typeof body.prompt === "string" ? sanitizePromptText(body.prompt.trim()) : "";
      const modelRaw = typeof body.model === "string" ? body.model.trim() : "";
      const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "creative-variant";
      const categorySlug = slugify(sourceId) || "creative-variant";
      const index = typeof body.index === "number" ? body.index : 0;
      const aspectRatio = normalizeAspectRatio(body.aspectRatio);
      const outputFormat = normalizeOutputFormat(body.outputFormat);
      const imageSize = normalizeImageSize(body.imageSize, body.outputResolution);
      const model = modelRaw.length > 0 ? modelRaw : undefined;

      if (!prompt) {
        return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
      }

      if (modelRaw.length > 120) {
        return NextResponse.json({ error: "Invalid model" }, { status: 400 });
      }

      const referenceImages: string[] = [];
      if (typeof body.sourceImage === "string" && body.sourceImage.trim()) {
        referenceImages.push(body.sourceImage.trim());
      }
      if (Array.isArray(body.userImages)) {
        body.userImages.slice(0, 5).forEach((image) => {
          if (typeof image === "string" && image.trim()) {
            referenceImages.push(image.trim());
          }
        });
      }

      const supabase = getSupabaseServiceClient();
      const { guestUserId, imageId } = await createGuestImageRecord(
        supabase,
        prompt,
        categorySlug,
        referenceImages.length,
        model,
      );

      const dispatchPayload: ImageGenerationJobPayload = {
        prompt,
        image_input: referenceImages,
        aspect_ratio: aspectRatio,
        image_size: imageSize,
        output_format: outputFormat,
        model,
        dbImageId: imageId,
        user_id: guestUserId,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      };

      let output: GenerateImageTaskOutput | undefined;

      try {
        if (hasDirectGoogleImageGeneration()) {
          const generatedImage = await generateGoogleImage({
            prompt,
            image_input: referenceImages,
            aspect_ratio: aspectRatio,
            image_size: imageSize,
            output_format: outputFormat,
            model,
          });
          const extension = getFileExtensionForMimeType(generatedImage.mimeType);
          const storagePath = `${guestUserId}/${imageId}_${Date.now()}.${extension}`;
          const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, generatedImage.buffer, {
              contentType: generatedImage.mimeType,
              upsert: true,
            });

          if (uploadError) {
            throw new Error(`Supabase upload failed: ${uploadError.message}`);
          }

          await updateImageRecordAsCompleted(
            supabase,
            imageId,
            guestUserId,
            storagePath,
            generatedImage.model,
            generatedImage.imageSize,
          );

          output = {
            dbImageId: imageId,
            storagePath,
          };
        } else {
          const executionResult = await runImageGenerationWithQuotaFallback(dispatchPayload, {
            requestedModel: model,
            requestedImageSize: imageSize,
          });

          await persistGuestDispatchParameters(supabase, imageId, guestUserId, {
            categorySlug,
            referenceImageCount: referenceImages.length,
            requestedModel: model,
            requestedImageSize: imageSize,
            effectiveModel: executionResult.effectiveModel,
            effectiveImageSize: executionResult.effectiveImageSize,
            fallbackUsed: executionResult.fallbackUsed,
          });

          output = executionResult.execution.output as GenerateImageTaskOutput;
        }
      } catch (taskError) {
        const taskErrorMessage = taskError instanceof Error ? taskError.message : String(taskError);
        const statusCode = getUpstreamStatusFromMessage(taskErrorMessage) || 500;

        const { data: imageRecord } = await supabase
          .from("generated_images")
          .select("storage_path")
          .eq("id", imageId)
          .maybeSingle();

        await supabase
          .from("generated_images")
          .update({
            status: "error",
            updated_at: new Date().toISOString(),
            storage_path: ensureErrorStoragePath(imageRecord?.storage_path, imageId),
          })
          .eq("id", imageId);

        return NextResponse.json({ error: taskErrorMessage }, { status: statusCode });
      }

      const storagePath = typeof output?.storagePath === "string" ? output.storagePath : "";
      const signedUrl = storagePath ? await createSignedImageUrl(supabase, storagePath) : null;
      const fallbackUrl =
        typeof output?.sourceImageUrl === "string" && output.sourceImageUrl.length > 0
          ? output.sourceImageUrl
          : null;
      const imageUrl = signedUrl || fallbackUrl;

      if (!imageUrl) {
        return NextResponse.json(
          { error: "Image generation completed but no URL was returned" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        index,
        id: output?.dbImageId || imageId,
        prompt,
        url: imageUrl,
        storagePath,
        ...(model ? { model } : {}),
      });
    }

    return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
  } catch (error) {
    console.error("[creative-variants] Route error", error);
    const message = error instanceof Error ? error.message : "Generation failed";
    const statusCode = getUpstreamStatusFromMessage(message) || 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
