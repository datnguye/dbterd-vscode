import * as path from "path";

import Mocha from "mocha";

export function run(): Promise<void> {
  const mocha = new Mocha({
    // "tdd" matches the suite/test/suiteSetup globals used by the test files;
    // VS Code's sample harness uses the same style.
    ui: "tdd",
    color: true,
    // VS Code's extension host is slow to boot and our tests spawn a Python
    // subprocess — 60s per test gives comfortable headroom.
    timeout: 60_000,
  });

  // esbuild emits each test suite as its own file in the same dist/test/suite/
  // directory — add them explicitly rather than globbing (the bundle is flat
  // and the entry points are known at build time).
  mocha.addFile(path.resolve(__dirname, "e2e.test.js"));

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
