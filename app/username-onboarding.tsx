"use client";
// Copyright © 2026 Alen Pepa
import { useState } from "react";
import { AudioLines, ArrowUpRight, Cpu, MessageSquare, ShieldCheck, Sparkles } from "lucide-react";
import BrandMark from "./brand-mark";
import UsernameForm from "./username-form";
import { usernameInitials, validUsername } from "../lib/user-profile";
import AppFooter from "./app-footer";
import type { Locale } from "../lib/templates";

export default function UsernameOnboarding({ locale, onLocaleChange, onComplete, initial = "" }: { locale: Locale; onLocaleChange: (locale: Locale) => void; onComplete: (username: string) => void; initial?: string }) {
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const [draft, setDraft] = useState(initial);
  const preview = validUsername(draft);
  return <main className="profile-onboarding">
    <header className="onboarding-header"><div className="onboarding-brand"><BrandMark/><span>AELVOR<span>.</span></span></div><div className="language-switch" aria-label={t("Interface language", "Oberflächensprache")}><button onClick={() => onLocaleChange("en")} aria-pressed={locale === "en"} className={locale === "en" ? "selected" : ""}>EN</button><button onClick={() => onLocaleChange("de")} aria-pressed={locale === "de"} className={locale === "de" ? "selected" : ""}>DE</button></div></header>
    <div className="onboarding-layout"><section className="onboarding-intro" aria-labelledby="onboarding-title"><span className="onboarding-eyebrow"><span/>{t("YOUR PERSONAL WORKSPACE", "DEIN PERSÖNLICHER WORKSPACE")}</span><h1 id="onboarding-title">{t("Make it", "Mach ihn")}<br/><em>{t("yours.", "zu deinem.")}</em></h1><p>{t("A place for your ideas, questions and next big thing. Start with a name that feels like you.", "Ein Ort für deine Ideen, Fragen und den nächsten großen Schritt. Starte mit einem Namen, der zu dir passt.")}</p>
      <div className="onboarding-capabilities"><span><Cpu size={15}/>{t("AI on your device", "AI auf deinem Gerät")}</span><span><AudioLines size={16}/>{t("Text & voice", "Text & Stimme")}</span></div>
      <div className="onboarding-profile-preview" aria-hidden="true"><span className="onboarding-preview-avatar">{preview ? usernameInitials(preview) : <Sparkles size={19}/>}</span><span><small>{t("YOUR SPACE", "DEIN BEREICH")}</small><strong>{preview ? `@${preview}` : t("Your next chapter", "Dein nächstes Kapitel")}</strong></span><ArrowUpRight size={17}/></div>
    </section><section className="onboarding-card" aria-labelledby="username-title"><div className="onboarding-card-top"><span><MessageSquare size={20}/></span><small>01 / 02</small></div><span className="onboarding-step">{t("WELCOME TO AELVOR", "WILLKOMMEN BEI AELVOR")}</span><h2 id="username-title">{t("What should we call you?", "Wie sollen wir dich nennen?")}</h2><p>{t("Choose your username. Next, choose an AI model or the built-in local assistant.", "Wähle deinen Benutzernamen. Danach wählst du ein AI-Modell oder den integrierten lokalen Assistenten.")}</p><UsernameForm locale={locale} initial={initial} onSave={onComplete} onChange={setDraft} firstVisit submitLabel={t("Continue to AI setup", "Weiter zur AI-Einrichtung")}/>
      <div className="onboarding-local-note"><ShieldCheck size={16}/><p>{t("Saved in this browser. You can change your username later in Settings.", "In diesem Browser gespeichert. Du kannst deinen Benutzernamen später in den Einstellungen ändern.")}</p></div>
    </section></div><AppFooter locale={locale} className="onboarding-footer"/>
  </main>;
}
