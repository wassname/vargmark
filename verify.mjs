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
import clingoWasm from "clingo-wasm";
import { compile } from "./compile_asp.mjs";

const math = create(all, {});
const md = new MarkdownIt({ html: false, linkify: false });
const paragraphCache = new Map();

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

// --- Verification checks (JS-only: math) ---

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

// checkGraph, findEntailmentCycles, buildAdjacency: replaced by ASP rules (cycle, isolated)

// checkFieldOrdering: moved to compile_asp.mjs
// checkPcsCredences: computation moved to compile_asp.mjs, application in verify()
// checkTopLevelCredence, checkRequiredFields, checkRanges: replaced by ASP rules

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

// --- Violation message mapping ---

/** Map ASP violation atoms to human-readable error messages */
function violationToMessage(v) {
  // Parse violation/2 and violation/3
  const m2 = v.match(/^violation\((\w+),(\w+)\)$/);
  if (m2) {
    const [, kind, a] = m2;
    const msgs = {
      missing_source: `MISSING SOURCE: [${a}] is tagged #observation but has no source URL`,
      missing_quote: `MISSING QUOTE: [${a}] is tagged #observation but has no quote`,
      top_level_credence: `TOP-LEVEL: [${a}] has hardcoded credence -- thesis credence should be computed, not stated`,
      isolated: `ISOLATED: [${a}] is a top-level statement with no relations`,
      cycle: `ENTAILMENT CYCLE: [${a}] is part of a cycle`,
    };
    return msgs[kind] || `${kind.toUpperCase()}: [${a}]`;
  }
  const m3 = v.match(/^violation\((\w+),(\w+),(\w+)\)$/);
  if (m3) {
    const [, kind, a, b] = m3;
    const msgs = {
      range_low: `RANGE: premise [${b}] in <${a}> credence < 0`,
      range_high: `RANGE: premise [${b}] in <${a}> credence > 1`,
      inference_range_low: `RANGE: inference [${b}] in <${a}> < 0`,
      inference_range_high: `RANGE: inference [${b}] in <${a}> > 1`,
      missing_reason: `MISSING REASON: premise ${b} in <${a}> has no {reason}`,
      missing_inference_reason: `MISSING REASON: conclusion [${b}] in <${a}> has no {reason}`,
      credence_on_conclusion: `PCS: <${a}> [${b}] has {credence} on conclusion -- use {inference} instead`,
      inference_on_premise: `PCS: <${a}> premise [${b}] has {inference} -- only conclusions get inference`,
      entailment: `ENTAILMENT: [${a}] entails [${b}] but computed(${b}) < computed(${a})`,
      contrary_sum: `CONTRARY: [${a}] + [${b}] > 1.0`,
      contradiction_high: `CONTRADICTION: [${a}] + [${b}] too far above 1.0`,
      contradiction_low: `CONTRADICTION: [${a}] + [${b}] too far below 1.0`,
    };
    return msgs[kind] || `${kind.toUpperCase()}: [${a}], [${b}]`;
  }
  return v;
}

// --- ASP verification ---

async function runAspVerification(data) {
  const { facts, pcsResults, fieldOrderErrors } = compile(data);

  const rulesPath = new URL("./rules.lp", import.meta.url);
  const rules = fs.readFileSync(rulesPath, "utf8");
  const program = facts.join("\n") + "\n" + rules;

  const result = await clingoWasm.run(program, 0);
  const witnesses = result.Call?.[0]?.Witnesses;
  if (!witnesses || witnesses.length === 0) {
    throw new Error(`ASP solver returned ${result.Result}: check rules.lp and compiled facts`);
  }
  const violations = witnesses[witnesses.length - 1].Value;
  const aspErrors = violations.map(violationToMessage);

  return { aspErrors, pcsResults, fieldOrderErrors };
}

// --- Verification runner ---

async function verify(data) {
  const statements = extractStatements(data);
  const relations = extractRelations(data);

  // Run ASP verification (structural checks)
  const { aspErrors, pcsResults, fieldOrderErrors } = await runAspVerification(data);

  // Apply PCS results to statements (computed credences + breakdown)
  const pcsNotes = [];
  for (const r of pcsResults) {
    const computed = r.computed / 10000;
    const rounded = Math.round(computed * 10000) / 10000;
    if (statements[r.conclusion]) {
      statements[r.conclusion].credence = rounded;
      statements[r.conclusion].pcsBreakdown = {
        premises: r.premises.map((p) => [p.title, p.bps / 10000]),
        inference: r.inference / 10000,
      };
    }
    const premiseStr = r.premises.map((p) => `${p.bps / 10000}`).join(" * ");
    pcsNotes.push(`  <${r.argument}>: [${r.conclusion}]`);
    pcsNotes.push(`    premises: ${premiseStr} = ${r.premises.reduce((acc, p) => acc * p.bps / 10000, 1.0).toFixed(3)}`);
    pcsNotes.push(`    inference: ${r.inference / 10000}`);
    pcsNotes.push(`    computed credence: ${computed.toFixed(2)}`);
  }

  // JS-only checks: math, field ordering
  const allErrors = [];
  allErrors.push(...aspErrors);
  allErrors.push(...fieldOrderErrors);
  allErrors.push(...checkMath(statements));

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

/**
 * Bold-highlight key fragments within the evidence paragraph.
 * boldFragments: strings extracted from argdown bold ranges. If non-empty,
 * only those phrases are bolded. Otherwise the entire quote span is bolded.
 */
function boldSnippet(paragraph, snippet, boldFragments) {
  const normalized = normalizeMarkdown(paragraph);

  if (!boldFragments || boldFragments.length === 0) {
    // No bold markers -- bold the whole quote span
    const span = findSnippetSpan(normalized, snippet);
    if (!span) {
      throw new Error(`Snippet not found in paragraph: ${snippet}`);
    }
    const [start, end] = span;
    return `${normalized.slice(0, start)}**${normalized.slice(start, end)}**${normalized.slice(end)}`;
  }

  // Bold only the marked fragments within the paragraph
  let result = normalized;
  // Process in reverse order of position so insertions don't shift later indices
  const spans = [];
  for (const frag of boldFragments) {
    // Use substring match for short key fragments (more precise than token matching)
    const idx = result.toLowerCase().indexOf(frag.toLowerCase());
    if (idx >= 0) {
      spans.push([idx, idx + frag.length]);
    }
  }
  // Apply in reverse order so indices stay valid
  spans.sort((a, b) => b[0] - a[0]);
  for (const [s, e] of spans) {
    result = `${result.slice(0, s)}**${result.slice(s, e)}**${result.slice(e)}`;
  }
  return result;
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

/**
 * Build a text fragment directive (#:~:text=...) for browser quote highlighting.
 * Uses bold fragments if available, otherwise first/last words of quote.
 * See https://web.dev/text-fragments/
 */
function textFragmentFromQuote(quote, boldFragments) {
  const target = (boldFragments && boldFragments.length > 0)
    ? boldFragments[0]
    : quote;
  const words = target.split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;
  const prefix = words.slice(0, 3).join(" ");
  const suffix = words.slice(-3).join(" ");
  return `#:~:text=${encodeURIComponent(prefix)},${encodeURIComponent(suffix)}`;
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
    // Extract bold fragments from argdown ranges
    const boldFragments = (p.ranges || [])
      .filter((r) => r.type === "bold")
      .map((r) => (p.text || "").slice(r.start, r.stop + 1));
    if (quote) {
      if (linkUrl && baseDir) {
        const key = observationKey(linkUrl, quote);
        const paragraph = paragraphCache.get(key);
        if (!paragraph) {
          throw new Error(`Missing cached paragraph for ${linkUrl}`);
        }
        const paragraphWithBold = boldSnippet(paragraph, quote, boldFragments);
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
      // Build text fragment URL for quote highlighting in browser
      let href = escapeHtml(linkUrl);
      if (quote && linkUrl.startsWith("http")) {
        const frag = textFragmentFromQuote(quote, boldFragments);
        if (frag) href += frag;
      }
      sourceParts.push(`<a href="${href}" target="_blank">${display}</a>`);
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
      const symbol = { entails: "+", contrary: "-", contradictory: "&harr;" }[argType] || "?";
      const cssClass = { entails: "support", contrary: "attack", undercut: "undercut" }[argType] || "";
      lines.push(
        `<span class="relation-indicator ${cssClass}" title="${relLabel}">` +
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
.relation-indicator { font-size: 0.85em; font-weight: 600; margin-left: 0.5em; display: inline-block; margin-top: 0.5em; }
.relation-indicator.support { color: #04c93f; background: #cee7d6; padding: 0.2em 0.6em; border-radius: 1em; }
.relation-indicator.attack { color: #c93504; background: #fde0d6; padding: 0.2em 0.6em; border-radius: 1em; }
.relation-indicator.undercut { color: #ff00d4; background: #ffb9f3; padding: 0.2em 0.6em; border-radius: 1em; }
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
        const bd = statements[name]?.pcsBreakdown;
        const mathStr = bd
          ? bd.premises.map(([, v]) => `${Math.round(v * 100)}%`).join(" &times; ") +
            ` &times; ${Math.round(bd.inference * 100)}% = `
          : "";
        html += `<div class="via">+ ${escapeHtml(name)}: ${mathStr}${Math.round(
          c * 100
        )}% <span style="color:#888">(${lo >= 0 ? "+" : ""}${lo.toFixed(1)})</span></div>\n`;
      }
      for (const [name, c] of t.via_contrary) {
        const lo = Math.log(clampCredence(c) / (1 - clampCredence(c)));
        const bd = statements[name]?.pcsBreakdown;
        const mathStr = bd
          ? bd.premises.map(([, v]) => `${Math.round(v * 100)}%`).join(" &times; ") +
            ` &times; ${Math.round(bd.inference * 100)}% = `
          : "";
        html += `<div class="via">- ${escapeHtml(name)}: ${mathStr}${Math.round(
          c * 100
        )}% <span style="color:#888">(${lo >= 0 ? "+" : ""}${lo.toFixed(1)})</span></div>\n`;
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
  verify(data).then(([exitCode, statements, relations]) => {
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
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

main();
