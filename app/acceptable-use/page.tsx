import type { Metadata } from "next";
import { LegalDocumentPage } from "@/app/_components/legal-document-page";
import { acceptableUseDocument } from "@/lib/legal-documents";

export const metadata: Metadata = {
  title: "Acceptable Use and Prohibited Listings Policy | FlockFront",
  description: "FlockFront Acceptable Use and Prohibited Listings Policy.",
};

export default function AcceptableUsePage() {
  return <LegalDocumentPage document={acceptableUseDocument} />;
}

