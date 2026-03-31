import { CreativeVariantsDemo } from "@/components/creative-variants-demo";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <section className="ui-border border-b py-6 sm:py-8">
          <h1 className="font-[family:var(--font-editorial)] text-[clamp(2rem,4vw,3.35rem)] leading-[0.94] tracking-[-0.045em] text-[var(--ink-strong)]">
            Creative Variant Factory
          </h1>
        </section>

        <section id="app" className="py-6 sm:py-8">
          <CreativeVariantsDemo />
        </section>
      </div>
    </main>
  );
}
