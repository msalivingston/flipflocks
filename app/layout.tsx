import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlipFlocks",
  description: "Independent poultry storefronts for local pickup.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
