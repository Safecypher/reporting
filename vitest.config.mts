import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Minimal Vitest config enabling the `@/*` path alias every source file in
 * this codebase already uses (tsconfig.json `paths`). Without this, Vitest
 * cannot resolve an `@/...` import at runtime -- previously unnoticed
 * because every existing test subject only ever used `@/` in a type-only
 * import (erased by TypeScript before Vitest sees it). Plan 06-10 is the
 * first to unit-test a real Server Action (`saveAlignmentSettings`), whose
 * own `@/lib/supabase/server` import is a runtime value import and fails to
 * resolve without this alias.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
});
