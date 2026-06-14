import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    // Extension is a separate project with its own build
    "extension/**",
    // Per-site onboarding scratch workspaces. Not deployed, not type-checked
    // (see tsconfig.json `exclude` and .dockerignore). The files here are
    // exploratory probes/dryruns full of intentional `any`s and `require()`s.
    "sites/**",
  ]),
  {
    // CLI / ops scripts (committed tools, NOT shipped app code): the /addsite
    // batch + QA + audit helpers wrap untyped `fetch()` JSON responses and
    // dynamically-imported Playwright handles, so explicit `any` is pragmatic
    // here — the same rationale as the ignored `sites/**` probes. We keep the
    // rest of the ruleset on (unused-vars, prefer-const, etc.) so these stay
    // genuinely linted.
    files: ["scripts/**/*.{ts,mts,mjs}"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
]);

export default eslintConfig;
