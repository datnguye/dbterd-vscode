/// <reference types="vitest" />
import * as path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
        assetFileNames: "index.[ext]",
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: false,
    // Tests live outside src/ so vite's production build never bundles them
    // and `dist/` (which gets rsync'd into the .vsix) stays test-free.
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
