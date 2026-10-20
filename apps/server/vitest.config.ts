import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Aliases pointing at workspace package SOURCES, not dist. Production
// builds resolve via package.json `main` (which now points at dist)
// — tests skip that roundtrip so editing a package's src is picked up
// immediately by vitest --watch without a build step.
const workspaceAliases = {
  "@swasth/shared-types": resolve(__dirname, "../../packages/shared-types/src/index.ts"),
  // Subpath alias must precede the bare package alias (first match wins).
  "@swasth/domain-logic/subscription-state": resolve(
    __dirname,
    "../../packages/domain-logic/src/subscription-state/index.ts",
  ),
  "@swasth/domain-logic": resolve(__dirname, "../../packages/domain-logic/src/index.ts"),
  "@swasth/test-factories": resolve(__dirname, "../../packages/test-factories/src/index.ts"),
};

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    name: "server-unit",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
  },
});
