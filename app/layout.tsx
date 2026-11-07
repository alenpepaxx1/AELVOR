// Copyright © 2026 Alen Pepa
import { COPYRIGHT_NOTICE } from "../lib/brand";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./studio.css";
import "./conversation.css";
import "./aelvor.css";
import "./model-library.css";
import "./conversation-workspace.css";
import "./user-profile.css";
import "./workspace-features.css";
import "./mobile.css";
import "./knowledge.css";
import "./artifact-preview.css";
import "./code-projects.css";
import "./connected-tools.css";
import "./modern-workspace.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

export const metadata: Metadata = {
  title: "AELVOR — Your local AI conversation",
  description: "Natural AI conversations in English and German, powered by an on-device language model, with text, voice, and local cybersecurity tools.",
  authors: [{ name: "Alen Pepa" }],
  creator: "Alen Pepa",
  other: { copyright: COPYRIGHT_NOTICE },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
