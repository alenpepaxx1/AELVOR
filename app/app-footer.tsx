// Copyright © 2026 Alen Pepa
import { COPYRIGHT_NOTICE } from "../lib/brand";
import type { Locale } from "../lib/templates";

export default function AppFooter({ locale, className = "" }: { locale: Locale; className?: string }) {
  return <footer className={`app-footer ${className}`} role="contentinfo" aria-label={locale === "de" ? "App-Fußzeile" : "Application footer"}>
    <span className="footer-credit">{COPYRIGHT_NOTICE}</span>
    <span className="footer-languages">English · Deutsch</span>
  </footer>;
}
