---
name: verified-argument-maps
description: "Write structured argument maps in Argdown strict mode (.argdown files) with labeled premises, credences, and source verification. Use when analyzing claims, building argument structures, or evaluating evidence chains."
---

# Verified Argument Maps

Structured arguments where every claim links to a source with a quote, premises get credences, inference steps are one-liners, and conclusions are computed. `just render` produces verified HTML with credence coloring.

## Principles

1. **Every claim has a source you can click.** `#observation` premises link to a paper/URL and include a blockquote of verbatim source text. A reader verifies in 10 seconds: click link, ctrl-F for quote.
2. **Separate observation from inference from conclusion.** Premises are sourced facts (`#observation`) or flagged assumptions (`#assumption`). The inference between `--` lines is one sentence. Each step is checkable in your head.
3. **Commit to numbers, not vibes.** Premises get `{credence: X}` (trust in the source). Conclusions get `{inference: X}` (how strong the reasoning step is). The verifier computes `conclusion_credence = product(premise_credences) * inference`. Nothing derivable is hardcoded.
4. **The argument computes a bottom line.** Entailments and contraries propagate through the graph. The top-level claim gets no hardcoded credence -- it's computed.

## Relations (strict mode)

| Relation | Syntax | Constraint | Use when |
|---|---|---|---|
| Entails | `+>` | P(B) >= P(A) | Conclusion supports a claim |
| Contrary | `->` | P(A) + P(B) <= 1 | Both could be partially true |
| Contradictory | `><` | P(A) + P(B) = 1 | Exactly one must be true (scenario branching, value tensions) |
| Undercut | `_>` | attacks the inference, not the premise | "Even if true, the conclusion doesn't follow" |

## Metadata Convention

Argdown passes arbitrary YAML `{key: value}` through to JSON. Only `credence`, `inference`, and `reason` are consumed by `argmap.py`. All other keys are passthrough metadata available for custom rendering. These keys are standardized:

| Key | On what | Meaning |
|---|---|---|
| `credence` | premises | Trust in this source/claim (0-1) |
| `inference` | conclusions | Strength of reasoning step (0-1). Credence is computed, not hardcoded. |
| `reason` | any | Why this credence/inference value (shown as tooltip) |
| `role` | statements | `"prior"` for base rate anchors, `"update"` for evidence that shifts from prior |
| `base_rate` | prior statements | The numeric base rate (e.g., 0.04) |
| `direction` | update conclusions | `"up"` or `"down"` from prior |
| `magnitude` | update conclusions | Likelihood ratio (e.g., 1.5 = 50% more likely) |

## Tag Convention

| Tag | Meaning |
|---|---|
| `#observation` | Sourced factual claim (must have link + quote) |
| `#assumption` | Unsourced belief or modeling choice |
| `#mechanism` | Explanation of how/why something works |
| `#crux` | A sub-question that determines the main answer |
| `#prior` | Base rate or reference class |
| `#cluster-X` | Correlated arguments sharing evidence base (renderer can discount) |
| `#pro` / `#con` | Classification for coloring |
| `#meta` | Commentary on the argument structure itself |

## Structural Patterns

### Pattern 1: Sourced Premise (universal building block)

Every factual claim. The blockquote IS the evidence; the premise text is just a pointer.

```argdown
[ShortName]: Author Year found X in study of Y. #observation
  > "exact quote from the source"
  [Author Year](https://url-to-paper)
  {credence: 0.90, reason: "well-cited, peer reviewed"}
```

For unsourced claims: `[Name]: Your assumption. #assumption {credence: 0.65}`

### Pattern 2: Evidence Chain (linear argument)

Premises -> inference bar -> conclusion -> relation to claim.

```argdown
<Argument Name>

(1) [Premise A]: ... #observation
    > "quote"
    [Source](url)
    {credence: 0.90}
(2) [Premise B]: ... #assumption
    {credence: 0.70}
----
(3) [Conclusion]: What follows.
    {inference: 0.80}
  +> [Main Claim]
```

### Pattern 3: Undercut

Attacks the inference step of another argument, not its premises. `_> <Target>` on the conclusion of the undercutting argument targets the inference bar inside `<Target>`, saying "even if your premises are true, your conclusion doesn't follow."

```argdown
<Synthetic Data Fix>
(1) [Synth Works]: RL improved math scores without human data. #observation
    {credence: 0.75}
----
(2) Synthetic data relaxes the data constraint.
    {inference: 0.60}
  + [Scaling Continues]

<Model Collapse>
(1) [Collapse]: Shumailov 2024 showed recursive self-training degrades quality. #observation
    > "Model collapse is a degenerative process"
    [Shumailov et al. 2024, Nature](https://www.nature.com/articles/s41586-024-07566-y)
    {credence: 0.85}
----
(2) Naive synthetic scaling degrades quality.
    {inference: 0.80}
  _> <Synthetic Data Fix>
```

### Pattern 4: Contradiction (value tensions, scenario splits)

Two claims that cannot both be fully true. `><` enforces P(A) + P(B) = 1.

```argdown
[Risk Real]: AI catastrophe probability >= 5%. #observation
  {credence: 0.70}

[Opportunity Cost]: Pausing delays millions of QALYs per year. #assumption
  {credence: 0.70}

[Risk Real]
  >< [Opportunity Cost]
```

### Pattern 5: Multi-Step Inference

Causal chains with intermediate conclusions feeding the next step.

```argdown
<Recursive Takeoff>
(1) [No Ceiling]: No fundamental barrier at human level. #observation
    {credence: 0.85}
(2) [Self Improve]: Capable AI could improve its own training. #assumption
    {credence: 0.50}
----
(3) Recursive self-improvement could produce rapid capability gain.
    {inference: 0.40}
(4) [Narrow Window]: Intervention window may be very short. #assumption
    {credence: 0.35}
----
(5) A pause gives safety margin before recursive takeoff.
    {inference: 0.30}
```

### Pattern 6: Sub-Question Decomposition

Complex question -> independent sub-questions, each with own evidence.

```argdown
[Main Q]: Scaling laws hold to 10^29 FLOP.

[Data Wall]: Data runs out before 10^29 FLOP. #crux
  - [Main Q]

[Energy Wall]: Energy costs become prohibitive. #crux
  - [Main Q]

[Loss Not Capability]: Loss drops but capabilities plateau. #crux
  - [Main Q]
```

Then each `#crux` gets its own PCS arguments with evidence. Cruxes complement the pro/con skeleton (Pattern 8) -- the main claim has `+`/`-` relations to arguments, and `#crux` sub-questions organize which arguments address which facet.

### Pattern 7: Synthesis / Aggregation

Pulls conclusions from multiple arguments into a bottom line. Connect the verdict back to the main claim with `+>` or `->`.

```argdown
<Bottom Line>
(1) [Evidence A Conclusion]
(2) [Evidence B Conclusion]
(3) [Counter Conclusion]
--
Weighing pro and con arguments {uses: [1, 2, 3]}
--
(4) [Verdict]: The net assessment after weighing all evidence.
    {inference: 0.55}
  +> [Main Claim]
```

### Pattern 8: Pro/Con Map (the universal skeleton)

Every argument map uses this top-level structure regardless of task type.

```argdown
===
title: Question Being Investigated
author: Agent Name
model:
    mode: strict
===

[Thesis]: The thing you're arguing about.
  + <Pro Argument 1>
  + <Pro Argument 2>
  - <Con Argument 1>
  - <Con Argument 2>
```

### Pattern 9: Conditional Decomposition

Express conditional probabilities using `><` contradiction + branched arguments.

```argdown
[Event]: The event occurs.

[Condition True]: The conditioning variable is true. #assumption
  {credence: 0.70}
[Condition False]: The conditioning variable is false. #assumption
  {credence: 0.30}
[Condition True] >< [Condition False]

<Event If Condition True>
(1) [Condition True]
(2) [Evidence under this scenario]. #observation {credence: 0.80}
----
(3) Under this condition, event probability is high.
    {inference: 0.75}
  + [Event]

<Event If Condition False>
(1) [Condition False]
(2) [Evidence under this scenario]. #observation {credence: 0.70}
----
(3) Without the condition, event probability is low.
    {inference: 0.40}
  - [Event]
```

### Pattern 10: Correlated Arguments

Tag arguments sharing evidence base with `#cluster-X`. Renderer can detect and discount to avoid double-counting.

```argdown
<Economic Cost> #cluster-cost
(1) [GDP Hit]: Sanctions could cost 7% of GDP. #observation {credence: 0.70}
----
(2) Economic costs deter. {inference: 0.65}
  + [Safe Outcome]

<Reputational Cost> #cluster-cost
(1) [Brand Risk]: Unsafe deployment causes brand damage. #assumption {credence: 0.60}
----
(2) Reputation costs deter. {inference: 0.55}
  + [Safe Outcome]
```

### Pattern 11: Base Rate as Privileged Prior

Mark the base rate explicitly. Other arguments are updates from it.

```argdown
[Base Rate]: Historical base rate is 3-5% per year. #prior #observation
  {credence: 0.80, role: "prior", base_rate: 0.04}
  + [Event]

<Upward Update>
(1) [New Signal]: A new indicator suggests elevated risk. #observation {credence: 0.75}
----
(2) Update upward from base rate.
    {inference: 0.60, role: "update", direction: "up", magnitude: 1.5}
  + [Event]
```

## Procedure

1. **State the claim** -- falsifiable, no hardcoded credence
2. **Find evidence** -- search for papers/sources, find ONE direct quote per claim
3. **Write premises** -- Pattern 1 (sourced) or Pattern 1 variant (assumption)
4. **Write the inference** -- between `--` lines, ONE sentence, optionally `{uses: [1, 2]}`
5. **Write conclusion** -- `{inference: X}` not `{credence: X}`
6. **Connect to top-level claim** -- `+>` (entails) or `->` (contrary)
7. **Choose structural patterns** as needed:
   - Simple empirical: Patterns 1-2, 7-8
   - Technical prediction: add Pattern 6 (sub-questions)
   - Forecasting: add Patterns 9 (conditionals), 11 (base rate)
   - Policy/normative: add Patterns 4 (contradictions), 5 (multi-step)
   - Complex evidence: add Patterns 3 (undercuts), 10 (correlation)
8. **Verify**: `just render`

## Common Mistakes

| Mistake | Fix |
|---|---|
| Premise text summarizes the finding | Put finding in the blockquote, keep premise text minimal |
| Blockquote is a question | Find a declarative finding |
| `{credence: X}` on a conclusion | Use `{inference: X}` -- credence is computed |
| `{credence: X}` on top-level claim | Remove it -- computed via propagation |
| Multi-sentence inference | Split into sub-arguments |
| Using `(1) and (2):` in inference | Use `{uses: [1, 2]}` YAML instead |
| No URL on `#observation` | Every observation must link to a source |
| URL in `{url: "..."}` metadata | Use markdown link `[Label](url)` in statement text |
| Counting correlated arguments independently | Tag with `#cluster-X` |
| Base rate as just another argument | Mark with `{role: "prior"}` |
| Square brackets in blockquotes | Escape `[` as `\[` inside `> "quote"` -- argdown parser treats `[text]` as statement references |
| Too many premises per argument | 2-4 premises per PCS is typical. More than 5 suggests splitting into sub-arguments |

## Example

See [example.argdown](/media/wassname/SGIronWolf/projects5/2025/argument-formats/example.argdown) for a complete worked example.

See [patterns.argdown](/media/wassname/SGIronWolf/projects5/2025/argument-formats/patterns.argdown) and [patterns_advanced.argdown](/media/wassname/SGIronWolf/projects5/2025/argument-formats/patterns_advanced.argdown) for minimal examples of each structural pattern.
