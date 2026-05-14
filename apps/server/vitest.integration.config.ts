import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Same source-aliasing rationale as vitest.config.ts.
const workspaceAliases = {
  "@swasth/shared-types": resolve(__dirname, "../../packages/shared-types/src/index.ts"),
  "@swasth/domain-logic": resolve(__dirname, "../../packages/domain-logic/src/index.ts"),
  "@swasth/test-factories": resolve(__dirname, "../../packages/test-factories/src/index.ts"),
};

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    name: "server-integration",
    environment: "node",
    include: ["src/**/*.integration.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
