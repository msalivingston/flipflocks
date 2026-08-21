import type { StorefrontCustomPolicy } from "./storefront-data";

export type StorefrontPolicySection = {
  body: string;
  title: string;
};

export function buildStorefrontPolicySections({
  cancellationPolicy,
  customPolicies,
  otherPolicies,
  pickupPolicy,
}: {
  cancellationPolicy?: string | null;
  customPolicies?: StorefrontCustomPolicy[] | null;
  otherPolicies?: string | null;
  pickupPolicy?: string | null;
}) {
  const sections: StorefrontPolicySection[] = [];

  addSection(sections, "Pickup policy", pickupPolicy);
  addSection(sections, "Other policies", otherPolicies);

  for (const policy of normalizeCustomPolicies(customPolicies)) {
    addSection(sections, policy.title, policy.body);
  }

  const cancellationPolicyBody = cancellationPolicy?.trim() ?? "";
  const normalizedCancellationPolicy = normalizePolicyBody(cancellationPolicyBody);

  if (
    normalizedCancellationPolicy &&
    !sections.some(
      (section) =>
        normalizePolicyBody(section.body) === normalizedCancellationPolicy,
    )
  ) {
    sections.push({
      body: cancellationPolicyBody,
      title: "Cancellation policy",
    });
  }

  return sections;
}

function addSection(
  sections: StorefrontPolicySection[],
  title: string,
  body: string | null | undefined,
) {
  const trimmed = body?.trim();

  if (!trimmed) return;

  sections.push({ body: trimmed, title });
}

function normalizeCustomPolicies(
  policies: StorefrontCustomPolicy[] | null | undefined,
) {
  if (!Array.isArray(policies)) return [];

  return policies
    .map((policy) => ({
      body: policy.body?.trim() ?? "",
      title: policy.title?.trim() ?? "",
    }))
    .filter((policy) => policy.title && policy.body)
    .slice(0, 4);
}

function normalizePolicyBody(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}
