// Sem janela de console extra no Windows em release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `ideario --mcp`: o Claude conversa com o app pelo MCP (stdin/stdout), sem abrir a janela.
    if std::env::args().skip(1).any(|a| a == "--mcp") {
        std::process::exit(ideario_lib::mcp_serve());
    }
    ideario_lib::run()
}
