# Dev Workflow

How to develop and test changes to vargdown (the SKILL.md format, verify.mjs verifier, etc.).

## Cycle

```
make change -> test with sub-agent -> review output -> address feedback -> commit
```

### 1. Make a change

Edit SKILL.md (format/principles), verify.mjs (verifier), or supporting files.

### 2. Test with a sub-agent

Spawn a sub-agent that acts as a naive user of the skill. The sub-agent should:

1. Read SKILL.md (the skill it's following)
2. Find the source URLs listed in the test task and download them to `examples/evidence/*.md` with headers:
   - `Source: <url>`
   - `Title: <title>`
   - blank line, then full markdown body (verbatim conversion)
3. Construct a `.argdown` argument map following the skill, using quotes from the evidence files
4. Run `npx @argdown/cli json examples/<stem>.argdown examples` then `node verify.mjs examples/<stem>.json --verify-only`
5. Report back: did the skill guide it correctly? What was confusing? What errors did the verifier catch vs miss?

Example sub-agent prompt:

```
You are testing the vargdown skill. Do NOT use HumanAgent MCP or contact the user directly.

1. Read SKILL.md for the format rules.
2. Download the sources listed in the task into `examples/evidence/*.md` (with Source/Title headers).
3. Write an argument map to examples/test_output.argdown following SKILL.md.
   The thesis should be: [your thesis here].
4. Run: npx @argdown/cli json examples/test_output.argdown examples
5. Run: node verify.mjs examples/test_output.json --verify-only
6. Fix any errors the verifier reports. Re-run until clean.
7. Run: node verify.mjs examples/test_output.json examples/test_output_verified.html
8. Report back to me:
   - Was the SKILL.md clear enough to follow without guessing?
   - What parts were confusing or ambiguous?
   - What errors did you hit and were the error messages helpful?
   - Did the verifier catch real problems or miss any?
   - Paste the final .argdown content.
```

### 3. Review

Check the sub-agent's output:
- Did it follow reason-before-credence ordering?
- Are observations properly sourced with exact quotes?
- Did it avoid common mistakes (credence on conclusions, unnamed conclusions, etc.)?
- Does the computed bottom line make sense?

If the sub-agent was confused by something, that's a signal SKILL.md needs clarifying.

### 4. Address feedback

Fix whatever the sub-agent flagged. If SKILL.md was ambiguous, make it precise. If the verifier missed something, fix verify.mjs. Then re-run the test.

### 5. Commit

```bash
npx @argdown/cli json examples/example.argdown examples
node verify.mjs examples/example.json examples/example_verified.html
git add -A && git commit
```

## Test sources

Put markdown files in `test_sources/<topic>/` with raw content for the sub-agent to argue about. Each topic folder should contain:
- Source files (`.md`) with exact quotes, URLs, and study details
- A `TASK.md` with thesis, source list, and step-by-step instructions

### Current test topics

| Topic | Folder | Thesis |
|---|---|---|
| Creatine & cognition | `test_sources/creatine_cognition/` | Does creatine supplementation improve cognitive performance? |

### Running a test

```bash
# 1. Spawn a sub-agent with this prompt (adapt topic folder and thesis):
#    "Read SKILL.md, then read all files in test_sources/creatine_cognition/,
#     then follow test_sources/creatine_cognition/TASK.md.
#     Report findings back to me. Do not use HumanAgent MCP."
#
# 2. Review the sub-agent's output against the checklist:
#    - reason-before-credence ordering?
#    - #observation has URL + exact quote?
#    - conclusions use {inference:} not {credence:}?
#    - top-level claim has NO hardcoded credence?
#    - all conclusions named: (N) [Name]: text?
#    - verifier ran clean?
#    - computed bottom line is plausible?
#
# 3. If SKILL.md was ambiguous, fix it. If verifier missed something, fix verify.mjs.
# 4. Re-run until the sub-agent produces clean output on first or second try.
```

### Adding a new test topic

1. Create `test_sources/<topic>/` with source `.md` files (exact quotes + URLs)
2. Write `test_sources/<topic>/TASK.md` following the creatine example
3. Run the test, review, iterate
