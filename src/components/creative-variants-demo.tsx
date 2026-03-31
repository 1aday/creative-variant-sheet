"use client";

import {
  AlertCircle,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  ImageUp,
  LoaderCircle,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { motion } from "motion/react";
import { startTransition, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";

type DemoSource = {
  id: string;
  name: string;
  category: string;
  descriptor: string;
  tags: string[];
  referenceImagePath: string;
  background: string;
  primaryColor: string;
  accentColor: string;
};

type VariantSeed = {
  id: string;
  keywords: string[];
  variantName: string;
  audience: string;
  painPoint: string;
  bodyCopy: string;
  cta: string;
  scene: string;
  words: string;
  primaryColor: string;
  accentColor: string;
};

type PromptProvider = "cerebras" | "local";
type PromptState = "idle" | "generating" | "ready" | "error";

type DemoRow = {
  id: string;
  variantName: string;
  audience: string;
  painPoint: string;
  language: string;
  bodyCopy: string;
  cta: string;
  scene: string;
  words: string;
  primaryColor: string;
  accentColor: string;
  promptText: string;
  promptState: PromptState;
  promptProvider: PromptProvider;
  promptError: string | null;
  imageUrl: string | null;
  errorMessage: string | null;
  status: "draft" | "generating" | "generated" | "error";
  renderVersion: number;
};

type ActivityState = {
  tone: "default" | "error";
  text: string;
};

type RoundSeedImage = {
  inputSrc: string;
  previewSrc: string;
  label: string;
};

type GeneratedAsset = {
  id: string;
  imageUrl: string;
  label: string;
  detail: string;
  rowSnapshot: DemoRow;
};

type UploadedSourceImage = {
  dataUrl: string;
  name: string;
  mimeType: string;
};

type PlannedVariant = {
  variantName?: string;
  audience?: string;
  painPoint?: string;
  language?: string;
  bodyCopy?: string;
  cta?: string;
  scene?: string;
  words?: string;
  aspectRatio?: string;
  imageModelPrompt?: string;
};

type PlanResponse = {
  strategySummary?: string;
  testPattern?: string;
  variants?: PlannedVariant[];
  plannerProvider?: "cerebras";
  model?: string;
  error?: string;
};

const MAX_ROWS = 5;
const DEFAULT_PROMPT =
  "Create a skincare casting test that keeps the ad layout consistent while changing the model's age, gender, and race across the variants.";
const PLAN_REVEAL_BASE_DELAY_MS = 120;
const PLAN_REVEAL_PER_GLYPH_MS = 16;
const PLAN_REVEAL_MAX_DELAY_MS = 420;
const PLAN_REVEAL_SETTLE_MS = 60;
const MAX_SOURCE_UPLOAD_DIMENSION = 1600;
const MAX_SOURCE_UPLOAD_DATA_URL_LENGTH = 3_500_000;
const cardMetaLabelClass =
  "text-[9px] uppercase tracking-[0.16em] text-[var(--ink-subtle)]";
const cardCompactTitleClass =
  "text-[0.92rem] font-semibold leading-[1.18] tracking-[-0.02em] text-[var(--ink-strong)]";
const cardCompactBodyClass =
  "text-[0.8rem] leading-5 text-[var(--ink-body)]";
const plannerInputClassName =
  "h-11 w-full border border-[rgba(18,28,20,0.14)] bg-white px-4 text-[0.94rem] text-[var(--ink-strong)] outline-none shadow-[0_12px_24px_-24px_rgba(18,28,20,0.45)] transition placeholder:text-[var(--ink-subtle)] focus:border-[var(--accent-strong)] focus:shadow-[0_18px_30px_-26px_rgba(18,28,20,0.55)]";

const sourceOptions: DemoSource[] = [
  {
    id: "casting-test",
    name: "Radiance Cream Casting Test",
    category: "Skin care",
    descriptor: "Close-up skincare ad with a model, cheek cream swipe, and clinical proof text overlay",
    tags: ["Casting test", "Skin care", "Proof-led"],
    referenceImagePath: "/creative-variants/casting-source.webp",
    background:
      "radial-gradient(circle at 18% 14%, rgba(255,255,255,0.72), transparent 28%), linear-gradient(145deg, #f3d5c7 0%, #dbb3a7 44%, #bea0bb 100%)",
    primaryColor: "#D09A7A",
    accentColor: "#D3B2C8",
  },
];

const variantSeeds: VariantSeed[] = [
  {
    id: "young-woman",
    keywords: ["young", "woman", "female", "gen z", "age", "gender", "race", "casting"],
    variantName: "Young Woman 20s",
    audience: "Women 20-29",
    painPoint: "Needs talent that feels closer to a younger skin-care shopper",
    bodyCopy:
      "Recast the image with a woman in her early 20s and preserve the same close crop, cheek cream swipe, soft lighting, and proof-led layout.",
    cta: "See results",
    scene: "Same close-up beauty crop with a fresher youthful casting",
    words: "Young adult, female, fresh skin, casting test, proof-led",
    primaryColor: "#C78672",
    accentColor: "#E8C9C1",
  },
  {
    id: "black-woman",
    keywords: ["black", "woman", "female", "race", "casting", "representation"],
    variantName: "Black Woman 30s",
    audience: "Women 28-40",
    painPoint: "Needs more culturally resonant casting and representation",
    bodyCopy:
      "Swap the model to a Black woman in her 30s with rich skin tone and natural texture while keeping the skincare cream placement, framing, and text area stable.",
    cta: "Shop routine",
    scene: "Same proof-driven beauty close-up with a confident Black female model",
    words: "Black woman, 30s, radiant skin, representation, skincare ad",
    primaryColor: "#8C5A4A",
    accentColor: "#E9C5AD",
  },
  {
    id: "asian-man",
    keywords: ["asian", "man", "male", "gender", "race", "casting"],
    variantName: "East Asian Man 30s",
    audience: "Men 28-38",
    painPoint: "Needs male casting without losing the premium skincare tone",
    bodyCopy:
      "Change the model to an East Asian man in his early 30s, keeping the same crop, editorial softness, cheek cream gesture, and premium skin finish.",
    cta: "Try the formula",
    scene: "Same tight beauty portrait with male skincare casting",
    words: "East Asian man, male grooming, 30s, skincare, controlled test",
    primaryColor: "#AF7D67",
    accentColor: "#D8B5AE",
  },
  {
    id: "mature-woman",
    keywords: ["mature", "older", "woman", "50", "age", "casting"],
    variantName: "Mature Woman 50+",
    audience: "Women 50+",
    painPoint: "Needs casting that signals credibility for a more mature customer",
    bodyCopy:
      "Recast the ad with a woman in her 50s or early 60s and keep the same skincare application cue, soft retouching level, and proof-focused composition intact.",
    cta: "See smoother skin",
    scene: "Same clinical beauty portrait with mature female casting",
    words: "Mature woman, 50 plus, radiant skin, trust, proof-led",
    primaryColor: "#A97262",
    accentColor: "#E3C5BF",
  },
  {
    id: "south-asian-woman",
    keywords: ["south asian", "woman", "female", "race", "casting", "representation"],
    variantName: "South Asian Woman 40s",
    audience: "Women 35-45",
    painPoint: "Needs casting that broadens representation without changing the ad system",
    bodyCopy:
      "Swap to a South Asian woman in her 40s and keep the exact same portrait scale, cream swipe placement, soft peach palette, and conversion-oriented proof copy area.",
    cta: "Explore results",
    scene: "Same proof-led skincare crop with South Asian female casting",
    words: "South Asian woman, 40s, inclusive casting, skincare, premium",
    primaryColor: "#B37B66",
    accentColor: "#DAB8B4",
  },
];

const inputClassName =
  "h-11 w-full border border-[var(--line-subtle)] bg-white px-3 text-sm text-[var(--ink-strong)] outline-none transition focus:border-[var(--accent-strong)]";
const textAreaClassName =
  "min-h-[112px] w-full resize-none border border-[var(--line-subtle)] bg-white px-3 py-3 text-sm leading-6 text-[var(--ink-strong)] outline-none transition focus:border-[var(--accent-strong)]";

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function withAlpha(color: string, alpha: number) {
  const normalized = color.replace("#", "").trim();
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((character) => `${character}${character}`)
          .join("")
      : normalized;

  const parsed = Number.parseInt(expanded, 16);
  if (!Number.isFinite(parsed) || expanded.length !== 6) {
    return color;
  }

  const red = (parsed >> 16) & 255;
  const green = (parsed >> 8) & 255;
  const blue = parsed & 255;

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function buildLocalImagePrompt(
  source: DemoSource,
  row: Pick<DemoRow, "variantName" | "audience" | "painPoint" | "language" | "bodyCopy" | "cta" | "scene" | "words">,
  plannerPrompt: string,
) {
  const parts = [
    `Create a premium ${source.category.toLowerCase()} advertising variation using the reference image as the base.`,
    `Source concept: ${source.descriptor}.`,
    plannerPrompt ? `Campaign brief: ${plannerPrompt}.` : "",
    `Creative angle: ${row.variantName}.`,
    `Audience: ${row.audience}.`,
    `Pain point: ${row.painPoint}.`,
    `Language: ${row.language}.`,
    `Scene: ${row.scene}.`,
    `Visual story: ${row.bodyCopy}.`,
    `Keywords: ${row.words}.`,
    `CTA energy: ${row.cta}.`,
    "Keep the close facial crop, cheek cream application, soft skincare lighting, and proof-led ad composition consistent unless the variant explicitly changes them.",
    "Treat model demographics as the intended test axis when requested: update age, gender presentation, and race only as directed while preserving realistic skin texture and editorial polish.",
    "Keep the final image free of logos, watermarks, or interface chrome.",
  ];

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function getSourceReferenceRequestUrl(source: DemoSource) {
  if (typeof window === "undefined") {
    return source.referenceImagePath;
  }

  return new URL(source.referenceImagePath, window.location.origin).toString();
}

function resolveSourceReferenceInput(source: DemoSource, uploadedSourceImage: UploadedSourceImage | null) {
  return uploadedSourceImage?.dataUrl?.trim() || getSourceReferenceRequestUrl(source);
}

function resolveSourcePreviewImageSrc(source: DemoSource, uploadedSourceImage: UploadedSourceImage | null) {
  return uploadedSourceImage?.dataUrl?.trim() || source.referenceImagePath;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.length > 0) {
        resolve(reader.result);
        return;
      }

      reject(new Error("Failed to read the uploaded file."));
    };
    reader.onerror = () => reject(new Error("Failed to read the uploaded file."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode the uploaded image."));
    image.src = dataUrl;
  });
}

async function optimizeUploadedSourceImage(file: File): Promise<UploadedSourceImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Upload a valid image file.");
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(originalDataUrl);
  const longestEdge = Math.max(image.naturalWidth || 0, image.naturalHeight || 0);
  const scale = longestEdge > 0 ? Math.min(1, MAX_SOURCE_UPLOAD_DIMENSION / longestEdge) : 1;
  const outputMimeType =
    file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";

  if (scale === 1 && originalDataUrl.length <= MAX_SOURCE_UPLOAD_DATA_URL_LENGTH) {
    return {
      dataUrl: originalDataUrl,
      name: file.name,
      mimeType: outputMimeType,
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not process the uploaded image.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const qualitySteps = outputMimeType === "image/png" ? [undefined] : [0.92, 0.82, 0.72];

  for (const quality of qualitySteps) {
    const candidate = canvas.toDataURL(outputMimeType, quality);
    if (candidate.length <= MAX_SOURCE_UPLOAD_DATA_URL_LENGTH || quality === qualitySteps.at(-1)) {
      return {
        dataUrl: candidate,
        name: file.name,
        mimeType: outputMimeType,
      };
    }
  }

  throw new Error("Could not prepare the uploaded image.");
}

function createVariantRow(
  seed: VariantSeed,
  source: DemoSource,
  prompt: string,
  id: string,
  renderVersion = 1,
): DemoRow {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, " ");
  const extraLine = normalizedPrompt
    ? ` Keep the tone aligned with ${normalizedPrompt.toLowerCase()}.`
    : "";

  const rowBase = {
    variantName: seed.variantName,
    audience: seed.audience,
    painPoint: seed.painPoint,
    language: "English",
    bodyCopy: `${seed.bodyCopy} Designed for ${source.category.toLowerCase()} creative.${extraLine}`,
    cta: seed.cta,
    scene: seed.scene,
    words: seed.words,
  };

  return {
    id,
    ...rowBase,
    primaryColor: seed.primaryColor,
    accentColor: seed.accentColor,
    promptText: buildLocalImagePrompt(source, rowBase, prompt),
    promptState: "idle",
    promptProvider: "local",
    promptError: null,
    imageUrl: null,
    errorMessage: null,
    status: "draft",
    renderVersion,
  };
}

function buildPromptPlan(prompt: string, source: DemoSource, planKey: string) {
  const normalizedPrompt = prompt.toLowerCase();
  const scoredSeeds = variantSeeds
    .map((seed) => ({
      seed,
      score: seed.keywords.reduce((sum, keyword) => {
        return sum + (normalizedPrompt.includes(keyword) ? 2 : 0);
      }, 0),
    }))
    .sort((left, right) => right.score - left.score);

  const orderedSeeds: VariantSeed[] = [];

  scoredSeeds.forEach(({ seed, score }) => {
    if (score > 0) {
      orderedSeeds.push(seed);
    }
  });

  variantSeeds.forEach((seed) => {
    if (!orderedSeeds.some((candidate) => candidate.id === seed.id)) {
      orderedSeeds.push(seed);
    }
  });

  return orderedSeeds.slice(0, 4).map((seed, index) => {
    return createVariantRow(seed, source, prompt, `${planKey}-${seed.id}-${index + 1}`);
  });
}

function buildManualRowId(index: number) {
  return `manual-row-${index}`;
}

function sleep(duration: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration);
  });
}

function cleanPlannerText(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function normalizePlannerWords(value: string | undefined, fallback: string) {
  const cleaned = cleanPlannerText(value, fallback);
  return cleaned
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
}

function createPlannedRow(
  variant: PlannedVariant,
  source: DemoSource,
  plannerPrompt: string,
  id: string,
  index: number,
  existingRow?: DemoRow,
): DemoRow {
  const paletteSeed = variantSeeds[index % variantSeeds.length] ?? variantSeeds[0];
  const variantName = cleanPlannerText(variant.variantName, `Variant ${index + 1}`);
  const audience = cleanPlannerText(variant.audience, "Core target audience");
  const painPoint = cleanPlannerText(variant.painPoint, "Primary pain point");
  const language = cleanPlannerText(variant.language, "English");
  const bodyCopy = cleanPlannerText(
    variant.bodyCopy,
    "Lead with one concrete product benefit and keep the message concise.",
  );
  const cta = cleanPlannerText(variant.cta, "Shop now");
  const scene = cleanPlannerText(variant.scene, "Product-led studio setup with clear focal point");
  const words = normalizePlannerWords(variant.words, "Benefit-first, High-contrast, Conversion-focused");
  const rowFields = {
    variantName,
    audience,
    painPoint,
    language,
    bodyCopy,
    cta,
    scene,
    words,
  };

  return {
    id,
    ...rowFields,
    primaryColor: existingRow?.primaryColor ?? paletteSeed.primaryColor,
    accentColor: existingRow?.accentColor ?? paletteSeed.accentColor,
    promptText: cleanPlannerText(variant.imageModelPrompt, buildLocalImagePrompt(source, rowFields, plannerPrompt)),
    promptState: "ready",
    promptProvider: "cerebras",
    promptError: null,
    imageUrl: null,
    errorMessage: null,
    status: "draft",
    renderVersion: existingRow?.renderVersion ?? 1,
  };
}

function SourcePreview({ source, imageSrc }: { source: DemoSource; imageSrc: string }) {
  return (
    <div
      className="relative aspect-[2/3] overflow-hidden"
      style={{ background: source.background }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt={`${source.name} source reference`}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,11,17,0.03),rgba(7,11,17,0.12))]" />
    </div>
  );
}

function GeneratingPreviewOverlay({ row }: { row: DemoRow }) {
  const primaryMist = withAlpha(row.primaryColor, 0.18);
  const accentMist = withAlpha(row.accentColor, 0.16);
  const frameColor = withAlpha(row.primaryColor, 0.18);
  const lineColor = withAlpha(row.primaryColor, 0.1);
  const railColor = withAlpha(row.primaryColor, 0.16);
  const progressGradient = `linear-gradient(90deg, ${withAlpha(row.primaryColor, 0)} 0%, ${withAlpha(
    row.primaryColor,
    0.75,
  )} 38%, ${withAlpha(row.accentColor, 0.72)} 68%, ${withAlpha(row.accentColor, 0)} 100%)`;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[rgba(246,244,239,0.24)] backdrop-blur-[2.5px]">
      <motion.div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at 18% 18%, ${accentMist} 0%, transparent 34%), radial-gradient(circle at 84% 74%, ${primaryMist} 0%, transparent 38%)`,
        }}
        animate={{
          opacity: [0.42, 0.7, 0.48],
          scale: [1, 1.025, 1],
        }}
        transition={{ duration: 6.8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.28) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.24) 1px, transparent 1px)",
          backgroundSize: "100% 26px, 26px 100%",
        }}
        animate={{
          opacity: [0.08, 0.18, 0.1],
        }}
        transition={{ duration: 5.6, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        className="absolute inset-y-0 -left-[46%] w-[42%] bg-gradient-to-r from-transparent via-white/55 to-transparent opacity-70 blur-2xl"
        animate={{ x: ["0%", "340%"] }}
        transition={{ duration: 3.9, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        className="absolute inset-[18px] border"
        style={{ borderColor: frameColor }}
        animate={{
          opacity: [0.28, 0.52, 0.3],
        }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute left-[18px] right-[18px] top-1/2 h-px -translate-y-1/2"
        style={{ background: lineColor }}
        animate={{
          opacity: [0.14, 0.32, 0.16],
        }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-[18px] left-1/2 top-[18px] w-px -translate-x-1/2"
        style={{ background: lineColor }}
        animate={{
          opacity: [0.1, 0.26, 0.1],
        }}
        transition={{ duration: 2.9, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="absolute inset-x-4 bottom-4 border border-[rgba(18,28,20,0.1)] bg-[rgba(255,255,255,0.74)] px-3 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-[0.22em] text-[var(--ink-subtle)]">Rendering pass</p>
            <p className="mt-1 text-[0.8rem] font-medium tracking-[-0.01em] text-[var(--ink-strong)]">
              Generating image
            </p>
          </div>

          <div className="relative flex size-5 shrink-0 items-center justify-center">
            <motion.span
              className="absolute inset-0 border"
              style={{ borderColor: withAlpha(row.primaryColor, 0.34) }}
              animate={{
                scale: [0.92, 1.08, 0.92],
                opacity: [0.22, 0.52, 0.22],
              }}
              transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.span
              className="size-2 rounded-[2px]"
              style={{ background: row.accentColor }}
              animate={{
                rotate: [0, 90, 180],
                scale: [0.86, 1, 0.86],
                opacity: [0.7, 1, 0.7],
              }}
              transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
        </div>

        <div className="mt-3 h-px overflow-hidden" style={{ background: railColor }}>
          <motion.div
            className="h-full w-[38%]"
            style={{ background: progressGradient }}
            animate={{ x: ["-72%", "230%"] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>
    </div>
  );
}

function VariantPreview({
  row,
  source,
  placeholderImageSrc,
}: {
  row: DemoRow;
  source: DemoSource;
  placeholderImageSrc: string | null;
}) {
  const compositionSeed = hashString(
    `${source.id}-${row.variantName}-${row.words}-${row.scene}-${row.renderVersion}`,
  );
  const haloSize = 144 + (compositionSeed % 56);
  const haloLeft = 8 + (compositionSeed % 44);
  const haloTop = 10 + ((compositionSeed >> 3) % 22);
  const bottleTilt = -8 + (compositionSeed % 16);
  const frameTilt = -14 + ((compositionSeed >> 5) % 28);
  return (
    <div className="relative aspect-[2/3] overflow-hidden" style={{ background: source.background }}>
      {row.imageUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={row.imageUrl}
            alt={`${row.variantName} generated concept`}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,11,17,0.03),rgba(7,11,17,0.12))]" />
        </>
      ) : placeholderImageSrc ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={placeholderImageSrc}
            alt={`${row.variantName} shared round seed`}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,11,17,0.04),rgba(7,11,17,0.14))]" />
        </>
      ) : (
        <>
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${row.primaryColor} 0%, transparent 58%), linear-gradient(315deg, ${row.accentColor} 0%, transparent 64%)`,
            }}
          />
          <div
            className="absolute rounded-full opacity-55 blur-3xl"
            style={{
              left: `${haloLeft}%`,
              top: `${haloTop}%`,
              width: `${haloSize}px`,
              height: `${haloSize}px`,
              background: row.accentColor,
            }}
          />
          <div
            className="absolute left-[12%] top-[18%] h-[40%] w-[24%] rounded-[24px] border border-white/30 bg-white/16 backdrop-blur-md"
            style={{ transform: `rotate(${frameTilt}deg)` }}
          />
          <div
            className="absolute left-1/2 top-[15%] h-[50%] w-[38%] -translate-x-1/2 rounded-[30px] border border-white/35 shadow-[0_22px_62px_-28px_rgba(0,0,0,0.42)]"
            style={{
              background: `linear-gradient(180deg, rgba(255,255,255,0.92) 0%, ${row.primaryColor} 44%, ${row.accentColor} 100%)`,
              transform: `translateX(-50%) rotate(${bottleTilt}deg)`,
            }}
          />
        </>
      )}

      {row.status === "generating" ? (
        <GeneratingPreviewOverlay row={row} />
      ) : null}
    </div>
  );
}

export function CreativeVariantsDemo() {
  const initialRows = buildPromptPlan(DEFAULT_PROMPT, sourceOptions[0], "plan-0");
  const [roundSeedImage, setRoundSeedImage] = useState<RoundSeedImage | null>(null);
  const [generatedAssets, setGeneratedAssets] = useState<GeneratedAsset[]>([]);
  const [uploadedSourceImage, setUploadedSourceImage] = useState<UploadedSourceImage | null>(null);
  const [plannerInput, setPlannerInput] = useState(DEFAULT_PROMPT);
  const [rows, setRows] = useState(initialRows);
  const [activeRowId, setActiveRowId] = useState(initialRows[0]?.id ?? "");
  const [isPlanning, setIsPlanning] = useState(false);
  const [isPlanRevealing, setIsPlanRevealing] = useState(false);
  const [plannerRevealIndex, setPlannerRevealIndex] = useState(-1);
  const [planRevealCycle, setPlanRevealCycle] = useState(0);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isUploadingSourceImage, setIsUploadingSourceImage] = useState(false);
  const [activity, setActivity] = useState<ActivityState>({
    tone: "default",
    text: "",
  });
  const planCounterRef = useRef(1);
  const manualCounterRef = useRef(1);
  const sourceFileInputRef = useRef<HTMLInputElement | null>(null);
  const rowStripRef = useRef<HTMLDivElement | null>(null);
  const rowCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const rowsRef = useRef(rows);

  const selectedSource = sourceOptions[0];
  const selectedSourcePreviewImageSrc = useMemo(() => {
    return roundSeedImage?.previewSrc || resolveSourcePreviewImageSrc(selectedSource, uploadedSourceImage);
  }, [roundSeedImage, selectedSource, uploadedSourceImage]);
  const selectedSourceReferenceInput = useMemo(() => {
    return roundSeedImage?.inputSrc || resolveSourceReferenceInput(selectedSource, uploadedSourceImage);
  }, [roundSeedImage, selectedSource, uploadedSourceImage]);
  const sharedPlaceholderImageSrc = roundSeedImage?.previewSrc || null;

  const activeRow = rows.find((row) => row.id === activeRowId) ?? rows[0] ?? null;
  const generatingCount = rows.filter((row) => row.status === "generating").length;
  const activeRowIndex = activeRow ? rows.findIndex((row) => row.id === activeRow.id) : -1;
  const isPlannerBusy = isPlanning || isPlanRevealing;
  const isBusy = isPlannerBusy || isGeneratingAll || generatingCount > 0 || isUploadingSourceImage;

  const buildGeneratedAsset = (row: DemoRow, imageUrl: string): GeneratedAsset => {
    const cleanedImageUrl = imageUrl.trim();
    return {
      id: `generated-asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      imageUrl: cleanedImageUrl,
      label: cleanPlannerText(row.variantName, "Generated image"),
      detail: cleanPlannerText(row.scene, row.audience),
      rowSnapshot: {
        ...row,
        imageUrl: cleanedImageUrl,
        errorMessage: null,
        status: "generated",
      },
    };
  };

  const addGeneratedAsset = (asset: GeneratedAsset) => {
    setGeneratedAssets((currentAssets) => {
      const nextAssets = [asset, ...currentAssets.filter((candidate) => candidate.imageUrl !== asset.imageUrl)];
      return nextAssets.slice(0, 18);
    });
  };

  const activateGeneratedAsset = (asset: GeneratedAsset) => {
    if (isBusy) return;
    if (roundSeedImage?.inputSrc === asset.imageUrl) return;

    const seedRow = asset.rowSnapshot;
    const nextVariantName = `${asset.label} Next`;
    const nextRowId = buildManualRowId(manualCounterRef.current);
    manualCounterRef.current += 1;

    const nextRoundRow: DemoRow = {
      ...seedRow,
      id: nextRowId,
      variantName: nextVariantName,
      promptText: seedRow.promptText.trim()
        ? seedRow.promptText
        : buildLocalImagePrompt(
            selectedSource,
            {
              ...seedRow,
              variantName: nextVariantName,
            },
            plannerInput,
          ),
      promptState: seedRow.promptText.trim() ? "ready" : "idle",
      promptProvider: seedRow.promptProvider,
      promptError: null,
      imageUrl: null,
      errorMessage: null,
      status: "draft",
      renderVersion: seedRow.renderVersion + 1,
    };

    setRoundSeedImage({
      inputSrc: asset.imageUrl,
      previewSrc: asset.imageUrl,
      label: asset.label,
    });

    setRows((currentRows) => {
      const clearedRows = currentRows.map((candidate) => ({
        ...candidate,
        imageUrl: null,
        errorMessage: null,
        status: "draft" as const,
      }));
      const trimmedRows = clearedRows.length >= MAX_ROWS ? clearedRows.slice(0, MAX_ROWS - 1) : clearedRows;
      return [nextRoundRow, ...trimmedRows];
    });
    setActiveRowId(nextRowId);
    setActivity({
      tone: "default",
      text: `${asset.label} is now the shared input for the next generation round.`,
    });
  };

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    if (!activeRowId || !rowStripRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      const rowCard = rowCardRefs.current[activeRowId];
      const rowStrip = rowStripRef.current;

      if (!rowCard || !rowStrip) return;

      const nextLeft =
        rowCard.offsetLeft - rowStrip.offsetLeft - (rowStrip.clientWidth - rowCard.clientWidth) / 2;

      rowStrip.scrollTo({
        left: Math.max(0, nextLeft),
        behavior: "smooth",
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeRowId]);

  const resetRenderedRows = () => {
    setRows((currentRows) =>
      currentRows.map((row) => ({
        ...row,
        imageUrl: null,
        errorMessage: null,
        status: "draft",
      })),
    );
  };

  const updateRow = (
    rowId: string,
    field:
      | "variantName"
      | "audience"
      | "painPoint"
      | "language"
      | "bodyCopy"
      | "cta"
      | "scene"
      | "words"
      | "primaryColor"
      | "accentColor"
      | "promptText",
    value: string,
  ) => {
    setRows((currentRows) => {
      return currentRows.map((row) => {
        if (row.id !== rowId) return row;

        const nextRow: DemoRow = {
          ...row,
          [field]: value,
        };

        if (field === "promptText") {
          nextRow.promptState = "ready";
          nextRow.promptProvider = "local";
          nextRow.promptError = null;
        } else {
          nextRow.promptState = "idle";
          nextRow.status = "draft";
          nextRow.imageUrl = null;
          nextRow.errorMessage = null;
        }

        return nextRow;
      });
    });
  };

  const resolvePromptForRow = (rowId: string, source: DemoSource, planner: string): string => {
    const row = rowsRef.current.find((candidate) => candidate.id === rowId);
    if (!row) return "";

    const resolvedPrompt = row.promptText.trim() || buildLocalImagePrompt(source, row, planner);

    if (!row.promptText.trim() || row.promptState !== "ready") {
      setRows((currentRows) =>
        currentRows.map((candidate) =>
          candidate.id === rowId
            ? {
                ...candidate,
                promptText: resolvedPrompt,
                promptState: "ready",
                promptProvider: candidate.promptText.trim() ? candidate.promptProvider : "local",
                promptError: null,
              }
            : candidate,
        ),
      );
    }

    return resolvedPrompt;
  };

  const generateImageForRow = async (
    rowId: string,
    options?: {
      promptOverride?: string;
      silent?: boolean;
      source?: DemoSource;
      planner?: string;
      sourceImageInput?: string;
    },
  ) => {
    const source = options?.source ?? selectedSource;
    const planner = options?.planner ?? plannerInput;
    const row = rowsRef.current.find((candidate) => candidate.id === rowId);
    if (!row) return false;

    const prompt = options?.promptOverride?.trim() || resolvePromptForRow(rowId, source, planner);
    const sourceImage = options?.sourceImageInput ?? selectedSourceReferenceInput;
    const rowIndex = rowsRef.current.findIndex((candidate) => candidate.id === rowId);

    setRows((currentRows) =>
      currentRows.map((candidate) =>
        candidate.id === rowId
          ? {
              ...candidate,
              status: "generating",
              errorMessage: null,
            }
          : candidate,
      ),
    );

    try {
      const response = await fetch("/api/creative-variants/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "image",
          sourceId: source.id,
          prompt,
          sourceImage,
          index: rowIndex,
          aspectRatio: "4:5",
          imageSize: "1K",
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        url?: string;
        prompt?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Image generation failed");
      }

      const generatedUrl = data.url?.trim() || row.imageUrl?.trim() || "";
      if (!generatedUrl) {
        throw new Error("Image generation returned no image URL.");
      }

      setRows((currentRows) =>
        currentRows.map((candidate) =>
          candidate.id === rowId
            ? {
                ...candidate,
                promptText: data.prompt || prompt,
                promptState: "ready",
                status: "generated",
                imageUrl: generatedUrl,
                errorMessage: null,
                renderVersion: candidate.renderVersion + 1,
              }
            : candidate,
        ),
      );
      addGeneratedAsset(
        buildGeneratedAsset(
          {
            ...row,
            promptText: data.prompt || prompt,
            promptState: "ready",
            status: "generated",
            imageUrl: generatedUrl,
            errorMessage: null,
            renderVersion: row.renderVersion + 1,
          },
          generatedUrl,
        ),
      );

      if (!options?.silent) {
        setActivity({
          tone: "default",
          text: `${row.variantName} generated successfully.`,
        });
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image generation failed";

      setRows((currentRows) =>
        currentRows.map((candidate) =>
          candidate.id === rowId
            ? {
                ...candidate,
                status: "error",
                errorMessage: message,
              }
            : candidate,
        ),
      );

      if (!options?.silent) {
        setActivity({
          tone: "error",
          text: message,
        });
      }

      return false;
    }
  };

  const handlePlannerApply = async () => {
    if (isBusy) return;

    const goal = plannerInput.trim();
    if (!goal || goal.length < 8) {
      setActivity({
        tone: "error",
        text: "Add a clearer testing goal before creating prompts.",
      });
      return;
    }

    const variantCount = Math.max(1, Math.min(MAX_ROWS, rowsRef.current.length || 4));
    const planKey = `plan-${planCounterRef.current}`;
    planCounterRef.current += 1;

    const preparedRows = rowsRef.current.slice(0, variantCount);
    while (preparedRows.length < variantCount) {
      preparedRows.push(
        createVariantRow(
          variantSeeds[preparedRows.length % variantSeeds.length],
          selectedSource,
          goal,
          `${planKey}-seed-${preparedRows.length + 1}`,
        ),
      );
    }

    setIsPlanning(true);
    setIsPlanRevealing(false);
    setPlannerRevealIndex(-1);
    setRows((currentRows) =>
      currentRows.map((row) => ({
        ...row,
        promptState: row.promptText.trim() ? "generating" : row.promptState,
        promptError: null,
      })),
    );

    try {
      const response = await fetch("/api/creative-variants/plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          testGoal: goal,
          variantCount,
          product: {
            name: selectedSource.name,
            category: selectedSource.category,
            description: selectedSource.descriptor,
            tags: selectedSource.tags,
          },
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as PlanResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to generate planner prompts");
      }

      const plannedVariants = Array.isArray(payload.variants) ? payload.variants : [];
      if (plannedVariants.length === 0) {
        throw new Error("The planner returned no variants. Try a more specific testing goal.");
      }

      const plannedRows = Array.from({ length: variantCount }, (_, index) => {
        const existingRow = preparedRows[index];
        const fallbackSeed = variantSeeds[index % variantSeeds.length];
        const fallbackRow =
          existingRow ??
          createVariantRow(fallbackSeed, selectedSource, goal, `${planKey}-fallback-${index + 1}`);

        return createPlannedRow(
          plannedVariants[index] ?? {},
          selectedSource,
          goal,
          fallbackRow.id,
          index,
          fallbackRow,
        );
      });

      startTransition(() => {
        setRows(preparedRows);
        setActiveRowId(preparedRows[0]?.id ?? "");
      });

      setIsPlanning(false);
      setIsPlanRevealing(true);
      setPlanRevealCycle((current) => current + 1);

      for (let index = 0; index < plannedRows.length; index += 1) {
        setRows((currentRows) => {
          const nextRows = currentRows.slice(0, plannedRows.length);
          while (nextRows.length < plannedRows.length) {
            nextRows.push(plannedRows[nextRows.length]);
          }
          nextRows[index] = plannedRows[index];
          return nextRows;
        });
        setPlannerRevealIndex(index);

        const titleLength = Array.from(plannedRows[index]?.variantName || `Variation ${index + 1}`).filter(
          (glyph) => glyph.trim().length > 0,
        ).length;
        await sleep(
          Math.min(PLAN_REVEAL_MAX_DELAY_MS, PLAN_REVEAL_BASE_DELAY_MS + titleLength * PLAN_REVEAL_PER_GLYPH_MS),
        );
      }

      await sleep(PLAN_REVEAL_SETTLE_MS);

      setRows(plannedRows);
      setPlannerRevealIndex(-1);
      setIsPlanRevealing(false);
      setActivity({
        tone: "default",
        text: `Drafted ${plannedRows.length} prompt${plannedRows.length === 1 ? "" : "s"} with a staged reveal.`,
      });
    } catch (error) {
      setIsPlanRevealing(false);
      setPlannerRevealIndex(-1);
      setActivity({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to generate planner prompts",
      });
    } finally {
      setIsPlanning(false);
    }
  };

  const handleUploadSourceImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || isBusy) {
      return;
    }

    try {
      setIsUploadingSourceImage(true);
      setRoundSeedImage(null);
      setGeneratedAssets([]);
      const optimizedImage = await optimizeUploadedSourceImage(file);
      setUploadedSourceImage(optimizedImage);
      resetRenderedRows();
      setActivity({
        tone: "default",
        text: "Uploaded source image is now the active reference for every row.",
      });
    } catch (error) {
      setActivity({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not load the uploaded source image.",
      });
    } finally {
      setIsUploadingSourceImage(false);
    }
  };

  const handleUsePresetSourceImage = () => {
    if (!uploadedSourceImage || isBusy) return;

    setUploadedSourceImage(null);
    setGeneratedAssets([]);
    if (sourceFileInputRef.current) {
      sourceFileInputRef.current.value = "";
    }
    resetRenderedRows();
    setActivity({
      tone: "default",
      text: "Returned to the preset source image.",
    });
  };

  const handleUseOriginalSource = () => {
    if (!roundSeedImage || isBusy) return;

    setRoundSeedImage(null);
    resetRenderedRows();
    setActivity({
      tone: "default",
      text: "Returned to the selected source image for the next round.",
    });
  };

  const handleGenerateAll = async () => {
    if (!rowsRef.current.length || isBusy) return;

    setIsGeneratingAll(true);
    const sourceSnapshot = selectedSource;
    const sourceImageSnapshot = selectedSourceReferenceInput;
    const plannerSnapshot = plannerInput;

    try {
      let successCount = 0;
      let failureCount = 0;

      for (const row of rowsRef.current) {
        const didSucceed = await generateImageForRow(row.id, {
          silent: true,
          source: sourceSnapshot,
          planner: plannerSnapshot,
          sourceImageInput: sourceImageSnapshot,
        });

        if (didSucceed) {
          successCount += 1;
        } else {
          failureCount += 1;
        }
      }

      setActivity({
        tone: failureCount > 0 ? "error" : "default",
        text:
          failureCount > 0
            ? `${successCount} row${successCount === 1 ? "" : "s"} generated, ${failureCount} failed.`
            : `Generated all ${successCount} row${successCount === 1 ? "" : "s"}.`,
      });
    } finally {
      setIsGeneratingAll(false);
    }
  };

  const handleDuplicateRow = (rowId: string) => {
    if (rows.length >= MAX_ROWS || isBusy) return;

    const row = rows.find((candidate) => candidate.id === rowId);
    if (!row) return;

    const duplicateId = buildManualRowId(manualCounterRef.current);
    manualCounterRef.current += 1;

    const nextVariantName = `${row.variantName} Copy`;
    const nextRow: DemoRow = {
      ...row,
      id: duplicateId,
      variantName: nextVariantName,
      promptText: row.promptText.trim()
        ? row.promptText
        : buildLocalImagePrompt(
            selectedSource,
            {
              ...row,
              variantName: nextVariantName,
            },
            plannerInput,
          ),
      promptState: "idle",
      promptProvider: row.promptProvider,
      promptError: null,
      imageUrl: null,
      errorMessage: null,
      status: "draft",
    };

    const nextRows = [...rows];
    const rowIndex = nextRows.findIndex((candidate) => candidate.id === rowId);
    nextRows.splice(rowIndex + 1, 0, nextRow);

    setRows(nextRows);
    setActiveRowId(duplicateId);
  };

  const handleAddRow = () => {
    if (rows.length >= MAX_ROWS || isBusy) return;

    const seed = variantSeeds[rows.length % variantSeeds.length];
    const rowId = buildManualRowId(manualCounterRef.current);
    manualCounterRef.current += 1;
    const nextRow = createVariantRow(seed, selectedSource, plannerInput, rowId);

    setRows((currentRows) => [...currentRows, nextRow]);
    setActiveRowId(rowId);
  };

  const handleUseRowAsNextRoundInput = (rowId: string) => {
    if (isBusy) return;

    const row = rows.find((candidate) => candidate.id === rowId);
    if (!row?.imageUrl) return;

    const matchingAsset = generatedAssets.find((asset) => asset.imageUrl === row.imageUrl);
    activateGeneratedAsset(matchingAsset ?? buildGeneratedAsset(row, row.imageUrl));
  };

  const handleDeleteRow = (rowId: string) => {
    if (rows.length <= 1 || isBusy) return;

    const nextRows = rows.filter((row) => row.id !== rowId);
    setRows(nextRows);

    if (activeRowId === rowId) {
      setActiveRowId(nextRows[0]?.id ?? "");
    }
  };

  const handleSelectAdjacentRow = (direction: -1 | 1) => {
    if (activeRowIndex < 0) return;

    const nextIndex = Math.min(rows.length - 1, Math.max(0, activeRowIndex + direction));
    const nextRow = rows[nextIndex];

    if (nextRow?.id && nextRow.id !== activeRowId) {
      setActiveRowId(nextRow.id);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3 sm:hidden">
          <div>
            <p className="type-kicker">Variant strip</p>
            <p className="type-section-copy mt-1 text-sm">
              Swipe across, tap a card, then edit the selected row below.
            </p>
          </div>
          <p className="type-meta shrink-0">
            {activeRowIndex >= 0 ? `${activeRowIndex + 1} / ${rows.length}` : `${rows.length} rows`}
          </p>
        </div>

        <div ref={rowStripRef} className="-mx-2 overflow-x-auto px-2 pb-2 sm:-mx-3 sm:px-3">
          <div className="flex min-w-max snap-x snap-proximity gap-4">
            <input
              ref={sourceFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleUploadSourceImage}
              disabled={isBusy}
            />

            <motion.article
              initial={{ opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="flex w-[min(86vw,304px)] shrink-0 snap-start flex-col overflow-hidden border border-[var(--line-subtle)] bg-white sm:w-[304px]"
            >
              <div className="relative overflow-hidden border-b border-[var(--line-subtle)] bg-slate-100">
                <SourcePreview source={selectedSource} imageSrc={selectedSourcePreviewImageSrc} />
              </div>
              <div className="flex min-h-[214px] flex-1 flex-col justify-between gap-3 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="type-chip ui-border inline-flex h-6 items-center border px-2.5">Source</span>
                  <span className="type-meta">
                    {roundSeedImage ? "Generated source" : uploadedSourceImage ? "Uploaded image" : selectedSource.category}
                  </span>
                </div>

                <div className="space-y-1">
                  <p className="type-meta">Reference</p>
                  <h3 className={cardCompactTitleClass}>{selectedSource.name}</h3>
                  <p className={cardCompactBodyClass}>{selectedSource.descriptor}</p>
                </div>

                {roundSeedImage ? (
                  <div className="space-y-1 border border-[var(--line-subtle)] bg-[var(--surface-muted)] px-3 py-2">
                    <p className="type-meta">Next round input</p>
                    <p className="truncate text-[0.78rem] leading-5 text-[var(--ink-body)]">
                      From {roundSeedImage.label}
                    </p>
                  </div>
                ) : uploadedSourceImage ? (
                  <div className="space-y-1 border border-[var(--line-subtle)] bg-[var(--surface-muted)] px-3 py-2">
                    <p className="type-meta">Uploaded source image</p>
                    <p className="truncate text-[0.78rem] leading-5 text-[var(--ink-body)]">
                      {uploadedSourceImage.name}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {selectedSource.tags.map((tag) => (
                    <span
                      key={tag}
                      className="border border-[var(--line-subtle)] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[var(--ink-subtle)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="ui-border border-t pt-2.5">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => sourceFileInputRef.current?.click()}
                      className="type-button-label h-9 w-full rounded-none border bg-transparent px-4 sm:flex-1"
                      disabled={isBusy}
                    >
                      {isUploadingSourceImage ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <ImageUp className="size-4" />
                      )}
                      {uploadedSourceImage ? "Replace upload" : "Upload source"}
                    </Button>

                    {roundSeedImage ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleUseOriginalSource}
                        className="type-button-label h-9 w-full rounded-none border bg-transparent px-4 sm:w-auto"
                        disabled={isBusy}
                      >
                        Use source
                      </Button>
                    ) : uploadedSourceImage ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleUsePresetSourceImage}
                        className="type-button-label h-9 w-full rounded-none border bg-transparent px-4 sm:w-auto"
                        disabled={isBusy}
                      >
                        Use preset
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </motion.article>

          {rows.map((row, index) => {
            const isActive = activeRow?.id === row.id;
            const isUsingRowAsSource = Boolean(row.imageUrl && roundSeedImage?.inputSrc === row.imageUrl);
            const isPlannerCardQueuedForReveal =
              index < rows.length && (isPlanning || (isPlanRevealing && index > plannerRevealIndex));
            const isPlannerCardRevealing = isPlanRevealing && index === plannerRevealIndex;

            return (
              <motion.article
                key={row.id}
                initial={{ opacity: 0, y: 18, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.4, ease: "easeOut", delay: (index + 1) * 0.045 }}
                ref={(element) => {
                  rowCardRefs.current[row.id] = element;
                }}
                className={`flex w-[min(86vw,304px)] shrink-0 snap-start flex-col overflow-hidden border bg-white transition sm:w-[304px] ${
                  isActive
                    ? "border-[var(--accent-strong)] shadow-[0_18px_40px_rgba(18,28,20,0.12)]"
                    : "border-[var(--line-subtle)]"
                }`}
              >
                <div className="relative overflow-hidden border-b border-[var(--line-subtle)] bg-slate-100">
                  <button
                    type="button"
                    onClick={() => setActiveRowId(row.id)}
                    aria-pressed={isActive}
                    className="block w-full text-left"
                  >
                    <VariantPreview row={row} source={selectedSource} placeholderImageSrc={sharedPlaceholderImageSrc} />
                  </button>
                </div>

                <div className="flex min-h-[188px] flex-1 flex-col gap-2.5 p-2.5">
                  {isPlannerCardQueuedForReveal ? (
                    <div className="space-y-2">
                      <div className="h-[62px] animate-pulse border border-[var(--line-subtle)] bg-[var(--surface-base)]" />
                      <div className="h-11 animate-pulse border border-[var(--line-subtle)] bg-[rgba(18,28,20,0.04)]" />
                    </div>
                  ) : (
                    <>
                      <motion.div
                        key={`${planRevealCycle}-${row.id}-${row.variantName}`}
                        initial={isPlannerCardRevealing ? { opacity: 0, y: 12 } : false}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, ease: "easeOut" }}
                        className="border border-[var(--line-subtle)] bg-[var(--surface-base)] px-3 py-2.5"
                      >
                        <h3 className={cardCompactTitleClass}>{row.variantName}</h3>
                      </motion.div>
                    </>
                  )}

                  <div className="grid gap-2 border-t border-[var(--line-subtle)] pt-2.5">
                    <div className="min-w-0">
                      <p className={cardMetaLabelClass}>Audience</p>
                      <p className={`${cardCompactBodyClass} mt-1 truncate`}>{row.audience}</p>
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--line-subtle)] pt-2.5">
                    <Button
                      variant="outline"
                      size="icon-xs"
                      onClick={() => handleDuplicateRow(row.id)}
                      className="rounded-none border"
                      disabled={rows.length >= MAX_ROWS || isBusy}
                    >
                      <Copy className="size-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      onClick={() => handleDeleteRow(row.id)}
                      className="rounded-none border"
                      disabled={rows.length <= 1 || isBusy}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                    {row.imageUrl ? (
                      <Button
                        variant="outline"
                        onClick={() => handleUseRowAsNextRoundInput(row.id)}
                        className={`type-button-label h-9 rounded-none border px-3 ${
                          isUsingRowAsSource
                            ? "border-[var(--accent-strong)] bg-[var(--surface-muted)] text-[var(--accent-strong)]"
                            : ""
                        }`}
                        disabled={isBusy}
                      >
                        <ArrowUp className="size-4" />
                        {isUsingRowAsSource ? "Using as source" : "Set source"}
                      </Button>
                    ) : null}
                    <Button
                      onClick={() => void generateImageForRow(row.id)}
                      className="type-button-label ui-button-primary h-9 w-full justify-center rounded-none px-4 sm:ml-auto sm:w-auto"
                      disabled={isBusy}
                    >
                      {row.status === "generated" ? (
                        <RotateCcw className="size-4" />
                      ) : row.status === "generating" ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Wand2 className="size-4" />
                      )}
                      {row.status === "generated" ? "Regenerate" : "Generate"}
                    </Button>
                  </div>

                  {row.errorMessage ? (
                    <div className="flex items-start gap-2 rounded-[10px] border border-[#d8c5bc] bg-[#fbf3ef] px-3 py-2 text-sm text-[#7d4434]">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <span>{row.errorMessage}</span>
                    </div>
                  ) : null}
                </div>
              </motion.article>
            );
          })}
          </div>
        </div>
      </div>

      <div className="border border-[var(--line-subtle)] bg-[var(--surface-muted)] p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-[54rem]">
            <p className="type-kicker">Variant strip</p>
          </div>

          <Button
            variant="outline"
            onClick={handleAddRow}
            className="type-button-label ui-button-secondary h-11 w-full rounded-none border bg-transparent px-5 sm:w-auto xl:shrink-0"
            disabled={rows.length >= MAX_ROWS || isBusy}
          >
            <Plus className="size-4" />
            Add row
          </Button>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_auto_auto] xl:items-end">
          <div className="space-y-2">
            <span className="type-meta">Reference</span>
            <div className="flex h-11 items-center border border-[var(--line-subtle)] bg-white px-3 text-sm text-[var(--ink-strong)]">
              {selectedSource.name}
            </div>
          </div>

          <label className="space-y-2">
            <span className="type-meta">Planner prompt</span>
            <input
              value={plannerInput}
              onChange={(event) => setPlannerInput(event.target.value)}
              className={plannerInputClassName}
              placeholder="Describe the next set of creative directions."
              disabled={isBusy}
            />
          </label>

          <Button
            onClick={() => void handlePlannerApply()}
            className="type-button-label ui-button-primary h-11 w-full rounded-none px-5 xl:w-auto xl:self-end"
            disabled={isBusy}
          >
            {isPlanning ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {isPlanning ? "Creating prompts..." : isPlanRevealing ? "Revealing..." : "Create prompts"}
          </Button>

          <Button
            variant="outline"
            onClick={() => void handleGenerateAll()}
            className="type-button-label ui-button-secondary h-11 w-full rounded-none border bg-transparent px-5 xl:w-auto xl:self-end"
            disabled={!rows.length || isBusy}
          >
            {isGeneratingAll ? <LoaderCircle className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {isGeneratingAll ? "Generating..." : "Generate all"}
          </Button>
        </div>

        {generatedAssets.length ? (
          <div className="mt-3 border-t border-[var(--line-subtle)] pt-3">
            <div className="flex items-center justify-between gap-3">
              <p className="type-meta">Reuse generated assets</p>
              <p className="type-meta">{generatedAssets.length} available</p>
            </div>

            <div className="-mx-1 mt-2 overflow-x-auto px-1">
              <div className="flex min-w-max gap-2.5">
                {generatedAssets.map((asset) => {
                  const isActiveAsset = roundSeedImage?.inputSrc === asset.imageUrl;

                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => activateGeneratedAsset(asset)}
                      className={`w-[124px] shrink-0 border bg-white p-1.5 text-left transition ${
                        isActiveAsset
                          ? "border-[var(--accent-strong)] shadow-[0_14px_26px_-22px_rgba(18,28,20,0.55)]"
                          : "border-[var(--line-subtle)] hover:border-[var(--accent-strong)]"
                      }`}
                      disabled={isBusy}
                    >
                      <div className="relative h-[84px] overflow-hidden border border-[var(--line-subtle)] bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset.imageUrl}
                          alt={asset.label}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        {isActiveAsset ? (
                          <span className="absolute right-1.5 top-1.5 border border-white/35 bg-[rgba(18,28,20,0.7)] px-1.5 py-0.5 text-[8px] uppercase tracking-[0.14em] text-white">
                            Using
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 space-y-0.5 px-0.5">
                        <p className="truncate text-[0.74rem] font-medium leading-4 text-[var(--ink-strong)]">
                          {asset.label}
                        </p>
                        <p className="truncate text-[0.66rem] uppercase tracking-[0.12em] text-[var(--ink-subtle)]">
                          {asset.detail}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {activity.text ? (
          <div
            className={`mt-3 flex items-start gap-2 border px-3 py-2.5 text-sm ${
              activity.tone === "error"
                ? "border-[#d8c5bc] bg-[#fbf3ef] text-[#7d4434]"
                : "border-[var(--line-subtle)] bg-white text-[var(--ink-body)]"
            }`}
          >
            {activity.tone === "error" ? (
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
            ) : (
              <Sparkles className="mt-0.5 size-4 shrink-0 text-[var(--accent-strong)]" />
            )}
            <span>{activity.text}</span>
          </div>
        ) : null}
      </div>

      {activeRow ? (
        <div className="border border-[var(--line-subtle)] bg-white p-3 sm:p-4">
          <div className="flex flex-col gap-2 border-b border-[var(--line-subtle)] pb-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[1.65rem] font-semibold leading-[0.96] tracking-[-0.05em] text-[var(--ink-strong)]">
              {activeRow.variantName}
            </p>

            <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
              <p className="type-meta whitespace-nowrap">
                {activeRowIndex + 1}
                {" / "}
                {rows.length}
              </p>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleSelectAdjacentRow(-1)}
                  className="type-button-label h-8 rounded-none border bg-transparent px-2.5"
                  disabled={activeRowIndex <= 0 || isBusy}
                >
                  <ChevronLeft className="size-4" />
                  Prev
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleSelectAdjacentRow(1)}
                  className="type-button-label h-8 rounded-none border bg-transparent px-2.5"
                  disabled={activeRowIndex >= rows.length - 1 || isBusy}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-2.5 lg:grid-cols-4">
            <label className="space-y-2">
              <span className="type-meta">Variant name</span>
              <input
                value={activeRow.variantName}
                onChange={(event) => updateRow(activeRow.id, "variantName", event.target.value)}
                className={inputClassName}
                disabled={isBusy}
              />
            </label>

            <label className="space-y-2">
              <span className="type-meta">Audience</span>
              <input
                value={activeRow.audience}
                onChange={(event) => updateRow(activeRow.id, "audience", event.target.value)}
                className={inputClassName}
                disabled={isBusy}
              />
            </label>

            <label className="space-y-2">
              <span className="type-meta">Pain point</span>
              <input
                value={activeRow.painPoint}
                onChange={(event) => updateRow(activeRow.id, "painPoint", event.target.value)}
                className={inputClassName}
                disabled={isBusy}
              />
            </label>

            <label className="space-y-2">
              <span className="type-meta">Language</span>
              <input
                value={activeRow.language}
                onChange={(event) => updateRow(activeRow.id, "language", event.target.value)}
                className={inputClassName}
                disabled={isBusy}
              />
            </label>

            <label className="space-y-2 lg:col-span-2">
              <span className="type-meta">Body copy</span>
              <textarea
                value={activeRow.bodyCopy}
                onChange={(event) => updateRow(activeRow.id, "bodyCopy", event.target.value)}
                className={textAreaClassName}
                disabled={isBusy}
              />
            </label>

            <label className="space-y-2 lg:col-span-2">
              <span className="type-meta">Keywords</span>
              <input
                value={activeRow.words}
                onChange={(event) => updateRow(activeRow.id, "words", event.target.value)}
                className={inputClassName}
                disabled={isBusy}
              />
            </label>

            <label className="space-y-2">
              <span className="type-meta">Primary color</span>
              <div className="flex h-11 items-center gap-3 border border-[var(--line-subtle)] bg-white px-3">
                <input
                  type="color"
                  value={activeRow.primaryColor}
                  onChange={(event) => updateRow(activeRow.id, "primaryColor", event.target.value)}
                  className="size-7 cursor-pointer border-0 bg-transparent p-0"
                  disabled={isBusy}
                />
                <span className="type-section-copy text-sm uppercase">{activeRow.primaryColor}</span>
              </div>
            </label>

            <label className="space-y-2">
              <span className="type-meta">Accent color</span>
              <div className="flex h-11 items-center gap-3 border border-[var(--line-subtle)] bg-white px-3">
                <input
                  type="color"
                  value={activeRow.accentColor}
                  onChange={(event) => updateRow(activeRow.id, "accentColor", event.target.value)}
                  className="size-7 cursor-pointer border-0 bg-transparent p-0"
                  disabled={isBusy}
                />
                <span className="type-section-copy text-sm uppercase">{activeRow.accentColor}</span>
              </div>
            </label>

            <label className="space-y-2 lg:col-span-4">
              <span className="type-meta">Image prompt</span>
              <textarea
                value={activeRow.promptText}
                onChange={(event) => updateRow(activeRow.id, "promptText", event.target.value)}
                className="min-h-[120px] w-full resize-none border border-[var(--line-subtle)] bg-white px-3 py-3 text-sm leading-6 text-[var(--ink-strong)] outline-none transition focus:border-[var(--accent-strong)]"
                disabled={isBusy}
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}
