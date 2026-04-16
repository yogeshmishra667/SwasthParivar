import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "server-integration",
    environment: "node",
    include: ["src/**/*.integration.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
