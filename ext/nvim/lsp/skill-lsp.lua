-- Neovim 0.11+ language server config, auto-discovered from runtimepath.
-- Requires the `skill-lsp` binary on PATH (see `just bin`).
return {
  cmd = { "skill-lsp", "--stdio" },
  filetypes = { "markdown" },
  root_markers = { ".claude", ".git" },
}
