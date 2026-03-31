import { ArrowUpRight, Sparkles } from "lucide-react";

import { CreativeVariantsDemo } from "@/components/creative-variants-demo";

const standaloneAppUrl = process.env.NEXT_PUBLIC_STANDALONE_APP_URL || "";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <section className="ui-border border-b py-8 sm:py-10">
          <div className="space-y-8">
            <div className="space-y-4">
              <p className="type-kicker">Standalone app</p>
              <h1 className="type-display-hero max-w-[11.5ch]">
                Creative Variant Sheet
              </h1>
              <p className="type-lead max-w-[50rem]">
                Plan a row set, edit each concept, and generate image variants from one source product image.
                This standalone build keeps the workflow focused on prompt planning, source reuse, and live creative output.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="type-chip ui-border inline-flex h-9 items-center border px-3">
                Source-first workflow
              </span>
              <span className="type-chip ui-border inline-flex h-9 items-center border px-3">
                GPT OSS planning
              </span>
              <span className="type-chip ui-border inline-flex h-9 items-center border px-3">
                Live generation
              </span>
            </div>

            <div className="ui-border ui-surface-base border p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-2">
                  <p className="type-kicker">What it does</p>
                  <p className="type-section-copy max-w-[48rem]">
                    Use one reference image, create multiple ad directions, and keep each row editable so testing
                    stays structured instead of turning into a pile of disconnected prompts.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <a
                    href="#app"
                    className="type-button-label ui-button-primary inline-flex h-11 items-center justify-center gap-2 rounded-none px-5 transition"
                  >
                    <Sparkles className="size-4" />
                    Open app
                  </a>
                  {standaloneAppUrl ? (
                    <a
                      href={standaloneAppUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="type-button-label ui-button-secondary inline-flex h-11 items-center justify-center gap-2 rounded-none border px-5 transition"
                    >
                      External URL
                      <ArrowUpRight className="size-4" />
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="app" className="py-6 sm:py-8">
          <CreativeVariantsDemo />
        </section>
      </div>
    </main>
  );
}
