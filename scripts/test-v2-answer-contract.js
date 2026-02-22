/* eslint-disable no-console */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ts = require("typescript");

function requireTsModule(tsPath) {
  const source = fs.readFileSync(tsPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2019,
      module: ts.ModuleKind.CommonJS,
      strict: true,
      esModuleInterop: true,
    },
    fileName: tsPath,
  });

  const m = new Module(tsPath, module);
  m.filename = tsPath;
  m.paths = Module._nodeModulePaths(path.dirname(tsPath));
  m._compile(compiled.outputText, tsPath);
  return m.exports;
}

function countLinesMatching(text, re) {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => re.test(l)).length;
}

function getSectionLines(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  assert.ok(start >= 0, `Missing heading: ${heading}`);
  const end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l.trim()));
  const slice = lines.slice(start + 1, end === -1 ? lines.length : end);
  return slice.map((l) => l.trimEnd());
}

const answerFrameworkPath = path.join(__dirname, "..", "lib", "answerFramework.ts");
const { renderV2AnswerMarkdown } = requireTsModule(answerFrameworkPath);

assert.equal(typeof renderV2AnswerMarkdown, "function", "renderV2AnswerMarkdown must be exported");

const md = renderV2AnswerMarkdown({
  summary: "This is sentence one. This is sentence two.",
  keyFindings: ["Delta statement 1.", "Delta statement 2.", "Finding 3.", "Finding 4."],
  likelyCauses: ["Cause 1.", "Cause 2.", "Cause 3."],
  recommendedActions: [
    { step: 'Update the title for "/collections/widgets" targeting "blue widgets".', priority: "High impact" },
    { step: 'Add internal links to "/collections/widgets" from related pages.', priority: "Medium impact" },
    { step: 'Re-check performance after changes.', priority: "Low impact" },
  ],
  whatStandsOut: "This is the most important single insight.",
  confidence: { level: "Medium", reason: "Volume is moderate, so results are directional." },
});

const headings = ["## Summary", "## Key findings", "## Likely causes", "## Recommended actions", "## Confidence"];
let lastIdx = -1;
for (const h of headings) {
  const idx = md.indexOf(h);
  assert.ok(idx >= 0, `Missing heading: ${h}`);
  assert.ok(idx > lastIdx, `Heading order incorrect for: ${h}`);
  lastIdx = idx;
}

const keyFindingsLines = getSectionLines(md, "## Key findings");
const keyBullets = keyFindingsLines.filter((l) => /^•\s+/.test(l)).length;
assert.ok(keyBullets >= 4 && keyBullets <= 8, "Expected 4–8 bullets in Key findings");

const causesLines = getSectionLines(md, "## Likely causes");
const causeBullets = causesLines.filter((l) => /^•\s+/.test(l)).length;
assert.ok(causeBullets >= 3 && causeBullets <= 6, "Expected 3–6 bullets in Likely causes");

const actionsLines = getSectionLines(md, "## Recommended actions");
const numbered = actionsLines.filter((l) => /^\d+\.\s+/.test(l)).length;
assert.ok(numbered >= 3 && numbered <= 7, "Expected 3–7 numbered action steps");

const standsOutIdx = md.indexOf("What stands out:");
const confidenceIdx = md.indexOf("## Confidence");
assert.ok(standsOutIdx >= 0, 'Expected "What stands out:" line');
assert.ok(standsOutIdx < confidenceIdx, '"What stands out:" must appear before "Confidence"');

const actionLines = actionsLines.filter((l) => /^\d+\.\s+/.test(l));
assert.ok(actionLines.length >= 3, "Expected at least 3 action lines");
for (const l of actionLines) {
  assert.ok(
    /^\d+\.\s+.*\[(High impact|Medium impact|Low impact)\]\s*$/.test(l),
    `Action line missing priority label: ${l}`,
  );
}

const confidenceLines = getSectionLines(md, "## Confidence").filter((l) => l.trim().length > 0);
assert.ok(confidenceLines.length >= 1, "Expected confidence content");
assert.ok(
  /^(High|Medium|Low)\s+—\s+.+[.!?]$/.test(confidenceLines[0]),
  "Expected confidence to be 'High/Medium/Low — <1 sentence>.'",
);

console.log("V2 answer contract test passed.");
