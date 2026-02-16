---
name: vargdown
description: Verified Argdown maps with credences and source quotes.
metadata: 
  - url: https://github.com/wassname/argument-formats
---

# Verified Argument Maps (v-argdown)

Structured argument maps where every claim has a clickable source + exact quote, premises get credences, conclusions get inference strengths, and the bottom line is computed, not asserted.

## Usage

0. Use URLs for sources. Fetch each URL with markitdown and save a full markdown copy into `evidence/`.
   - Command pattern: `markitdown {url} > evidence/{slug}.md`
   - Required headers at top of each evidence file:
     - `Source: <url>`
     - `Title: <title>`
     - blank line, then full markdown body (verbatim conversion)
1. Write `.argdown` file following the below format (block qoutes, and link to evidence/{slug}.md#{line})
2. Verify and fix errors until clean with verify.mjs
3. Have a sub-agent review it: check all links resolve, skeptically review all reasoning, inference values, and credence assignments
4. Render to HTML with colored cards and computed credences and ask human to review

```bash
npx @argdown/cli json <stem>.argdown "$(dirname <stem>)"
node verify.mjs <stem>.json --verify-only   # verify
node verify.mjs <stem>.json <stem>_verified.html  # render
```

## Principles

**Machine-check what you can; make the rest judgeable at the right level.**

The format lets machines verify the mechanical (quote matching, arithmetic, graph structure), weaker models verify the intermediate (inference plausibility, source relevance), and humans verify the cruxes -- each with minimal work per node.

**1a. Proof travels with the claim.**
Every observation exports URL + exact quote + frozen local copy. The judge never searches for evidence -- it's right there. The agent saves sources into `evidence/` so verification uses a frozen copy, not a live URL that may break or change.

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
  + <Structure Helps>
  - <Overhead Cost>

# Evidence For

<Structure Helps>

(1) [Arg Mapping]: Nesbit & Liu 2025 systematically reviewed 124
    studies on argument mapping in higher education. #observation
    [Nesbit & Liu 2025](https://doi.org/10.1111/hequ.70063)
    [evidence](evidence/nesbit_2025_argument_mapping.md#L9-L22)
    > This systematic review examines research on the use of argument maps or diagrams by postsecondary students. The goals were to identify the themes, research questions, and results of systematically identified studies, and to assess the current prospects for meta-analyses. Relevant databases were searched for qualitative, observational and experimental studies. We coded 124 studies on research design, mapping software, student attitudes, collaborative mapping and thinking skills. There were 102 empirical studies, of which 44% assessed student attitudes toward argument mapping, 40% investigated collaborative argument mapping and 51% examined the quality or structure of student-constructed argument maps. **The causal relationship most frequently investigated was the effect of argument mapping on critical thinking skills.** We present the results from selected studies and consider their significance for learning design.
    {reason: "systematic review of 124 studies, but effect sizes vary and meta-analysis still needed", credence: 0.70}
(2) [Hallucination Rate]: Safran & Cali 2025 find only 7.5% of
    LLM-generated references are fully accurate. #observation
    [Safran & Cali 2025](https://doi.org/10.38053/acmj.1746227)
    [evidence](evidence/safran_2025_hallucination.md#L134-L136)
    > **Only 7.5% of references were fully accurate in the initial generation, while 42.5% were completely fabricated.** The remaining 50% were partially correct. After verification, the proportion of fully accurate references rose to 77.5%. Wilcoxon signed-rank testing confirmed a statistically significant improvement in accuracy across all prompts (W=561.0, p<0.001, r=0.60). The most common errors included invalid DOIs, fabricated article titles, and mismatched metadata.
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

Output: `[Closes Gap]` implied credence ~73% (+0.99 log-odds; pro outweighs con for complex claims).

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
  - **`#observation`**: MUST have source URL link + markdown blockquote + `{reason, credence}`.
    - Quote style: include local context, not just a one-liner.
      - Default target: quote at least 3-5 sentences total around the key claim.
      - Include at least 1-2 sentences before and 1-2 after when available.
      - Bold only the key fragment inside that larger excerpt.
      - If the source only provides a single sentence (e.g., an abstract bullet), add a short comment explaining why no wider context exists.
    - Link style:
     - required: source URL link, e.g. `[Paper](https://...)`
     - recommended: local evidence link with line range, e.g. `[evidence](evidence/paper.md#L120-L136)`
  - The verifier matches quoted text against local `evidence/*.md`, then renders the matched paragraph with the key snippet bolded.
   - **Evidence file format**: one `evidence/*.md` per URL with headers:
     - `Source: <url>`
     - `Title: <title>`
     - blank line, then full markdown body (verbatim conversion)
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
    [evidence](evidence/shumailov_2024_model_collapse.md#L112-L116)
    > We discover that learning from data produced by other models causes **model collapse -- a degenerative process whereby, over time, models forget the true underlying data distribution,** even in the absence of a shift in the distribution over time. We give examples of model collapse for Gaussian Mixture Models (GMMs), Variational Autoencoders (VAE) and Large Language models (LLMs). We show that over time we start losing information about the true distribution, which first starts with tails disappearing, and over the generations learned behaviours start converging to a point estimate with very small variance.
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
[Risk Real]: AI catastrophe probability >= 5%. #assumption
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
(1) [GDP Hit]: Sanctions could cost 7% of GDP. #assumption
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
[Base Rate]: Historical energy transitions take 50-70 years. #prior #assumption
  {reason: "Smil 2010 data", credence: 0.80, role: "prior", base_rate: 0.04}
  +> [Slow Transition]

<Upward Update>
(1) [New Signal]: Private fusion investment 10x in 5 years. #assumption
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
| Blockquote is a single sentence only | Expand to surrounding context (target 3-5 sentences; 1-2 before/after)    |
| Paraphrasing in blockquote           | Use exact text; if paraphrasing: `> "paraphrase: ..."` and lower credence |
| Multi-sentence inference             | Split into sub-arguments (Pattern 5)                                      |
| Missing `{reason: "..."}`            | Always explain why this number, before the number                         |
| `[...]` in blockquotes               | Use `(...)` instead -- parser treats `[x]` as statement refs              |
| Using `><` for contradiction         | Use mutual `- [other]` contraries (see Pattern 4)                         |
