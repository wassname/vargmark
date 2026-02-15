# vargdown - Verified Argument Maps

Structured argument maps in Argdown strict mode with sourced quotes and computed credences. Every claim has a clickable source + exact quote. The verifier computes a bottom line credence via log-odds propagation.

Design principle: **proof travels with the claim**. The generator has context the judge lacks, so every citation must export enough information that verification is a lookup, not a search. Save source text to local `evidence/` files so verification uses frozen local copies, not live URLs that break.

## Install as agent skill

```bash
# OpenCode
ln -s /path/to/this/repo ~/.config/opencode/skills/vargdown

# Claude Code
ln -s /path/to/this/repo ~/.claude/skills/vargdown
```

The skill file ([SKILL.md](SKILL.md)) is the single source of truth for how agents write argument maps.

## Quick start

```bash
npm install -g @argdown/cli
just render examples/example   # parse, verify, render to HTML
```

Requires `uv` (Python deps), `just`, and `npx` (argdown CLI).

## How it works

1. Agent writes `.argdown` file following [SKILL.md](SKILL.md) format
2. `just render <stem>` runs: argdown CLI (parse to JSON) -> `argmap.py` (verify + render HTML)
3. Verifier checks: credence consistency, source attribution, inference math, graph structure
4. Output: HTML with colored cards, computed credences, and a bottom line number

See `examples/` for working argument maps.

## References

- [Argdown syntax](https://argdown.org/syntax/)
- [AI Safety via Debate](https://arxiv.org/abs/1805.00899) - Irving et al. 2018
- [Scalable oversight](https://arxiv.org/abs/2211.03540) - Bowman et al. 2022
