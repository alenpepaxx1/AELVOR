// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { attributeCode, attributeMarkdown } from "../lib/copyright.ts";
import { COPYRIGHT_NOTICE } from "../lib/brand.ts";
import { makeScript } from "../lib/local-agent.ts";
import { pythonModelRunner } from "../lib/local-model.ts";
import { exampleResponse, templates } from "../lib/templates.ts";

test("copyright comments use the syntax of executable code and remain idempotent", () => {
  for (const [language, prefix] of [["python", "#"], ["bash", "#"], ["typescript", "//"], ["css", "/*"], ["sql", "--"], ["html", "<!--"], ["batch", "REM"]]) {
    const result = attributeCode("original content", language);
    assert.ok(result.startsWith(`${prefix} ${COPYRIGHT_NOTICE}`), language);
    assert.equal(attributeCode(result, language), result, language);
    assert.ok(result.endsWith("original content"));
  }
  const upstream = "// Copyright Example Authors\nconst value = 3;";
  const result = attributeCode(upstream, "javascript");
  assert.ok(result.includes(upstream));
  new Script(result);
});

test("interpreter headers, encoding declarations and framework directives retain their position", () => {
  const python = '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\nprint("Grüße")';
  assert.equal(attributeCode(python, "python"), python.replace('print(', `# ${COPYRIGHT_NOTICE}\nprint(`));
  assert.equal(attributeCode("#!/bin/sh", "sh"), `#!/bin/sh\n# ${COPYRIGHT_NOTICE}\n`);
  for (const directive of ['"use client";', '"use server";', '"use strict";']) {
    assert.ok(attributeCode(`${directive}\nconst value = 1;`, "typescript").startsWith(`${directive}\n// ${COPYRIGHT_NOTICE}\n`));
  }
  assert.ok(attributeCode('<?xml version="1.0"?>\n<root/>', "xml").startsWith('<?xml version="1.0"?>\n<!-- Copyright'));
  assert.ok(attributeCode('@charset "UTF-8";\nbody {}', "css").startsWith('@charset "UTF-8";\n/* Copyright'));
  assert.ok(attributeCode('<?php echo "hello";', "php").startsWith("<?php\n/* Copyright"));
});

test("strict data and unknown formats stay unchanged", () => {
  for (const [language, source] of [["json", '{"name":"Alen"}'], ["csv", "name,value\nAlen,1"], ["text", "0123456789abcdef"], ["constructor", "arbitrary data"], ["", "plain content"]]) {
    assert.equal(attributeCode(source, language), source);
  }
  assert.equal(attributeCode("", "python"), "");
});

test("Markdown attribution preserves prose, strict JSON and incomplete streaming fences", () => {
  const source = 'An example.\n```python\nprint(1)\n```\n```json\n{"ok":true}\n```\nTail.';
  const result = attributeMarkdown(source);
  assert.ok(result.startsWith("An example.\n"));
  assert.ok(result.endsWith("\nTail."));
  assert.ok(result.includes(`\`\`\`python\n# ${COPYRIGHT_NOTICE}\nprint(1)\n\`\`\``));
  assert.ok(result.includes('```json\n{"ok":true}\n```'));
  assert.equal(attributeMarkdown(result), result);
  const partial = attributeMarkdown("```javascript\nconst answer =");
  assert.ok(partial.endsWith("const answer ="));
  assert.equal(partial.match(/```/g).length, 1);
});

test("fixed scripts, Python model runner and bilingual examples include attribution", () => {
  for (const kind of ["hash", "logs", "inventory"]) assert.ok(makeScript(kind).startsWith(`# ${COPYRIGHT_NOTICE}\n`));
  assert.ok(pythonModelRunner.startsWith(`# ${COPYRIGHT_NOTICE}\n`));
  for (const template of templates) for (const locale of ["en", "de"]) {
    const response = exampleResponse(template.id, locale);
    assert.equal(attributeMarkdown(response), response);
    for (const match of response.matchAll(/```(python|javascript|typescript|bash|sql)\n([\s\S]*?)```/g)) assert.ok(match[2].includes(COPYRIGHT_NOTICE));
  }
});
