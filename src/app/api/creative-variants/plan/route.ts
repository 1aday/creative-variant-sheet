import { NextRequest, NextResponse } from "next/server";
import Cerebras from "@cerebras/cerebras_cloud_sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const cerebras = process.env.CEREBRAS_API_KEY
  ? new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY })
  : null;

const DEFAULT_PLANNED_VARIANT_COUNT = 4;
const MAX_PLANNED_VARIANT_COUNT = 5;
const MIN_PLANNED_VARIANT_COUNT = 1;
const CEREBRAS_PLANNER_MAX_COMPLETION_TOKENS = 4096;
const PLANNER_MODEL_TIMEOUT_MS = 45_000;
const DEFAULT_PLANNER_MODEL =
  process.env.CEREBRAS_PLANNER_MODEL?.trim() || "qwen-3-235b-a22b-instruct-2507";
const PLANNER_MODEL_FALLBACKS = ["qwen-3-235b-a22b-instruct-2507", "llama3.1-8b"] as const;
const ASPECT_RATIOS = ["match_input_image"] as const;
const TEST_PATTERNS = [
  "same_message_different_audiences",
  "same_audience_different_pain_points",
  "same_audience_different_languages",
  "mixed_experiment",
] as const;

type AspectRatio = (typeof ASPECT_RATIOS)[number];
type TestPattern = (typeof TEST_PATTERNS)[number];

type PromptSections = {
  objective: string;
  audience: string;
  painPoint: string;
  message: string;
  visualDirection: string;
  language: string;
  offer: string;
};

type PlannedVariant = {
  variantName: string;
  audience: string;
  painPoint: string;
  language: string;
  bodyCopy: string;
  cta: string;
  scene: string;
  words: string;
  aspectRatio: AspectRatio;
  imageModelPrompt: string;
  promptSections: PromptSections;
};

type PlannerCompletion = {
  choices: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      refusal?: string | null;
    } | null;
  }>;
};

const buildCreativeVariantPlanSchema = (variantCount: number) => ({
  name: "creative_variant_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["strategySummary", "testPattern", "variants"],
    properties: {
      strategySummary: { type: "string" },
      testPattern: {
        type: "string",
        enum: [...TEST_PATTERNS],
      },
      variants: {
        type: "array",
        minItems: variantCount,
        maxItems: variantCount,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "variantName",
            "audience",
            "painPoint",
            "language",
            "bodyCopy",
            "cta",
            "scene",
            "words",
            "aspectRatio",
            "imageModelPrompt",
            "promptSections",
          ],
          properties: {
            variantName: { type: "string" },
            audience: { type: "string" },
            painPoint: { type: "string" },
            language: { type: "string" },
            bodyCopy: { type: "string" },
            cta: { type: "string" },
            scene: { type: "string" },
            words: { type: "string" },
            aspectRatio: {
              type: "string",
              enum: [...ASPECT_RATIOS],
            },
            imageModelPrompt: { type: "string" },
            promptSections: {
              type: "object",
              additionalProperties: false,
              required: [
                "objective",
                "audience",
                "painPoint",
                "message",
                "visualDirection",
                "language",
                "offer",
              ],
              properties: {
                objective: { type: "string" },
                audience: { type: "string" },
                painPoint: { type: "string" },
                message: { type: "string" },
                visualDirection: { type: "string" },
                language: { type: "string" },
                offer: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
});

const buildCerebrasVariantPlanSchema = (variantCount: number) => {
  const schema = buildCreativeVariantPlanSchema(variantCount);
  const variantsProperty = asRecord(schema.schema.properties.variants);

  if (variantsProperty) {
    delete variantsProperty.minItems;
    delete variantsProperty.maxItems;
  }

  return schema;
};

const PLATFORM_BRAND_PATTERN = /\bad-?styles?\b/gi;

const stripPlatformBrandTokens = (value: string): string => {
  return value.replace(PLATFORM_BRAND_PATTERN, " ").replace(/\s+/g, " ").trim();
};

const PLANNER_SYSTEM_PROMPT = [
  "You are a senior performance creative strategist for paid social ads.",
  "You will receive one product image and a testing goal.",
  "Use image understanding: analyze the product image's composition, product form factor, lighting style, and visual cues before proposing variants.",
  "Create distinct testable variants with clear experimental separation based on the user's requested change axis.",
  "The user decides what to vary: treat any requested variable as valid (visual attribute, copy angle, audience, language, offer, locale, style, etc).",
  "Extract the primary change axis from the user goal and build the requested variants as a targeted sweep across concrete values for that axis.",
  "For each variant, generate a concrete imageModelPrompt that can be sent directly to an image model for editing the reference image.",
  "When user asks to vary one attribute (color, material, background, text, pose, etc), keep everything else stable and only change that attribute per variant.",
  "If the requested axis is casting or demographics, keep framing, proof layout, product usage cues, and lighting stable while changing only age, gender presentation, and race as directed.",
  "Never inject platform/app brand identity (e.g., AdStyle, Adstyles) or UI theme colors unless explicitly provided in user input.",
  "Return strict JSON only that matches the provided schema and contains no extra keys.",
].join(" ");

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const cleanText = (value: unknown, fallback = ""): string => {
  if (typeof value !== "string") return fallback;
  return value.replace(/\s+/g, " ").trim() || fallback;
};

const withTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const clampVariantCount = (value: unknown): number => {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PLANNED_VARIANT_COUNT;
  return Math.min(MAX_PLANNED_VARIANT_COUNT, Math.max(MIN_PLANNED_VARIANT_COUNT, Math.round(parsed)));
};

const buildPlannerUserPrompt = (params: {
  testGoal: string;
  productName: string;
  productCategory: string;
  productDescription: string;
  productTags: string[];
  variantCount: number;
}) => {
  const safeGoal = stripPlatformBrandTokens(params.testGoal);
  const safeProductName = stripPlatformBrandTokens(params.productName);
  const safeCategory = stripPlatformBrandTokens(params.productCategory);
  const safeDescription = stripPlatformBrandTokens(params.productDescription);
  const safeTags = params.productTags.map((tag) => stripPlatformBrandTokens(tag)).filter(Boolean);

  return [
    `Testing goal: ${safeGoal}`,
    `Product name: ${safeProductName}`,
    `Product category: ${safeCategory}`,
    `Product description: ${safeDescription || "none provided"}`,
    `Product tags: ${safeTags.join(", ") || "none provided"}`,
    "",
    "The product image is the source of truth for brand/vibe. Use visual evidence from that image when writing scenes and messaging angles.",
    "Do not invent brand names, logos, app/platform references, or UI theme palettes.",
    "",
    "You must fill these table columns for each variant:",
    "variantName, audience, painPoint, language, bodyCopy, cta, scene, words, aspectRatio, imageModelPrompt, promptSections",
    "",
    "Rules:",
    `1) Return exactly ${params.variantCount} variants (${params.variantCount} distinct ad concepts).`,
    "2) Derive the primary variation axis directly from the testing goal. Do not substitute a different axis unless the user asks for mixed testing.",
    "3) Make each variant genuinely different for testing by using concrete option values along that axis (not superficial rewrites).",
    "4) If the user request implies option sets (e.g., colors, audiences, languages, claim styles), make each variant map to one explicit option.",
    "5) variantName should reflect the option value being tested so rows are scannable.",
    "6) Keep bodyCopy concise and ad-ready (max 22 words).",
    "7) Keep cta concise (max 5 words).",
    "8) words must be comma-separated strategic keywords (4 to 8 terms).",
    "9) Set aspectRatio to match_input_image for every variant.",
    "10) imageModelPrompt must be a direct instruction for image editing using the reference image, explicitly stating what to change and what to keep fixed.",
    "11) If user requested one specific change axis, vary only that axis across variants and keep all other visual factors consistent.",
    "12) promptSections must be practical building blocks for image generation prompts.",
    "13) If the user is testing model demographics, keep composition, crop, skincare application, and proof text treatment stable while varying casting attributes only.",
    "14) Return JSON only. No preamble, no markdown, no code fences, no explanation.",
    "",
    "JSON response format example:",
    JSON.stringify(
      {
        strategySummary: `${params.variantCount}-variant plan optimized for audience and message testing.`,
        testPattern: "mixed_experiment",
        variants: [
          {
            variantName: "Variant 1",
            audience: "Example audience",
            painPoint: "Example pain point",
            language: "English",
            bodyCopy: "Example concise body copy",
            cta: "Shop now",
            scene: "Example scene direction",
            words: "Keyword A, Keyword B, Keyword C",
            aspectRatio: "match_input_image",
            imageModelPrompt:
              "Keep composition, model pose, and product unchanged. Change only nail color to classic red with realistic gloss and natural skin tones.",
            promptSections: {
              objective: "Example objective",
              audience: "Example audience",
              painPoint: "Example pain point",
              message: "Example core message",
              visualDirection: "Example visual direction",
              language: "English",
              offer: "Example offer/CTA angle",
            },
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
};

const clampWords = (value: unknown): string => {
  const text = cleanText(value);
  if (!text) return "Benefit-led, Scroll-stopping, Product-first";

  return text
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
};

const normalizeAspectRatio = (value: unknown): AspectRatio => {
  void value;
  return "match_input_image";
};

const normalizeTestPattern = (value: unknown): TestPattern => {
  if (typeof value !== "string") return "mixed_experiment";
  return TEST_PATTERNS.includes(value as TestPattern)
    ? (value as TestPattern)
    : "mixed_experiment";
};

const fallbackVariant = (index: number, language = "English"): PlannedVariant => {
  return {
    variantName: `Variant ${index + 1}`,
    audience: "Core target audience",
    painPoint: "Primary pain point",
    language,
    bodyCopy: "Lead with one concrete product benefit and keep the message concise.",
    cta: "Shop now",
    scene: "Product-led studio setup with clear focal point",
    words: "Benefit-first, High-contrast, Conversion-focused",
    aspectRatio: "match_input_image",
    imageModelPrompt:
      "Keep product identity, framing, and lighting fixed. Apply one controlled visual change for this variant only.",
    promptSections: {
      objective: "Test conversion-focused product message",
      audience: "Core target audience",
      painPoint: "Primary pain point",
      message: "Lead with strongest product benefit and clear value proposition",
      visualDirection: "Keep product centered with clean performance-marketing composition",
      language,
      offer: "Strong CTA with direct purchase intent",
    },
  };
};

const normalizeVariant = (rawVariant: unknown, index: number): PlannedVariant => {
  const variantRecord = asRecord(rawVariant);
  const defaultRow = fallbackVariant(index);
  if (!variantRecord) return defaultRow;

  const promptSectionsRecord = asRecord(variantRecord.promptSections);

  const variantName = cleanText(variantRecord.variantName, defaultRow.variantName);
  const audience = cleanText(variantRecord.audience, defaultRow.audience);
  const painPoint = cleanText(variantRecord.painPoint, defaultRow.painPoint);
  const language = cleanText(variantRecord.language, defaultRow.language);
  const bodyCopy = cleanText(variantRecord.bodyCopy, defaultRow.bodyCopy);
  const cta = cleanText(variantRecord.cta, defaultRow.cta);
  const scene = cleanText(variantRecord.scene, defaultRow.scene);
  const imageModelPrompt = cleanText(variantRecord.imageModelPrompt, defaultRow.imageModelPrompt);

  return {
    variantName,
    audience,
    painPoint,
    language,
    bodyCopy,
    cta,
    scene,
    words: clampWords(variantRecord.words),
    aspectRatio: normalizeAspectRatio(variantRecord.aspectRatio),
    imageModelPrompt,
    promptSections: {
      objective: cleanText(promptSectionsRecord?.objective, defaultRow.promptSections.objective),
      audience: cleanText(promptSectionsRecord?.audience, audience || defaultRow.promptSections.audience),
      painPoint: cleanText(promptSectionsRecord?.painPoint, painPoint || defaultRow.promptSections.painPoint),
      message: cleanText(promptSectionsRecord?.message, bodyCopy || defaultRow.promptSections.message),
      visualDirection: cleanText(
        promptSectionsRecord?.visualDirection,
        scene || defaultRow.promptSections.visualDirection,
      ),
      language: cleanText(promptSectionsRecord?.language, language || defaultRow.promptSections.language),
      offer: cleanText(promptSectionsRecord?.offer, cta || defaultRow.promptSections.offer),
    },
  };
};

const extractFirstJsonObject = (value: string): string | null => {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fencedMatch?.[1]?.trim() || value.trim();
  const startIndex = source.indexOf("{");
  if (startIndex === -1) return null;

  let inString = false;
  let escaping = false;
  let depth = 0;

  for (let i = startIndex; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }

  return null;
};

const parsePlannerJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    const extracted = extractFirstJsonObject(raw);
    if (!extracted) {
      throw new Error("Invalid JSON returned by model");
    }
    try {
      return JSON.parse(extracted);
    } catch {
      throw new Error("Invalid JSON returned by model");
    }
  }
};

const readCompletionText = (content: unknown): string => {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((entry) => {
      const record = asRecord(entry);
      return cleanText(record?.text);
    })
    .filter(Boolean)
    .join("\n")
    .trim();
};

const getPlannerModels = (): string[] => {
  const candidates = [DEFAULT_PLANNER_MODEL, ...PLANNER_MODEL_FALLBACKS];
  return Array.from(new Set(candidates.map((model) => model.trim()).filter(Boolean)));
};

const shouldTryNextPlannerModel = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /(does not exist|do not have access|not supported|unsupported|invalid model|404)/i.test(message);
};

export async function POST(request: NextRequest) {
  try {
    if (!cerebras) {
      return NextResponse.json({ error: "CEREBRAS_API_KEY is not configured" }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const testGoal = cleanText(body?.testGoal);
    const variantCount = clampVariantCount(body?.variantCount);
    const product = asRecord(body?.product);
    const productName = cleanText(product?.name, "Product");
    const productCategory = cleanText(product?.category, "General");
    const productDescription = cleanText(product?.description);
    const productTags = Array.isArray(product?.tags)
      ? product.tags
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => cleanText(tag))
          .filter(Boolean)
          .slice(0, 10)
      : [];

    if (!testGoal || testGoal.length < 8) {
      return NextResponse.json(
        { error: "Please provide a clearer testing goal before drafting prompts." },
        { status: 400 },
      );
    }

    const userText = buildPlannerUserPrompt({
      testGoal,
      productName,
      productCategory,
      productDescription,
      productTags,
      variantCount,
    });
    const plannerSchema = buildCerebrasVariantPlanSchema(variantCount);
    const plannerPrompt = [
      userText,
      "",
      "No product image is attached for this request.",
      "Do not claim to inspect the image directly.",
      "Rely only on the product name, category, tags, and the user's testing goal.",
    ].join("\n");

    let completion: PlannerCompletion | null = null;
    let resolvedPlannerModel = "";
    let lastPlannerError: unknown = null;

    for (const plannerModel of getPlannerModels()) {
      try {
        completion = await withTimeout(
          cerebras.chat.completions.create({
            model: plannerModel,
            temperature: 1,
            top_p: 1,
            max_completion_tokens: CEREBRAS_PLANNER_MAX_COMPLETION_TOKENS,
            response_format: {
              type: "json_schema",
              json_schema: plannerSchema,
            },
            messages: [
              {
                role: "system",
                content: PLANNER_SYSTEM_PROMPT,
              },
              {
                role: "user",
                content: plannerPrompt,
              },
            ],
          }) as Promise<PlannerCompletion>,
          PLANNER_MODEL_TIMEOUT_MS,
          "Creative planner timed out. Retry the request.",
        );
        resolvedPlannerModel = plannerModel;
        break;
      } catch (error) {
        lastPlannerError = error;
        if (!shouldTryNextPlannerModel(error)) {
          throw error;
        }
      }
    }

    if (!completion) {
      throw lastPlannerError instanceof Error
        ? lastPlannerError
        : new Error("No accessible Cerebras planner model is configured.");
    }

    const choice = completion.choices[0];
    if (!choice) {
      return NextResponse.json({ error: "No response from planner model" }, { status: 502 });
    }

    const choiceMessage = asRecord(choice.message);
    if (choiceMessage?.refusal) {
      return NextResponse.json(
        { error: "Model refused to generate a variant plan", refusal: choiceMessage.refusal },
        { status: 400 },
      );
    }
    if (choice.finish_reason === "content_filter") {
      return NextResponse.json({ error: "Content filter triggered" }, { status: 400 });
    }

    const rawContent = readCompletionText(choiceMessage?.content);
    if (!rawContent) {
      return NextResponse.json({ error: "Empty model output" }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = parsePlannerJson(rawContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON returned by model";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const parsedRecord = asRecord(parsed);
    const rawVariants = Array.isArray(parsedRecord?.variants) ? parsedRecord.variants : [];

    const normalizedVariants: PlannedVariant[] = [];
    for (let index = 0; index < variantCount; index += 1) {
      normalizedVariants.push(normalizeVariant(rawVariants[index] ?? null, index));
    }

    return NextResponse.json({
      strategySummary: cleanText(
        parsedRecord?.strategySummary,
        `Generated ${variantCount} structured variants for creative testing.`,
      ),
      testPattern: normalizeTestPattern(parsedRecord?.testPattern),
      variants: normalizedVariants,
      model: resolvedPlannerModel,
      plannerProvider: "cerebras",
      promptDebug: {
        system: PLANNER_SYSTEM_PROMPT,
        user: plannerPrompt,
        plannerProvider: "cerebras",
        plannerModel: resolvedPlannerModel,
      },
    });
  } catch (error) {
    console.error("[creative-variants/plan] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Failed to generate variant plan" }, { status: 500 });
  }
}
