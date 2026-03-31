import { CreativeVariantsDemo } from "@/components/creative-variants-demo";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1600px] px-3 sm:px-5 lg:px-6">
        <section className="ui-border border-b py-2.5 sm:py-3">
          <h1 className="font-[family:var(--font-editorial)] text-[clamp(1.35rem,2.2vw,1.9rem)] leading-[0.98] tracking-[-0.03em] text-[var(--ink-strong)]">
            Creative Variant Factory
          </h1>
        </section>

        <section id="app" className="py-3 sm:py-4">
          <CreativeVariantsDemo />
        </section>
      </div>
    </main>
  );
}
