use std::{env, fs};
use zed_extension_api::{self as zed, Result};

const PACKAGE_NAME: &str = "skill-language-server";
const SERVER_SCRIPT: &str = "node_modules/skill-language-server/dist/main.cjs";

struct SkillLanguageServerExtension {
    did_find_server: bool,
}

impl SkillLanguageServerExtension {
    fn server_exists(&self) -> bool {
        fs::metadata(SERVER_SCRIPT).is_ok_and(|stat| stat.is_file())
    }

    fn server_script_path(&mut self, language_server_id: &zed::LanguageServerId) -> Result<String> {
        let server_exists = self.server_exists();
        if self.did_find_server && server_exists {
            return Ok(SERVER_SCRIPT.to_string());
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );
        let latest_version = zed::npm_package_latest_version(PACKAGE_NAME)?;

        if !server_exists
            || zed::npm_package_installed_version(PACKAGE_NAME)?.as_deref()
                != Some(latest_version.as_str())
        {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            match zed::npm_install_package(PACKAGE_NAME, &latest_version) {
                Ok(()) => {
                    if !self.server_exists() {
                        Err(format!(
                            "installed package '{PACKAGE_NAME}' did not contain expected path '{SERVER_SCRIPT}'"
                        ))?;
                    }
                }
                // A failed update is fine as long as a previous install still exists.
                Err(error) => {
                    if !self.server_exists() {
                        Err(error)?;
                    }
                }
            }
        }

        self.did_find_server = true;
        Ok(SERVER_SCRIPT.to_string())
    }
}

impl zed::Extension for SkillLanguageServerExtension {
    fn new() -> Self {
        Self {
            did_find_server: false,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // A binary on PATH (e.g. installed via `just bin`) wins over the npm auto-install.
        if let Some(command) = worktree.which("skill-language-server") {
            return Ok(zed::Command {
                command,
                args: vec!["--stdio".to_string()],
                env: vec![],
            });
        }

        let server_path = self.server_script_path(language_server_id)?;
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                env::current_dir()
                    .unwrap()
                    .join(server_path)
                    .to_string_lossy()
                    .to_string(),
                "--stdio".to_string(),
            ],
            env: vec![],
        })
    }
}

zed::register_extension!(SkillLanguageServerExtension);
