"use client";
// Copyright © 2026 Alen Pepa

import { useState } from "react";
import { ArrowRight, ArrowUpRight, Braces, Code2, Compass, FileText, Lightbulb, LockKeyhole, MessageSquare, ShieldCheck, Sparkles, Terminal } from "lucide-react";
import type { AgentMode, Locale } from "../lib/templates";
import { APP_NAME } from "../lib/brand";
import BrandMark from "./brand-mark";

export function StartHero({ locale, username }: { locale: Locale; username?: string }) {
  const de = locale === "de";
  return <section className="start-hero" aria-labelledby="start-title">
    <div className="start-emblem" aria-hidden="true"><span className="emblem-orbit"/><BrandMark/><span className="emblem-spark"/></div>
    <div className="start-eyebrow"><span/>{username ? `${de ? "HALLO" : "HELLO"}, @${username}` : APP_NAME}<i/>{de ? "DEIN RAUM FÜR IDEEN" : "YOUR SPACE FOR IDEAS"}</div>
    <h1 id="start-title">{de ? "Womit starten wir?" : "Where should we begin?"}</h1>
    <p>{de ? "Stelle eine Frage, entwickle eine Idee oder löse eine Aufgabe. Wir gehen es gemeinsam an." : "Ask a question, build an idea, or work through a challenge. Let's make room for what's next."}</p>
  </section>;
}

type Category = "everyday" | "code" | "security";
type Prompt = { icon: typeof Sparkles; tag: [string, string]; title: [string, string]; description: [string, string]; question: [string, string]; mode: AgentMode; engine: "chat" | "tools" };
const prompts: Record<Category, Prompt[]> = {
  everyday: [
    { icon: Lightbulb, tag: ["UNDERSTAND", "VERSTEHEN"], title: ["Make the complex simple", "Komplexes einfach verstehen"], description: ["A clear explanation. A fresh perspective.", "Eine klare Erklärung. Ein neuer Blickwinkel."], question: ["Explain how artificial intelligence works in simple terms, with an everyday example.", "Erkläre mir künstliche Intelligenz einfach, mit einem Beispiel aus dem Alltag."], mode: "learn", engine: "chat" },
    { icon: FileText, tag: ["WRITE", "SCHREIBEN"], title: ["Find the right words", "Die richtigen Worte finden"], description: ["Turn a rough idea into a better message.", "Aus einer ersten Idee wird eine gute Nachricht."], question: ["Help me write a friendly, professional message. Ask me who it is for and what I want to say.", "Hilf mir, eine freundliche, professionelle Nachricht zu schreiben. Frage mich, an wen sie geht und was ich sagen möchte."], mode: "auto", engine: "chat" },
    { icon: Compass, tag: ["EXPLORE", "ENTDECKEN"], title: ["Move an idea forward", "Eine Idee weiterbringen"], description: ["Think it through. Find the next step.", "Klarer denken. Den nächsten Schritt finden."], question: ["Help me turn an idea into a realistic plan. Ask me what I want to achieve first.", "Hilf mir, aus einer Idee einen realistischen Plan zu machen. Frage mich zuerst, was ich erreichen möchte."], mode: "auto", engine: "chat" },
  ],
  code: [
    { icon: Code2, tag: ["BUILD", "ERSTELLEN"], title: ["Build something useful", "Etwas Nützliches bauen"], description: ["Work through a small project, step by step.", "Ein kleines Projekt, Schritt für Schritt."], question: ["Help me build a small programming project. First ask me which language and what I want it to do.", "Hilf mir, ein kleines Programmierprojekt zu bauen. Frage mich zuerst nach der Sprache und der gewünschten Funktion."], mode: "build", engine: "chat" },
    { icon: Braces, tag: ["DEBUG", "FEHLER FINDEN"], title: ["Untangle a code problem", "Ein Codeproblem lösen"], description: ["Understand the cause and work toward a fix.", "Die Ursache verstehen und eine Lösung finden."], question: ["Help me debug a program. Ask me for the code, the exact error, and the behavior I expected.", "Hilf mir, einen Programmfehler zu finden. Frage nach dem Code, der genauen Fehlermeldung und dem erwarteten Verhalten."], mode: "investigate", engine: "chat" },
    { icon: Terminal, tag: ["LOCAL TOOL", "LOKALES TOOL"], title: ["Create a file hash script", "Ein Datei-Hash-Skript erstellen"], description: ["A Python SHA-256 tool you can download.", "Ein Python-SHA-256-Tool zum Herunterladen."], question: ["Write a Python SHA-256 script", "Schreibe ein Python-SHA-256-Skript"], mode: "build", engine: "tools" },
  ],
  security: [
    { icon: ShieldCheck, tag: ["REVIEW", "PRÜFEN"], title: ["Look closer at a URL", "Eine URL genauer ansehen"], description: ["Inspect its structure without opening it.", "Die Struktur prüfen, ohne sie zu öffnen."], question: ["Analyze this URL: https://example.org/", "Prüfe diese URL: https://example.org/"], mode: "investigate", engine: "tools" },
    { icon: LockKeyhole, tag: ["LEARN", "LERNEN"], title: ["Understand Zero Trust", "Zero Trust verstehen"], description: ["A practical security concept, explained.", "Ein Sicherheitskonzept, praktisch erklärt."], question: ["Explain Zero Trust with a practical example", "Erkläre Zero Trust mit einem praktischen Beispiel"], mode: "learn", engine: "tools" },
    { icon: MessageSquare, tag: ["DISCUSS", "BESPRECHEN"], title: ["Strengthen your setup", "Dein Setup besser schützen"], description: ["Talk through your security questions.", "Besprich deine Fragen zur IT-Sicherheit."], question: ["Help me improve my home network security. First ask me about my current setup.", "Hilf mir, mein Heimnetzwerk besser zu schützen. Frage mich zuerst nach meinem aktuellen Setup."], mode: "investigate", engine: "chat" },
  ],
};

export function PromptLibrary({ locale, disabled, onSelect, onPlaybooks }: { locale: Locale; disabled: boolean; onSelect: (prompt: string, mode: AgentMode, engine: "chat" | "tools") => void; onPlaybooks: () => void }) {
  const [category, setCategory] = useState<Category>("everyday");
  const language = locale === "de" ? 1 : 0;
  const tabs: [Category, string][] = [["everyday", language ? "Für dich" : "For you"], ["code", "Code"], ["security", "Security"]];
  return <section className="prompt-library" aria-labelledby="prompt-library-title">
    <div className="prompt-library-heading"><h2 id="prompt-library-title">{language ? "Ein guter Anfang" : "A good place to start"}</h2><button onClick={onPlaybooks}>{language ? "Alle Playbooks" : "All playbooks"}<ArrowUpRight size={14}/></button></div>
    <div className="prompt-tabs" aria-label={language ? "Themen" : "Topics"}>{tabs.map(([id, label]) => <button key={id} aria-pressed={category === id} className={category === id ? "selected" : ""} onClick={() => setCategory(id)}>{id === "everyday" && <Sparkles size={12}/>} {label}</button>)}</div>
    <div className="prompt-grid">{prompts[category].map(item => { const Icon = item.icon; return <button key={item.title[0]} disabled={disabled} className="prompt-card" onClick={() => onSelect(item.question[language], item.mode, item.engine)}><span className="prompt-card-top"><Icon size={19}/><span>{item.tag[language]}</span><ArrowRight size={15}/></span><h3>{item.title[language]}</h3><p>{item.description[language]}</p><span className="prompt-card-action">{language ? "Als Frage verwenden" : "Try this prompt"}<ArrowUpRight size={13}/></span></button>; })}</div>
  </section>;
}
