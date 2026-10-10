//! Ligar o Ideario ao Claude: Configurações → Claude (MCP). Registra o servidor no Claude Desktop (o arquivo de
//! configuração dele) e mostra o comando pronto para o Claude Code.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::store::Result;

/// Nome do servidor na configuração do Claude.
const NAME: &str = "ideario";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInfo {
    /// Programa que o Claude roda (este executável) e os argumentos.
    pub command: String,
    pub args: Vec<String>,
    /// Comando para registrar no Claude Code.
    pub claude_code: String,
    /// Arquivo de configuração do Claude Desktop.
    pub desktop_config: Option<String>,
    /// O Claude Desktop parece instalado (a pasta dele existe).
    pub desktop_found: bool,
    /// Já registrado no Claude Desktop, apontando para este executável.
    pub desktop_installed: bool,
}

/// Este executável. No Linux, o AppImage roda de uma pasta temporária: vale o caminho do próprio .AppImage.
fn command() -> Result<PathBuf> {
    if let Some(p) = std::env::var_os("APPIMAGE").filter(|p| !p.is_empty()) {
        return Ok(PathBuf::from(p));
    }
    std::env::current_exe().map_err(|e| e.to_string())
}

fn desktop_config() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("Claude").join("claude_desktop_config.json"))
}

fn quote(p: &str) -> String {
    format!("\"{}\"", p.replace('"', "\\\""))
}

pub fn info() -> Result<McpInfo> {
    let cmd = command()?.display().to_string();
    let config = desktop_config();
    Ok(McpInfo {
        claude_code: format!("claude mcp add --scope user {NAME} -- {} --mcp", quote(&cmd)),
        desktop_found: config.as_ref().and_then(|c| c.parent()).is_some_and(Path::exists),
        desktop_installed: config.as_ref().is_some_and(|c| installed(c, &cmd)),
        desktop_config: config.map(|c| c.display().to_string()),
        command: cmd,
        args: vec!["--mcp".into()],
    })
}

/// Lê a configuração do Claude Desktop (sem arquivo = vazia). Arquivo que não é JSON: erro, e não mexemos nele.
fn read(config: &Path) -> Result<Map<String, Value>> {
    match std::fs::read_to_string(config) {
        Ok(text) if text.trim().is_empty() => Ok(Map::new()),
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(o)) => Ok(o),
            _ => Err(format!("{} não é um JSON válido; não mexi nele", config.display())),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn write(config: &Path, o: Map<String, Value>) -> Result<()> {
    if let Some(dir) = config.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&Value::Object(o)).map_err(|e| e.to_string())? + "\n";
    // Grava ao lado e troca: o arquivo nunca fica pela metade.
    let tmp = config.with_extension("json.ideario-tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, config).map_err(|e| e.to_string())
}

pub fn installed(config: &Path, command: &str) -> bool {
    read(config).ok().and_then(|o| o.get("mcpServers")?.get(NAME)?.get("command")?.as_str().map(|c| c == command)).unwrap_or(false)
}

/// Põe (ou atualiza) o Ideario em `mcpServers`, sem mexer no resto da configuração.
pub fn install(config: &Path, command: &str) -> Result<()> {
    let mut o = read(config)?;
    let servers = o.entry("mcpServers").or_insert_with(|| json!({}));
    let Some(servers) = servers.as_object_mut() else { return Err("mcpServers não é um objeto; não mexi".into()) };
    servers.insert(NAME.into(), json!({ "command": command, "args": ["--mcp"] }));
    write(config, o)
}

pub fn uninstall(config: &Path) -> Result<()> {
    let mut o = read(config)?;
    if let Some(servers) = o.get_mut("mcpServers").and_then(Value::as_object_mut) {
        servers.remove(NAME);
    }
    write(config, o)
}

#[tauri::command]
pub fn mcp_info() -> Result<McpInfo> {
    info()
}

/// Registra no Claude Desktop (vale depois de reabrir o Claude).
#[tauri::command]
pub fn mcp_install() -> Result<McpInfo> {
    let config = desktop_config().ok_or("não achei a pasta de configuração do usuário")?;
    install(&config, &command()?.display().to_string())?;
    info()
}

#[tauri::command]
pub fn mcp_uninstall() -> Result<McpInfo> {
    let config = desktop_config().ok_or("não achei a pasta de configuração do usuário")?;
    uninstall(&config)?;
    info()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("ideario-mcp-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn install_keeps_the_rest_of_the_config() {
        let d = dir();
        let c = d.join("Claude").join("claude_desktop_config.json");
        // sem arquivo: cria
        install(&c, "/apps/ideario").unwrap();
        assert!(installed(&c, "/apps/ideario"));
        assert!(!installed(&c, "/outro/ideario"));
        // com outros servidores e chaves: ficam
        std::fs::write(&c, r#"{"theme":"dark","mcpServers":{"files":{"command":"npx","args":["x"]}}}"#).unwrap();
        install(&c, "/apps/ideario").unwrap();
        install(&c, "/apps/ideario").unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&c).unwrap()).unwrap();
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["mcpServers"]["files"]["command"], "npx");
        assert_eq!(v["mcpServers"]["ideario"], json!({"command": "/apps/ideario", "args": ["--mcp"]}));
        uninstall(&c).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&c).unwrap()).unwrap();
        assert!(v["mcpServers"].get("ideario").is_none());
        assert_eq!(v["mcpServers"]["files"]["command"], "npx");
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn broken_config_is_left_alone() {
        let d = dir();
        let c = d.join("claude_desktop_config.json");
        std::fs::write(&c, "{ isto não é json").unwrap();
        assert!(install(&c, "/apps/ideario").is_err());
        assert_eq!(std::fs::read_to_string(&c).unwrap(), "{ isto não é json");
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn claude_code_command_quotes_the_path() {
        let i = info().unwrap();
        assert!(i.claude_code.starts_with("claude mcp add --scope user ideario -- \""));
        assert!(i.claude_code.ends_with("\" --mcp"));
    }
}
