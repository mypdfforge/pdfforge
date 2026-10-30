# Developer Instructions & Rules

## 1. Explicit Confirmation Before Any File Changes
- **ALWAYS** ask for user confirmation before modifying, creating, or deleting files in the codebase.
- Present the planned changes, wait for the user to explicitly approve or say "yes", and only then execute the edits.

## 2. Explicit Confirmation Before Git Actions
- **NEVER** run `git push`, `git commit`, or `git push --force` automatically.
- Only run git push or commit when the user explicitly instructs or confirms to push.
- When work is finished or tested, ask: *"Would you like me to commit and push these changes?"* and wait for confirmation.
