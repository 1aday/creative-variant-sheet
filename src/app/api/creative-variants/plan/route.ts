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
const TEST_PATTERNS = ["specific_axis_sweep", "mixed_experiment"] as const;

type AspectRatio = (typeof ASPECT_RATIOS)[number];
type TestPattern = (typeof TEST_PATTERNS)[number];

type PlannedVariant = {
  variantName: string;
  aspectRatio: AspectRatio;
  imageModelPrompt: string;
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
          required: ["variantName", "aspectRatio", "imageModelPrompt"],
          properties: {
            variantName: { type: "string" },
            aspectRatio: {
              type: "string",
              enum: [...ASPECT_RATIOS],
            },
            imageModelPrompt: { type: "string" },
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
  "You will receive a testing goal for variations built from one reference product image.",
  "Create distinct testable variants with clear experimental separation based on the user's requested change axis.",
  "The user decides what to vary: treat any requested variable as valid (visual attribute, copy angle, audience, language, offer, locale, style, etc).",
  "Extract the primary change axis from the user goal and build the requested variants as a targeted sweep across concrete values for that axis.",
  "For each variant, generate a concrete imageModelPrompt that can be sent directly to an image model for editing the reference image.",
  "If the request is for a specific axis, keep framing, proof layout, product usage cues, and lighting stable while changing only the aspect the user explicitly asked for.",
  "Do not introduce unrelated changes outside the requested axis.",
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
  variantCount: number;
}) => {
  const safeGoal = stripPlatformBrandTokens(params.testGoal);

  return [
    `Testing goal: ${safeGoal}`,
    "",
    "Treat the reference image as a locked base asset.",
    "Do not invent brand names, logos, app/platform references, or UI theme palettes.",
    "",
    "Return these fields for each variant:",
    "variantName, aspectRatio, imageModelPrompt",
    "",
    "Rules:",
    `1) Return exactly ${params.variantCount} variants (${params.variantCount} distinct ad concepts).`,
    "2) Derive the primary variation axis directly from the testing goal. Do not substitute a different axis unless the user asks for mixed testing.",
    "3) Make each variant genuinely different for testing by using concrete option values along that axis (not superficial rewrites).",
    "4) If the user request implies option sets (e.g., colors, backgrounds, claims, demographics, text treatments, materials), make each variant map to one explicit option.",
    "5) variantName should reflect the option value being tested so rows are scannable.",
    "6) Set aspectRatio to match_input_image for every variant.",
    "7) imageModelPrompt must be a direct instruction for image editing using the reference image, explicitly stating what to change and what to keep fixed.",
    "8) Keep framing, proof layout, product usage cues, and lighting stable while changing only the aspect the user explicitly asked for.",
    "9) Do not introduce unrelated changes outside the requested axis.",
    "10) Return JSON only. No preamble, no markdown, no code fences, no explanation.",
    "",
    "JSON response format example:",
    JSON.stringify(
      {
        strategySummary: `${params.variantCount}-variant plan optimized for a controlled axis sweep.`,
        testPattern: "specific_axis_sweep",
        variants: [
          {
            variantName: "Variant 1",
            aspectRatio: "match_input_image",
            imageModelPrompt:
              "Keep composition, model pose, and product unchanged. Change only nail color to classic red with realistic gloss and natural skin tones.",
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
};

const normalizeAspectRatio = (value: unknown): AspectRatio => {
  void value;
  return "match_input_image";
};

const normalizeTestPattern = (value: unknown): TestPattern => {
  if (typeof value !== "string") return "specific_axis_sweep";
  return TEST_PATTERNS.includes(value as TestPattern)
    ? (value as TestPattern)
    : "specific_axis_sweep";
};

const fallbackVariant = (index: number): PlannedVariant => {
  return {
    variantName: `Variant ${index + 1}`,
    aspectRatio: "match_input_image",
    imageModelPrompt:
      "Keep framing, proof layout, product usage cues, and lighting stable. Change only one requested aspect for this variant.",
  };
};

const normalizeVariant = (rawVariant: unknown, index: number): PlannedVariant => {
  const variantRecord = asRecord(rawVariant);
  const defaultRow = fallbackVariant(index);
  if (!variantRecord) return defaultRow;

  return {
    variantName: cleanText(variantRecord.variantName, defaultRow.variantName),
    aspectRatio: normalizeAspectRatio(variantRecord.aspectRatio),
    imageModelPrompt: cleanText(variantRecord.imageModelPrompt, defaultRow.imageModelPrompt),
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

    if (!testGoal || testGoal.length < 8) {
      return NextResponse.json(
        { error: "Please provide a clearer testing goal before drafting prompts." },
        { status: 400 },
      );
    }

    const userText = buildPlannerUserPrompt({
      testGoal,
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
