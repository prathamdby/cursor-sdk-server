import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const fixture = join(dirname(fileURLToPath(import.meta.url)), "helpers/process-guards-fixture.ts");

function runFixture(mode: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", [fixture, mode], {
    encoding: "utf8",
    timeout: 5000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const benignRejection = runFixture("benign-rejection");
expect(benignRejection.status === 0, "benign unhandledRejection should not exit");
expect(
  benignRejection.stderr.includes("ignored benign connectrpc stream error"),
  "benign unhandledRejection should be logged",
);
expect(
  benignRejection.stdout.includes("still alive"),
  "process should stay alive after benign rejection",
);

const benignException = runFixture("benign-exception");
expect(benignException.status === 0, "benign uncaughtException should not exit");
expect(
  benignException.stderr.includes("ignored benign connectrpc stream error"),
  "benign uncaughtException should be logged",
);

const fatalRejection = runFixture("fatal-rejection");
expect(fatalRejection.status === 1, "non-benign unhandledRejection should exit with code 1");
expect(
  fatalRejection.stderr.includes("fatal unhandledRejection"),
  "non-benign unhandledRejection should be logged as fatal",
);

const fatalException = runFixture("fatal-exception");
expect(fatalException.status === 1, "non-benign uncaughtException should exit with code 1");
expect(
  fatalException.stderr.includes("fatal uncaughtException"),
  "non-benign uncaughtException should be logged as fatal",
);

console.log("process-guards tests passed");
