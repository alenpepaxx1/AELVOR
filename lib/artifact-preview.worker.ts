// Copyright © 2026 Alen Pepa
import { compilePreviewProject } from "./preview-compiler-core.ts";
self.onmessage = event => {
  try { self.postMessage({ ok: true, result: compilePreviewProject(event.data) }); }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : "Preview compilation failed." }); }
};
