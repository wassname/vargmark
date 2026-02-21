#!/usr/bin/env node
/**
 * compile_asp.mjs -- Compile argdown JSON into ASP facts for clingo.
 *
 * Pipeline: .argdown -> @argdown/cli json -> this -> facts.lp
 * The facts are then combined with rules.lp and solved by clingo-wasm.
 *
 * All credences/inferences are emitted as integer basis points (bps):
 *   0.70 -> 7000, 1.0 -> 10000, 0.0 -> 0
 *
 * No strings in ASP facts -- only structural atoms with sanitized IDs.
 */

import fs from "node:fs";

// --- ID sanitization ---

/** Convert argdown name to valid ASP atom: lowercase, underscores, no leading digit */
function atomize(name) {
  let a = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (/^[0-9]/.test(a)) a = `n${a}`;
  if (!a) a = "unnamed";
  return a;
}

// Track atomized names to detect collisions
const atomMap = new Map(); // atomized -> original

/** Atomize with collision detection. Throws if two different names map to the same atom. */
function atomizeChecked(name) {
  const a = atomize(name);
  const existing = atomMap.get(a);
  if (existing && existing !== name) {
    throw new Error(`Atom collision: "${name}" and "${existing}" both map to "${a}"`);
  }
  atomMap.set(a, name);
  return a;
}

/** Convert float credence/inference to integer bps */
function toBps(v) {
  return Math.round(v * 10000);
}

// --- Extraction ---

/**
 * Extract all facts from argdown JSON.
 * Returns { facts: string[], pcsResults: object[], fieldOrderErrors: string[], jsChecks: object }
 *
 * pcsResults: computed credences from PCS multiplication (done in JS, emitted as computed/2 facts)
 * fieldOrderErrors: reason-before-credence ordering violations (checked in JS, not ASP)
 */
export function compile(data) {
  const facts = [];
  const pcsResults = [];
  const fieldOrderErrors = [];
  const statements = data.statements || {};
  const argumentsData = data.arguments || {};

  // Reset collision tracker per compile call
  atomMap.clear();

  // Track computed credences (from PCS) and raw credences
  const computedCredences = new Map(); // title -> bps

  // --- Statements ---
  for (const [title, ec] of Object.entries(statements)) {
    const id = atomizeChecked(title);
    facts.push(`claim(${id}).`);

    const d = (ec && ec.data) || {};

    // Top-level flag
    if (ec && ec.isUsedAsTopLevelStatement) {
      facts.push(`top_claim(${id}).`);
    }

    // Hardcoded credence on statement
    if (d.credence != null) {
      facts.push(`hardcoded_credence(${id}).`);
      computedCredences.set(title, toBps(d.credence));
    }

    // Field ordering check (JS-side)
    checkFieldOrder(d, `[${title}]`, fieldOrderErrors);
  }

  // --- Relations (from statements and arguments) ---
  const seenRels = new Set();
  function emitRelation(rel) {
    const key = `${rel.from}|${rel.to}|${rel.relationType}`;
    if (seenRels.has(key)) return;
    seenRels.add(key);

    const fromId = atomize(rel.from);
    const toId = atomize(rel.to);

    if (rel.relationType === "entails") {
      facts.push(`entails(${fromId}, ${toId}).`);
    } else if (rel.relationType === "contrary" || rel.relationType === "contradictory") {
      facts.push(`contrary(${fromId}, ${toId}).`);
    } else if (rel.relationType === "undercut") {
      // Undercut targets an argument; resolve to its main conclusion
      const arg = argumentsData[rel.to];
      if (arg) {
        const mainConc = (arg.pcs || []).find((m) => m.role === "main-conclusion");
        if (mainConc) {
          facts.push(`contrary(${fromId}, ${atomize(mainConc.title)}).`);
          return;
        }
      }
      // Fallback: emit as contrary on the target name directly
      facts.push(`contrary(${fromId}, ${toId}).`);
    }
  }

  for (const [, ec] of Object.entries(statements)) {
    for (const rel of (ec && ec.relations) || []) emitRelation(rel);
  }
  for (const [, arg] of Object.entries(argumentsData)) {
    for (const rel of (arg && arg.relations) || []) emitRelation(rel);
  }

  // --- Arguments (PCS) ---
  for (const [argName, arg] of Object.entries(argumentsData)) {
    const argId = atomizeChecked(argName);
    facts.push(`argument(${argId}).`);

    const pcs = (arg && arg.pcs) || [];
    if (pcs.length === 0) continue;

    // Walk PCS stages: premises accumulate, conclusions consume
    let stagePremises = []; // [{title, id, bps}]
    let premiseIdx = 0;

    for (const m of pcs) {
      const d = m.data || {};
      const mId = atomize(m.title || argName);

      if (m.role === "premise") {
        const credence = d.credence ?? null;
        const bps = credence != null ? toBps(credence) : null;

        // Always record PCS membership (for isolation checks)
        facts.push(`pcs_member(${argId}, ${mId}).`);

        if (bps != null) {
          facts.push(`premise(${argId}, ${premiseIdx}, ${mId}, ${bps}).`);
          stagePremises.push({ title: m.title, id: mId, bps });
        }

        // Tags
        for (const tag of m.tags || []) {
          facts.push(`tag(${mId}, ${atomize(tag)}).`);
        }

        // Source URL presence
        const hasLink = (m.ranges || []).some((r) => r.type === "link");
        if (hasLink) facts.push(`has_source(${mId}).`);

        // Quote presence (blockquote > marker inline in text)
        const hasQuote = />\s*"/.test(m.text || "") || />\s+\S/.test(m.text || "");
        if (hasQuote) facts.push(`has_quote(${mId}).`);

        // Reason presence
        if (d.reason) facts.push(`has_reason(${argId}, ${mId}).`);

        // Error: premise with {inference}
        if (d.inference != null) {
          facts.push(`premise_has_inference(${argId}, ${mId}).`);
        }

        // Field ordering
        checkFieldOrder(d, `[${m.title}] in <${argName}>`, fieldOrderErrors);

        premiseIdx++;
        continue;
      }

      // Conclusion (intermediary or main)
      if (m.role === "intermediary-conclusion" || m.role === "main-conclusion") {
        const inference = d.inference;
        const hardcoded = d.credence;

        // Error: conclusion uses {credence} instead of {inference}
        if (hardcoded != null && inference == null) {
          facts.push(`conclusion_has_credence(${argId}, ${mId}).`);
        }

        // Reason on inference
        if (d.reason) facts.push(`has_inference_reason(${argId}, ${mId}).`);

        // Field ordering
        checkFieldOrder(d, `[${m.title}] in <${argName}>`, fieldOrderErrors);

        // Compute PCS product
        if (stagePremises.length > 0 && inference != null) {
          const infBps = toBps(inference);
          facts.push(`inference(${argId}, ${mId}, ${infBps}).`);

          // Multiply: product = (p1 * p2 * ... * pn * inf) / 10000^n
          // In bps arithmetic: product = p1/10000 * p2/10000 * ... * inf/10000 * 10000
          let product = 1.0;
          for (const p of stagePremises) {
            product *= p.bps / 10000;
          }
          product *= infBps / 10000;
          const computedBps = Math.round(product * 10000);

          computedCredences.set(m.title, computedBps);

          pcsResults.push({
            argument: argName,
            conclusion: m.title,
            premises: stagePremises.map((p) => ({ title: p.title, bps: p.bps })),
            inference: infBps,
            computed: computedBps,
          });

          // Intermediary feeds next stage
          if (m.role === "intermediary-conclusion") {
            stagePremises = [{ title: m.title, id: mId, bps: computedBps }];
          }
        } else if (inference != null) {
          facts.push(`inference(${argId}, ${mId}, ${toBps(inference)}).`);
        }
      }
    }
  }

  // --- Emit computed credences ---
  for (const [title, bps] of computedCredences) {
    facts.push(`computed(${atomize(title)}, ${bps}).`);
  }

  return { facts, pcsResults, fieldOrderErrors };
}

function checkFieldOrder(d, label, errors) {
  if (!d) return;
  const keys = Object.keys(d);
  if (keys.includes("reason") && (keys.includes("credence") || keys.includes("inference"))) {
    const reasonIdx = keys.indexOf("reason");
    const numKey = keys.includes("credence") ? "credence" : "inference";
    const numIdx = keys.indexOf(numKey);
    if (reasonIdx > numIdx) {
      errors.push(`ORDERING: ${label} has {${numKey}} before {reason} -- reason must come first`);
    }
  }
}

// --- CLI ---
if (process.argv[1] && process.argv[1].endsWith("compile_asp.mjs")) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node compile_asp.mjs <argdown.json>");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const { facts, pcsResults, fieldOrderErrors } = compile(data);

  // Output facts
  console.log(`% Compiled from ${inputPath}`);
  console.log(`% ${facts.length} facts\n`);
  console.log(facts.join("\n"));

  if (fieldOrderErrors.length > 0) {
    console.error(`\n${fieldOrderErrors.length} field ordering errors:`);
    for (const e of fieldOrderErrors) console.error(`  ${e}`);
  }
  if (pcsResults.length > 0) {
    console.error("\nPCS computations:");
    for (const r of pcsResults) {
      const premStr = r.premises.map((p) => `${p.bps}`).join(" * ");
      console.error(`  <${r.argument}> [${r.conclusion}]: ${premStr} * ${r.inference} => ${r.computed} bps`);
    }
  }
}
