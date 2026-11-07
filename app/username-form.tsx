"use client";
// Copyright © 2026 Alen Pepa
import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { usernameIssue, validUsername } from "../lib/user-profile";
import type { Locale } from "../lib/templates";

export default function UsernameForm({ locale, initial = "", onSave, onChange, firstVisit = false, persisted = true, submitLabel }: { locale: Locale; initial?: string; onSave: (name: string) => void; onChange?: (name: string) => void; firstVisit?: boolean; persisted?: boolean; submitLabel?: string }) {
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const [value, setValue] = useState(initial), [touched, setTouched] = useState(false);
  const issue = usernameIssue(value), normalized = validUsername(value);
  const error = touched && issue ? issue === "required" ? t("Choose a username to continue.", "Wähle einen Benutzernamen, um fortzufahren.") : issue === "length" ? t("Use between 2 and 24 characters.", "Nutze zwischen 2 und 24 Zeichen.") : t("Start with a letter or number. Use letters, numbers, dots, underscores or hyphens.", "Beginne mit einem Buchstaben oder einer Zahl. Nutze Buchstaben, Zahlen, Punkte, Unterstriche oder Bindestriche.") : "";
  return <form className="username-form" onSubmit={event => { event.preventDefault(); setTouched(true); if (normalized && (firstVisit || normalized !== initial || !persisted)) { onSave(normalized); setValue(normalized); } }} noValidate>
    <label htmlFor="profile-username">{t("Username", "Benutzername")}</label>
    <div className={`username-input ${normalized ? "valid" : ""} ${error ? "invalid" : ""}`}><span aria-hidden="true">@</span><input id="profile-username" name="username" autoFocus autoComplete="nickname" autoCapitalize="none" spellCheck={false} maxLength={64} value={value} onBlur={() => setTouched(true)} onChange={event => { setValue(event.target.value); onChange?.(event.target.value); }} placeholder={t("yourname", "deinname")} aria-invalid={Boolean(error)} aria-describedby="username-help username-error" required/>{normalized && <Check size={17} aria-hidden="true"/>}</div>
    <div className="username-help"><small id="username-help">{t("2–24 characters · Letters, numbers, . _ -", "2–24 Zeichen · Buchstaben, Zahlen, . _ -")}</small><span>{Array.from(value.trim().normalize("NFC")).length}/24</span></div>
    <p className="username-error" id="username-error" aria-live="polite">{error}</p>
    {!persisted && <p className="settings-storage-status" role="status">{t("Your username is active for this visit. Saving failed; try again to keep it next time.", "Dein Benutzername gilt für diesen Besuch. Speichern fehlgeschlagen; versuche es erneut, um ihn zu behalten.")}</p>}
    <button className="username-submit" type="submit" disabled={!normalized || (!firstVisit && normalized === initial && persisted)}>{submitLabel || (firstVisit ? t("Enter workspace", "Workspace öffnen") : !persisted && normalized === initial ? t("Retry saving", "Erneut speichern") : t("Save username", "Benutzernamen speichern"))}<ArrowRight size={16}/></button>
  </form>;
}
