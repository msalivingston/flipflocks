"use client";

import {
  useState,
  type ComponentType,
  type PointerEvent,
  type ReactNode,
} from "react";

type StoreSetupAccordionId =
  | "status"
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
        summary={<span className="truncate">{pickupPolicySummary}</span>}
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
              <p className="mt-2 text-xs font-medium leading-5 text-stone-500">
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
            <div className="grid overflow-hidden rounded-lg border border-stone-200 bg-white">
              {customPolicies.map((policy) => (
                <CustomPolicyCard
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
            <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-medium leading-5 text-stone-600">
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
  isDragging,
  onBeginDrag,
  onChange,
  onEndDrag,
  onMoveDrag,
  onRemove,
  policy,
  rowRef,
}: {
  isDragging: boolean;
  onBeginDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onChange: (updates: Partial<CustomPolicyDraft>) => void;
  onEndDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onMoveDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onRemove: () => void;
  policy: CustomPolicyDraft;
  rowRef: (element: HTMLDivElement | null) => void;
}) {
  return (
    <div
      className={`border-b border-stone-200 px-3 py-3 transition last:border-b-0 ${
        isDragging ? "bg-emerald-50/40" : "bg-white"
      }`}
      ref={rowRef}
    >
      <div className="grid gap-3 md:grid-cols-[2.25rem_minmax(12rem,0.42fr)_minmax(0,1fr)_auto] md:items-start">
        <button
          aria-label="Drag to reorder custom policy"
          className="mt-6 inline-flex size-9 touch-none cursor-grab items-center justify-center rounded-md text-lg font-semibold leading-none text-stone-400 transition hover:bg-stone-50 hover:text-stone-600 active:cursor-grabbing active:bg-emerald-50 active:text-emerald-800"
          onPointerCancel={onEndDrag}
          onPointerDown={onBeginDrag}
          onPointerMove={onMoveDrag}
          onPointerUp={onEndDrag}
          type="button"
        >
          {"\u22ee\u22ee"}
        </button>
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Policy title
          <input
            className="seller-form-field min-h-10"
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="Cancellation policy"
            value={policy.title}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Policy text
          <textarea
            className="seller-form-field min-h-16 resize-y py-3"
            onChange={(event) => onChange({ body: event.target.value })}
            rows={2}
            value={policy.body}
          />
        </label>
        <button
          className="mt-6 inline-flex min-h-10 items-center justify-center rounded-md border border-red-100 bg-white px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50"
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
