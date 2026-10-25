import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  // esbuild-generated Edge bundle; lint its shared source instead. npm test
  // checks the exact generated output and source manifest for freshness.
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "supabase/functions/visit-payments/index.ts",
    ],
  },
  ...nextVitals,
  ...nextTypeScript,
];

export default eslintConfig;
