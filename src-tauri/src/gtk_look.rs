//! Linux (GNOME e afins): a barra de título é desenhada pelo tema GTK. Com o sistema no escuro, o Ubuntu troca o
//! próprio tema para a variante escura ("Yaru-dark"), e só pedir "prefira claro" não clareia a barra. Então, com o
//! app no claro, esta janela usa a variante clara do mesmo tema (só neste app; o sistema não muda). No escuro, a
//! escura; em "Sistema", volta ao que o sistema usa.

#[cfg(target_os = "linux")]
mod imp {
    use gtk::glib::prelude::*;
    use std::sync::OnceLock;

    /// Tema e preferência de escuro do sistema, lidos antes da primeira troca.
    static SYSTEM: OnceLock<(Option<String>, bool)> = OnceLock::new();

    /// Na linha principal do GTK.
    pub(crate) fn apply(look: &str) {
        let Some(settings) = gtk::Settings::default() else { return };
        let (name, prefer_dark) = SYSTEM
            .get_or_init(|| (settings.property::<Option<String>>("gtk-theme-name"), settings.property::<bool>("gtk-application-prefer-dark-theme")))
            .clone();
        let (name, prefer_dark) = match look {
            "light" => (name.as_deref().map(super::light_variant), false),
            "dark" => (name, true),
            _ => (name, prefer_dark),
        };
        if let Some(name) = name {
            if settings.property::<Option<String>>("gtk-theme-name").as_deref() != Some(name.as_str()) {
                settings.set_property("gtk-theme-name", name);
            }
        }
        settings.set_property("gtk-application-prefer-dark-theme", prefer_dark);
    }
}

#[cfg(target_os = "linux")]
pub(crate) use imp::apply;

/// Nome da variante clara de um tema GTK ("Yaru-blue-dark" → "Yaru-blue"); tema claro fica como está.
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
fn light_variant(name: &str) -> String {
    for suffix in ["-dark", "-Dark", "_dark", ":dark"] {
        if let Some(base) = name.strip_suffix(suffix) {
            if !base.is_empty() {
                return base.to_string();
            }
        }
    }
    name.to_string()
}

#[cfg(test)]
mod tests {
    use super::light_variant;

    #[test]
    fn light_variant_of_the_system_theme() {
        assert_eq!(light_variant("Yaru-dark"), "Yaru");
        assert_eq!(light_variant("Yaru-blue-dark"), "Yaru-blue");
        assert_eq!(light_variant("Adwaita-dark"), "Adwaita");
        assert_eq!(light_variant("Pop-Dark"), "Pop");
        assert_eq!(light_variant("Yaru"), "Yaru");
        assert_eq!(light_variant("-dark"), "-dark");
    }
}
