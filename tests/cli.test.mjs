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


test("init budget flags generate scoped policies and required context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ai-spend-guard-guided-init-"));

  try {
    await run(
      [
        "init",
        "--daily", "7",
        "--monthly", "70",
        "--max-call", "0.75",
        "--max-concurrent", "12",
        "--per-user-daily", "1.5",
        "--per-project-monthly", "25"
      ],
      dir
    );

    const config = JSON.parse(
      await readFile(join(dir, "ai-spend-firewall.config.json"), "utf8")
    );

    const daily = config.policies.find(
      (policy) => policy.id === "global-daily-hard-cap"
    );
    const monthly = config.policies.find(
      (policy) => policy.id === "global-monthly-hard-cap"
    );
    const user = config.policies.find(
      (policy) => policy.id === "per-user-daily"
    );
    const project = config.policies.find(
      (policy) => policy.id === "per-project-monthly"
    );

    assert.equal(daily.limitUsd, 7);
    assert.equal(daily.maxOperationUsd, 0.75);
    assert.equal(daily.maxConcurrent, 12);
    assert.equal(monthly.limitUsd, 70);
    assert.equal(user.limitUsd, 1.5);
    assert.equal(project.limitUsd, 25);
    assert.ok(config.requiredContext.includes("userId"));
    assert.ok(config.requiredContext.includes("projectId"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
