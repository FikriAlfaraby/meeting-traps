import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "test-results/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      eqeqeq: ["error", "always"],
      "no-implied-eval": "off",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
)
