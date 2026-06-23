import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Test runner config. Default environment is node (server + lib tests);
// component tests opt into jsdom with a `// @vitest-environment jsdom`
// docblock at the top of the file.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx,mjs,js,jsx}"],
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "json-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx,js,jsx}", "server/**/*.mjs"],
      exclude: ["**/*.d.ts", "tests/**"],
      all: true,
    },
  },
});
