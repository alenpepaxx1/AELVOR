// Copyright © 2026 Alen Pepa
import type { CodeProjectTarget } from "./code-projects.ts";
export function requestedProjectTarget(text: string): CodeProjectTarget | null {
  const intent = /\b(?:create|build|develop|generate|write|scaffold|erstell\w*|baue\w*|entwick\w*|generier\w*|schreib\w*|krijo)\b([\s\S]{0,120}?)\b(?:projects?|projek\w*|apps?|applications?|software|programs?|programme?|websites?|webseite\w*)\b/i.exec(text);
  // A request to write a letter about an app still asks for a letter.
  if (!intent || /\b(?:poem|story|novel|essay|email|letter|message|speech|gedicht|geschichte|roman|aufsatz|brief|nachricht|rede)\b/i.test(intent[1]) || /^(?:(?:please|bitte)\s+)?(?:translate|übersetz\w*|ubersetz\w*)\b/i.test(text.trim())) return null;
  const request = text.split(/\b(?:named|called|namens|mit dem namen)\b/i, 1)[0];
  if (/\bflutter\b/i.test(request) || /\bandroid\b/i.test(request) && /\bios\b|\biphone\b/i.test(request)) return "flutter";
  if (/\bandroid\b|\bkotlin\b/i.test(request)) return "android";
  if (/\bios\b|\bswiftui\b|\biphone\b|\bipad\b/i.test(request)) return "ios";
  if (/\breact\b/i.test(request)) return "react";
  if (/\bpython\b/i.test(request)) return "python";
  if (/\bnode(?:\.?js)?\b|\btypescript\b.*\b(?:api|server)\b|\bbackend\b/i.test(request)) return "node";
  if (/\bweb\b|\bwebsite\b|\bwebseite\w*|\bhtml\b|\bcss\b/i.test(request)) return "web";
  return "general";
}
