// Mobile test harness — Jest + jest-expo (Expo SDK 54 / React 19 / RN 0.81).
// Component tests use React Native Testing Library (v13).
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    // Mirror the `@/*` -> `src/*` alias from tsconfig + babel module-resolver.
    "^@/(.*)$": "<rootDir>/src/$1",
    // Workspace package SOURCE (not its unbuilt dist), as the server's
    // vitest aliases do; its NodeNext `./x.js` imports map to `./x`.
    "^@swasth/shared-types$": "<rootDir>/../../packages/shared-types/src/index.ts",
    "^(\\.{1,2}/.+)\\.js$": "$1",
  },
  testMatch: ["<rootDir>/__tests__/**/*.test.{ts,tsx}"],
};
