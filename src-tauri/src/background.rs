//! Segundo plano (opção nas Configurações): ao fechar a janela, o Ideario continua aberto, com um ícone na bandeja
//! do sistema (Windows, Linux) ou na barra de menus (macOS). Assim ele volta na hora, sem abrir do zero.
//! Desligado (padrão), fechar a janela encerra o app, como de costume.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Window, WindowEvent};

const TRAY: &str = "main";

/// Ícone da bandeja (source/tray.svg): no Mac e no Linux, só o desenho de dentro, monocromático, como os ícones
/// do sistema; no Windows, o ícone colorido do app.
fn tray_icon<R: Runtime>(app: &AppHandle<R>, tray: TrayIconBuilder<R>) -> TrayIconBuilder<R> {
    #[cfg(target_os = "macos")]
    {
        // Imagem "template": o macOS pinta de claro ou escuro conforme a barra de menus (e o destaque ao clicar).
        let _ = app;
        let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-dark.png")).expect("ícone da bandeja");
        tray.icon(icon).icon_as_template(true)
    }
    #[cfg(target_os = "linux")]
    {
        // O Linux não pinta o ícone: escolhemos pela cor do painel. O do GNOME (e da maioria) é escuro; no KDE o
        // painel segue o esquema de cores.
        let _ = app;
        let light_panel = crate::system_theme::detect().scheme.is_some_and(|s| s.mode == "light");
        let bytes: &[u8] = if light_panel { include_bytes!("../icons/tray-dark.png") } else { include_bytes!("../icons/tray-light.png") };
        tray.icon(tauri::image::Image::from_bytes(bytes).expect("ícone da bandeja"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        match app.default_window_icon() {
            Some(icon) => tray.icon(icon.clone()),
            None => tray,
        }
    }
}

#[derive(Default)]
pub struct Background(AtomicBool);

/// A UI chama ao iniciar (com o valor salvo no aparelho) e quando a opção muda.
#[tauri::command]
pub fn set_background<R: Runtime>(app: AppHandle<R>, state: State<'_, Background>, enabled: bool) -> Result<(), String> {
    state.0.store(enabled, Ordering::Relaxed);
    if enabled {
        ensure_tray(&app).map_err(|e| e.to_string())
    } else {
        app.remove_tray_by_id(TRAY);
        Ok(())
    }
}

fn ensure_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if app.tray_by_id(TRAY).is_some() {
        return Ok(());
    }
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", "Abrir o Ideario", true, None::<&str>)?,
            &MenuItem::with_id(app, "new", "Nova nota", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?,
        ],
    )?;
    let mut tray = TrayIconBuilder::with_id(TRAY).tooltip("Ideario").menu(&menu).show_menu_on_left_click(false);
    tray = tray_icon(app, tray);
    tray.on_menu_event(|app, e| match e.id.as_ref() {
        "open" => show(app),
        "new" => {
            show(app);
            let _ = app.emit("new-note", ());
        }
        "quit" => app.exit(0),
        _ => {}
    })
    // Clique simples no ícone traz a janela de volta (o menu fica no botão direito).
    .on_tray_icon_event(|tray, e| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            show(tray.app_handle());
        }
    })
    .build(app)?;
    Ok(())
}

/// Mostra a janela principal (e põe o foco nela).
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Com o segundo plano ligado, fechar a janela só a esconde.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.state::<Background>().0.load(Ordering::Relaxed) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn tray_icons_decode() {
        for bytes in [&include_bytes!("../icons/tray-dark.png")[..], &include_bytes!("../icons/tray-light.png")[..]] {
            let icon = tauri::image::Image::from_bytes(bytes).unwrap();
            assert_eq!((icon.width(), icon.height()), (64, 64));
        }
    }
}
