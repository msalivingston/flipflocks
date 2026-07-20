"use client";

import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { buildPublicListingPath } from "../_lib/public-listing-url";

type ListingShareDialogMode = "published" | "share";

export type ListingShareDialogItem = {
  id: string;
  title: string;
  publicPath: ReturnType<typeof buildPublicListingPath> | undefined;
  shareText?: string | null;
  summary?: string | null;
};

export type ListingShareDialogProps = {
  listingTitle: string;
  storeName: string;
  publicPath: ReturnType<typeof buildPublicListingPath> | undefined;
  isStorePublic: boolean;
  shareText?: string | null;
  summary?: string | null;
  mode?: ListingShareDialogMode;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
};

type CopyState = "idle" | "copied" | "error";
type ShareFailure = "unavailable" | "failed" | null;

export function ListingShareDialog({
  listingTitle,
  storeName,
  publicPath,
  isStorePublic,
  shareText: customShareText,
  summary,
  mode = "published",
  open,
  onClose,
  onDone,
}: ListingShareDialogProps) {
  const dialogTitleId = useId();
  const fallbackTitleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyResetTimer = useRef<number | null>(null);
  const [origin, setOrigin] = useState("");
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [shareFailure, setShareFailure] = useState<ShareFailure>(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);

  const normalizedPublicPath = normalizePublicPath(publicPath);
  const absoluteUrl = useMemo(() => {
    return buildAbsoluteUrl(normalizedPublicPath, origin);
  }, [normalizedPublicPath, origin]);
  const shareText =
    customShareText?.trim() || buildShareText({ listingTitle, storeName, summary });
  const hasValidPublicPath = Boolean(normalizedPublicPath);
  const canSharePublicLink = Boolean(isStorePublic && absoluteUrl);
  const isPublishedMode = mode === "published";

  useEffect(() => {
    if (!open) return;

    const resetTimer = window.setTimeout(() => {
      setOrigin(window.location.origin);
      setCopyState("idle");
      setShareFailure(null);
      setFallbackOpen(false);
      closeButtonRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(resetTimer);
  }, [open]);

  useEffect(() => {
    if (!open || copyState !== "copied") return;

    copyResetTimer.current = window.setTimeout(() => {
      setCopyState("idle");
    }, 1600);

    return () => {
      if (copyResetTimer.current) {
        window.clearTimeout(copyResetTimer.current);
        copyResetTimer.current = null;
      }
    };
  }, [copyState, open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") handleClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function handleClose() {
    setFallbackOpen(false);
    setShareFailure(null);
    onClose();
  }

  function handleDone() {
    setFallbackOpen(false);
    setShareFailure(null);
    if (onDone) {
      onDone();
      return;
    }

    onClose();
  }

  async function copyListingUrl() {
    if (!absoluteUrl) return;

    const copied = await copyTextToClipboard(absoluteUrl);
    setCopyState(copied ? "copied" : "error");
  }

  async function shareListing() {
    if (!absoluteUrl || !canSharePublicLink) return;

    setShareFailure(null);

    if (!("share" in navigator) || typeof navigator.share !== "function") {
      setFallbackOpen(true);
      setShareFailure("unavailable");
      return;
    }

    const shareData = {
      title: listingTitle,
      text: shareText,
      url: absoluteUrl,
    };

    try {
      if (
        "canShare" in navigator &&
        typeof navigator.canShare === "function" &&
        !navigator.canShare(shareData)
      ) {
        setFallbackOpen(true);
        setShareFailure("unavailable");
        return;
      }

      await navigator.share(shareData);
    } catch (error) {
      if (isAbortError(error)) return;

      setFallbackOpen(true);
      setShareFailure("failed");
    }
  }

  function openFacebookShare() {
    if (!absoluteUrl) return;

    openExternalWindow(buildFacebookShareUrl(absoluteUrl));
  }

  function openEmailShare() {
    if (!absoluteUrl) return;

    const subject = listingTitle;
    const customEmailBody = customShareText?.trim();
    const bodyParts = customEmailBody
      ? [customEmailBody, absoluteUrl]
      : [listingTitle, storeName, summary?.trim(), absoluteUrl];
    window.location.href = buildEmailShareUrl({
      bodyParts,
      subject,
    });
  }

  if (!open) return null;

  return (
    <div
      aria-labelledby={dialogTitleId}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-stone-950/45 px-3 py-5 sm:px-4 sm:py-6"
      role="dialog"
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xl">
        <button
          ref={closeButtonRef}
          aria-label="Close dialog"
          className="absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-full text-2xl leading-none text-stone-500 transition hover:bg-stone-100 hover:text-stone-950 focus:outline-none focus:ring-2 focus:ring-emerald-700"
          type="button"
          onClick={handleClose}
        >
          &times;
        </button>

        <div className="grid gap-5 px-4 pb-5 pt-6 sm:px-6 sm:pb-6">
          {isStorePublic ? (
            <PublicStoreContent
              absoluteUrl={absoluteUrl}
              canSharePublicLink={canSharePublicLink}
              copyState={copyState}
              dialogTitleId={dialogTitleId}
              fallbackOpen={fallbackOpen}
              fallbackTitleId={fallbackTitleId}
              hasValidPublicPath={hasValidPublicPath}
              isPublishedMode={isPublishedMode}
              listingTitle={listingTitle}
              shareFailure={shareFailure}
              onCloseFallback={() => setFallbackOpen(false)}
              onCopy={() => void copyListingUrl()}
              onDone={handleDone}
              onEmail={openEmailShare}
              onFacebook={openFacebookShare}
              onShare={() => void shareListing()}
              onViewListing={() => absoluteUrl && openExternalWindow(absoluteUrl)}
            />
          ) : (
            <HiddenStoreContent
              dialogTitleId={dialogTitleId}
              listingTitle={listingTitle}
              onDone={handleDone}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function ListingShareMultiDialog({
  isStorePublic,
  items,
  mode = "published",
  open,
  onClose,
  onDone,
  storeName,
}: {
  isStorePublic: boolean;
  items: ListingShareDialogItem[];
  mode?: ListingShareDialogMode;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
  storeName: string;
}) {
  const dialogTitleId = useId();
  const fallbackTitleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyResetTimer = useRef<number | null>(null);
  const [origin, setOrigin] = useState("");
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [copyErrorItemId, setCopyErrorItemId] = useState<string | null>(null);
  const [fallbackItemId, setFallbackItemId] = useState<string | null>(null);
  const [shareFailure, setShareFailure] = useState<ShareFailure>(null);

  useEffect(() => {
    if (!open) return;

    const resetTimer = window.setTimeout(() => {
      setOrigin(window.location.origin);
      setCopiedItemId(null);
      setCopyErrorItemId(null);
      setFallbackItemId(null);
      setShareFailure(null);
      closeButtonRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(resetTimer);
  }, [open]);

  useEffect(() => {
    if (!open || !copiedItemId) return;

    copyResetTimer.current = window.setTimeout(() => {
      setCopiedItemId(null);
    }, 1600);

    return () => {
      if (copyResetTimer.current) {
        window.clearTimeout(copyResetTimer.current);
        copyResetTimer.current = null;
      }
    };
  }, [copiedItemId, open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") handleClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function handleClose() {
    setFallbackItemId(null);
    setShareFailure(null);
    onClose();
  }

  function handleDone() {
    setFallbackItemId(null);
    setShareFailure(null);
    if (onDone) {
      onDone();
      return;
    }

    onClose();
  }

  function getAbsoluteUrl(item: ListingShareDialogItem) {
    return buildAbsoluteUrl(item.publicPath, origin);
  }

  function getShareText(item: ListingShareDialogItem) {
    return (
      item.shareText?.trim() ||
      buildShareText({
        listingTitle: item.title,
        storeName,
        summary: item.summary,
      })
    );
  }

  async function copyListingUrl(item: ListingShareDialogItem) {
    const absoluteUrl = getAbsoluteUrl(item);
    if (!absoluteUrl) return;

    const copied = await copyTextToClipboard(absoluteUrl);
    setCopiedItemId(copied ? item.id : null);
    setCopyErrorItemId(copied ? null : item.id);
  }

  async function shareListing(item: ListingShareDialogItem) {
    const absoluteUrl = getAbsoluteUrl(item);
    if (!absoluteUrl || !isStorePublic) return;

    setShareFailure(null);

    if (!("share" in navigator) || typeof navigator.share !== "function") {
      setFallbackItemId(item.id);
      setShareFailure("unavailable");
      return;
    }

    const shareData = {
      title: item.title,
      text: getShareText(item),
      url: absoluteUrl,
    };

    try {
      if (
        "canShare" in navigator &&
        typeof navigator.canShare === "function" &&
        !navigator.canShare(shareData)
      ) {
        setFallbackItemId(item.id);
        setShareFailure("unavailable");
        return;
      }

      await navigator.share(shareData);
    } catch (error) {
      if (isAbortError(error)) return;

      setFallbackItemId(item.id);
      setShareFailure("failed");
    }
  }

  function openFacebookShare(item: ListingShareDialogItem) {
    const absoluteUrl = getAbsoluteUrl(item);
    if (!absoluteUrl) return;

    openExternalWindow(buildFacebookShareUrl(absoluteUrl));
  }

  function openEmailShare(item: ListingShareDialogItem) {
    const absoluteUrl = getAbsoluteUrl(item);
    if (!absoluteUrl) return;

    window.location.href = buildEmailShareUrl({
      bodyParts: [getShareText(item), absoluteUrl],
      subject: item.title,
    });
  }

  if (!open) return null;

  const fallbackItem = items.find((item) => item.id === fallbackItemId) ?? null;
  const isPublishedMode = mode === "published";

  return (
    <div
      aria-labelledby={dialogTitleId}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-stone-950/45 px-3 py-5 sm:px-4 sm:py-6"
      role="dialog"
    >
      <div className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xl">
        <button
          ref={closeButtonRef}
          aria-label="Close dialog"
          className="absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-full text-2xl leading-none text-stone-500 transition hover:bg-stone-100 hover:text-stone-950 focus:outline-none focus:ring-2 focus:ring-emerald-700"
          type="button"
          onClick={handleClose}
        >
          &times;
        </button>

        <div className="grid gap-5 px-4 pb-5 pt-6 sm:px-6 sm:pb-6">
          {isStorePublic ? (
            <>
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-800 text-3xl font-semibold text-white shadow-sm">
                <Image
                  alt=""
                  aria-hidden="true"
                  className="size-7 object-contain brightness-0 invert"
                  height={28}
                  src="/glyphs/checkmark.png"
                  width={28}
                />
              </div>
              <div className="text-center">
                <h2
                  className="text-2xl font-semibold leading-tight text-stone-950"
                  id={dialogTitleId}
                >
                  {isPublishedMode ? "Your listings are live!" : "Share listings"}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-700">
                  {isPublishedMode
                    ? "Your live poultry listings are now published on your storefront."
                    : "Choose a listing to view, share, or copy."}
                </p>
              </div>

              <div className="grid gap-3">
                {items.map((item) => {
                  const normalizedPath = normalizePublicPath(item.publicPath);
                  const absoluteUrl = getAbsoluteUrl(item);
                  const copyState =
                    copiedItemId === item.id
                      ? "copied"
                      : copyErrorItemId === item.id
                        ? "error"
                        : "idle";

                  return (
                    <section
                      className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                      key={item.id}
                    >
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-stone-950">
                          {item.title}
                        </h3>
                        {item.summary ? (
                          <p className="mt-1 text-xs leading-5 text-stone-600">
                            {item.summary}
                          </p>
                        ) : null}
                        {!normalizedPath ? (
                          <p className="mt-1 text-xs font-medium text-amber-700">
                            The public listing link is not available yet.
                          </p>
                        ) : copyState === "copied" ? (
                          <p
                            aria-live="polite"
                            className="mt-1 text-xs font-semibold text-emerald-700"
                            role="status"
                          >
                            Copied
                          </p>
                        ) : copyState === "error" ? (
                          <p
                            aria-live="polite"
                            className="mt-1 text-xs font-semibold text-red-700"
                            role="status"
                          >
                            Copy was not available.
                          </p>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                        <button
                          className="seller-secondary-button min-h-10 justify-center px-3 text-sm"
                          disabled={!absoluteUrl}
                          type="button"
                          onClick={() => absoluteUrl && openExternalWindow(absoluteUrl)}
                        >
                          View
                        </button>
                        <button
                          className="seller-secondary-button min-h-10 justify-center px-3 text-sm"
                          disabled={!absoluteUrl}
                          type="button"
                          onClick={() => void shareListing(item)}
                        >
                          Share
                        </button>
                        <button
                          className="seller-secondary-button min-h-10 justify-center px-3 text-sm"
                          disabled={!absoluteUrl}
                          type="button"
                          onClick={() => void copyListingUrl(item)}
                        >
                          {copyState === "copied" ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </section>
                  );
                })}
              </div>

              {fallbackItem ? (
                <FallbackSharePanel
                  fallbackTitleId={fallbackTitleId}
                  shareFailure={shareFailure}
                  onClose={() => setFallbackItemId(null)}
                  onCopy={() => void copyListingUrl(fallbackItem)}
                  onEmail={() => openEmailShare(fallbackItem)}
                  onFacebook={() => openFacebookShare(fallbackItem)}
                />
              ) : null}

              <div className="flex justify-center">
                <button
                  className="seller-secondary-button min-w-28 justify-center"
                  type="button"
                  onClick={handleDone}
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <HiddenStoreMultiContent
              dialogTitleId={dialogTitleId}
              onDone={handleDone}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function PublicStoreContent({
  absoluteUrl,
  canSharePublicLink,
  copyState,
  dialogTitleId,
  fallbackOpen,
  fallbackTitleId,
  hasValidPublicPath,
  isPublishedMode,
  listingTitle,
  shareFailure,
  onCloseFallback,
  onCopy,
  onDone,
  onEmail,
  onFacebook,
  onShare,
  onViewListing,
}: {
  absoluteUrl: string | null;
  canSharePublicLink: boolean;
  copyState: CopyState;
  dialogTitleId: string;
  fallbackOpen: boolean;
  fallbackTitleId: string;
  hasValidPublicPath: boolean;
  isPublishedMode: boolean;
  listingTitle: string;
  shareFailure: ShareFailure;
  onCloseFallback: () => void;
  onCopy: () => void;
  onDone: () => void;
  onEmail: () => void;
  onFacebook: () => void;
  onShare: () => void;
  onViewListing: () => void;
}) {
  if (!hasValidPublicPath) {
    return (
      <NeutralMissingPathContent
        dialogTitleId={dialogTitleId}
        onDone={onDone}
      />
    );
  }

  const displayUrl = absoluteUrl ?? "Preparing listing link...";

  return (
    <>
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-800 text-3xl font-semibold text-white shadow-sm">
        <Image
          alt=""
          aria-hidden="true"
          className="size-7 object-contain brightness-0 invert"
          height={28}
          src="/glyphs/checkmark.png"
          width={28}
        />
      </div>
      <div className="text-center">
        <h2
          className="text-2xl font-semibold leading-tight text-stone-950"
          id={dialogTitleId}
        >
          {isPublishedMode ? "Your listing is live!" : "Share your listing"}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-700">
          {isPublishedMode
            ? `${listingTitle} is now published on your storefront.`
            : "Get the word out and reach more local buyers."}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          className="seller-primary-button justify-center bg-emerald-800 hover:bg-emerald-900"
          disabled={!canSharePublicLink}
          type="button"
          onClick={onViewListing}
        >
          View listing
        </button>
        <button
          className={`justify-center ${
            isPublishedMode ? "seller-secondary-button" : "seller-primary-button"
          }`}
          disabled={!canSharePublicLink}
          type="button"
          onClick={onShare}
        >
          Share now
        </button>
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-xs font-medium text-stone-500">
          <span className="h-px bg-stone-200" />
          <span>or copy your listing link</span>
          <span className="h-px bg-stone-200" />
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            aria-readonly="true"
            className="seller-form-field min-w-0 cursor-not-allowed truncate shadow-none"
            readOnly
            value={displayUrl}
          />
          <button
            className="seller-secondary-button justify-center"
            type="button"
            onClick={onCopy}
          >
            {copyState === "copied" ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="min-h-5" aria-live="polite" role="status">
          {copyState === "copied" ? (
            <p className="text-xs font-semibold text-emerald-700">Copied</p>
          ) : copyState === "error" ? (
            <p className="text-xs font-semibold text-red-700">
              Copy was not available. Select the link and copy it manually.
            </p>
          ) : null}
        </div>
        <p className="text-center text-sm leading-6 text-stone-600">
          Share your listing to reach more local buyers.
        </p>
      </div>

      {fallbackOpen ? (
        <FallbackSharePanel
          fallbackTitleId={fallbackTitleId}
          shareFailure={shareFailure}
          onClose={onCloseFallback}
          onCopy={onCopy}
          onEmail={onEmail}
          onFacebook={onFacebook}
        />
      ) : null}

      <div className="flex justify-center">
        <button
          className="seller-secondary-button min-w-28 justify-center"
          type="button"
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </>
  );
}

function FallbackSharePanel({
  fallbackTitleId,
  shareFailure,
  onClose,
  onCopy,
  onEmail,
  onFacebook,
}: {
  fallbackTitleId: string;
  shareFailure: ShareFailure;
  onClose: () => void;
  onCopy: () => void;
  onEmail: () => void;
  onFacebook: () => void;
}) {
  return (
    <section
      aria-labelledby={fallbackTitleId}
      className="rounded-lg border border-stone-200 bg-stone-50 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3
            className="text-base font-semibold leading-6 text-stone-950"
            id={fallbackTitleId}
          >
            Share your listing
          </h3>
          <p className="mt-1 text-sm leading-5 text-stone-600">
            {shareFailure === "failed"
              ? "Native sharing was not completed. Use one of these options instead."
              : "Choose a quick sharing option."}
          </p>
        </div>
        <button
          aria-label="Close sharing options"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xl leading-none text-stone-500 transition hover:bg-white hover:text-stone-950 focus:outline-none focus:ring-2 focus:ring-emerald-700"
          type="button"
          onClick={onClose}
        >
          &times;
        </button>
      </div>
      <div className="mt-3 grid divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
        <ShareOptionButton
          glyph="/glyphs/clipboard.png"
          label="Copy link"
          description="Copy the link to your listing"
          onClick={onCopy}
        />
        <ShareOptionButton
          glyph="/glyphs/chat.png"
          label="Share on Facebook"
          description="Share to your feed or a group"
          onClick={onFacebook}
        />
        <ShareOptionButton
          glyph="/glyphs/envelope.png"
          label="Email listing"
          description="Send the listing link by email"
          onClick={onEmail}
        />
      </div>
    </section>
  );
}

function ShareOptionButton({
  description,
  glyph,
  label,
  onClick,
}: {
  description: string;
  glyph: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700"
      type="button"
      onClick={onClick}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-stone-100">
        <Image
          alt=""
          className="size-5 object-contain"
          height={20}
          src={glyph}
          width={20}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-stone-950">
          {label}
        </span>
        <span className="block text-xs leading-5 text-stone-600">
          {description}
        </span>
      </span>
    </button>
  );
}

function HiddenStoreContent({
  dialogTitleId,
  listingTitle,
  onDone,
}: {
  dialogTitleId: string;
  listingTitle: string;
  onDone: () => void;
}) {
  return (
    <>
      <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-2xl font-bold text-amber-800">
        <span aria-hidden="true">!</span>
      </div>
      <div className="text-center">
        <h2
          className="text-2xl font-semibold leading-tight text-stone-950"
          id={dialogTitleId}
        >
          Your listing is published
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-700">
          Your listing is saved, but your storefront is currently hidden. Make
          your store live before sharing it with buyers.
        </p>
        <p className="mx-auto mt-2 max-w-md text-xs font-medium leading-5 text-stone-500">
          {listingTitle}
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
        <button
          className="seller-secondary-button justify-center"
          type="button"
          onClick={onDone}
        >
          Done
        </button>
        <a
          className="seller-primary-button justify-center"
          href="/dashboard/store-admin"
        >
          Go to Store Setup
        </a>
      </div>
    </>
  );
}

function NeutralMissingPathContent({
  dialogTitleId,
  onDone,
}: {
  dialogTitleId: string;
  onDone: () => void;
}) {
  return (
    <>
      <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-stone-200 bg-stone-50 text-2xl font-bold text-stone-700">
        <span aria-hidden="true">i</span>
      </div>
      <div className="text-center">
        <h2
          className="text-2xl font-semibold leading-tight text-stone-950"
          id={dialogTitleId}
        >
          Listing link unavailable
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-700">
          The public listing link is not available yet.
        </p>
      </div>
      <div className="flex justify-center">
        <button
          className="seller-secondary-button min-w-28 justify-center"
          type="button"
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </>
  );
}

function HiddenStoreMultiContent({
  dialogTitleId,
  onDone,
}: {
  dialogTitleId: string;
  onDone: () => void;
}) {
  return (
    <>
      <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-2xl font-bold text-amber-800">
        <span aria-hidden="true">!</span>
      </div>
      <div className="text-center">
        <h2
          className="text-2xl font-semibold leading-tight text-stone-950"
          id={dialogTitleId}
        >
          Your listings are published
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-700">
          Your listings are saved, but your storefront is currently hidden.
          Make your store live before sharing them with buyers.
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
        <button
          className="seller-secondary-button justify-center"
          type="button"
          onClick={onDone}
        >
          Done
        </button>
        <a
          className="seller-primary-button justify-center"
          href="/dashboard/store-admin"
        >
          Go to Store Setup
        </a>
      </div>
    </>
  );
}

function normalizePublicPath(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith("/")) return null;

  return trimmed;
}

function buildAbsoluteUrl(
  publicPath: string | null | undefined,
  origin: string,
) {
  const normalizedPath = normalizePublicPath(publicPath);
  if (!origin || !normalizedPath) return null;

  try {
    return new URL(normalizedPath, origin).toString();
  } catch {
    return null;
  }
}

function buildShareText({
  listingTitle,
  storeName,
  summary,
}: {
  listingTitle: string;
  storeName: string;
  summary?: string | null;
}) {
  return [listingTitle, `from ${storeName}`, summary?.trim()]
    .filter((value): value is string => Boolean(value))
    .join(" - ");
}

async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return fallbackCopyText(value);
    }
  }

  return fallbackCopyText(value);
}

function fallbackCopyText(value: string) {
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function buildFacebookShareUrl(absoluteUrl: string) {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
    absoluteUrl,
  )}`;
}

function buildEmailShareUrl({
  bodyParts,
  subject,
}: {
  bodyParts: Array<string | null | undefined>;
  subject: string;
}) {
  const body = bodyParts
    .filter((value): value is string => Boolean(value))
    .join("\n\n");

  return `mailto:?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

function openExternalWindow(url: string) {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
