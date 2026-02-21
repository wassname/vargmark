# ASP Conversion Plan

## Goal

Replace the ad-hoc imperative verification in verify.mjs with declarative ASP rules solved by clingo-wasm. Keep argdown as the LLM-facing surface syntax. The pipeline becomes:

```
.argdown -> @argdown/cli json -> argdown JSON -> compile_asp.mjs -> facts.lp
facts.lp + rules.lp -> clingo-wasm -> answer set (violations + computed credences)
answer set + argdown JSON -> render.mjs -> verified HTML
```

## Why

- Verification rules become declarative logic, not imperative loops
- Adding a new check = adding a rule, not writing a function
- Constraint violations are found by the solver, not by hand-coded iteration
- Correctness of the rules themselves becomes more inspectable
- clingo-wasm means zero native deps (npm only)

## Review feedback (incorporated)

Subagent correctly noted: most checks are one-liner comparisons, not
satisfiability problems. ASP is overkill for range checks. The honest
justification is: (a) cycle detection IS natural in ASP, (b) we may
want constraint satisfaction later ("find consistent credences"), (c)
it's an intellectual exercise in declarative verification.

Key changes from review:
- **Minimal fact schema**: no strings, no quotes in ASP. Structural atoms only.
- **Evidence stays 100% JS**: quote matching, paragraph extraction, bold fragments.
- **ALL computation in JS**: PCS products, log-odds. ASP only checks constraints.
- **Fix ASP syntax**: no `|abs|`, no `#product`. Use disjunctive rules.
- **Error message mapping**: JS layer translates ASP violation atoms to readable messages.
- **Field ordering check**: stays in JS compiler (JSON key order).
- **Math checks**: stay in JS (mathjs evaluation).

## Architecture

### Files

| File | Purpose |
|---|---|
| `rules.lp` | ASP verification rules (the core) |
| `compile_asp.mjs` | argdown JSON -> ASP facts (.lp) |
| `verify.mjs` | orchestrator: calls compile, runs clingo-wasm, parses answer set, renders HTML |
| `render.mjs` | answer set + JSON -> HTML (extracted from old verify.mjs) |
| `test.mjs` | updated: same pipeline but checks clingo output |

### rules.lp -- what the ASP encodes

All numbers are integers in basis points (bps): 7000 = 0.70. This avoids float issues in clingo.

**Facts emitted by compile_asp.mjs (structural only, no strings):**
```asp
claim(c_name).
argument(a_name).
premise(a_name, Pos, c_name, CredenceBps).
has_reason(a_name, Pos).              % compiler checks reason exists, emits flag
inference(a_name, c_name, InferenceBps).
has_inference_reason(a_name).

entails(c_from, c_to).
contrary(c_from, c_to).
undercut(c_from, a_target).

tag(c_name, observation).             % atoms, not strings
tag(c_name, assumption).
has_source(c_name).                   % compiler verified source URL exists
has_quote(c_name).                    % compiler verified quote exists
quote_verified(c_name).              % compiler matched quote against evidence

top_claim(c_name).
computed(c_name, CredenceBps).        % pre-computed by compiler (PCS products)
```

**Rules in rules.lp:**
```asp
% --- Range checks ---
violation(range_premise, A, C) :- premise(A, _, C, V), (V < 0; V > 10000).
violation(range_inference, A, C) :- inference(A, C, V), (V < 0; V > 10000).

% --- Missing reason ---
violation(missing_reason, A, P) :- premise(A, P, _, _), not has_reason(A, P).
violation(missing_inference_reason, A) :- inference(A, _, _), not has_inference_reason(A).

% --- Observation must have source + quote ---
violation(missing_source, C) :- tag(C, observation), not has_source(C).
violation(missing_quote, C) :- tag(C, observation), not has_quote(C).

% --- Top-level claim must not have hardcoded credence ---
violation(top_level_credence, C) :- top_claim(C), hardcoded_credence(C).

% --- Entailment monotonicity: P(B) >= P(A) ---
violation(entailment, A, B) :-
  entails(A, B), computed(A, CA), computed(B, CB), CB < CA.

% --- Contrary constraint: P(A) + P(B) <= 1 ---
violation(contrary_sum, A, B) :-
  contrary(A, B), computed(A, CA), computed(B, CB), CA + CB > 10000.

% --- Contradiction (mutual contrary): P(A) + P(B) ~= 1 ---
violation(contradiction_high, A, B) :-
  contrary(A, B), contrary(B, A),
  computed(A, CA), computed(B, CB),
  CA + CB - 10000 > 500.

violation(contradiction_low, A, B) :-
  contrary(A, B), contrary(B, A),
  computed(A, CA), computed(B, CB),
  10000 - CA - CB > 500.

% --- Entailment cycles (reachability) ---
reaches(A, B) :- entails(A, B).
reaches(A, C) :- reaches(A, B), entails(B, C).
violation(cycle, A) :- reaches(A, A).

% --- Isolated top-level claims ---
has_relation(C) :- entails(C, _).
has_relation(C) :- entails(_, C).
has_relation(C) :- contrary(C, _).
has_relation(C) :- contrary(_, C).
has_relation(C) :- premise(_, _, C, _).
violation(isolated, C) :- top_claim(C), not has_relation(C).

% --- Show violations ---
#show violation/2.
#show violation/3.
```

### compile_asp.mjs

Walks the argdown JSON (same format @argdown/cli produces) and emits ASP facts:

1. Extract statements -> `claim/3` facts
2. Extract PCS arguments -> `argument/1`, `premise/5`, `inference/4` facts
3. Extract relations -> `entails/2`, `contrary/2`, `undercut/2` facts
4. Extract tags -> `tag/2` facts
5. Extract observation metadata -> `source/6`, `quote/2`, `bold_fragment/2` facts
6. Mark top-level claims -> `top_claim/1` facts

String escaping: ASP string literals use `"..."` with `\"` escapes. Newlines replaced with `\n`.

### Integer math for PCS

Clingo has no `#product` aggregate. Options:
1. **Compile-time expansion** (chosen): compile_asp.mjs computes the premise product and emits it as a fact:
   ```asp
   pcs_product(a1, 5600).  % 7000 * 8000 / 10000
   computed(C, V) :- inference(A, C, Inf, _), pcs_product(A, Prod), V = Prod * Inf / 10000.
   ```
   This is clean: the solver verifies constraints, the compiler does arithmetic.

2. Lua scripting in clingo: possible but adds complexity.

Decision: option 1. The compiler is already walking the JSON; computing products there is natural.

### Multi-step PCS (pattern 5)

Multi-step PCS has intermediary conclusions that feed into the next stage. The compiler handles this by emitting multiple `pcs_product` facts, one per stage:

```asp
% Stage 1: premises 1,2 -> intermediary conclusion 3
pcs_product(recursive_takeoff_s1, 4250).  % 8500 * 5000 / 10000
computed(rapid_gain, 1700).               % 4250 * 4000 / 10000

% Stage 2: intermediary 3 + premise 4 -> main conclusion 5
pcs_product(recursive_takeoff_s2, 595).   % 1700 * 3500 / 10000
computed(pause_buys_time, 178).           % 595 * 3000 / 10000
```

### Evidence verification

Quote matching stays in JS (compile_asp.mjs or verify.mjs). ASP is wrong for fuzzy string matching. The compiler:
1. Loads evidence/*.md files
2. Matches quotes against paragraphs (same snippetTokens logic)
3. Emits `quote_verified(c_name).` or `quote_mismatch(c_name, "error message").` facts

ASP then checks:
```asp
violation(quote_mismatch, C, Msg) :- quote_mismatch(C, Msg).
violation(missing_evidence, C) :- tag(C, "observation"), not quote_verified(C).
```

### Log-odds bottom line

Computed in JS after clingo returns the answer set. The compiler or verify.mjs:
1. Collects computed credences from the answer set
2. Runs log-odds aggregation for top-level claims
3. Passes results to the renderer

This is arithmetic, not constraint solving -- JS is fine.

### render.mjs

Extracted from the current verify.mjs HTML rendering code. Takes:
- argdown JSON (for structure, text, argument names)
- computed credences (from answer set + log-odds)
- violations (from answer set)
- evidence paragraphs (from quote matching)

Produces the same HTML output as before.

## Migration steps

1. Install clingo-wasm: `npm install clingo-wasm`
2. Create `rules.lp` with all verification rules
3. Create `compile_asp.mjs`: JSON -> ASP facts
4. Refactor `verify.mjs`: orchestrator calling compile + clingo + render
5. Extract `render.mjs` from current verify.mjs
6. Update `test.mjs` to use new pipeline (same test structure)
7. Port all test patterns and examples
8. Update SKILL.md usage section

## What stays the same

- `.argdown` surface syntax (LLMs write this)
- `@argdown/cli` for parsing
- `evidence/` directory structure
- HTML output format
- Test structure (test_patterns/, examples/)

## What changes

- verify.mjs: imperative checks -> clingo-wasm solver
- New file: rules.lp (declarative verification)
- New file: compile_asp.mjs (JSON -> ASP facts)
- New file: render.mjs (extracted HTML rendering)
- package.json: add clingo-wasm dependency

## Risks

- clingo-wasm may have quirks (WASM cold start, string handling limits)
- Integer bps arithmetic loses precision below 0.01% (acceptable)
- LLMs don't need to know about ASP -- they still write argdown
