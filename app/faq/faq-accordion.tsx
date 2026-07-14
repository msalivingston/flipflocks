"use client";

import { useState } from "react";

export type PublicFaq = {
  answer: string;
  id: string;
  question: string;
};

export function FaqAccordion({ faqs }: { faqs: PublicFaq[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  function toggleFaq(id: string) {
    setOpenIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#e6ddcf] bg-white/72">
      {faqs.map((faq) => {
        const isOpen = openIds.has(faq.id);
        const answerId = `faq-answer-${faq.id}`;

        return (
          <div className="border-b border-[#e6ddcf] last:border-b-0" key={faq.id}>
            <h2>
              <button
                aria-controls={answerId}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-5 px-5 py-4 text-left font-serif text-[1.08rem] leading-6 text-[#143d28] transition hover:bg-[#fbf8ef] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#0e4a2d] sm:px-7 sm:py-5 sm:text-[1.18rem]"
                type="button"
                onClick={() => toggleFaq(faq.id)}
              >
                <span>{faq.question}</span>
                <span
                  aria-hidden="true"
                  className={`shrink-0 text-xl leading-none text-[#143d28] transition-transform ${
                    isOpen ? "rotate-45" : ""
                  }`}
                >
                  +
                </span>
              </button>
            </h2>

            {isOpen ? (
              <div
                className="px-5 pb-5 text-[1rem] leading-7 text-[#303830] sm:px-7 sm:pb-6"
                id={answerId}
              >
                <p className="whitespace-pre-line">{faq.answer}</p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
