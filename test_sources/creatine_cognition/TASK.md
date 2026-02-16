# Test Task: Creatine and Cognitive Performance

## Thesis

Does creatine supplementation improve cognitive performance in healthy adults?

## Source material

Use the following source URLs:
- https://pubmed.ncbi.nlm.nih.gov/29704637/ (Avgerinos 2018 systematic review)
- https://pubmed.ncbi.nlm.nih.gov/14561278/ (Rae 2003 RCT)
- https://pubmed.ncbi.nlm.nih.gov/31471173/ (Sandkuhler 2023 RCT)

## Instructions

1. Read `SKILL.md` for the format rules
2. Download each URL and save a full markdown conversion into `examples/evidence/*.md` with headers:
   - `Source: <url>`
   - `Title: <title>`
   - blank line, then full markdown body (verbatim conversion)
3. Write `examples/creatine.argdown` following SKILL.md
   - Top-level claim: `[Creatine Improves Cognition]`
   - Include at least 2 pro arguments (PCS blocks) and 1 con argument
   - Use exact quotes from the source files as blockquotes
   - Every `#observation` must have a URL and quote
   - Use `{reason: "...", credence: X}` (reason first!) on premises
   - Use `{reason: "...", inference: X}` on conclusions
   - NO credence on the top-level claim
4. Run: `npx @argdown/cli json examples/creatine.argdown examples`
5. Run: `node verify.mjs examples/creatine.json --verify-only`
6. Fix any errors. Re-run until clean.
7. Run: `node verify.mjs examples/creatine.json examples/creatine_verified.html`
8. Report back:
   - Final `.argdown` content
   - Verifier output (errors hit, how you fixed them)
   - Was SKILL.md clear enough? What was confusing?
   - What the computed bottom-line credence was
