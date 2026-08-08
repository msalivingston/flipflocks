import Image from "next/image";
import Link from "next/link";
import type { LegalDocument } from "@/lib/legal-documents";
import { legalRoutes } from "@/lib/legal";

export function LegalDocumentPage({ document }: { document: LegalDocument }) {
  return (
    <main className="min-h-screen bg-[#fbf7ef] text-[#173624]">
      <header className="border-b border-[#ddd5c6] bg-white/95 px-5 py-4 md:px-8">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-5">
          <Link className="inline-flex" href="/" aria-label="FlockFront home">
            <Image
              alt="FlockFront"
              className="h-auto w-[170px] sm:w-[205px]"
              height={236}
              priority
              src="/branding/flockfront-logo-final-cropped.png"
              width={1549}
            />
          </Link>
          <Link
            className="text-sm font-bold text-[#17613a] underline decoration-[#9dbda5] decoration-2 underline-offset-4 hover:text-[#0d4829]"
            href="/"
          >
            Back to FlockFront
          </Link>
        </div>
      </header>

      <article className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="rounded-2xl border border-[#ded6c7] bg-white px-5 py-8 shadow-[0_14px_38px_rgba(57,45,25,0.08)] sm:px-10 sm:py-11 lg:px-14">
          <header className="border-b border-[#e5ded1] pb-7">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#277047]">
              FlockFront legal
            </p>
            <h1 className="mt-3 font-serif text-3xl font-semibold leading-tight text-[#10281c] sm:text-4xl">
              {document.title}
            </h1>
            <div className="mt-4 space-y-1 text-sm font-semibold text-stone-600">
              {document.meta.map((line) => <p key={line}>{line}</p>)}
            </div>
          </header>

          <div className="mt-7 space-y-5 text-[15px] leading-7 text-stone-700 sm:text-base sm:leading-8">
            {document.introduction.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>

          <div className="mt-9 space-y-9">
            {document.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="font-serif text-2xl font-semibold leading-tight text-[#163824]">
                  {section.heading}
                </h2>
                <div className="mt-4 space-y-4 text-[15px] leading-7 text-stone-700 sm:text-base sm:leading-8">
                  {section.blocks.map((block, index) => {
                    if (block.type === "list") {
                      return (
                        <ul className="list-disc space-y-2 pl-6 marker:text-[#277047]" key={index}>
                          {block.items.map((item) => <li key={item}>{item}</li>)}
                        </ul>
                      );
                    }
                    if (block.type === "address") {
                      return (
                        <address className="not-italic" key={index}>
                          {block.lines.map((line) => <span className="block" key={line}>{line}</span>)}
                        </address>
                      );
                    }
                    return <p key={index}>{block.text}</p>;
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </article>

      <footer className="border-t border-[#ddd5c6] bg-white px-5 py-6 md:px-8">
        <nav className="mx-auto flex max-w-5xl flex-wrap justify-center gap-x-6 gap-y-3 text-sm font-semibold text-[#17613a]" aria-label="Legal policies">
          <Link href={legalRoutes.terms}>Terms of Service</Link>
          <Link href={legalRoutes.privacy}>Privacy Policy</Link>
          <Link href={legalRoutes.acceptableUse}>Acceptable Use</Link>
        </nav>
      </footer>
    </main>
  );
}

