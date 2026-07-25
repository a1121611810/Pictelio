<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

## OpenWiki 维护规则

- **AI Agent 在提交代码前**（尤其是修改了 `src/` 或 `packages/` 目录中的代码后），应主动执行 `pnpm openwiki:update` 更新文档。
- 如 `pnpm openwiki:update` 执行失败，不阻塞后续操作，但应在回复中提示用户。
- **禁止手动编辑** `openwiki/` 目录下的生成文件。如需更新文档内容，应修改源码后通过 `pnpm openwiki:update` 重新生成。
- pre-commit hook（Husky）也会在检测到源码变更时自动触发 `openwiki --update`，作为兜底机制。
