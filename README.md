# vargdown - Verified Argument Maps

Structured argument maps where every claim has a clickable source + exact quote, and the bottom line is computed via log-odds, not asserted.

Goal: make it hard to the LLM to hallucinate, and easy for you to check.

- 1st pass: automatic verification with code
- 2nd pass: approximate verification by another agent (sub agent)
- 3rd pass: human, assisted by good UI

## Principles

**Machine-check what you can; make the rest judgeable at the right level.**

- **1a. Proof travels with the claim.** Every observation exports URL + exact quote + frozen local copy (`evidence/`). The judge never searches -- it's right there.
- **1b. Observations have sources; inferences have reasons.** Each step is one or the other, never mixed. Observations are checked against their source; inferences against reasoning and stated credence.
- **1c. Reason first, credence second; bottom line is computed, never stated.** State why before how-much. The top-level claim falls out of the math.

## Install as agent skill

```bash
# Claude Code / OpenCode
ln -s /path/to/this/repo ~/.claude/skills/vargdown
```

The skill file ([SKILL.md](SKILL.md)) is the single source of truth for how agents write argument maps.

## Quick start

```bash
npm install
npm install -g @argdown/cli
npx @argdown/cli json examples/example.argdown examples
node verify.mjs examples/example.json examples/example_verified.html
```

Requires `node` and `npx` (argdown CLI).

## How it works

0. Agent searches for information, and saves it to ./evicence/
1. Agent writes `.argdown` file following [SKILL.md](SKILL.md) format
2. Agent run verified.mjs
   1. Verifier checks: credence consistency, source attribution, inference math, graph structure
3. Subagent provides external check
4. Human checked
   1. Output: HTML with colored cards, computed credences, and a bottom line number

See `examples/` for working argument maps. See [AGENTS.md](AGENTS.md) for the dev workflow.

## References

- [Argdown syntax](https://argdown.org/syntax/)
- [AI Safety via Debate](https://arxiv.org/abs/1805.00899) - Irving et al. 2018
- [Scalable oversight](https://arxiv.org/abs/2211.03540) - Bowman et al. 2022
TODO are these really relevent, or aspirational?
