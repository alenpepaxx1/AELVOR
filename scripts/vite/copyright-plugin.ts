// Copyright © 2026 Alen Pepa
import type { Plugin } from "vite";
import { COPYRIGHT_NOTICE } from "../../lib/brand.ts";

const banner = `/*! ${COPYRIGHT_NOTICE}. AELVOR application integration; third-party notices retained. */`;
export function copyrightPlugin(): Plugin {
  return {
    name: "aelvor-copyright",
    outputOptions(options) {
      const previous = options.postBanner;
      return {
        ...options,
        comments: { ...(typeof options.comments === "object" ? options.comments : {}), legal: true },
        // Rolldown applies postBanner after minification and includes it in
        // asset hashes. Preserve any banner supplied by another integration.
        postBanner: async chunk => [banner, typeof previous === "function" ? await previous(chunk) : previous].filter(Boolean).join("\n"),
      };
    },
    generateBundle(_, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== "asset" || !item.fileName.endsWith(".css")) continue;
        const css = typeof item.source === "string" ? item.source : new TextDecoder().decode(item.source);
        if (!css.includes(COPYRIGHT_NOTICE)) item.source = `${banner}\n${css}`;
      }
    },
  };
}
