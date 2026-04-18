const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const tests = process.argv.includes("--tests");

const baseOptions = {
  bundle: true,
  format: "cjs",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: "node",
  external: ["vscode"],
  logLevel: production ? "silent" : "info",
  target: "node18",
};

const extensionBuild = {
  ...baseOptions,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
};

// Test bundle: compile the mocha runner + test suites. Mocha itself is
// resolved at runtime from node_modules, so mark it external to avoid
// bundling the framework into our test files.
const testsBuild = {
  ...baseOptions,
  entryPoints: ["src/test/runTest.ts", "src/test/suite/index.ts", "src/test/suite/e2e.test.ts"],
  outdir: "dist/test",
  external: ["vscode", "mocha", "@vscode/test-electron"],
};

async function main() {
  const configs = tests ? [testsBuild] : [extensionBuild];
  const ctxs = await Promise.all(configs.map((c) => esbuild.context(c)));
  if (watch) {
    await Promise.all(ctxs.map((c) => c.watch()));
  } else {
    await Promise.all(ctxs.map((c) => c.rebuild()));
    await Promise.all(ctxs.map((c) => c.dispose()));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
