import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname);

/**
 * Run argdown CLI to parse .argdown -> .json, then run verify.mjs --verify-only.
 * Returns { exitCode, stdout, stderr } from the verifier.
 */
function verifyArgdown(argdownPath) {
  const dir = path.dirname(argdownPath);
  const stem = path.basename(argdownPath, ".argdown");
  const jsonPath = path.join(dir, stem + ".json");

  // Parse argdown -> JSON
  execSync(`npx --yes @argdown/cli json "${argdownPath}" "${dir}"`, {
    cwd: ROOT,
    stdio: "pipe",
  });
  assert.ok(fs.existsSync(jsonPath), `JSON not created: ${jsonPath}`);

  // Verify
  const out = execSync(
    `node verify.mjs "${jsonPath}" --verify-only`,
    { cwd: ROOT, stdio: "pipe" }
  ).toString();

  return out;
}

// --- SKILL.md main example ---
describe("SKILL.md example", () => {
  const tmpArgdown = path.join(ROOT, "test-skill-example.argdown");
  const tmpJson = path.join(ROOT, "test-skill-example.json");

  it("extracts and verifies", () => {
    const skill = fs.readFileSync(path.join(ROOT, "SKILL.md"), "utf8");
    const match = skill.match(/```argdown\n([\s\S]*?)\n```/);
    assert.ok(match, "No argdown block in SKILL.md");
    fs.writeFileSync(tmpArgdown, match[1]);
    const out = verifyArgdown(tmpArgdown);
    assert.match(out, /All checks passed/);
    // Cleanup
    fs.unlinkSync(tmpArgdown);
    fs.unlinkSync(tmpJson);
  });
});

// --- Test pattern files ---
describe("test_patterns/", () => {
  const patternDir = path.join(ROOT, "test_patterns");
  const files = fs.readdirSync(patternDir).filter((f) => f.endsWith(".argdown"));

  for (const file of files) {
    it(`${file} verifies`, () => {
      const out = verifyArgdown(path.join(patternDir, file));
      assert.match(out, /All checks passed/);
    });
  }
});

// --- Example files ---
describe("examples/", () => {
  const exDir = path.join(ROOT, "examples");
  const files = fs.readdirSync(exDir).filter((f) => f.endsWith(".argdown"));

  for (const file of files) {
    it(`${file} verifies`, () => {
      const out = verifyArgdown(path.join(exDir, file));
      assert.match(out, /All checks passed/);
    });
  }
});
