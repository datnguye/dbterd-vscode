import * as path from "path";

import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  // The folder containing the extension's package.json (the "development" extension).
  const extensionDevelopmentPath = path.resolve(__dirname, "../../");
  // The compiled mocha runner. esbuild emits dist/test/suite/index.js from src/test/suite/index.ts.
  const extensionTestsPath = path.resolve(__dirname, "./suite/index.js");
  // Open the jaffle-shop fixture as the active workspace so dbt_project.yml
  // discovery (and any workspaceFolder-relative settings) behave like the real user flow.
  const fixtureWorkspace = path.resolve(
    extensionDevelopmentPath,
    "src/test/fixtures/jaffle-shop",
  );

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        fixtureWorkspace,
        // Keep test runs hermetic — no user extensions, no telemetry prompts.
        "--disable-extensions",
        "--disable-workspace-trust",
      ],
    });
  } catch (err) {
    console.error("Failed to run tests:", err);
    process.exit(1);
  }
}

void main();
