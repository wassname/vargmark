# Argdown Syntax Reference

## Statements

```argdown
// Untitled statement
The earth is round.

// Titled statement (creates equivalence class)
[Earth Shape]: The earth is round.

// Reference existing statement by title
[Earth Shape]

// Mention without creating relation
The argument about @[Earth Shape] is well-supported.
```

Statements with the same `[Title]` belong to the same equivalence class and are treated as logically equivalent. This is how you share premises/conclusions across arguments.

## Arguments

```argdown
// Sketched argument (title + description)
<Teleological Proof>: The world is intelligently designed,
therefore an intelligent creator must exist.

// Reference
<Teleological Proof>

// Mention without relation
I disagree with @<Teleological Proof>.
```

Argument descriptions are NOT statements. They sketch the argument's drift without formal structure.

## Relations

### Symbols

| Symbol | Meaning | Direction |
|--------|---------|-----------|
| `+` | Support | Backward (default) |
| `-` | Attack | Backward (default) |
| `_` | Undercut | Backward (default) |
| `+>` | Support | Forward |
| `->` | Attack | Forward |
| `_>` | Undercut | Forward |
| `<+` | Support | Explicit backward |
| `<-` | Attack | Explicit backward |
| `<_` | Undercut | Explicit backward |

Undercut attacks the *inference step* rather than a premise or conclusion.

### Examples

```argdown
[Claim]
  + <Pro Argument>           // Pro supports Claim
  - <Con Argument>           // Con attacks Claim
    + <Defense>              // Defense supports Con (nested)
    - <Rebuttal>             // Rebuttal attacks Con
  _> <Undercut target>       // Claim undercuts target's inference

// Strict mode relations (enable via config)
[A]
  >< [B]    // contradiction
  + [C]     // entailment (strict)
  - [D]     // contrary (strict)
```

## Premise-Conclusion Structures (PCS)

### Collapsed inference (simple)

```argdown
<Simple Argument>

(1) All humans are mortal.
(2) Socrates is human.
----
(3) Socrates is mortal.
```

Minimum 4 hyphens. Last statement is main conclusion.

### Expanded inference (with rules/metadata)

```argdown
<Detailed Argument>

(1) All humans are mortal.
(2) Socrates is human.
--
Universal instantiation, Modus Ponens {uses: [1,2], logic: ["deductive"]}
--
(3) Socrates is mortal.
```

2 hyphens open/close. Between them: inference rule names and optional YAML metadata.

### PCS with references and relations

```argdown
<Argument A>

(1) [Shared Premise]: All X are Y.
(2) Z is X.
----
(3) [Shared Conclusion]: Z is Y.
  +> <Another Argument>   // conclusion supports another argument
  -> [Counter Claim]      // conclusion attacks a claim
```

PCS statements can have titles (linking to equivalence classes), tags, metadata, mentions.

### Multi-step inference

```argdown
<Complex Argument>

(1) Premise A.
(2) Premise B.
----
(3) Intermediate conclusion.    // also a premise for next step
(4) Additional premise.
----
(5) Final conclusion.
```

## Headings and Groups

```argdown
# Top Level

## Sub Section #tag {isGroup: true}

### Nested Group

[Statements inside headings are grouped in the map]
```

`{isGroup: true}` makes the heading a visual group box in the argument map.

## Tags

```argdown
[Statement]: Text. #simple-tag #(tag with spaces)

<Argument>: Description. #methodology

# Heading #section-tag
```

Tags colorize nodes in the argument map.

## Metadata (YAML)

### Inline

```argdown
[Claim]: Statement text. {source: "Paper 2024", confidence: 0.8}
```

### Block

```argdown
[Claim]: Statement text.
{
  sources:
    - Author 2024
    - Author 2023
  confidence: high
  page: 42
}
```

### On arguments

```argdown
<Argument> {
  links:
    - https://example.com
  formalization: "propositional logic"
}
```

### On inferences

```argdown
----
Rule Name {uses: [1,2], strength: "deductive"}
----
```

## Frontmatter

```argdown
===
title: My Debate Map
author: Author Name
date: 2025-01-15
subTitle: An analysis of X
abstract: >
  This document reconstructs the debate about X.

// Map display settings
map:
  statementLabelMode: text       // or "title", "hide-untitled"
  argumentLabelMode: title       // or "description", "hide-untitled"
  groupDepth: 2                  // heading nesting depth for groups

// Model settings
model:
  mode: loose                    // "loose" (default) or "strict"

// Color settings
color:
  colorScheme: colorbrewer-set3
  tagColors:
    pro: "#4CAF50"
    con: "#f44336"
===
```

## Comments

```argdown
// Single line comment

/* Multi-line
   comment */

<!-- HTML-style
     comment -->

<Argument>: Text <!-- inline comment --> more text.
```

## Logic Symbols

| Shortcode | Symbol | Meaning |
|-----------|--------|---------|
| `.~.` | NOT | Negation |
| `.^.` | AND | Conjunction |
| `.v.` | OR | Disjunction |
| `.->. ` | IMPLIES | Material conditional |
| `.<->.` | IFF | Biconditional |

```argdown
[De Morgan]: .~.(p .^. q) .<->. (.~.p) .v. (.~.q)
```

## Lists

```argdown
// Unordered
* [Point 1]: First point.
* [Point 2]: Second point.

// Ordered
1. [Step 1]: Do this first.
2. [Step 2]: Then this.
```

Note: PCS uses `(1)` parentheses, not `1.` periods.

## Links

```argdown
// External
[See this paper](https://arxiv.org/abs/1234.5678)

// Internal cross-references
[Jump to heading](#heading-section-name)
[See statement](#statement-statement-title)
[See argument](#argument-argument-title)
```

## Complete Example

```argdown
===
title: Should We Adopt Sparse Autoencoders for Interpretability?
author: Research Group
map:
  statementLabelMode: text
  argumentLabelMode: title
color:
  tagColors:
    pro: "#4CAF50"
    con: "#f44336"
    method: "#2196F3"
===

# The Debate

[Main Claim]: Sparse autoencoders (SAEs) are currently the best
method for extracting interpretable features from neural networks. #method

## Arguments For

<Monosemanticity>: SAEs produce monosemantic features
that correspond to human-interpretable concepts. #pro
  + [Main Claim]

<Scalability>: SAEs scale to large models (GPT-4 class)
without architectural changes. #pro
  + [Main Claim]

## Arguments Against

<Feature Splitting>: SAE features split arbitrarily
depending on dictionary size, undermining reliability. #con
  - [Main Claim]

<Completeness>: SAEs may miss features that don't
decompose linearly. #con
  - [Main Claim]
    + <Linear Representation>: The linear representation
      hypothesis is well-supported empirically.

## Detailed Reconstruction

<Monosemanticity>

(1) [Linear Features]: Neural network representations
contain linear directions corresponding to concepts.
(2) SAEs with L1 sparsity recover these directions as
dictionary elements.
----
(3) SAE features are monosemantic and interpretable.
  +> [Main Claim]

<Feature Splitting>

(1) The same concept splits into multiple SAE features
at different dictionary sizes.
(2) [Reliability Req]: A reliable method should give
consistent features across hyperparameters.
----
(3) SAEs fail the reliability requirement.
  -> [Main Claim]
  _> <Monosemanticity>
```
