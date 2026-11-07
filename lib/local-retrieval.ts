// Copyright © 2026 Alen Pepa
const stopWords = new Set("a an the and or is are was were be to of for in on at with from this that these those it its my your our their what which how why please explain compare file files document documents about tell me can could would should i you we das die der den dem des ein eine einer einen einem eines und oder ist sind war waren sein zu von für fur im in auf mit aus diese dieser dieses was wie warum bitte erkläre erklare vergleiche datei dateien dokument dokumente über uber mir mich ich du sie wir ihr meine mein deine dein kann kannst können konnen sollte".split(" "));
function terms(text: string): string[] {
  return (text.replace(/([a-z])([A-Z])/g, "$1 $2").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ß/g, "ss").match(/[\p{L}\p{N}]+/gu) || []).filter(word => word.length > 1 && !stopWords.has(word));
}
export { terms as retrievalTerms };

// Bounded lexical retrieval over text already supplied by the user. No model,
// network request, persistent index or synthetic summary is involved.
export function fileExcerptSelector(content: string, question: string) {
  const keys = [...new Set(terms(question))].slice(0, 32);
  let anchor = 0, best = 0;
  if (keys.length && content.length > 400) {
    const passages: { offset: number; counts: Map<string, number> }[] = [];
    const frequency = new Map<string, number>();
    for (let offset = 0; offset < content.length; offset += 280) {
      const counts = new Map<string, number>();
      for (const word of terms(content.slice(offset, offset + 440))) if (keys.includes(word)) counts.set(word, (counts.get(word) || 0) + 1);
      for (const word of counts.keys()) frequency.set(word, (frequency.get(word) || 0) + 1);
      passages.push({ offset, counts });
    }
    for (const passage of passages) {
      let score = 0;
      for (const [word, count] of passage.counts) score += (1 + Math.log(Math.min(3, count))) * (1 + Math.log(1 + passages.length / (frequency.get(word) || 1)));
      if (score > best) { best = score; anchor = passage.offset; }
    }
    if (best > 0) {
      // Focus a scarce matching term so a very small phone excerpt still
      // contains evidence, rather than the beginning of its search window.
      const offset = anchor;
      let rarity = 0;
      for (const match of content.slice(offset, offset + 440).matchAll(/[\p{L}\p{N}]+/gu)) {
        for (const word of terms(match[0])) {
          const score = keys.includes(word) ? 1 / (frequency.get(word) || 1) : 0;
          if (score > rarity) { rarity = score; anchor = offset + match.index!; }
        }
      }
    }
  }
  return (maximum: number) => {
    const length = Math.max(0, Math.floor(maximum));
    let start = content.length <= length ? 0 : Math.max(0, Math.min(content.length - length, anchor - Math.min(80, Math.floor(length / 5))));
    // Include a nearby line boundary when doing so still leaves the matching
    // passage in view. Long single-line JSON/code can start mid-line.
    const boundary = start > 0 ? content.lastIndexOf("\n", start - 1) + 1 : 0;
    if (start - boundary <= 60 && anchor - boundary < length) start = boundary;
    const high = (code: number) => code >= 0xd800 && code <= 0xdbff;
    const low = (code: number) => code >= 0xdc00 && code <= 0xdfff;
    if (low(content.charCodeAt(start)) && high(content.charCodeAt(start - 1))) start--;
    let end = Math.min(content.length, start + length);
    if (high(content.charCodeAt(end - 1)) && low(content.charCodeAt(end))) end--;
    const text = content.slice(start, end);
    const startLine = 1 + (content.slice(0, start).match(/\n/g)?.length || 0);
    const endLine = startLine + (text.match(/\n/g)?.length || 0);
    return { text, startLine, endLine };
  };
}
