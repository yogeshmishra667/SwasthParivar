import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import security from "eslint-plugin-security";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/return-await": ["error", "always"],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true, allowBoolean: true }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "eqeqeq": ["error", "always", { null: "ignore" }],
    },
  },
  // React Hooks rules — applied to every React codebase in the workspace
  // (mobile + the admin console SPA).
  {
    files: ["apps/mobile/**/*.{ts,tsx}", "apps/admin/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // eslint-plugin-security — hand-picked high-signal subset. Two rules
  // in the recommended set (`detect-object-injection`,
  // `detect-non-literal-fs-filename`) are notoriously noisy on
  // template-string paths and are turned off here. Re-enable per-package
  // if a specific surface needs the extra rigor.
  //
  // Catches at lint time: eval-with-expression, ReDoS, weak RNG, timing
  // attacks on auth/OTP/JWT comparisons, child_process command injection,
  // bidi-character (Trojan Source) attacks.
  {
    plugins: { security },
    rules: {
      "security/detect-bidi-characters": "error",
      "security/detect-buffer-noassert": "error",
      "security/detect-child-process": "error",
      "security/detect-disable-mustache-escape": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-new-buffer": "error",
      "security/detect-no-csrf-before-method-override": "error",
      "security/detect-non-literal-regexp": "error",
      "security/detect-non-literal-require": "error",
      "security/detect-possible-timing-attacks": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-unsafe-regex": "error",
      // Off — noisy on legitimate `path.join(__dirname, …)` and template
      // paths in tests/scripts. Trivy + CodeQL cover the genuine risks.
      "security/detect-non-literal-fs-filename": "off",
      // Off — false-positive heavy on every `obj[key]` lookup. The TS
      // type system + lint already block unsafe `any` access; the
      // marginal signal here is not worth the suppress noise.
      "security/detect-object-injection": "off",
    },
  },
  // Scaffolds + scripts legitimately spawn child processes and read
  // dynamic file paths — that's their entire purpose. Don't lint
  // security rules against generators.
  {
    files: ["scripts/**/*.{mjs,js,ts}", "**/scaffold/**"],
    rules: {
      "security/detect-child-process": "off",
      "security/detect-non-literal-regexp": "off",
    },
  },
  // Test files: relax unsafe-any rules — supertest, vitest helpers, mocks
  // legitimately return `any`, and forcing typed shims everywhere adds
  // noise that hides real test bugs.
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/.expo/**",
      "**/coverage/**",
      "**/*.config.{js,mjs,cjs,ts}",
      "vitest.workspace.ts",
      "dangerfile.ts",
      ".claude/worktrees/**",
    ],
  },
];
