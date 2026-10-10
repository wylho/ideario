//! Notificações do sistema para os lembretes (macOS, Windows, Linux), com os botões Abrir, Adiar 10 min e Concluir.
//! Cada notificação espera a resposta numa thread própria; a resposta volta para o núcleo e para a janela.

use tauri::{AppHandle, Emitter, Manager};

use crate::commands::Core;
use crate::reminders::{Notice, Notifier};
use crate::store::now;

const SNOOZE_MS: i64 = 10 * 60 * 1000;

pub struct SystemNotifier {
    pub app: AppHandle,
}

impl Notifier for SystemNotifier {
    fn show(&self, n: &Notice) {
        let (app, n) = (self.app.clone(), n.clone());
        std::thread::spawn(move || {
            let mut x = notify_rust::Notification::new();
            x.appname("Ideario").summary(&n.title).body(&n.body);
            #[cfg(windows)]
            x.app_id(&app.config().identifier);
            if n.note.is_some() {
                x.action("open", "Abrir").action("snooze", "Adiar 10 min");
                if !n.repeats {
                    x.action("done", "Concluir");
                }
            }
            // Sem servidor de notificações (ex.: Linux sem área de trabalho), fica só o aviso dentro do app.
            let Ok(handle) = x.show() else { return };
            handle.wait_for_action(|action| act(&app, &n, action));
        });
    }
}

/// Resposta da notificação. No macOS vem o texto do botão; nos outros, o identificador; clicar no corpo = abrir.
fn act(app: &AppHandle, n: &Notice, action: &str) {
    match action {
        "open" | "Abrir" | "default" => {
            show_window(app);
            match &n.note {
                Some(id) => app.emit("open-note", id),
                None => app.emit("open-view", "reminders"),
            }
            .ok();
        }
        "snooze" | "Adiar 10 min" => change(app, n, |s, id| crate::reminders::snooze(s, id, now() + SNOOZE_MS)),
        "done" | "Concluir" => change(app, n, |s, id| crate::reminders::complete(s, id, now(), &chrono::Local)),
        _ => {}
    }
}

fn change(app: &AppHandle, n: &Notice, f: impl FnOnce(&crate::store::Store, &str) -> crate::store::Result<()>) {
    let Some(id) = &n.note else { return };
    if app.state::<Core>().with(|s| f(s, id)).is_ok() {
        app.emit("core-changed", ()).ok();
    }
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Confere os lembretes a cada 10 s, desde a abertura (os atrasados avisam logo). Avisa a janela também.
pub fn start(app: AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = notify_rust::set_application(&app.config().identifier);
    std::thread::spawn(move || loop {
        let notifier = SystemNotifier { app: app.clone() };
        if let Ok(alerts) = app.state::<Core>().with(|s| crate::reminders::tick(s, now(), &notifier)) {
            if !alerts.is_empty() {
                app.emit("reminders", &alerts).ok();
                app.emit("core-changed", ()).ok();
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(10));
    });
}
