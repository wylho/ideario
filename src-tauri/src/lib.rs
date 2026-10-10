//! Núcleo do Ideario (SPEC §4). Fase 1: banco local (SQLite + FTS5), notas, categorias, tags e anexos.
//! Próximos módulos: Y.Doc por nota (yrs, Fase 2), pipeline de mídia (Fase 3), lembretes (4), sync (5), importação (6).

// Sem `unwrap`/`expect` fora dos testes: um erro vira mensagem ou é tratado, nunca derruba o app.
#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]

mod attachments;
mod background;
mod commands;
mod keep;
mod media;
mod notify;
mod projection;
mod reminders;
mod store;
mod sync;
mod system_fonts;
mod system_theme;
mod text;
mod ydoc;

use tauri::{Manager, WebviewWindowBuilder};

use commands::Core;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Janela nativa de abrir arquivo (Importar do Google Keep).
        .plugin(tauri_plugin_dialog::init())
        // Abre o navegador no login do Google (sync com o Drive).
        .plugin(tauri_plugin_opener::init())
        .manage(sync::Sync::default())
        .manage(background::Background::default())
        .on_window_event(background::on_window_event)
        // Fotos, vídeos, áudios e documentos das notas: `att://localhost/<hash>` (convertFileSrc(hash, 'att')).
        .register_asynchronous_uri_scheme_protocol("att", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                // Anexo grande que outro aparelho subiu: desce agora, na hora de abrir.
                sync::ensure_local(&app, req.uri().path().trim_start_matches('/'));
                let core = app.state::<Core>();
                let res = match core.store.lock() {
                    Ok(store) => attachments::serve(&store, &core.data, &req),
                    Err(_) => attachments::status_only(tauri::http::StatusCode::SERVICE_UNAVAILABLE),
                };
                responder.respond(res);
            });
        })
        .setup(|app| {
            // Banco local (SQLite) na pasta de dados do app; abre antes da janela, para a lista vir na hora.
            let data = app.path().app_data_dir()?;
            app.manage(Core::open(data).map_err(|e| format!("não foi possível abrir o banco: {e}"))?);
            // Fotos antigas (sem miniatura e paleta): em segundo plano, sem atrasar a lista.
            let handle = app.handle().clone();
            std::thread::spawn(move || handle.state::<Core>().backfill_media());
            // Lembretes: notificação na hora (e os atrasados, logo ao abrir).
            notify::start(app.handle().clone());
            // Sync com o Google Drive em segundo plano (se houver login).
            sync::start(app.handle());

            // A janela é criada aqui (e não pelo tauri.conf.json) para receber as fontes e as cores do
            // sistema antes de a página carregar, sem troca visível de fonte ou de cor.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("janela main ausente no tauri.conf.json")?;
            // Nasce com a aparência escolhida da última vez (barra de título e fundo), não com a do sistema.
            let (look, bg) = app
                .state::<Core>()
                .with(|s| Ok((s.sync_value("window_theme")?, s.sync_value("window_bg")?)))
                .unwrap_or_default();
            let mut window = WebviewWindowBuilder::from_config(app.handle(), &config)?
                .initialization_script(format!("{}\n{}", system_fonts::init_script(), system_theme::init_script()))
                .theme(match look.as_deref() {
                    Some("dark") => Some(tauri::Theme::Dark),
                    Some("light") => Some(tauri::Theme::Light),
                    _ => None,
                });
            if let Some(color) = bg.as_deref().and_then(commands::parse_hex) {
                window = window.background_color(color);
            }
            window.build()?;
            #[cfg(target_os = "linux")]
            linux_media(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_path,
            commands::set_window_look,
            commands::pending_previews,
            commands::inspect_takeout,
            commands::import_keep,
            commands::set_preview,
            app_version,
            background::set_background,
            commands::list_notes,
            commands::list_reminders,
            commands::list_attachments,
            commands::list_images,
            commands::view_counts,
            commands::list_categories,
            commands::create_category,
            commands::update_category,
            commands::delete_category,
            commands::restore_category,
            commands::list_tags,
            commands::rename_tag,
            commands::get_note,
            commands::save_note,
            commands::get_note_state,
            commands::apply_note_update,
            commands::set_reminder_done,
            commands::update_note,
            commands::move_note,
            commands::adopt_order,
            commands::duplicate_note,
            commands::note_text,
            commands::delete_note,
            commands::trash_count,
            commands::empty_trash,
            commands::get_settings,
            commands::save_settings,
            sync::service::sync_status,
            sync::service::sync_now,
            sync::service::sync_focus,
            sync::service::sync_sign_in,
            sync::service::sync_cancel_sign_in,
            sync::service::sync_sign_out,
            commands::get_attachments,
            commands::import_file,
            commands::download_attachment,
        ])
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(e) => {
            eprintln!("erro ao iniciar o Ideario: {e}");
            std::process::exit(1);
        }
    };
    app.run(|_app, _event| {
            // macOS: clicar no ícone do Dock com a janela escondida traz a janela de volta.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                background::show(_app);
            }
        });
}

/// Versão do núcleo, para a UI confirmar que o IPC está de pé.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Linux: a WebKitGTK vem com a captura de mídia desligada e nega o pedido de microfone/câmera se ninguém responder.
/// Liga a captura e aceita só áudio e vídeo (o gravador e a câmera da nota); compartilhar a tela continua negado.
#[cfg(target_os = "linux")]
fn linux_media(app: &tauri::App) -> tauri::Result<()> {
    use webkit2gtk::{glib::prelude::*, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, UserMediaPermissionRequestExt, WebViewExt};
    let Some(window) = app.get_webview_window("main") else { return Ok(()) };
    window.with_webview(|wv| {
        let view = wv.inner();
        if let Some(settings) = view.settings() {
            settings.set_enable_media_stream(true);
            settings.set_enable_mediasource(true);
        }
        view.connect_permission_request(|_, request| {
            let Some(media) = request.downcast_ref::<UserMediaPermissionRequest>() else { return false };
            if media.is_for_audio_device() || media.is_for_video_device() {
                request.allow();
            } else {
                request.deny();
            }
            true
        });
    })
}
