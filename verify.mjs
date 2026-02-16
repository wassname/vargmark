#!/usr/bin/env node
/*
Verified argument map tool: verify + render in one step.

Parses argdown JSON export, checks credence consistency, computes conclusions,
and renders enriched HTML with credence coloring.

Usage:
    node verify.mjs example.json                          # verify + render
    node verify.mjs example.json output.html              # specify output path
    npx @argdown/cli json example.argdown --stdout | node verify.mjs  # pipe

Evidence:
    The agent must download sources into evidence/*.md with headers:
      Source: <url>
      Title: <title>

    The verifier only reads local evidence and fails if missing.
*/

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { create, all } from "mathjs";
import MarkdownIt from "markdown-it";

const math = create(all, {});
const md = new MarkdownIt({ html: false, linkify: false });
const paragraphCache = new Map();

const CONTRADICTION_TOLERANCE = 0.05; // credences should sum to 1.0 +/- this

// --- Extraction ---

function extractStatements(data) {
  const statements = {};
  const items = data.statements || {};
  for (const [title, ec] of Object.entries(items)) {
    const d = (ec && ec.data) || {};
    const info = {
      title,
      text: "",
      credence: d.credence ?? null,
      tag: d.tag ?? null,
      math: d.math ?? null,
    };
    if (ec && ec.members && ec.members.length > 0) {
      info.text = ec.members[0].text || "";
    }
    statements[title] = info;
  }
  return statements;
}

function extractRelations(data) {
  const relations = [];
  const seen = new Set();
  const statements = data.statements || {};
  for (const [, ec] of Object.entries(statements)) {
    const rels = (ec && ec.relations) || [];
    for (const rel of rels) {
      const key = `${rel.from}|${rel.to}|${rel.relationType}`;
      if (!seen.has(key)) {
        seen.add(key);
        relations.push(rel);
      }
    }
  }
  const argumentsData = data.arguments || {};
  for (const [, arg] of Object.entries(argumentsData)) {
    const rels = (arg && arg.relations) || [];
    for (const rel of rels) {
      const key = `${rel.from}|${rel.to}|${rel.relationType}`;
      if (!seen.has(key)) {
        seen.add(key);
        relations.push(rel);
      }
    }
  }
  return relations;
}

// --- Verification checks ---

function checkCredenceConsistency(statements, relations) {
  const errors = [];
  for (const rel of relations) {
    const a = statements[rel.from] || {};
    const b = statements[rel.to] || {};
    const ca = a.credence;
    const cb = b.credence;
    if (ca == null || cb == null) {
      continue;
    }
    const rtype = rel.relationType;
    if (rtype === "entails" && cb < ca) {
      errors.push(
        `ENTAILMENT: [${rel.from}] (${ca}) entails [${rel.to}] (${cb}), but ${cb} < ${ca}.`
      );
    } else if (rtype === "contrary" && ca + cb > 1.0) {
      errors.push(
        `CONTRARY: [${rel.from}] (${ca}) + [${rel.to}] (${cb}) = ${(ca + cb).toFixed(2)} > 1.0.`
      );
    } else if (rtype === "contradictory" && Math.abs(ca + cb - 1.0) > CONTRADICTION_TOLERANCE) {
      errors.push(
        `CONTRADICTION: [${rel.from}] (${ca}) + [${rel.to}] (${cb}) = ${(ca + cb).toFixed(2)} != 1.0.`
      );
    }
  }
  return errors;
}

function checkMath(statements) {
  const errors = [];
  for (const [title, s] of Object.entries(statements)) {
    const exprStr = s.math;
    if (!exprStr) {
      continue;
    }
    try {
      const result = math.evaluate(exprStr);
      if (result === true) {
        continue;
      }
      if (result === false) {
        errors.push(`MATH FAIL: [${title}]: '${exprStr}' is False`);
      } else if (typeof result === "number") {
        errors.push(
          `MATH EVAL: [${title}]: '${exprStr}' = ${Number(result).toFixed(4)} (not boolean)`
        );
      } else {
        errors.push(`MATH EVAL: [${title}]: '${exprStr}' = ${String(result)} (not boolean)`);
      }
    } catch (err) {
      errors.push(`MATH ERROR: [${title}]: '${exprStr}' raised ${err}`);
    }
  }
  return errors;
}

function buildAdjacency(edges) {
  const adj = new Map();
  for (const [u, v] of edges) {
    if (!adj.has(u)) adj.set(u, new Set());
    adj.get(u).add(v);
  }
  return adj;
}

function findEntailmentCycles(nodes, entailmentEdges) {
  const adj = buildAdjacency(entailmentEdges);
  const cycles = new Set();
  const visited = new Set();
  const stack = [];
  const inStack = new Set();

  function dfs(node) {
    visited.add(node);
    stack.push(node);
    inStack.add(node);

    const neighbors = adj.get(node) || new Set();
    for (const next of neighbors) {
      if (!visited.has(next)) {
        dfs(next);
      } else if (inStack.has(next)) {
        const idx = stack.indexOf(next);
        if (idx >= 0) {
          const cycle = stack.slice(idx).concat(next);
          const key = cycle.join(" -> ");
          cycles.add(key);
        }
      }
    }

    stack.pop();
    inStack.delete(node);
  }

  for (const n of nodes) {
    if (!visited.has(n)) {
      dfs(n);
    }
  }
  return Array.from(cycles);
}

function checkGraph(statements, relations, data) {
  const errors = [];
  const nodes = Object.keys(statements);
  const entailmentEdges = [];
  const degree = new Map();
  for (const n of nodes) {
    degree.set(n, 0);
  }

  for (const rel of relations) {
    if (rel.relationType === "entails") {
      entailmentEdges.push([rel.from, rel.to]);
    }
    if (degree.has(rel.from)) degree.set(rel.from, degree.get(rel.from) + 1);
    if (degree.has(rel.to)) degree.set(rel.to, degree.get(rel.to) + 1);
  }

  const cycles = findEntailmentCycles(nodes, entailmentEdges);
  for (const cycle of cycles) {
    errors.push(`ENTAILMENT CYCLE: ${cycle}`);
  }

  const topLevel = new Set();
  const st = data.statements || {};
  for (const [title, ec] of Object.entries(st)) {
    if (ec && ec.isUsedAsTopLevelStatement) {
      topLevel.add(title);
    }
  }

  for (const title of nodes) {
    if ((degree.get(title) || 0) === 0 && topLevel.has(title)) {
      errors.push(`ISOLATED: [${title}] is a top-level statement with no relations`);
    }
  }
  return errors;
}

function checkFieldOrdering(data) {
  const errors = [];
  const statements = data.statements || {};
  for (const [title, ec] of Object.entries(statements)) {
    const d = (ec && ec.data) || {};
    const keys = Object.keys(d);
    if (keys.includes("reason") && (keys.includes("credence") || keys.includes("inference"))) {
      const reasonIdx = keys.indexOf("reason");
      const numIdx = keys.includes("credence") ? keys.indexOf("credence") : keys.indexOf("inference");
      if (reasonIdx > numIdx) {
        const field = keys.includes("credence") ? "credence" : "inference";
        errors.push(`ORDERING: [${title}] has {${field}} before {reason} -- reason must come first`);
      }
    }
  }

  const argumentsData = data.arguments || {};
  for (const [argName, arg] of Object.entries(argumentsData)) {
    const pcs = (arg && arg.pcs) || [];
    for (const m of pcs) {
      const d = (m && m.data) || {};
      const keys = Object.keys(d);
      if (keys.includes("reason") && (keys.includes("credence") || keys.includes("inference"))) {
        const reasonIdx = keys.indexOf("reason");
        const numIdx = keys.includes("credence") ? keys.indexOf("credence") : keys.indexOf("inference");
        if (reasonIdx > numIdx) {
          const field = keys.includes("credence") ? "credence" : "inference";
          const title = m.title || argName;
          errors.push(
            `ORDERING: [${title}] in <${argName}> has {${field}} before {reason} -- reason must come first`
          );
        }
      }
    }
  }
  return errors;
}

function checkPcsCredences(data, statements) {
  const errors = [];
  const notes = [];
  const argumentsData = data.arguments || {};
  for (const [argName, arg] of Object.entries(argumentsData)) {
    const pcs = (arg && arg.pcs) || [];
    if (pcs.length === 0) continue;

    // Walk PCS in order: premises accumulate, conclusions consume them (staged)
    let stagePremises = []; // [[title, credence], ...]
    for (const m of pcs) {
      const d = m.data || {};

      if (m.role === "premise") {
        if (d.credence != null) {
          stagePremises.push([m.title, d.credence]);
        }
        // Error: conclusion uses {credence} (issue #3)
        if (d.inference != null) {
          errors.push(`PCS: <${argName}> premise [${m.title}] has {inference} -- only conclusions get inference`);
        }
        continue;
      }

      if (m.role === "intermediary-conclusion" || m.role === "main-conclusion") {
        const inference = d.inference;
        const hardcoded = d.credence;

        // Error: conclusion uses {credence} instead of {inference} (issue #3)
        if (hardcoded != null && inference == null) {
          errors.push(
            `PCS: <${argName}> [${m.title}] has {credence} on conclusion -- use {inference} instead (credence is computed)`
          );
        }

        if (stagePremises.length === 0) continue;
        const premiseProduct = stagePremises.reduce((acc, [, c]) => acc * c, 1.0);

        if (inference != null) {
          if (inference > 1.0 || inference < 0) {
            errors.push(`PCS: <${argName}> [${m.title}] inference=${inference} out of range [0,1]`);
          }
          const computed = premiseProduct * inference;
          const premiseStr = stagePremises.map(([, c]) => `${c}`).join(" * ");
          notes.push(`  <${argName}>: [${m.title}]`);
          notes.push(`    premises: ${premiseStr} = ${premiseProduct.toFixed(3)}`);
          notes.push(`    inference: ${inference}`);
          notes.push(
            `    computed credence: ${premiseProduct.toFixed(3)} * ${inference} = ${computed.toFixed(2)}`
          );
          const rounded = Math.round(computed * 10000) / 10000;
          if (statements[m.title]) {
            statements[m.title].credence = rounded;
          }

          // For multi-step: intermediary feeds into next stage as a premise
          if (m.role === "intermediary-conclusion") {
            stagePremises = [[m.title, rounded]];
          }
        } else if (hardcoded != null) {
          if (hardcoded > premiseProduct) {
            errors.push(
              `PCS: <${argName}> [${m.title}] credence=${hardcoded} > product of premises (${premiseProduct.toFixed(3)})`
            );
          }
          const implied = hardcoded / premiseProduct;
          const premiseStr = stagePremises.map(([, c]) => `${c}`).join(" * ");
          notes.push(`  <${argName}>: [${m.title}] credence=${hardcoded}`);
          notes.push(`    premises: ${premiseStr} = ${premiseProduct.toFixed(3)}`);
          notes.push(`    implied inference: ${hardcoded} / ${premiseProduct.toFixed(3)} = ${implied.toFixed(2)}`);
        }
      }
    }
  }
  return [errors, notes];
}

function cruxAnalysis(statements, relations) {
  const adj = new Map();
  for (const rel of relations) {
    if (rel.relationType === "entails") {
      if (!adj.has(rel.from)) adj.set(rel.from, new Set());
      adj.get(rel.from).add(rel.to);
    }
  }

  function countDescendants(start) {
    const seen = new Set();
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop();
      const neighbors = adj.get(node) || new Set();
      for (const n of neighbors) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return seen.size;
  }

  const notes = [];
  for (const [title, s] of Object.entries(statements)) {
    if (s.credence == null || !adj.has(title)) {
      continue;
    }
    const downstream = countDescendants(title);
    if (downstream > 0) {
      notes.push(
        `CRUX: [${title}] (credence=${Number(s.credence).toFixed(2)}) affects ${downstream} downstream statement(s).`
      );
    }
  }
  return notes;
}

function clampCredence(c) {
  return Math.max(0.001, Math.min(0.999, c));
}

function propagateCredences(statements, relations, data) {
  // Resolve undercut: _> targets an argument, treat as contrary on argument's main conclusion
  const argumentsData = data?.arguments || {};
  const resolvedRelations = [];
  for (const rel of relations) {
    if (rel.relationType === "undercut") {
      // Undercut targets argument name; find its main conclusion
      const arg = argumentsData[rel.to];
      if (arg) {
        const mainConc = (arg.pcs || []).find((m) => m.role === "main-conclusion");
        if (mainConc) {
          resolvedRelations.push({ ...rel, relationType: "contrary", to: mainConc.title });
          continue;
        }
      }
      // If can't resolve, still add as-is (will be ignored but won't crash)
    }
    resolvedRelations.push(rel);
  }

  const targets = {};
  for (const rel of resolvedRelations) {
    const fromC = statements[rel.from]?.credence;
    if (fromC == null) {
      continue;
    }
    const to = rel.to;
    if (!targets[to]) {
      targets[to] = { via_entail: [], via_contrary: [] };
    }
    if (rel.relationType === "entails") {
      targets[to].via_entail.push([rel.from, fromC]);
    } else if (rel.relationType === "contrary") {
      targets[to].via_contrary.push([rel.from, fromC]);
    }
  }

  for (const t of Object.values(targets)) {
    let logOdds = 0.0;
    for (const [, c] of t.via_entail) {
      const cc = clampCredence(c);
      logOdds += Math.log(cc / (1 - cc));
    }
    for (const [, c] of t.via_contrary) {
      const cc = clampCredence(c);
      logOdds -= Math.log(cc / (1 - cc));
    }
    t.log_odds = logOdds;
    t.implied = 1.0 / (1.0 + Math.exp(-logOdds));
  }
  return targets;
}

function formatPropagation(targets) {
  const lines = [];
  for (const [title, t] of Object.entries(targets)) {
    if (t.implied == null) {
      continue;
    }
    const logOdds = t.log_odds ?? 0.0;
    lines.push(`  [${title}] implied credence: ${t.implied.toFixed(2)} (${logOdds >= 0 ? "+" : ""}${logOdds.toFixed(2)} log-odds)`);
    for (const [name, c] of t.via_entail) {
      const lo = Math.log(clampCredence(c) / (1 - clampCredence(c)));
      lines.push(`    + [${name}] (${c.toFixed(2)}, ${lo >= 0 ? "+" : ""}${lo.toFixed(2)} log-odds)`);
    }
    for (const [name, c] of t.via_contrary) {
      const lo = Math.log(clampCredence(c) / (1 - clampCredence(c)));
      lines.push(`    - [${name}] (${c.toFixed(2)}, ${lo >= 0 ? "+" : ""}${lo.toFixed(2)} log-odds)`);
    }
  }
  return lines;
}

// Issue #4: thesis statement (target of entails from PCS conclusions) must not have hardcoded credence
function checkTopLevelCredence(data) {
  const errors = [];
  // Find statements that are targets of entails relations (thesis statements)
  const entailTargets = new Set();
  const st = data.statements || {};
  for (const [, ec] of Object.entries(st)) {
    for (const rel of (ec && ec.relations) || []) {
      if (rel.relationType === "entails") {
        entailTargets.add(rel.to);
      }
    }
  }
  const argumentsData = data.arguments || {};
  for (const [, arg] of Object.entries(argumentsData)) {
    for (const rel of (arg && arg.relations) || []) {
      if (rel.relationType === "entails") {
        entailTargets.add(rel.to);
      }
    }
  }
  // Only flag entails targets that also have hardcoded credence
  for (const title of entailTargets) {
    const ec = st[title];
    const d = (ec && ec.data) || {};
    if (d.credence != null) {
      errors.push(`TOP-LEVEL: [${title}] has {credence: ${d.credence}} -- thesis credence should be computed, not stated`);
    }
  }
  return errors;
}

// Issue #5: {reason} is required on every credence/inference
function checkRequiredFields(data) {
  const errors = [];
  function checkData(d, label) {
    if (!d) return;
    if ((d.credence != null || d.inference != null) && !d.reason) {
      const field = d.credence != null ? "credence" : "inference";
      errors.push(`MISSING REASON: ${label} has {${field}} but no {reason}`);
    }
  }
  const statements = data.statements || {};
  for (const [title, ec] of Object.entries(statements)) {
    checkData((ec && ec.data) || {}, `[${title}]`);
  }
  const argumentsData = data.arguments || {};
  for (const [argName, arg] of Object.entries(argumentsData)) {
    for (const m of (arg && arg.pcs) || []) {
      checkData(m.data || {}, `[${m.title || argName}] in <${argName}>`);
    }
  }
  return errors;
}

// Issue #6: credence and inference must be in [0, 1]
function checkRanges(data) {
  const errors = [];
  function checkData(d, label) {
    if (!d) return;
    if (d.credence != null && (d.credence < 0 || d.credence > 1)) {
      errors.push(`RANGE: ${label} credence=${d.credence} out of [0, 1]`);
    }
    if (d.inference != null && (d.inference < 0 || d.inference > 1)) {
      errors.push(`RANGE: ${label} inference=${d.inference} out of [0, 1]`);
    }
  }
  const statements = data.statements || {};
  for (const [title, ec] of Object.entries(statements)) {
    checkData((ec && ec.data) || {}, `[${title}]`);
  }
  const argumentsData = data.arguments || {};
  for (const [argName, arg] of Object.entries(argumentsData)) {
    for (const m of (arg && arg.pcs) || []) {
      checkData(m.data || {}, `[${m.title || argName}] in <${argName}>`);
    }
  }
  return errors;
}

// --- Verification runner ---

function verify(data) {
  const statements = extractStatements(data);
  const relations = extractRelations(data);

  const allErrors = [];
  allErrors.push(...checkMath(statements));
  allErrors.push(...checkGraph(statements, relations, data));
  allErrors.push(...checkFieldOrdering(data));
  allErrors.push(...checkRequiredFields(data));
  allErrors.push(...checkRanges(data));

  // Compute conclusion credences first, then check consistency (issue #10)
  const [pcsErrors, pcsNotes] = checkPcsCredences(data, statements);
  allErrors.push(...pcsErrors);
  allErrors.push(...checkCredenceConsistency(statements, relations));
  allErrors.push(...checkTopLevelCredence(data));

  const cruxNotes = cruxAnalysis(statements, relations);

  if (allErrors.length > 0) {
    console.log(`\n${allErrors.length} issues found:\n`);
    for (const e of allErrors) {
      console.log(`  ${e}`);
    }
  } else {
    console.log("All checks passed.");
  }

  if (cruxNotes.length > 0) {
    console.log("\nCrux analysis:");
    for (const n of cruxNotes) {
      console.log(`  ${n}`);
    }
  }

  if (pcsNotes.length > 0) {
    console.log("\nPCS inference strength:");
    for (const line of pcsNotes) {
      console.log(line);
    }
  }

  const targets = propagateCredences(statements, relations, data);
  const propLines = formatPropagation(targets);
  if (propLines.length > 0) {
    console.log("\nBottom line:");
    for (const line of propLines) {
      console.log(line);
    }
  }

  const nCredences = Object.values(statements).filter((s) => s.credence != null).length;
  console.log(`\nSummary: ${Object.keys(statements).length} statements, ${relations.length} relations, ${nCredences} with credences`);

  return [allErrors.length > 0 ? 1 : 0, statements, relations];
}

// --- HTML rendering ---

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function credenceColor(c) {
  const hue = c * 120;
  return `hsl(${Math.round(hue)}, 70%, 45%)`;
}

function credenceBg(c) {
  const hue = c * 120;
  return `hsl(${Math.round(hue)}, 60%, 92%)`;
}

function renderCredence(c, label = "", reason = "") {
  const pct = `${Math.round(c * 100)}%`;
  const parts = [label ? `${label}: ${c.toFixed(2)}` : `${c.toFixed(2)}`];
  if (reason) {
    parts.push(reason);
  }
  const title = parts.join(" -- ");
  return (
    `<span class="credence" style="color:${credenceColor(c)}; ` +
    `background:${credenceBg(c)}; padding:2px 6px; border-radius:4px; ` +
    `font-weight:600" title="${escapeHtml(title)}">${pct}</span>`
  );
}

function extractLink(premise) {
  const text = premise.text || "";
  const ranges = premise.ranges || [];
  for (const r of ranges) {
    if (r.type === "link") {
      if (typeof r.start === "number" && typeof r.stop === "number") {
        const name = text.slice(r.start, r.stop + 1);
        return [name, r.url];
      }
      return [null, r.url];
    }
  }
  return [null, null];
}

function extractQuote(text) {
  for (const marker of ['>"', "> "]) {
    const idx = text.indexOf(marker);
    if (idx >= 0) {
      return text.slice(idx + 1).trim().replace(/^"|"$/g, "");
    }
  }
  return null;
}

function snippetTokens(text) {
  const tokens = String(text).match(/\d+\.\d+|[\p{L}]+|\d+/gu);
  if (!tokens || tokens.length === 0) {
    throw new Error(`No tokens found in snippet: ${text}`);
  }
  return tokens;
}

function findSnippetSpan(text, snippet) {
  const tokens = snippetTokens(snippet).map((t) => t.toLowerCase());
  const hay = String(text);
  const hayLower = hay.toLowerCase();
  let start = null;
  let end = null;
  let idx = 0;
  for (const token of tokens) {
    const pos = hayLower.indexOf(token, idx);
    if (pos < 0) {
      return null;
    }
    if (start === null) {
      start = pos;
    }
    end = pos + token.length;
    idx = end;
  }
  return [start, end];
}

function boldSnippet(paragraph, snippet) {
  const normalized = normalizeMarkdown(paragraph);
  const span = findSnippetSpan(normalized, snippet);
  if (!span) {
    throw new Error(`Snippet not found in paragraph: ${snippet}`);
  }
  const [start, end] = span;
  return `${normalized.slice(0, start)}**${normalized.slice(start, end)}**${normalized.slice(end)}`;
}

function normalizeMarkdown(text) {
  return String(text)
    .replace(/`+/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/(\w)-\n(\w)/g, "$1$2") // dehyphenate PDF line breaks
    .replace(/\s+/g, " ")
    .trim();
}

function extractParagraphByBlocks(markdown, snippet) {
  const blocks = String(markdown).split(/\n\s*\n/);
  for (const block of blocks) {
    const normalized = normalizeMarkdown(block);
    if (findSnippetSpan(normalized, snippet)) {
      return normalized;
    }
  }
  return null;
}

function extractParagraphWithSnippet(markdown, snippet) {
  const tokens = md.parse(markdown, {});
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "paragraph_open" && tokens[i + 1]?.type === "inline") {
      const paragraph = tokens[i + 1].content || "";
      if (findSnippetSpan(normalizeMarkdown(paragraph), snippet)) {
        return paragraph;
      }
    }
  }
  const block = extractParagraphByBlocks(markdown, snippet);
  if (block) {
    return block;
  }
  throw new Error(`Snippet not found in any paragraph: ${snippet}`);
}

function observationKey(url, snippet) {
  return `${url}::${snippetTokens(snippet).join("-")}`;
}

function parseEvidenceMarkdown(text) {
  const lines = String(text).split("\n");
  let source = null;
  let title = null;
  let bodyStart = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === "") {
      bodyStart = i + 1;
      break;
    }
    if (line.startsWith("Source:")) {
      source = line.slice("Source:".length).trim();
    } else if (line.startsWith("Title:")) {
      title = line.slice("Title:".length).trim();
    }
  }
  if (!source) {
    throw new Error("Evidence markdown missing Source: header");
  }
  if (!title) {
    throw new Error(`Evidence markdown missing Title: header for ${source}`);
  }
  const body = lines.slice(bodyStart ?? lines.length).join("\n").trim();
  return { source, title, body };
}

function loadEvidenceIndex(baseDir) {
  const evidenceDir = path.join(baseDir, "evidence");
  if (!fs.existsSync(evidenceDir)) {
    throw new Error(`Missing evidence directory: ${evidenceDir}`);
  }
  const files = fs.readdirSync(evidenceDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    throw new Error(`No evidence markdown files found in ${evidenceDir}`);
  }
  const index = new Map();
  for (const file of files) {
    const raw = fs.readFileSync(path.join(evidenceDir, file), "utf8");
    const parsed = parseEvidenceMarkdown(raw);
    if (index.has(parsed.source)) {
      throw new Error(`Duplicate evidence Source: ${parsed.source}`);
    }
    index.set(parsed.source, parsed);
  }
  return index;
}

function collectObservations(data) {
  const observations = [];
  const argumentsData = data.arguments || {};
  for (const [argName, arg] of Object.entries(argumentsData)) {
    const pcs = (arg && arg.pcs) || [];
    for (const m of pcs) {
      if (m.role !== "premise") {
        continue;
      }
      const tags = m.tags || [];
      if (!tags.includes("observation")) {
        continue;
      }
      const [linkName, linkUrl] = extractLink(m);
      const quote = extractQuote(m.text || "");
      if (!linkUrl) {
        throw new Error(`Missing URL for observation: [${m.title || argName}]`);
      }
      if (!quote) {
        throw new Error(`Missing quote for observation: [${m.title || argName}]`);
      }
      observations.push({ title: m.title || argName, linkUrl, quote });
    }
  }
  return observations;
}

function ensureEvidence(data, baseDir) {
  const evidenceIndex = loadEvidenceIndex(baseDir);
  const observations = collectObservations(data);
  for (const obs of observations) {
    const evidence = evidenceIndex.get(obs.linkUrl);
    if (!evidence) {
      throw new Error(`Missing evidence markdown for URL: ${obs.linkUrl}`);
    }
    const paragraph = extractParagraphWithSnippet(evidence.body, obs.quote);
    const key = observationKey(obs.linkUrl, obs.quote);
    paragraphCache.set(key, paragraph);
  }
}

function conclusionRelation(concTitle, relations) {
  for (const rel of relations) {
    if (rel.from === concTitle) {
      return [rel.relationType, rel.to];
    }
  }
  return null;
}

function renderArgument(argName, arg, statements, relations, baseDir = null) {
  const pcs = arg.pcs || [];
  if (pcs.length === 0) {
    return "";
  }

  const premises = pcs.filter((m) => m.role === "premise");
  const conclusions = pcs.filter((m) => m.role === "main-conclusion");

  let argType = null;
  let relTarget = null;
  for (const conc of conclusions) {
    const rel = conclusionRelation(conc.title || "", relations);
    if (rel) {
      [argType, relTarget] = rel;
      break;
    }
  }

  const borderColor = { entails: "#2d9a2d", contrary: "#d9534f" }[argType] || "#e0e0e0";
  const relLabel = { entails: "supports", contrary: "challenges", contradictory: "contradicts" }[argType];

  const lines = [`<div class="argument" style="border-left: 4px solid ${borderColor};">`];
  lines.push(`<h3>${escapeHtml(argName)}</h3>`);

  for (let i = 0; i < premises.length; i += 1) {
    const p = premises[i];
    const data = p.data || {};
    const credence = data.credence;
    const reason = data.reason || "";
    const title = p.title || "?";
    const [linkName, linkUrl] = extractLink(p);
    const tags = p.tags || [];
    const isAssumption = tags.includes("assumption");

    lines.push('<div class="premise">');
    lines.push(`<span class="premise-nr">(${i + 1})</span> `);
    if (isAssumption) {
      lines.push('<span class="label-assumption">If</span> ');
    }
    lines.push(`<strong>${escapeHtml(title)}</strong>`);

    const quote = extractQuote(p.text || "");
    if (quote) {
      if (linkUrl && baseDir) {
        const key = observationKey(linkUrl, quote);
        const paragraph = paragraphCache.get(key);
        if (!paragraph) {
          throw new Error(`Missing cached paragraph for ${linkUrl}`);
        }
        const paragraphWithBold = boldSnippet(paragraph, quote);
        const rendered = md.renderInline(paragraphWithBold);
        lines.push(`<blockquote>${rendered}</blockquote>`);
      } else {
        const rendered = md.renderInline(quote);
        lines.push(`<blockquote>&quot;${rendered}&quot;</blockquote>`);
      }
    }

    const sourceParts = [];
    if (linkUrl) {
      const display = linkName ? escapeHtml(linkName) : escapeHtml(linkUrl);
      sourceParts.push(`<a href="${escapeHtml(linkUrl)}" target="_blank">${display}</a>`);
    }
    if (credence != null) {
      sourceParts.push(renderCredence(credence, "credence", reason));
    }
    if (sourceParts.length > 0) {
      lines.push(`<div class="source-line">${sourceParts.join(" ")}</div>`);
    } else if (credence != null) {
      lines.push(`<div class="source-line">${renderCredence(credence, "credence", reason)}</div>`);
    }

    lines.push("</div>");
  }

  for (const conc of conclusions) {
    const infData = conc.inference || {};
    const concData = conc.data || {};
    const inferenceStrength = concData.inference;
    const reason = concData.reason || "";
    const rules = infData.inferenceRules || [];
    for (const rule of rules) {
      const parts = [`<div class="inference-step">&there4; ${escapeHtml(rule)}`];
      if (inferenceStrength != null) {
        parts.push(` ${renderCredence(inferenceStrength, "inference", reason)}`);
      }
      parts.push("</div>");
      lines.push(parts.join(""));
    }
  }

  for (const conc of conclusions) {
    const data = conc.data || {};
    const title = conc.title || "?";
    const inference = data.inference;
    const computed = statements[title]?.credence;

    lines.push('<div class="conclusion">');
    lines.push('<span class="label-conclusion">Then</span> ');
    lines.push(`<strong>${escapeHtml(title)}</strong>: ${escapeHtml(conc.text || "")}`);

    if (computed != null) {
      const premiseVals = premises
        .map((p) => [p.title || "?", (p.data || {}).credence])
        .filter(([, c]) => c != null);
      if (premiseVals.length > 0 && inference != null) {
        const partsStr = premiseVals.map(([, c]) => `${Math.round(c * 100)}%`).join(" &times; ");
        lines.push(
          `<br><span class="math">${partsStr} &times; ${Math.round(inference * 100)}%` +
            ` = ${renderCredence(computed, "computed credence")}</span>`
        );
      } else {
        lines.push(`<br>computed: ${renderCredence(computed, "computed credence")}`);
      }
    }

    if (relLabel && relTarget) {
      const symbol = { entails: "&uarr;", contrary: "&darr;", contradictory: "&harr;" }[argType] || "?";
      lines.push(
        `<span class="relation-indicator" style="color:${borderColor};" title="${relLabel}"> ` +
          `${symbol} ${relLabel} ${escapeHtml(relTarget)}</span>`
      );
    }
    lines.push("</div>");
  }

  lines.push("</div>");
  return lines.join("\n");
}

function renderHtml(data, statements, relations, argdownSource = null, baseDir = null) {
  const topLevel = Object.entries(data.statements || {}).filter(([, ec]) => ec && ec.isUsedAsTopLevelStatement);
  const titleName = topLevel.length > 0 ? topLevel[0][0] : "Argument Map";
  let titleText = "";
  if (topLevel.length > 0) {
    const members = topLevel[0][1].members || [];
    if (members.length > 0) {
      titleText = members[0].text || "";
    }
  }

  const targets = propagateCredences(statements, relations, data);
  const bottomLines = Object.entries(targets)
    .filter(([, t]) => t.implied != null)
    .map(([t, info]) => [t, info.implied, info]);
  const argumentsData = data.arguments || {};

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(titleText || titleName)}</title>
<style>
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 42em; margin: 2em auto; padding: 0 1em;
    line-height: 1.6; color: #333;
}
h1 { color: #1a1a1a; font-size: 1.4em; }
h2 { color: #555; font-size: 1.1em; border-bottom: 1px solid #ddd; padding-bottom: 0.3em; }
h3 { color: #0582ca; font-size: 1em; margin-bottom: 0.5em; }
.bottom-line {
    background: #f8f9fa; border-left: 4px solid #0582ca;
    padding: 1em 1.5em; margin-bottom: 2em; font-size: 1.1em;
}
.bottom-line .claim { font-weight: 600; }
.bottom-line .via { font-size: 0.85em; color: #666; margin-top: 0.3em; }
.argument {
    margin-bottom: 2em; padding: 1em;
    border: 1px solid #e0e0e0; border-radius: 6px;
}
.premise {
    margin-bottom: 0.8em; padding-left: 2em;
}
.premise-nr { color: #0582ca; font-weight: 600; }
.source-line { padding-left: 2em; margin-top: 0.2em; font-size: 0.9em; }
.label-assumption { color: #e68a00; font-weight: 600; font-style: italic; }
.label-conclusion { color: #0582ca; font-weight: 600; font-style: italic; }
.tag { color: #66a61e; font-size: 0.85em; }
blockquote {
    margin: 0.5em 0 0.5em 2.5em;
    padding: 0.4em 0.8em 0.4em 1em;
    border-left: 3px solid #ccc;
    color: #555; font-style: italic; font-size: 0.9em;
}
.inference-step {
    border-top: 2px solid #0582ca; border-bottom: 2px solid #0582ca;
    padding: 0.5em 1em; margin: 0.8em 0;
    color: #0582ca; font-size: 0.9em; font-style: italic;
}
.conclusion { padding: 0.5em; background: #f8f9fa; border-radius: 4px; }
.math { font-size: 0.9em; color: #555; font-variant-numeric: tabular-nums; }
.relation-indicator { font-size: 0.85em; font-weight: 600; margin-left: 0.5em; }
a { color: #0582ca; }
.credence { font-size: 0.85em; font-variant-numeric: tabular-nums; }
.section-label { color: #888; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.05em; }
details.source-code { margin-top: 2em; border-top: 1px solid #ddd; padding-top: 1em; }
details.source-code summary { cursor: pointer; color: #888; font-size: 0.9em; }
details.source-code pre {
    background: #f6f8fa; padding: 1em; border-radius: 4px;
    overflow-x: auto; font-size: 0.8em; line-height: 1.4;
}
</style>
</head>
<body>
<h1>${escapeHtml(titleText || titleName)}</h1>
`;

  if (bottomLines.length > 0) {
    html += '<div class="bottom-line">\n<span class="section-label">Bottom line</span>\n';
    for (const [tTitle, implied, t] of bottomLines) {
      const logOdds = t.log_odds ?? 0.0;
      html += `<div class="claim">${escapeHtml(tTitle)}: ${renderCredence(
        implied,
        "implied credence"
      )} <span style="font-size:0.8em;color:#888">(${logOdds >= 0 ? "+" : ""}${logOdds.toFixed(
        1
      )} log-odds)</span></div>\n`;
      for (const [name, c] of t.via_entail) {
        const lo = Math.log(clampCredence(c) / (1 - clampCredence(c)));
        html += `<div class="via">&uarr; ${escapeHtml(name)} (${Math.round(
          c * 100
        )}%, ${lo >= 0 ? "+" : ""}${lo.toFixed(1)})</div>\n`;
      }
      for (const [name, c] of t.via_contrary) {
        const lo = Math.log(clampCredence(c) / (1 - clampCredence(c)));
        html += `<div class="via">&darr; ${escapeHtml(name)} (${Math.round(
          c * 100
        )}%, ${lo >= 0 ? "+" : ""}${lo.toFixed(1)})</div>\n`;
      }
    }
    html += "</div>\n";
  }

  const sections = {};
  for (const [argName, arg] of Object.entries(argumentsData)) {
    const members = arg.members || [];
    const section = members.find((m) => m.section)?.section || null;
    if (!sections[section]) sections[section] = [];
    sections[section].push([argName, arg]);
  }
  const sectionTitles = {};
  for (const s of data.sections || []) {
    sectionTitles[s.id] = s.title;
  }

  for (const [sectionId, args] of Object.entries(sections)) {
    const sectionTitle = sectionTitles[sectionId] || "";
    if (sectionTitle) {
      html += `<h2>${escapeHtml(sectionTitle)}</h2>\n`;
    }
    for (const [argName, arg] of args) {
      html += renderArgument(argName, arg, statements, relations, baseDir);
    }
  }

  if (argdownSource) {
    html += '<details class="source-code">\n<summary>Raw argdown source</summary>\n';
    html += `<pre><code>${escapeHtml(argdownSource)}</code></pre>\n</details>\n`;
  }

  html += "</body>\n</html>";
  return html;
}

// --- Main ---

function parseArgs(argv) {
  let input = null;
  let output = null;
  let verifyOnly = false;

  for (const arg of argv) {
    if (arg === "--verify-only") {
      verifyOnly = true;
    } else if (!input) {
      input = arg;
    } else if (!output) {
      output = arg;
    }
  }

  return { input, output, verifyOnly };
}

function main() {
  const { input, output, verifyOnly } = parseArgs(process.argv.slice(2));

  const baseDir = input ? path.dirname(path.resolve(input)) : process.cwd();

  let raw;
  if (input && fs.existsSync(input)) {
    raw = fs.readFileSync(input, "utf8");
  } else {
    raw = fs.readFileSync(0, "utf8");
  }

  const data = JSON.parse(raw);

  ensureEvidence(data, baseDir);
  const [exitCode, statements, relations] = verify(data);

  if (verifyOnly) {
    process.exit(exitCode);
  }

  let argdownSource = null;
  if (input) {
    const dir = path.dirname(input);
    const base = path.basename(input, path.extname(input));
    const argdownPath = path.join(dir, `${base}.argdown`);
    if (fs.existsSync(argdownPath)) {
      argdownSource = fs.readFileSync(argdownPath, "utf8");
    }
  }

  const outputPath = output || "example_verified.html";
  const html = renderHtml(data, statements, relations, argdownSource, baseDir);
  fs.writeFileSync(outputPath, html);
  console.log(`\nRendered to ${outputPath}`);

  process.exit(exitCode);
}

main();
