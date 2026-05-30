import re
import os

files_to_resolve = [
    "apps/server/src/app.ts",
    "apps/server/src/config/env.ts",
    "apps/server/src/shared/analytics/posthog.ts",
    "apps/server/src/shared/middleware/error-handler.ts",
    "apps/server/src/shared/queue.ts",
    "apps/server/src/workers/index.ts",
    "phase4.md"
]

for fp in files_to_resolve:
    with open(fp, 'r') as f:
        content = f.read()

    # Find the blocks
    pattern = re.compile(r'<<<<<<< HEAD(.*?)=======(.*?)>>>>>>> main', re.DOTALL)
    
    # We will replace it with \1 + \2
    new_content = pattern.sub(r'\1\2', content)

    with open(fp, 'w') as f:
        f.write(new_content)
    os.system(f"git add {fp}")

