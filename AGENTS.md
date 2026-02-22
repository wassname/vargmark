# Dev Workflow

How to develop and test changes to vargdown (the SKILL.md format, verify.mjs verifier, etc.).

## Cycle

```
make change -> npm test -> worker sub-agent -> review output -> address feedback -> commit
```

### 1. Make a change

Edit SKILL.md (format/principles), verify.mjs (verifier), or supporting files.

### 2. Run unit tests

```bash
npm install  # required on first use in a fresh worktree (node_modules not shared between worktrees)
npm test
```

This runs `test.mjs` (Node.js built-in `node:test`). It covers:

1. **SKILL.md example** -- extracts the argdown block from SKILL.md, parses it with the argdown CLI, and verifies it. Ensures the spec's own example stays valid.
2. **test_patterns/** -- one test per `.argdown` file in `test_patterns/`. Each pattern exercises a specific feature (undercut, contradiction, multi-step PCS, subquestion, conditional, correlated sources, base rate).
3. **examples/** -- one test per `.argdown` file in `examples/`. End-to-end examples produced by sub-agents or humans.

To add a new test pattern: create `test_patterns/<name>.argdown` with supporting evidence files (there's a symlink `test_patterns/evidence -> ../evidence`). It will be picked up automatically.

All tests must pass before committing.

### 3. Spawn a worker sub-agent to test the skill

Spawn a sub-agent that acts as a naive first-time user of SKILL.md. Its job is to stress-test whether the format and verifier work correctly -- not to produce an epistemically rigorous map.

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
8. Report back:
   - What parts of SKILL.md were confusing or required guessing?
   - What errors did you hit and were the error messages helpful?
   - Paste the final .argdown content.
```

### 4. Review

Check the sub-agent's output against SKILL.md. Focus on:
- Did the format guide it correctly or was anything ambiguous?
- Did the verifier catch real problems, or miss any?
- Does the sub-agent's output follow reason-before-credence, named conclusions, no credence on conclusions?

If SKILL.md was ambiguous, make it precise. If the verifier missed something, fix verify.mjs.

### 5. Address feedback and commit

```bash
npm test
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
