// Mobile test harness — Jest + jest-expo (Expo SDK 54 / React 19 / RN 0.81).
// Component tests use React Native Testing Library (v13).
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    // Mirror the `@/*` -> `src/*` alias from tsconfig + babel module-resolver.
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["<rootDir>/__tests__/**/*.test.{ts,tsx}"],
};
