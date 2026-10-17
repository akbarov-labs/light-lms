import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([".next/**", "node_modules/**", "next-env.d.ts", ".claude/**", "backups/**", "src/generated/**"]),
  ...nextVitals,
  ...nextTs,
  {
    // eslint-plugin-react 7.37's "detect" calls context.getFilename(), removed in ESLint 10; keep in step with react
    settings: { react: { version: "19.3" } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // eslint-plugin-react-hooks 7 (eslint-config-next 16) adds React Compiler rules. The compiler is not
      // enabled here; keep the pre-16 rule set (rules-of-hooks + exhaustive-deps) until it is adopted.
      ...Object.fromEntries(
        ["static-components", "use-memo", "void-use-memo", "preserve-manual-memoization", "incompatible-library", "immutability", "globals", "refs", "set-state-in-effect", "error-boundaries", "purity", "set-state-in-render", "unsupported-syntax", "config", "gating"].map((r) => [`react-hooks/${r}`, "off"]),
      ),
    },
  },
]);
