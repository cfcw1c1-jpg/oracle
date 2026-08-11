// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // supabase/functions/** are Deno Edge Functions, a separate runtime
    // from the Expo app (different globals, remote esm.sh imports) -- not
    // part of this app's bundle or lint surface.
    ignores: ["dist/*", "supabase/functions/**"],
  }
]);
