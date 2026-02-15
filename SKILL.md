---
name: vargdown
description: |
  Write structured argument maps in Argdown strict mode (.argdown files) with
  labeled premises, credences, and source verification. Use when analyzing
  claims, building argument structures, or evaluating evidence chains.
  Produces verifiable HTML via `just render`.
---

# Verified Argument Maps (v-argdown)

Every claim has a clickable source + quote. Premises get credences. Conclusions get inference strengths. The top-level claim is computed, not asserted.


**Agent workflow**: write .argdown -> run `just verify` -> read errors -> fix -> re-run until "All checks passed."

## Procedure

1. State the claim as a falsifiable thesis (no hardcoded credence)
2. Search for evidence -- find papers, extract ONE direct quote per claim
3. Write top-level structure: `[Thesis]` with `+ <Pro>` and `- <Con>` arguments
4. Write each argument as a PCS (premise-conclusion structure) with numbered premises, inference bar, named conclusion
5. Run `just verify <stem>` -- fix errors until "All checks passed", then `just render` for HTML


## Principles

TODO rewrite this as reason: implementation or similar sould be
1. automatically verify what we can
2. make it easy for a judge to verify
  3. this means the judge has the same information as the writer
  4. this means it requries little attention, time, or decoding to check

### How

1. **Every claim has a source you can click.** Observations link to a paper/URL and include a blockquote of raw text from the source. The premise text provides minimal context; the quote carries the factual weight. If a reader can't verify a premise in 10 seconds, the argument is not trustworthy.

TODO and every source has a saved markdown, and a link to the section/line in that file
TODO try this, update docs for this

3. **Separate observation from inference from conclusion.** Premises are either sourced facts (`#observation`) or flagged assumptions (`#assumption`). The inference between `--` lines is one sentence. This makes the human's job small: check each one-liner inference step.

4. **Commit to numbers, not vibes.** Premises get `{reason: '...', credence: X}` (how much you trust the source). Conclusions get `{reason: '...', inference: X}` (how strong the reasoning step is). The verifier computes conclusion credence = product(premise credences) * inference strength. Nothing derivable is hardcoded.

5. **The argument computes a bottom line.** Entailments and contraries propagate through the graph to produce an implied credence for the top-level claim. The reader gets a single number, not just a tree.

The relations have checkable probability constraints:

| Relation | Constraint | Meaning |
|---|---|---|
| A `+>` B (entails) | P(B) >= P(A) | If A is true, B must be true |
| A `->` B (contrary) | P(A) + P(B) <= 1 | A and B can't both be true |
| A `><` B (contradictory) | P(A) + P(B) = 1 | Exactly one is true |



## Complete Example of Output

This skill document is itself a vargdown argument. Study the format, then read the rules.

```argdown
===
title: Does Structured Argumentation Close the Verification Gap?
author: vargdown SKILL.md
model:
    mode: strict
===

[Closes Gap]: Structured argument maps with sourced quotes and
  computed credences close the verification gap in LLM-generated reasoning.
  + <Debate Helps>
  + <Structure Helps>
  - <Overhead Cost>

# Evidence For


# TODO FIXME always have reason before credece as we are thinking not rationalising post hoc

<Debate Helps>

(1) [Debate]: Irving et al. 2018 propose AI safety via debate, where
    agents argue opposing sides and a judge evaluates. #observation
    [Irving et al. 2018](https://arxiv.org/abs/1805.00899)
    > "debate, where two agents compete to convince a judge, can be used to train models that are safe"
    {credence: 0.75, reason: "influential but empirical validation is limited"}
(2) [Oversight]: Bowman et al. 2022 argue scalable oversight requires
    decomposing arguments so humans check small steps. #observation
    [Bowman et al. 2022](https://arxiv.org/abs/2211.03540)
    > "we need mechanisms for humans to oversee tasks they cannot directly evaluate"
    {credence: 0.80, reason: "widely cited position paper from NYU alignment group"}
----
(3) [Decomposition Works]: Breaking arguments into individually
    checkable steps enables human verification at scale.
    {inference: 0.70, reason: "plausible mechanism, but empirical evidence thin"}
  +> [Closes Gap]

<Structure Helps>

(1) [Arg Mapping]: Nesbit & Liu 2025 review argument mapping in
    higher education and find it improves critical thinking. #observation
    [Nesbit & Liu 2025](https://doi.org/10.1111/hequ.70063)
    > "argument mapping in higher education: a systematic review"
    {credence: 0.70, reason: "systematic review, but effect sizes vary"}
(2) [Hallucination Rate]: Safran & Cali 2025 find only 7.5% of
    LLM-generated references are fully accurate. #observation
    [Safran & Cali 2025](https://doi.org/10.38053/acmj.1746227)
    > "Only 7.5% of references were fully accurate in the initial generation, while 42.5% were completely fabricated"
    {credence: 0.80, reason: "small study (40 refs) but consistent with other findings"}
----
(3) [Forced Sourcing Helps]: Requiring URL + exact quote per claim
    makes hallucinated citations immediately visible.
    {inference: 0.85, reason: "if quote must be verbatim, fabrication is caught on click"}
  +> [Closes Gap]

# Evidence Against

<Overhead Cost>

(1) [Verbosity]: Vargdown files are 3-5x longer than prose summaries,
    requiring more LLM tokens and human reading time. #assumption
    {credence: 0.90, reason: "observed in our own tests: ~200 lines vs ~50 lines prose"}
(2) [Parser Friction]: Argdown strict mode rejects common patterns
    like unnamed conclusions and ><, increasing failure rate. #assumption
    {credence: 0.70, reason: "seen in 3/4 initial agent tests"}
----
(3) [Too Costly]: The overhead of structured format may not be
    worth the verification benefit for simple questions.
    {inference: 0.40, reason: "overhead is real but format is for complex contested claims, not simple queries"}
  -> [Closes Gap]
```

Output: `[Closes Gap]` implied credence ~66% (+0.67 log-odds; pro outweighs con for complex claims).


---
## Verification

Run the verifier script after writing. Fix errors until it passes:

TODO remove just dependancy (use uv or npx)

```bash
just verify <stem>          # text output: checks + computed credences
just render <stem>          # also generates HTML with colored cards
```

The verifier checks: credence consistency, PCS math, graph structure, and contradiction constraints. It computes conclusion credences from premises and outputs a bottom-line assessment.

## Tags

| Tag | Meaning |
|-----|---------|
| `#observation` | Sourced claim (needs URL + quote) |
| `#assumption` | Unsourced belief |
| `#crux` | Sub-question that determines the main answer |
| `#prior` | Base rate or reference class |
| `#mechanism` | Explanation of how/why |
| `#cluster-X` | Correlated arguments (shared evidence) |



## Key Rules (deviations from standard Argdown)

1. **`{credence: X}`** on premises = trust in source (0-1). **`{inference: X}`** on conclusions = reasoning strength given premises (0-1). Never write `{credence}` on a conclusion. Example: `{credence: 0.7}` on a premise, `{inference: 0.6}` on its conclusion. The conclusion's credence is *computed*: `product(premise credences) * inference`, aggregated via log-odds.
2. **Top-level claim** gets NO hardcoded credence. It's computed via log-odds aggregation.
3. **`#observation`** premises MUST have: `[Label](url)` link + `> "exact quote"` blockquote.
4. **`#assumption`** premises need `{credence: X, reason: "..."}` but no URL.
5. **ALL conclusions** must be named: `(3) [Name]: text`. Never bare sentences.
6. **`{reason: "..."}`** is required on every credence and inference value.
7. **`><` does not parse.** Use mutual contraries instead (see Pattern 4 below).

---

## Pattern Snippets

### Undercut (Pattern 3)

Attacks the inference, not the premises. "Even if true, doesn't follow."

```argdown
<Collapse Risk>
(1) [Collapse]: Shumailov 2024 showed recursive self-training degrades. #observation
    [Shumailov 2024](https://www.nature.com/articles/s41586-024-07566-y)
    > "Model collapse is a degenerative process"
    {credence: 0.85, reason: "Nature paper, well-replicated"}
----
(2) [Naive Degrades]: Naive synthetic scaling degrades quality.
    {inference: 0.80, reason: "direct implication"}
  _> <Synthetic Data Fix>
```

### Contradiction / Value Tension (Pattern 4)

`><` doesn't parse. Use mutual `- [other]` + comment:

```argdown
// Contradiction: P(Risk Real) + P(Opportunity Cost) = 1
[Risk Real]: AI catastrophe probability >= 5%. #observation
  {credence: 0.70, reason: "expert survey median ~5-10%"}
  - [Opportunity Cost]
[Opportunity Cost]: Pausing delays millions of QALYs/year. #assumption
  {credence: 0.30, reason: "complement of Risk Real"}
  - [Risk Real]
```

### Multi-Step Inference (Pattern 5)

Name every intermediate conclusion:

```argdown
<Recursive Takeoff>
(1) [No Ceiling]: No fundamental barrier at human level. #assumption
    {credence: 0.85, reason: "no known theoretical ceiling"}
(2) [Self Improve]: Capable AI could improve its own training. #assumption
    {credence: 0.50, reason: "speculative but plausible"}
----
(3) [Rapid Gain]: Recursive self-improvement produces rapid capability gain.
    {inference: 0.40, reason: "possible but not certain"}
(4) [Narrow Window]: Intervention window may be very short. #assumption
    {credence: 0.35, reason: "depends on speed of recursive improvement"}
----
(5) [Pause Buys Time]: A pause gives safety margin before recursive takeoff.
    {inference: 0.30, reason: "only helps if takeoff is near"}
```

### Sub-Question Decomposition (Pattern 6)

A crux with `- [Main Q]` means: if this crux is true, Main Q becomes less likely.

```argdown
[Main Q]: Scaling laws hold to 10^29 FLOP.
[Data Wall]: Data runs out before 10^29 FLOP. #crux
  - [Main Q]
[Energy Wall]: Energy costs become prohibitive. #crux
  - [Main Q]
```

Then give each crux its own PCS arguments with evidence.

### Bottom Line Synthesis (Pattern 7)

Use `+> [Thesis]` if evidence supports, `-> [Thesis]` if against:

```argdown
<Bottom Line>
(1) [Pro Conclusion A]
(2) [Pro Conclusion B]
(3) [Con Conclusion C]
--
Weighing pro and con arguments {uses: [1, 2, 3]}
--
(4) [Verdict]: Net assessment after weighing all evidence.
    {inference: 0.55, reason: "pro outweighs con but margin is thin"}
  +> [Main Claim]
```

### Conditional Decomposition (Pattern 8)

```argdown
// Contradiction: exactly one scenario
[ITER Succeeds]: ITER achieves Q>10 by 2035. #assumption
  {credence: 0.40, reason: "behind schedule but possible"}
  - [ITER Fails]
[ITER Fails]: ITER does not achieve Q>10. #assumption
  {credence: 0.60, reason: "history of delays"}
  - [ITER Succeeds]

<Fusion If ITER Succeeds>
(1) [ITER Succeeds]
(2) [Fast Commercialization]: Private sector scales quickly after proof. #assumption
    {credence: 0.50, reason: "assumes regulatory cooperation"}
----
(3) [Commercial Fusion Possible]: Commercial fusion reactors by 2045.
    {inference: 0.45, reason: "10 years is aggressive for deployment"}
  +> [Fusion By 2045]
```

### Correlated Arguments (Pattern 9)

Tag with `#cluster-X` to flag shared evidence base:

```argdown
<Economic Cost> #cluster-cost
(1) [GDP Hit]: Sanctions could cost 7% of GDP. #observation {credence: 0.70, reason: "IMF estimates"}
----
(2) [Econ Deters]: Economic costs deter. {inference: 0.65, reason: "assumes rational actors"}
  +> [Safe Outcome]

<Reputational Cost> #cluster-cost
(1) [Brand Risk]: Brand damage from unsafe deployment. #assumption {credence: 0.60, reason: "some evidence"}
----
(2) [Rep Deters]: Reputation costs deter. {inference: 0.55, reason: "weaker than economic"}
  +> [Safe Outcome]
```

### Base Rate Prior (Pattern 10)

```argdown
[Base Rate]: Historical energy transitions take 50-70 years. #prior #observation
  {credence: 0.80, role: "prior", base_rate: 0.04, reason: "Smil 2010 data"}
  +> [Slow Transition]

<Upward Update>
(1) [New Signal]: Private fusion investment 10x in 5 years. #observation
    {credence: 0.75, reason: "documented but novel"}
----
(2) [Faster Than Base]: Update toward faster transition.
    {inference: 0.60, role: "update", direction: "up", magnitude: 1.5, reason: "investment != deployment"}
  +> [Fast Transition]
```

---


---

## Ensemble Mode

To compare two agents' argument maps on the same topic:

1. Agent A writes `topic_a.argdown`, Agent B writes `topic_b.argdown`
2. A third agent reads both and produces a comparison:

```
## Comparison: [Topic]
|                    | Agent A          | Agent B          |
|--------------------|------------------|------------------|
| Thesis credence    | 0.42             | 0.58             |
| # pro arguments    | 3                | 2                |
| # con arguments    | 2                | 3                |
| Key disagreement   | [Claim X]: A=0.8, B=0.3 |          |
| Missing in A       | [Claim Y]        |                  |
| Missing in B       | [Claim Z]        |                  |
```

3. The arbiter merges into `topic_merged.argdown`, keeping the stronger-sourced version of each disputed claim, and noting disagreements as comments.

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `{credence: X}` on a conclusion | `{inference: X}` -- credence is computed |
| `{credence: X}` on top-level claim | Remove -- computed via log-odds |
| Unnamed conclusion `(3) Some text.` | `(3) [Name]: Some text.` |
| No URL on `#observation` | Every observation needs `[Label](url)` |
| Blockquote is vague or a paper title | Find a specific declarative finding |
| Paraphrasing in blockquote | Use exact text; if paraphrasing: `> "paraphrase: ..."` and lower credence |
| Multi-sentence inference | Split into sub-arguments (Pattern 5) |
| Missing `{reason: "..."}` | Always explain why this number |
| `[brackets]` in blockquotes | Escape as `\[text\]` -- parser treats `[x]` as statement refs |
| Using `><` for contradiction | Use mutual `- [other]` contraries (see Pattern 4) |

