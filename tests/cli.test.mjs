import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function run(args, cwd) {
  return execFileAsync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

test("init scaffolds a self-validating starter project without overwriting by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ai-spend-guard-init-"));

  try {
    const initialized = await run(["init"], dir);
    assert.match(initialized.stdout, /created ai-spend-firewall\.config\.json/);
    assert.match(initialized.stdout, /created policy-tests\.json/);

    const config = JSON.parse(
      await readFile(join(dir, "ai-spend-firewall.config.json"), "utf8")
    );
    assert.equal(config.unknownEstimate, "deny");
    assert.deepEqual(config.requiredContext, ["provider", "resource"]);

    const doctor = await run(["doctor"], dir);
    assert.match(doctor.stdout, /AI Spend Guard doctor/);

    const policyTests = await run(
      ["test-policies", "--file", "policy-tests.json"],
      dir
    );
    assert.match(policyTests.stdout, /2 passed, 0 failed/);

    const plan = await run(["plan", "--file", "spend-plan.json"], dir);
    assert.match(plan.stdout, /starter worst-case workload/);

    await assert.rejects(
      () => run(["init"], dir),
      (error) => {
        assert.match(
          String(error.stderr || error.message),
          /Refusing to overwrite existing file/
        );
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
