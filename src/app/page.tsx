import { CreativeVariantsDemo } from "@/components/creative-variants-demo";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1600px] px-3 sm:px-5 lg:px-6">
        <section id="app" className="py-3">
          <CreativeVariantsDemo />
        </section>
      </div>
    </main>
  );
}
