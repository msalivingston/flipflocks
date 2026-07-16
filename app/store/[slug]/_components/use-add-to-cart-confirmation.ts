"use client";

import { useEffect, useRef, useState } from "react";

export function useAddToCartConfirmation() {
  const confirmationPanelRef = useRef<HTMLDivElement | null>(null);
  const [confirmationSignal, setConfirmationSignal] = useState(0);
  const [isButtonConfirmed, setIsButtonConfirmed] = useState(false);
  const [isPanelHighlighted, setIsPanelHighlighted] = useState(false);

  useEffect(() => {
    if (confirmationSignal === 0) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let frameId = 0;
    let labelTimeoutId = 0;
    let highlightTimeoutId = 0;

    labelTimeoutId = window.setTimeout(() => {
      setIsButtonConfirmed(false);
    }, 1600);

    frameId = window.requestAnimationFrame(() => {
      const panel = confirmationPanelRef.current;

      if (!panel) return;

      scrollConfirmationPanelIntoView(panel, prefersReducedMotion);

      if (!prefersReducedMotion) {
        setIsPanelHighlighted(true);
        highlightTimeoutId = window.setTimeout(() => {
          setIsPanelHighlighted(false);
        }, 1200);
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(labelTimeoutId);
      window.clearTimeout(highlightTimeoutId);
    };
  }, [confirmationSignal]);

  return {
    confirmationPanelRef,
    isButtonConfirmed,
    isPanelHighlighted,
    showAddToCartConfirmation: () => {
      setIsButtonConfirmed(true);
      setConfirmationSignal((current) => current + 1);
    },
  };
}

function scrollConfirmationPanelIntoView(
  panel: HTMLElement,
  prefersReducedMotion: boolean,
) {
  const rect = panel.getBoundingClientRect();
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight;
  const isAlreadyNoticeable =
    rect.top >= 0 && rect.top <= viewportHeight * 0.72;

  if (isAlreadyNoticeable) return;

  const desiredTop = Math.min(
    Math.max(viewportHeight * 0.62, 180),
    viewportHeight - 120,
  );

  window.scrollTo({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    top: Math.max(0, window.scrollY + rect.top - desiredTop),
  });
}
