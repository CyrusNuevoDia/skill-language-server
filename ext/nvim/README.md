# skill-lsp for Neovim (0.11+)

Install the server binary first: `npm install -g skill-language-server` (or, from a repo clone, `just bin`) — either way `skill-lsp` ends up on your PATH.

With lazy.nvim:

```lua
{ dir = "/path/to/skill-lsp/ext/nvim" }
```

Or without a plugin manager: copy `lsp/skill-lsp.lua` into `~/.config/nvim/lsp/`
and add `vim.lsp.enable("skill-lsp")` to your init.lua.

Note: Neovim applies the folder rename in `textDocument/rename` responses, but
does not send `workspace/willRenameFiles` — renaming a skill folder in a file
explorer plugin won't rewrite references; rename from the `name:` value or a
reference token instead.
