// Copyright © 2026 Alen Pepa
import ts from "typescript";
import { previewExtension, resolvePreviewPath, validatePreviewProject, type PreviewIssue, type PreviewProject } from "./artifact-project.ts";
export type CompiledPreview = { project: PreviewProject; modules: Record<string, string>; issues: PreviewIssue[] };
const packages = new Set(["react", "react-dom", "react-dom/client", "react/jsx-runtime", "lucide-react"]);
export function compilePreviewProject(input: PreviewProject): CompiledPreview {
  const project = validatePreviewProject(input), modules: Record<string, string> = Object.create(null), issues: PreviewIssue[] = [];
  for (const file of project.files) {
    const ext = previewExtension(file.path);
    if (ext === "json") { try { JSON.parse(file.content); } catch { issues.push({ file: file.path, message: "Invalid JSON." }); } continue; }
    if (!["js", "mjs", "cjs", "jsx", "ts", "tsx"].includes(ext)) continue;
    const result = ts.transpileModule(file.content, { fileName: file.path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: "React.createElement", jsxFragmentFactory: "React.Fragment", esModuleInterop: true, allowJs: true, isolatedModules: true } });
    for (const diagnostic of result.diagnostics || []) if (diagnostic.category === ts.DiagnosticCategory.Error) issues.push({ file: file.path, line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : undefined, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").slice(0, 700) });
    const imports = ts.preProcessFile(file.content, true, true).importedFiles;
    for (const dependency of imports) {
      const name = dependency.fileName;
      if (packages.has(name)) continue;
      if ((name.startsWith(".") || name.startsWith("@/")) && resolvePreviewPath(file.path, name, project.files)) continue;
      issues.push({ file: file.path, message: `Unavailable import: ${name}. Use local files, React, ReactDOM or lucide-react. Remote and server packages are not installed.` });
    }
    modules[file.path] = result.outputText + `\n//# sourceURL=aelvor-preview/${file.path}`;
  }
  return { project, modules, issues: issues.slice(0, 20) };
}
