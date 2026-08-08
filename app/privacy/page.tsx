import type { Metadata } from "next";
import { LegalDocumentPage } from "@/app/_components/legal-document-page";
import { privacyDocument } from "@/lib/legal-documents";
import { buildPublicMetadata } from "@/lib/public-metadata";

export const metadata: Metadata = buildPublicMetadata({
  canonicalPath: "/privacy",
  title: "Privacy Policy | FlockFront",
  description:
    "Read how FlockFront collects, uses, shares, retains, and protects personal information across its website and services.",
});

export default function PrivacyPage() {
  return <LegalDocumentPage document={privacyDocument} />;
}
