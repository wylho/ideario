//! Fontes da área de trabalho, para a interface usar a mesma tipografia do sistema.
//!
//! Windows, macOS e Android resolvem `system-ui` no CSS para a fonte nativa. A WebKitGTK não:
//! ela cai no padrão do fontconfig e ignora a fonte escolhida no GNOME ou no KDE. Por isso, no
//! Linux, lemos a fonte do GTK (que o GNOME e o KDE preenchem) e entregamos à UI antes da primeira pintura.

use serde::Serialize;

#[derive(Debug, Default, Serialize)]
pub struct SystemFonts {
    /// Família da fonte da interface (ex.: "Ubuntu", "Cantarell", "Noto Sans").
    pub ui: Option<String>,
    /// Família da fonte monoespaçada.
    pub mono: Option<String>,
}

#[cfg(target_os = "linux")]
pub fn detect() -> SystemFonts {
    use gtk::gio;
    use gtk::prelude::*;

    // "Ubuntu 11", "Noto Sans, 10", "Cantarell Bold 11" → só a família.
    let family = |desc: &str| {
        gtk::pango::FontDescription::from_string(desc)
            .family()
            .map(|f| f.trim().to_string())
            .filter(|f| !f.is_empty())
    };
    let ui = gtk::Settings::default()
        .and_then(|s| s.gtk_font_name())
        .and_then(|name| family(&name));

    // A monoespaçada só existe nas configurações do GNOME; checar o esquema evita pânico em outros ambientes.
    const SCHEMA: &str = "org.gnome.desktop.interface";
    let mono = gio::SettingsSchemaSource::default()
        .and_then(|src| src.lookup(SCHEMA, true))
        .map(|_| gio::Settings::new(SCHEMA).string("monospace-font-name"))
        .and_then(|name| family(&name));

    SystemFonts { ui, mono }
}

#[cfg(not(target_os = "linux"))]
pub fn detect() -> SystemFonts {
    SystemFonts::default()
}

/// Script injetado antes da página: a UI lê `window.__IDEARIO_SYSTEM_FONTS__` ao iniciar.
pub fn init_script() -> String {
    let json = serde_json::to_string(&detect()).unwrap_or_else(|_| "{}".into());
    format!("window.__IDEARIO_SYSTEM_FONTS__ = {json};")
}
