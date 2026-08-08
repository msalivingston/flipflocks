import type { Metadata } from "next";
import { LegalDocumentPage } from "@/app/_components/legal-document-page";
import { termsDocument } from "@/lib/legal-documents";
import { buildPublicMetadata } from "@/lib/public-metadata";

export const metadata: Metadata = buildPublicMetadata({
  canonicalPath: "/terms",
  title: "Terms of Service | FlockFront",
  description:
    "Review the terms that apply to the FlockFront website, seller tools, storefronts, ordering tools, and related services.",
});

export default function TermsPage() {
  return <LegalDocumentPage document={termsDocument} />;
}
