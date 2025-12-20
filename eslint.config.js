import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  eslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        console: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        crypto: "readonly",
        TextEncoder: "readonly",
        D1Database: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Map: "readonly",
        Date: "readonly",
        Math: "readonly",
        Promise: "readonly",
        Error: "readonly",
        btoa: "readonly",
        atob: "readonly",
        WebSocketPair: "readonly",
        RequestInit: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // TypeScript specific
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",

      // General
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-unused-vars": "off", // Use TypeScript's version
      "prefer-const": "error",
      "no-var": "error",
      "eqeqeq": ["error", "always"],
    },
  },
  {
    ignores: ["node_modules/", "dist/", ".wrangler/", "drizzle/", "migrations/"],
  },
];
