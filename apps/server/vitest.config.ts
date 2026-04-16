import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "server-unit",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
  },
});
