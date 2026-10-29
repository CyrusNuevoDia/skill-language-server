use std::{env, fs};
use zed_extension_api::{self as zed, Result};

const PACKAGE_NAME: &str = "skill-language-server";
const SERVER_SCRIPT: &str = "node_modules/skill-language-server/dist/main.cjs";

// None means the installed server is usable without a registry response.
fn registry_version(latest_version: Result<String>, server_exists: bool) -> Result<Option<String>> {
    match latest_version {
        Ok(version) => Ok(Some(version)),
        Err(_) if server_exists => Ok(None),
        Err(error) => Err(error),
    }
}

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
        if let Some(latest_version) =
            registry_version(zed::npm_package_latest_version(PACKAGE_NAME), server_exists)?
        {
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

#[cfg(test)]
mod tests {
    use super::registry_version;

    #[test]
    fn cached_server_survives_registry_failure() {
        assert_eq!(registry_version(Err("offline".into()), true), Ok(None));
    }

    #[test]
    fn missing_server_preserves_registry_error() {
        assert_eq!(
            registry_version(Err("offline".into()), false),
            Err("offline".into())
        );
    }

    #[test]
    fn successful_lookup_keeps_updates_enabled() {
        for server_exists in [false, true] {
            assert_eq!(
                registry_version(Ok("0.8.1".into()), server_exists),
                Ok(Some("0.8.1".into()))
            );
        }
    }
}
