# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**.

## File structure

Single-context repo:

```
/
├── AGENTS.md
├── CLAUDE.md
├── docs/adr/
│   ├── 0033-update-dialog-multiple-fixes.md
│   └── 0034-migrate-playwright-e2e-to-agent-browser.md
└── packages/
```

## Use the glossary's vocabulary

When your output names a domain concept, use the term as defined in `AGENTS.md`. Don't drift to synonyms.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding.
