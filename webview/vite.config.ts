/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
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
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
