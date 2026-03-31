import { Sparkles } from "lucide-react";

import { CreativeVariantsDemo } from "@/components/creative-variants-demo";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <section className="ui-border border-b py-6 sm:py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="type-display-hero sm:whitespace-nowrap">
              Creative Variant Sheet
            </h1>
            <a
              href="#app"
              className="type-button-label ui-button-primary inline-flex h-11 items-center justify-center gap-2 rounded-none px-5 transition sm:w-auto"
            >
              <Sparkles className="size-4" />
              Open app
            </a>
          </div>
        </section>

        <section id="app" className="py-6 sm:py-8">
          <CreativeVariantsDemo />
        </section>
      </div>
    </main>
  );
}
