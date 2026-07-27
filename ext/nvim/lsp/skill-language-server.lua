-- Neovim 0.11+ language server config, auto-discovered from runtimepath.
-- Requires the `skill-language-server` binary on PATH (see `just bin`).
return {
  cmd = { "skill-language-server", "--stdio" },
  filetypes = { "markdown" },
  root_markers = { ".claude", ".git" },
}
