import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "uploads/**", ".refresh-publish/**", "create-ridhuanbackendtemplate/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      // Underscore marks parameters required by a signature (Express handlers, policy hooks) but unused.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["tests/**/*.mjs", "scripts/**/*.mjs", "*.js"],
    languageOptions: { globals: { process: "readonly", console: "readonly", fetch: "readonly", Buffer: "readonly", TextDecoder: "readonly", URL: "readonly", AbortController: "readonly", setTimeout: "readonly", clearTimeout: "readonly" } },
  },
);
