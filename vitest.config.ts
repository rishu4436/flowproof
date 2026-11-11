import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/core/src/**/*.test.ts",
      "packages/ai/src/**/*.test.ts",
      "apps/demo-portal/src/**/*.test.ts",
      "apps/worker/src/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
