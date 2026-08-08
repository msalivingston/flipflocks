import type { Metadata } from "next";
import { LegalDocumentPage } from "@/app/_components/legal-document-page";
import { privacyDocument } from "@/lib/legal-documents";

export const metadata: Metadata = {
  title: "Privacy Policy | FlockFront",
  description: "FlockFront Privacy Policy.",
};

export default function PrivacyPage() {
  return <LegalDocumentPage document={privacyDocument} />;
}

