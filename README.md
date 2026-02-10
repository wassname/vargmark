
# Verified Argument Maps

Have your LLM ourput a structured argument, that is easy to verify.

![alt text](image-1.png)

## Example

```argdown
===
title: Are Linear Probes Reliable for Evaluating Representations?
author: Deep Research Agent
model:
    mode: strict
===

// Top-level claim: credence is computed from the arguments below
[Reliable]: Linear probes are a reliable method for evaluating
  neural network representations.
  + <Linear Separability>
  - <Probe Overfitting>

# Evidence For

<Linear Separability>

(1) [Monotonic]: Alain & Bengio 2016 train linear classifier probes
    on intermediate layers of Inception v3 and ResNet-50. #observation
    [Alain & Bengio 2016](https://arxiv.org/abs/1610.01644)
    > "we observe experimentally that the linear separability of features increase monotonically along the depth of the model"
    {reason: "4000+ citations, replicated across architectures", credence: 0.92}
(2) [Linearity Assumption]: If a property is linearly separable in
    a representation, it is likely encoded explicitly rather than
    requiring nonlinear computation to extract. #assumption
    {reason: "plausible but nonlinear features exist too", credence: 0.65}
--
Monotonic separability suggests probes track genuine feature quality
{uses: [1, 2]}
--
(3) [Probes Valid]: Linear probes reveal genuine structure in
    neural network representations.
    {inference: 0.92, reason: "direct implication if both premises hold"}
  +> [Reliable]

# Evidence Against

<Probe Overfitting>

(1) [Control Tasks]: Hewitt & Liang 2019 propose control tasks
    to test probe selectivity on ELMo representations. #observation
    [Hewitt & Liang 2019](https://arxiv.org/abs/1909.03368)
    > "popular probes on ELMo representations are not selective"
    {reason: "well-designed experiment, widely cited", credence: 0.90}
(2) [Limitations Survey]: Belinkov 2022 reviews the probing
    classifiers methodology. #observation
    [Belinkov 2022](https://arxiv.org/abs/2102.12452)
    > "recent studies have demonstrated various methodological limitations of this approach"
    {reason: "comprehensive survey but some claims are speculative", credence: 0.88}
--
High accuracy alone is insufficient evidence of encoding
{uses: [1, 2]}
--
(3) [Probes Mislead]: High probe accuracy may not reliably indicate
    that a representation genuinely encodes a property.
    {inference: 0.51, reason: "shows problems exist but doesn't prove probes are useless"}
  -> [Reliable]
```

### Verifier output

```
All checks passed.

Crux analysis:
  CRUX: [Probes Valid] (credence=0.55) has 1 downstream entailment(s). Changing this credence affects 1 other statement(s).

PCS inference strength:
  <Linear Separability>: [Probes Valid]
    premises: 0.92 * 0.65 = 0.598
    inference: 0.92
    computed credence: 0.598 * 0.92 = 0.55
  <Probe Overfitting>: [Probes Mislead]
    premises: 0.9 * 0.88 = 0.792
    inference: 0.51
    computed credence: 0.792 * 0.51 = 0.40

Bottom line:
  [Reliable] implied credence: 0.64 (+0.59 log-odds)
    + [Probes Valid] (0.55, +0.20 log-odds)
    - [Probes Mislead] (0.40, -0.39 log-odds)

Summary: 7 statements, 2 relations, 6 with credences
```

## Writing Arguments

For the procedural guide (principles, step-by-step, common mistakes), see the [skill file](../../.claude/skills/argdown/SKILL.md). That file is the single source of truth for how to write verified argument maps and is designed to be read by LLMs.

## Principles

1. **Every claim has a source you can click.** Observations link to a paper/URL and include a blockquote of raw text from the source. The premise text provides minimal context; the quote carries the factual weight. If a reader can't verify a premise in 10 seconds, the argument is not trustworthy.

2. **Separate observation from inference from conclusion.** Premises are either sourced facts (`#observation`) or flagged assumptions (`#assumption`). The inference between `--` lines is one sentence. This makes the human's job small: check each one-liner inference step.

3. **Commit to numbers, not vibes.** Premises get `{credence: X}` (how much you trust the source). Conclusions get `{inference: X}` (how strong the reasoning step is). The verifier computes conclusion credence = product(premise credences) * inference strength. Nothing derivable is hardcoded.

4. **The argument computes a bottom line.** Entailments and contraries propagate through the graph to produce an implied credence for the top-level claim. The reader gets a single number, not just a tree.

The relations have checkable probability constraints:

| Relation | Constraint | Meaning |
|---|---|---|
| A `+>` B (entails) | P(B) >= P(A) | If A is true, B must be true |
| A `->` B (contrary) | P(A) + P(B) <= 1 | A and B can't both be true |
| A `><` B (contradictory) | P(A) + P(B) = 1 | Exactly one is true |

## Use Cases

**Deep research.** An LLM does research and produces a structured argument where every fact links to a real paper with a real quote. The human clicks through to verify sources and reads each one-liner inference step. The verifier handles the mechanical checks (credence consistency, math, graph structure) and computes the bottom line.

**Scalable oversight.** An LLM generates an argument in Argdown format. The verifier automates everything it can. A human reviewer only checks the inference steps, which are forced to be short one-liners.

**Alignment via debate.** Two LLM agents argue opposing positions. The verifier identifies cruxes (highest credence disagreement), checks internal consistency, and verifies sources. A judge focuses on disputed inferences rather than re-reading everything.

## Quick Start

```bash
npm install -g @argdown/cli
just render   # parse, verify, render to HTML -- all in one
```

See [justfile](justfile) for all commands. Requires `uv` (for Python deps) and `just`.


The [skill file](../../.claude/skills/argdown/SKILL.md) is the procedural guide for writing arguments.

## References

- Argdown: https://argdown.org/syntax/
- Argdown strict mode: https://argdown.org/syntax/#relations-between-statements
- AI Safety via Debate: Irving et al. 2018 (https://arxiv.org/abs/1805.00899)
- Scalable oversight: Bowman et al. 2022 (https://arxiv.org/abs/2211.03540)
