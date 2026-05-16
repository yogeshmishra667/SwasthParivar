#!/usr/bin/env bash
# Scaffolds a new server module under apps/server/src/modules/<name>/
# following the CLAUDE.md module pattern: controller, service, routes,
# validation, types. Idempotent — refuses to clobber an existing module.
#
# Usage: pnpm new-module <name>
#   e.g. pnpm new-module appointments
set -eu

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "Usage: pnpm new-module <name>" >&2
  exit 2
fi

# Slug guard — same set the rest of the codebase uses for module folders.
if ! printf '%s' "$NAME" | grep -Eq '^[a-z][a-z0-9-]*$'; then
  echo "Module name must be lowercase letters / digits / hyphens, starting with a letter." >&2
  echo "Got: $NAME" >&2
  exit 2
fi

DIR="apps/server/src/modules/$NAME"
if [ -d "$DIR" ]; then
  echo "Module already exists: $DIR" >&2
  exit 1
fi

# Portable transforms (work on bash 3.2 / macOS):
#   PascalName — first-char upper, kebab→camel ("med-reminder" → "MedReminder")
#   snakeName  — hyphens become underscores ("med-reminder" → "med_reminder")
PascalName=$(printf '%s' "$NAME" | awk -F- '{ for(i=1;i<=NF;i++){ $i=toupper(substr($i,1,1)) substr($i,2) } } 1' OFS='')
snakeName=$(printf '%s' "$NAME" | tr '-' '_')

mkdir -p "$DIR"

cat > "$DIR/$NAME.types.ts" <<TS
// Shared types for the $NAME module. Keep these narrow — broad shared
// types belong in packages/shared-types.

export interface ${PascalName}Stub {
  id: string;
}
TS

cat > "$DIR/$NAME.validation.ts" <<TS
import { z } from "zod";

// Per-route Zod schemas. Controller MUST parse req.body / req.query /
// req.params through one of these before reaching the service.

export const create${PascalName}Schema = z.object({
  // TODO: replace with real fields
  placeholder: z.string().min(1),
});
TS

cat > "$DIR/$NAME.service.ts" <<TS
// Business logic for the $NAME module. No Express types here.

export const list${PascalName} = async (): Promise<unknown[]> => {
  return [];
};
TS

cat > "$DIR/$NAME.controller.ts" <<TS
import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import * as service from "./$NAME.service.js";

export const list = async (_req: Request, res: Response): Promise<void> => {
  const items = await service.list${PascalName}();
  ok(res, { items });
};
TS

cat > "$DIR/$NAME.routes.ts" <<TS
import { Router } from "express";
import { requireAuth } from "../../shared/auth/middleware.js";
import * as ctrl from "./$NAME.controller.js";

export const ${snakeName}Router = Router();

${snakeName}Router.use(requireAuth);
${snakeName}Router.get("/", ctrl.list);
TS

# Optional jobs file — only created when the module obviously needs a
# queue. Skip by default; add it manually if/when needed.

echo "✅ Created $DIR with 5 files"
echo
echo "Next steps:"
echo "  1. Mount the router in apps/server/src/app.ts:"
echo "       import { ${NAME//-/_}Router } from \"./modules/$NAME/$NAME.routes.js\";"
echo "       app.use(\"/api/v1/$NAME\", ${NAME//-/_}Router);"
echo "  2. Replace the placeholder validation schema."
echo "  3. Add an integration test in apps/server/tests/integration/$NAME.test.ts."
echo "  4. Confirm scope matches the current CLAUDE.md phase before shipping."
