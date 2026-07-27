use zed_extension_api::{self as zed, Result};

struct SkillLanguageServerExtension;

impl zed::Extension for SkillLanguageServerExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let command = worktree.which("skill-language-server").ok_or_else(|| {
            "skill-language-server not found on PATH — install it with `npm install -g skill-language-server` (or `just bin` from a repo checkout)".to_string()
        })?;
        Ok(zed::Command {
            command,
            args: vec!["--stdio".to_string()],
            env: vec![],
        })
    }
}

zed::register_extension!(SkillLanguageServerExtension);
