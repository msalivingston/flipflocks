import type { Metadata } from "next";
import { LegalDocumentPage } from "@/app/_components/legal-document-page";
import { termsDocument } from "@/lib/legal-documents";

export const metadata: Metadata = {
  title: "Terms of Service | FlockFront",
  description: "FlockFront Terms of Service.",
};

export default function TermsPage() {
  return <LegalDocumentPage document={termsDocument} />;
}

