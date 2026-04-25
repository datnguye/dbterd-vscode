import * as path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // node-only — these tests cover pure helpers (no VS Code, no electron).
    // The e2e suite is mocha + @vscode/test-electron and lives at
    // src/test/suite/e2e.test.ts; vitest skips it explicitly.
    environment: "node",
    // Unit tests live outside src/ so esbuild's bundle (and the .vsix) never
    // includes them. The mocha-based e2e suite still lives at src/test/suite/.
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist", "src/test/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/extension.ts", // requires VS Code activation context
        "src/test/**",
      ],
    },
  },
});
