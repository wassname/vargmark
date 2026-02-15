---
name: vargdown
description: |
  Write structured argument maps in Argdown strict mode (.argdown files) with
  labeled premises, credences, and source verification. Use when analyzing
  claims, building argument structures, or evaluating evidence chains.
  Produces verifiable HTML via `just render`.
---

# Verified Argument Maps (v-argdown)

Structured argument maps where every claim has a clickable source + exact quote, premises get credences, conclusions get inference strengths, and the bottom line is computed, not asserted.

## Usage

1. Write `.argdown` file following this format
2. Verify and fix errors until clean
3. Have a sub-agent review it: check all links resolve, skeptically review all reasoning, inference values, and credence assignments
4. (optional) Render to HTML with colored cards and computed credences

```bash
# with just (if available)
just verify <stem>
just render <stem>

# without just
npx @argdown/cli json <stem>.argdown "$(dirname <stem>)"
uv run --with sympy --with networkx python argmap.py <stem>.json --verify-only   # verify
uv run --with sympy --with networkx python argmap.py <stem>.json <stem>_verified.html  # render
```

## Principles

**Machine-check what you can; make the rest judgeable at the right level.**

The format lets machines verify the mechanical (quote matching, arithmetic, graph structure), weaker models verify the intermediate (inference plausibility, source relevance), and humans verify the cruxes -- each with minimal work per node.

**1a. Proof travels with the claim.**
Every observation exports URL + exact quote + frozen local copy. The judge never searches for evidence -- it's right there. Save source text to `evidence/` so verification uses a frozen copy, not a live URL that may break or change.

**1b. Observations have sources; inferences have reasons.**
Observations are checked against their source quote. Inferences are checked against reasoning and stated credence. Each step is one or the other, never mixed.

**1c. Reason first, credence second; bottom line is computed, never stated.**
State why before how-much -- reasoning to a number, not post-hoc rationalization. Write `{reason: "...", credence: X}` not `{credence: X, reason: "..."}`. Conclusion credence = product(premise credences) * inference. The top-level claim falls out of the math.

## Example

This skill document argues for itself. Study the format, then read the rules below.

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

<Debate Helps>

(1) [Debate]: Irving et al. 2018 propose AI safety via debate, where
    agents argue opposing sides and a judge evaluates. #observation
    [Irving et al. 2018](https://arxiv.org/abs/1805.00899)
    > "we propose training agents via self play on a zero sum debate game"
    {reason: "influential but empirical validation is limited", credence: 0.75}
(2) [Oversight]: Bowman et al. 2022 argue scalable oversight requires
    decomposing arguments so humans check small steps. #observation
    [Bowman et al. 2022](https://arxiv.org/abs/2211.03540)
    > "scalable oversight: the problem of supervising systems that potentially outperform us on most skills relevant to the task at hand"
    {reason: "widely cited position paper from NYU alignment group", credence: 0.80}
----
(3) [Decomposition Works]: Breaking arguments into individually
    checkable steps enables human verification at scale.
    {reason: "plausible mechanism, but empirical evidence thin", inference: 0.70}
  +> [Closes Gap]

<Structure Helps>

(1) [Arg Mapping]: Nesbit & Liu 2025 systematically reviewed 124
    studies on argument mapping in higher education. #observation
    [Nesbit & Liu 2025](https://doi.org/10.1111/hequ.70063)
    > "the weight of evidence supports a recommendation that instructors use argument mapping to develop critical thinking and argumentation skills"
    {reason: "systematic review of 124 studies, but effect sizes vary and meta-analysis still needed", credence: 0.70}
(2) [Hallucination Rate]: Safran & Cali 2025 find only 7.5% of
    LLM-generated references are fully accurate. #observation
    [Safran & Cali 2025](https://doi.org/10.38053/acmj.1746227)
    > "Only 7.5% of references were fully accurate in the initial generation, while 42.5% were completely fabricated"
    {reason: "small study (40 refs) but consistent with other findings", credence: 0.80}
----
(3) [Forced Sourcing Helps]: Requiring URL + exact quote per claim
    makes hallucinated citations immediately visible.
    {reason: "if quote must be verbatim, fabrication is caught on click", inference: 0.85}
  +> [Closes Gap]

# Evidence Against

<Overhead Cost>

(1) [Verbosity]: Vargdown files are 3-5x longer than prose summaries,
    requiring more LLM tokens and human reading time. #assumption
    {reason: "observed in our own tests: ~200 lines vs ~50 lines prose", credence: 0.90}
(2) [Parser Friction]: Argdown strict mode rejects common patterns
    like unnamed conclusions and ><, increasing failure rate. #assumption
    {reason: "seen in 3/4 initial agent tests", credence: 0.70}
----
(3) [Too Costly]: The overhead of structured format may not be
    worth the verification benefit for simple questions.
    {reason: "overhead is real but format is for complex contested claims, not simple queries", inference: 0.40}
  -> [Closes Gap]
```

Output: `[Closes Gap]` implied credence ~66% (+0.67 log-odds; pro outweighs con for complex claims).

---

## Format Rules

### Tags

| Tag            | Meaning                                      |
| -------------- | -------------------------------------------- |
| `#observation` | Sourced claim (needs URL + quote)            |
| `#assumption`  | Unsourced belief                             |
| `#crux`        | Sub-question that determines the main answer |
| `#prior`       | Base rate or reference class                 |
| `#mechanism`   | Explanation of how/why                       |
| `#cluster-X`   | Correlated arguments (shared evidence)       |

### Key Rules (deviations from standard Argdown)

1. **`{reason: "...", credence: X}`** on premises = trust in source (0-1). **`{reason: "...", inference: X}`** on conclusions = reasoning strength given premises (0-1). Never write `{credence}` on a conclusion -- credence is _computed_: `product(premise credences) * inference`, aggregated via log-odds. Reason always comes first.
2. **Top-level claim** gets NO hardcoded credence. It's computed via log-odds aggregation.
3. **Tag-specific requirements**:
   - **`#observation`**: MUST have `[Label](url)` link + `> "exact quote"` blockquote + `{reason, credence}`. Save source text to `evidence/` so verification uses a frozen local copy. Link to the specific passage: `[Label](evidence/paper.md#L42)` for a line or `[Label](evidence/paper.md#L42-L55)` for a range. The renderer will inline the referenced text as a popup.
   - **`#assumption`**: needs `{reason, credence}` but NO URL required.
   - **`#mechanism`**, **`#prior`**, **`#crux`**: same as `#assumption` (reason + credence, no URL required). Tag is metadata only.
4. **ALL conclusions** must be named: `(3) [Name]: text`. Never bare sentences.
5. **`{reason: "..."}`** is required on every credence and inference value, and comes first.
6. **`><` does not parse.** Use mutual contraries instead (see Pattern 4 below).

### Relation Constraints

| Relation | Constraint | Meaning |
|---|---|---|
| A `+>` B (entails) | P(B) >= P(A) | If A is true, B must be true |
| A `->` B (contrary) | P(A) + P(B) <= 1 | A and B can't both be true |
| A `><` B (contradictory) | P(A) + P(B) = 1 | Exactly one is true |

### Verification

The verifier checks: credence consistency, PCS math, graph structure, and contradiction constraints. It computes conclusion credences from premises and outputs a bottom-line assessment.

---

## Appendix

### Pattern Snippets

#### Undercut (Pattern 3)

Attacks the inference, not the premises. "Even if true, doesn't follow."

```argdown
<Collapse Risk>
(1) [Collapse]: Shumailov 2024 showed recursive self-training degrades. #observation
    [Shumailov 2024](https://www.nature.com/articles/s41586-024-07566-y)
    > "Model collapse is a degenerative process"
    {reason: "Nature paper, well-replicated", credence: 0.85}
----
(2) [Naive Degrades]: Naive synthetic scaling degrades quality.
    {reason: "direct implication", inference: 0.80}
  _> <Synthetic Data Fix>
```

#### Contradiction / Value Tension (Pattern 4)

`><` doesn't parse. Use mutual `- [other]` + comment:

```argdown
// Contradiction: P(Risk Real) + P(Opportunity Cost) = 1
[Risk Real]: AI catastrophe probability >= 5%. #observation
  {reason: "expert survey median ~5-10%", credence: 0.70}
  - [Opportunity Cost]
[Opportunity Cost]: Pausing delays millions of QALYs/year. #assumption
  {reason: "complement of Risk Real", credence: 0.30}
  - [Risk Real]
```

#### Multi-Step Inference (Pattern 5)

Name every intermediate conclusion:

```argdown
<Recursive Takeoff>
(1) [No Ceiling]: No fundamental barrier at human level. #assumption
    {reason: "no known theoretical ceiling", credence: 0.85}
(2) [Self Improve]: Capable AI could improve its own training. #assumption
    {reason: "speculative but plausible", credence: 0.50}
----
(3) [Rapid Gain]: Recursive self-improvement produces rapid capability gain.
    {reason: "possible but not certain", inference: 0.40}
(4) [Narrow Window]: Intervention window may be very short. #assumption
    {reason: "depends on speed of recursive improvement", credence: 0.35}
----
(5) [Pause Buys Time]: A pause gives safety margin before recursive takeoff.
    {reason: "only helps if takeoff is near", inference: 0.30}
```

#### Sub-Question Decomposition (Pattern 6)

A crux with `- [Main Q]` means: if this crux is true, Main Q becomes less likely.

```argdown
[Main Q]: Scaling laws hold to 10^29 FLOP.
[Data Wall]: Data runs out before 10^29 FLOP. #crux
  - [Main Q]
[Energy Wall]: Energy costs become prohibitive. #crux
  - [Main Q]
```

Then give each crux its own PCS arguments with evidence.

#### Bottom Line Synthesis (Pattern 7)

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
    {reason: "pro outweighs con but margin is thin", inference: 0.55}
  +> [Main Claim]
```

#### Conditional Decomposition (Pattern 8)

```argdown
// Contradiction: exactly one scenario
[ITER Succeeds]: ITER achieves Q>10 by 2035. #assumption
  {reason: "behind schedule but possible", credence: 0.40}
  - [ITER Fails]
[ITER Fails]: ITER does not achieve Q>10. #assumption
  {reason: "history of delays", credence: 0.60}
  - [ITER Succeeds]

<Fusion If ITER Succeeds>
(1) [ITER Succeeds]
(2) [Fast Commercialization]: Private sector scales quickly after proof. #assumption
    {reason: "assumes regulatory cooperation", credence: 0.50}
----
(3) [Commercial Fusion Possible]: Commercial fusion reactors by 2045.
    {reason: "10 years is aggressive for deployment", inference: 0.45}
  +> [Fusion By 2045]
```

#### Correlated Arguments (Pattern 9)

Tag with `#cluster-X` to flag shared evidence base:

```argdown
<Economic Cost> #cluster-cost
(1) [GDP Hit]: Sanctions could cost 7% of GDP. #observation
    {reason: "IMF estimates", credence: 0.70}
----
(2) [Econ Deters]: Economic costs deter.
    {reason: "assumes rational actors", inference: 0.65}
  +> [Safe Outcome]

<Reputational Cost> #cluster-cost
(1) [Brand Risk]: Brand damage from unsafe deployment. #assumption
    {reason: "some evidence", credence: 0.60}
----
(2) [Rep Deters]: Reputation costs deter.
    {reason: "weaker than economic", inference: 0.55}
  +> [Safe Outcome]
```

#### Base Rate Prior (Pattern 10)

```argdown
[Base Rate]: Historical energy transitions take 50-70 years. #prior #observation
  {reason: "Smil 2010 data", credence: 0.80, role: "prior", base_rate: 0.04}
  +> [Slow Transition]

<Upward Update>
(1) [New Signal]: Private fusion investment 10x in 5 years. #observation
    {reason: "documented but novel", credence: 0.75}
----
(2) [Faster Than Base]: Update toward faster transition.
    {reason: "investment != deployment", inference: 0.60, role: "update", direction: "up", magnitude: 1.5}
  +> [Fast Transition]
```

### Ensemble Mode

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

### Common Mistakes

| Mistake                              | Fix                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `{credence: X, reason: "..."}` order | `{reason: "...", credence: X}` -- reason first, then number              |
| `{credence: X}` on a conclusion      | `{inference: X}` -- credence is computed                                  |
| `{credence: X}` on top-level claim   | Remove -- computed via log-odds                                           |
| Unnamed conclusion `(3) Some text.`  | `(3) [Name]: Some text.`                                                  |
| No URL on `#observation`             | Every observation needs `[Label](url)`                                    |
| Blockquote is vague or a paper title | Find a specific declarative finding                                       |
| Paraphrasing in blockquote           | Use exact text; if paraphrasing: `> "paraphrase: ..."` and lower credence |
| Multi-sentence inference             | Split into sub-arguments (Pattern 5)                                      |
| Missing `{reason: "..."}`            | Always explain why this number, before the number                         |
| `[...]` in blockquotes               | Use `(...)` instead -- parser treats `[x]` as statement refs              |
| Using `><` for contradiction         | Use mutual `- [other]` contraries (see Pattern 4)                         |
