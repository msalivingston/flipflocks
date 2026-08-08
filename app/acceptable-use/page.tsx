import type { Metadata } from "next";
import { LegalDocumentPage } from "@/app/_components/legal-document-page";
import { acceptableUseDocument } from "@/lib/legal-documents";
import { buildPublicMetadata } from "@/lib/public-metadata";

export const metadata: Metadata = buildPublicMetadata({
  canonicalPath: "/acceptable-use",
  title: "Acceptable Use and Prohibited Listings Policy | FlockFront",
  description:
    "Review the rules for accounts, storefronts, listings, photos, messages, orders, customer records, and other uses of FlockFront.",
});

export default function AcceptableUsePage() {
  return <LegalDocumentPage document={acceptableUseDocument} />;
}
