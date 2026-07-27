use zed_extension_api::{self as zed, Result};

struct SkillLspExtension;

impl zed::Extension for SkillLspExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let command = worktree.which("skill-lsp").ok_or_else(|| {
            "skill-lsp not found on PATH — run `just bin` and make sure ~/.local/bin is on your PATH".to_string()
        })?;
        Ok(zed::Command {
            command,
            args: vec!["--stdio".to_string()],
            env: vec![],
        })
    }
}

zed::register_extension!(SkillLspExtension);
