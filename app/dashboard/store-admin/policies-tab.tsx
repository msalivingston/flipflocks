"use client";

import {
  useState,
  type ComponentType,
  type PointerEvent,
  type ReactNode,
} from "react";

type StoreSetupAccordionId =
  | "status"
  | "visibility"
  | "information"
  | "appearance"
  | "about"
  | "business"
  | "logo"
  | "hero"
  | "about-photo"
  | "pickup"
  | "delivery"
  | "pickup-policy"
  | "custom-policies";

type StoreSetupAccordionSectionProps = {
  badge?: ReactNode;
  children: ReactNode;
  glyph: string;
  id: StoreSetupAccordionId;
  isOpen: boolean;
  onToggle: (id: StoreSetupAccordionId | "none") => void;
  showStatusDot?: boolean;
  statusDotTone?: "green" | "red";
  summary: ReactNode;
  thumbnailAlt?: string;
  thumbnailSrc?: string | null;
  title: string;
};

type StorefrontNoteProps = {
  children: ReactNode;
};

type TextAreaFieldProps = {
  compact?: boolean;
  helper?: string;
  label: string;
  maxLength?: number;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  showCounter?: boolean;
  value: string;
};

type CustomPolicyDraft = {
  id: string;
  title: string;
  body: string;
};

type DragPreview = {
  label: string;
  width: number;
  x: number;
  y: number;
};

type PoliciesAccordionId = "pickup-policy" | "custom-policies";

export type PoliciesTabProps = {
  AccordionSection: ComponentType<StoreSetupAccordionSectionProps>;
  StorefrontNote: ComponentType<StorefrontNoteProps>;
  TextAreaField: ComponentType<TextAreaFieldProps>;
  customPolicyDragPreview: DragPreview | null;
  customPolicies: CustomPolicyDraft[];
  draggingCustomPolicyId: string | null;
  onAddCustomPolicy: () => void;
  onBeginCustomPolicyDrag: (
    policyId: string,
    event: PointerEvent<HTMLButtonElement>,
  ) => void;
  onEndCustomPolicyDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onMoveCustomPolicyDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onMoveCustomPolicy: (policyId: string, offset: -1 | 1) => void;
  onPickupPolicyChange: (value: string) => void;
  onRegisterCustomPolicyRow: (
    policyId: string,
    element: HTMLElement | null,
  ) => void;
  onRemoveCustomPolicy: (policyId: string) => void;
  onRestoreDefaultPickupPolicy: () => void;
  onUpdateCustomPolicy: (
    policyId: string,
    updates: Partial<CustomPolicyDraft>,
  ) => void;
  pickupPolicy: string;
};

export default function PoliciesTab({
  AccordionSection,
  StorefrontNote,
  TextAreaField,
  customPolicyDragPreview,
  customPolicies,
  draggingCustomPolicyId,
  onAddCustomPolicy,
  onBeginCustomPolicyDrag,
  onEndCustomPolicyDrag,
  onMoveCustomPolicyDrag,
  onMoveCustomPolicy,
  onPickupPolicyChange,
  onRegisterCustomPolicyRow,
  onRemoveCustomPolicy,
  onRestoreDefaultPickupPolicy,
  onUpdateCustomPolicy,
  pickupPolicy,
}: PoliciesTabProps) {
  const canAddPolicy = customPolicies.length < 4;
  const [openSection, setOpenSection] =
    useState<PoliciesAccordionId | "none">("none");
  const pickupPolicySummary = pickupPolicy.trim()
    ? truncateSummary(pickupPolicy.trim())
    : "No policy added";
  const customPolicySummary =
    customPolicies.length === 0
      ? "No custom policies added"
      : `${customPolicies.length} ${pluralize(
          customPolicies.length,
          "custom policy",
          "custom policies",
        )}`;

  return (
    <div className="grid gap-3">
      <AccordionSection
        glyph="/glyphs/clipboard.png"
        id="pickup-policy"
        isOpen={openSection === "pickup-policy"}
        onToggle={(id) => setOpenSection(id as PoliciesAccordionId | "none")}
        summary={
          <>
            <span className="sm:hidden">
              {pickupPolicy.trim() ? "Policy added" : "No policy added"}
            </span>
            <span className="hidden truncate sm:inline">
              {pickupPolicySummary}
            </span>
          </>
        }
        title="Pickup and delivery policy"
      >
        <div className="grid gap-3">
          <StorefrontNote>
            Explain pickup expectations, timing, and what buyers should bring.
          </StorefrontNote>
          <TextAreaField
            compact
            helper="Examples: Pickup is at our farm in Hotchkiss, CO. Bring a clean carrier or box. Please arrive on time."
            label="Pickup policy"
            onChange={onPickupPolicyChange}
            rows={4}
            value={pickupPolicy}
          />
          <div className="flex justify-end">
            <button
              className="seller-secondary-button bg-white"
              onClick={onRestoreDefaultPickupPolicy}
              type="button"
            >
              Restore default pickup policy
            </button>
          </div>
        </div>
      </AccordionSection>

      <AccordionSection
        glyph="/glyphs/open-book.png"
        id="custom-policies"
        isOpen={openSection === "custom-policies"}
        onToggle={(id) => setOpenSection(id as PoliciesAccordionId | "none")}
        summary={<span className="truncate">{customPolicySummary}</span>}
        title="Custom policies"
      >
        <div className="grid gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <StorefrontNote>
                Add up to 4 extra policy sections if your farm has specific
                terms buyers should know.
              </StorefrontNote>
              <p className="mt-2 text-sm font-medium leading-6 text-stone-600 sm:text-xs sm:leading-5 sm:text-stone-500">
                Examples: Cancellation policy, Deposit policy, Minimum order
                policy, Health policy, Biosecurity policy, Livestock guarantee.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:items-end">
              <span className="text-sm font-semibold text-stone-600">
                {customPolicies.length} of 4 added
              </span>
              <button
                className="seller-small-button w-full sm:w-auto"
                disabled={!canAddPolicy}
                onClick={onAddCustomPolicy}
                type="button"
              >
                + Add custom policy
              </button>
            </div>
          </div>

          {customPolicies.length === 0 ? (
            <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm leading-6 text-stone-600">
              No custom policies yet.
            </p>
          ) : (
            <div className="grid divide-y divide-stone-200 md:overflow-hidden md:rounded-lg md:border md:border-stone-200 md:bg-white md:divide-y-0">
              {customPolicies.map((policy, index) => (
                <CustomPolicyCard
                  canMoveDown={index < customPolicies.length - 1}
                  canMoveUp={index > 0}
                  isDragging={draggingCustomPolicyId === policy.id}
                  key={policy.id}
                  onBeginDrag={(event) =>
                    onBeginCustomPolicyDrag(policy.id, event)
                  }
                  onChange={(updates) =>
                    onUpdateCustomPolicy(policy.id, updates)
                  }
                  onEndDrag={onEndCustomPolicyDrag}
                  onMoveDrag={onMoveCustomPolicyDrag}
                  onMoveDown={() => onMoveCustomPolicy(policy.id, 1)}
                  onMoveUp={() => onMoveCustomPolicy(policy.id, -1)}
                  onRemove={() => onRemoveCustomPolicy(policy.id)}
                  policy={policy}
                  rowRef={(element) =>
                    onRegisterCustomPolicyRow(policy.id, element)
                  }
                />
              ))}
            </div>
          )}

          {customPolicies.length > 0 && canAddPolicy ? (
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white px-4 text-sm font-semibold text-emerald-900 transition hover:border-emerald-200 hover:bg-emerald-50/30"
              onClick={onAddCustomPolicy}
              type="button"
            >
              + Add another custom policy (up to 4 total)
            </button>
          ) : null}

          {!canAddPolicy ? (
            <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium leading-6 text-stone-600 sm:text-xs sm:leading-5">
              You can add up to 4 custom policies for now.
            </p>
          ) : null}
        </div>
      </AccordionSection>

      {customPolicyDragPreview ? (
        <SortableRowDragPreview preview={customPolicyDragPreview} />
      ) : null}
    </div>
  );
}

function SortableRowDragPreview({
  preview,
}: {
  preview: DragPreview;
}) {
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-stone-950 shadow-lg"
      style={{
        left: preview.x,
        top: preview.y,
        width: preview.width,
      }}
    >
      {preview.label}
    </div>
  );
}

function CustomPolicyCard({
  canMoveDown,
  canMoveUp,
  isDragging,
  onBeginDrag,
  onChange,
  onEndDrag,
  onMoveDrag,
  onMoveDown,
  onMoveUp,
  onRemove,
  policy,
  rowRef,
}: {
  canMoveDown: boolean;
  canMoveUp: boolean;
  isDragging: boolean;
  onBeginDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onChange: (updates: Partial<CustomPolicyDraft>) => void;
  onEndDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onMoveDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onRemove: () => void;
  policy: CustomPolicyDraft;
  rowRef: (element: HTMLDivElement | null) => void;
}) {
  return (
    <div
      className={`py-4 transition first:pt-0 last:pb-0 md:border-b md:border-stone-200 md:px-3 md:py-3 md:first:pt-3 md:last:border-b-0 md:last:pb-3 ${
        isDragging ? "bg-emerald-50/40" : "bg-white"
      }`}
      ref={rowRef}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 md:grid-cols-[2.25rem_minmax(12rem,0.42fr)_minmax(0,1fr)_auto] md:items-start">
        <div
          aria-label={`Reorder ${policy.title.trim() || "custom policy"}`}
          className="col-span-2 col-start-1 flex items-center justify-between gap-3 md:hidden"
          role="group"
        >
          <span className="text-sm font-semibold text-stone-600">Reorder</span>
          <span className="inline-flex overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm">
            <button
              aria-label="Move custom policy up"
              className="inline-flex size-11 items-center justify-center text-xl font-bold text-emerald-900 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-300"
              disabled={!canMoveUp}
              onClick={onMoveUp}
              type="button"
            >
              {"\u2191"}
            </button>
            <button
              aria-label="Move custom policy down"
              className="inline-flex size-11 items-center justify-center border-l border-stone-200 text-xl font-bold text-emerald-900 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-300"
              disabled={!canMoveDown}
              onClick={onMoveDown}
              type="button"
            >
              {"\u2193"}
            </button>
          </span>
        </div>
        <button
          aria-label="Drag to reorder custom policy"
          className="hidden size-9 touch-none cursor-grab items-center justify-center rounded-md text-lg font-semibold leading-none text-stone-400 transition hover:bg-stone-50 hover:text-stone-600 active:cursor-grabbing active:bg-emerald-50 active:text-emerald-800 md:mt-6 md:inline-flex"
          onPointerCancel={onEndDrag}
          onPointerDown={onBeginDrag}
          onPointerMove={onMoveDrag}
          onPointerUp={onEndDrag}
          type="button"
        >
          {"\u22ee\u22ee"}
        </button>
        <label className="col-span-2 grid gap-1.5 text-sm font-semibold text-stone-700 md:col-auto md:gap-1">
          Policy title
          <input
            className="seller-form-field min-h-12 text-base md:min-h-10 md:text-sm"
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="Cancellation policy"
            value={policy.title}
          />
        </label>
        <label className="col-span-2 grid gap-1.5 text-sm font-semibold text-stone-700 md:col-auto md:gap-1">
          Policy text
          <textarea
            className="seller-form-field min-h-28 resize-y py-3 text-base md:min-h-16 md:text-sm"
            onChange={(event) => onChange({ body: event.target.value })}
            rows={2}
            value={policy.body}
          />
        </label>
        <button
          className="col-span-2 inline-flex min-h-11 items-center justify-center rounded-md border border-stone-200 bg-stone-100 px-3 text-sm font-semibold text-red-700 transition hover:border-red-200 hover:bg-red-50 md:col-auto md:mt-6 md:min-h-10"
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

function truncateSummary(value: string, maxLength = 96) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) return normalized;

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}
