# Test Task: Creatine and Cognitive Performance

## Thesis

Does creatine supplementation improve cognitive performance in healthy adults?

## Source material

Read all files in `test_sources/creatine_cognition/`:
- `avgerinos_2018.md` - systematic review of 6 RCTs (281 subjects)
- `rae_2003.md` - RCT in 45 vegetarians, strong positive result
- `sandkuhler_2023.md` - more recent RCT, null result in young omnivores
- `mechanism.md` - biological mechanism background

## Instructions

1. Read `SKILL.md` for the format rules
2. Read all source files in `test_sources/creatine_cognition/`
3. Write `examples/creatine.argdown` following SKILL.md
   - Top-level claim: `[Creatine Improves Cognition]`
   - Include at least 2 pro arguments (PCS blocks) and 1 con argument
   - Use exact quotes from the source files as blockquotes
   - Every `#observation` must have a URL and quote
   - Use `{reason: "...", credence: X}` (reason first!) on premises
   - Use `{reason: "...", inference: X}` on conclusions
   - NO credence on the top-level claim
4. Run: `just verify examples/creatine`
5. Fix any errors. Re-run until clean.
6. Run: `just render examples/creatine`
7. Report back:
   - Final `.argdown` content
   - Verifier output (errors hit, how you fixed them)
   - Was SKILL.md clear enough? What was confusing?
   - What the computed bottom-line credence was
