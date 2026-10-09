//! Cores da área de trabalho, para o tema "Sistema" (src/lib/theme.svelte.ts).
//!
//! Lemos só o necessário, uma vez, enquanto a janela é criada: qual é a área de trabalho, a cor de
//! destaque e, no KDE, o esquema de cores em uso. Cada leitura é uma configuração ou um arquivo pequeno
//! (bem menos de 1 ms). O resultado vai para a UI antes da primeira pintura, junto com as fontes.

use serde::Serialize;

#[derive(Debug, Default, Serialize)]
pub struct SystemTheme {
    /// "gnome", "kde", "windows" ou "macos".
    pub desktop: Option<&'static str>,
    /// Cor de destaque do sistema em `#rrggbb`, se houver.
    pub accent: Option<String>,
    /// KDE: o esquema de cores em uso. Vale só para o modo (claro ou escuro) que ele descreve.
    pub scheme: Option<Scheme>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Scheme {
    /// "light" ou "dark", pelo brilho do fundo da janela.
    pub mode: &'static str,
    pub colors: SchemeColors,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct SchemeColors {
    pub bg: String,
    /// Cards: a "View" no claro (branca); no escuro a dos botões, porque a "View" do Breeze Dark é mais
    /// escura que a janela e os cards pareceriam afundados.
    pub surface: String,
    pub fg: String,
    pub muted: String,
}

fn hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Cores de destaque nomeadas do GNOME 47+ (as mesmas de src/lib/palettes.ts).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn gnome_accent(name: &str) -> Option<&'static str> {
    Some(match name {
        "blue" => "#3584e4",
        "teal" => "#2190a4",
        "green" => "#3a944a",
        "yellow" => "#c88800",
        "orange" => "#ed5b00",
        "red" => "#e62d42",
        "pink" => "#d56199",
        "purple" => "#9141ac",
        "slate" => "#6f8396",
        _ => return None,
    })
}

// ---------- KDE ----------

/// `kdeglobals` é um INI: `[Colors:Window]` → `BackgroundNormal=239,240,241`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn kde_value<'a>(ini: &'a str, section: &str, key: &str) -> Option<&'a str> {
    let mut inside = false;
    for line in ini.lines().map(str::trim) {
        if line.starts_with('[') {
            inside = line == format!("[{section}]");
        } else if inside {
            if let Some((k, v)) = line.split_once('=') {
                if k.trim() == key {
                    return Some(v.trim());
                }
            }
        }
    }
    None
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn kde_rgb(v: &str) -> Option<(u8, u8, u8)> {
    let mut it = v.split(',').map(|p| p.trim().parse::<u8>().ok());
    let rgb = (it.next()??, it.next()??, it.next()??);
    Some(rgb)
}

/// Destaque e esquema a partir do conteúdo de `kdeglobals`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn kde_theme(ini: &str) -> (Option<String>, Option<Scheme>) {
    let color = |section: &str, key: &str| kde_value(ini, section, key).and_then(kde_rgb);
    let accent = color("General", "AccentColor")
        .or_else(|| color("Colors:Selection", "BackgroundNormal"))
        .map(|(r, g, b)| hex(r, g, b));

    let scheme = (|| {
        let bg = color("Colors:Window", "BackgroundNormal")?;
        let fg = color("Colors:Window", "ForegroundNormal")?;
        let muted = color("Colors:Window", "ForegroundInactive").unwrap_or(fg);
        let luma = 0.2126 * bg.0 as f32 + 0.7152 * bg.1 as f32 + 0.0722 * bg.2 as f32;
        let dark = luma < 128.0;
        let surface = color(if dark { "Colors:Button" } else { "Colors:View" }, "BackgroundNormal").unwrap_or(bg);
        let h = |c: (u8, u8, u8)| hex(c.0, c.1, c.2);
        Some(Scheme {
            mode: if dark { "dark" } else { "light" },
            colors: SchemeColors { bg: h(bg), surface: h(surface), fg: h(fg), muted: h(muted) },
        })
    })();
    (accent, scheme)
}

// ---------- por sistema ----------

#[cfg(target_os = "linux")]
pub fn detect() -> SystemTheme {
    let desktops = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_ascii_uppercase();
    if desktops.split(':').any(|d| d == "KDE") {
        let path = std::env::var_os("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| std::path::Path::new(&h).join(".config")))
            .map(|dir| dir.join("kdeglobals"));
        let ini = path.and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
        let (accent, scheme) = kde_theme(&ini);
        return SystemTheme { desktop: Some("kde"), accent, scheme };
    }

    // GNOME e demais (Cinnamon, XFCE, Budgie…): base Adwaita. O destaque só existe no GNOME 47+;
    // checar o esquema e a chave evita pânico onde ela não existe.
    use gtk::gio;
    use gtk::prelude::*;
    const SCHEMA: &str = "org.gnome.desktop.interface";
    let accent = gio::SettingsSchemaSource::default()
        .and_then(|src| src.lookup(SCHEMA, true))
        .filter(|schema| schema.has_key("accent-color"))
        .and_then(|_| gnome_accent(&gio::Settings::new(SCHEMA).string("accent-color")))
        .map(str::to_string);
    SystemTheme { desktop: Some("gnome"), accent, scheme: None }
}

#[cfg(target_os = "windows")]
pub fn detect() -> SystemTheme {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    // AccentColor do DWM: 0xAABBGGRR.
    let accent = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\DWM")
        .and_then(|key| key.get_value::<u32, _>("AccentColor"))
        .ok()
        .map(|v| hex(v as u8, (v >> 8) as u8, (v >> 16) as u8));
    SystemTheme { desktop: Some("windows"), accent, scheme: None }
}

#[cfg(target_os = "macos")]
pub fn detect() -> SystemTheme {
    use objc2_app_kit::{NSColor, NSColorSpace};
    // controlAccentColor acompanha a cor escolhida em Ajustes > Aparência (azul quando "Multicolorido").
    #[allow(unused_unsafe)]
    let accent = unsafe {
        NSColor::controlAccentColor().colorUsingColorSpace(&NSColorSpace::sRGBColorSpace()).map(|c| {
            let to = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
            hex(to(c.redComponent()), to(c.greenComponent()), to(c.blueComponent()))
        })
    };
    SystemTheme { desktop: Some("macos"), accent, scheme: None }
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
pub fn detect() -> SystemTheme {
    SystemTheme::default()
}

/// Script injetado antes da página: a UI lê `window.__IDEARIO_SYSTEM_THEME__` ao iniciar.
pub fn init_script() -> String {
    let json = serde_json::to_string(&detect()).unwrap_or_else(|_| "{}".into());
    format!("window.__IDEARIO_SYSTEM_THEME__ = {json};")
}

#[cfg(test)]
mod tests {
    use super::*;

    const BREEZE_DARK: &str = "
[Colors:Button]
BackgroundNormal=41,44,48

[Colors:Selection]
BackgroundNormal=61,174,233

[Colors:View]
BackgroundNormal=20,22,24

[Colors:Window]
BackgroundNormal=32,35,38
ForegroundInactive=161,169,177
ForegroundNormal=252,252,252

[General]
ColorScheme=BreezeDark
";

    #[test]
    fn kde_breeze_dark() {
        let (accent, scheme) = kde_theme(BREEZE_DARK);
        assert_eq!(accent.as_deref(), Some("#3daee9"));
        let s = scheme.unwrap();
        assert_eq!(s.mode, "dark");
        assert_eq!(s.colors.bg, "#202326");
        assert_eq!(s.colors.surface, "#292c30");
        assert_eq!(s.colors.fg, "#fcfcfc");
    }

    #[test]
    fn kde_accent_color_wins_over_selection() {
        let ini = format!("{BREEZE_DARK}AccentColor=233,100,61\n");
        assert_eq!(kde_theme(&ini).0.as_deref(), Some("#e9643d"));
    }

    #[test]
    fn kde_missing_file_is_harmless() {
        assert_eq!(kde_theme(""), (None, None));
    }

    #[test]
    fn gnome_accent_names() {
        assert_eq!(gnome_accent("teal"), Some("#2190a4"));
        assert_eq!(gnome_accent("nope"), None);
    }
}
