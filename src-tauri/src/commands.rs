//! Comandos que a UI chama (`invoke`). Um para cada método da interface `Api` (src/lib/api/index.ts).
//! Todos rodam no núcleo, só com o banco local: nenhum espera a rede.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{json, Map, Value};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

use crate::attachments;
use crate::store::{
    Attachment, AttachmentRow, Category, Filter, NoteDetail, NoteInput, NoteSummary, Result, Store, SyncStatus, TagCount, ViewCounts,
};

/// Estado do núcleo: o banco e a pasta de dados do app.
pub struct Core {
    pub store: Mutex<Store>,
    pub data: PathBuf,
}

impl Core {
    pub fn open(data: PathBuf) -> Result<Core> {
        std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        let store = Store::open(&data.join("ideario.db"))?;
        welcome(&store)?;
        Ok(Core { store: Mutex::new(store), data })
    }

    pub fn with<T>(&self, f: impl FnOnce(&Store) -> Result<T>) -> Result<T> {
        let store = self.store.lock().map_err(|_| "banco indisponível".to_string())?;
        f(&store)
    }
}

/// Primeiro uso: uma nota curta de boas-vindas, para a tela não abrir vazia.
fn welcome(store: &Store) -> Result<()> {
    if store.flag("welcomed")? || !store.is_empty()? {
        return store.set_flag("welcomed");
    }
    let p = |t: &str| json!({"type":"paragraph","content":[{"type":"text","text":t}]});
    let item = |t: &str| json!({"type":"taskItem","attrs":{"checked":false},"content":[p(t)]});
    let body = json!({"type":"doc","content":[
        p("Tudo fica guardado neste computador e abre na hora."),
        {"type":"taskList","content":[
            item("Crie uma nota no + (ou Ctrl+N)"),
            item("Use #tags no texto para marcar"),
            item("Arraste os blocos pela alça ⋮⋮ à esquerda"),
            item("Escolha o tema nas Configurações"),
        ]},
    ]});
    let note = NoteInput {
        id: uuid::Uuid::now_v7().to_string(),
        title: "Bem-vindo ao Ideario".into(),
        body,
        category_id: None,
        color: "butter".into(),
        pinned: true,
        archived: false,
        trashed_at: None,
        reminder_at: None,
        reminder_done: false,
        tags: vec![],
    };
    store.save_note(&note)?;
    store.set_flag("welcomed")
}

type Core_<'a> = State<'a, Core>;

#[tauri::command]
pub fn list_notes(core: Core_, filter: Filter, r#box: String, query: String, sort: String) -> Result<Vec<NoteSummary>> {
    core.with(|s| s.list_notes(&filter, &r#box, &query, &sort))
}

#[tauri::command]
pub fn list_reminders(core: Core_, filter: Filter, query: String, include_done: bool) -> Result<Vec<NoteSummary>> {
    core.with(|s| s.list_reminders(&filter, &query, include_done))
}

#[tauri::command]
pub fn list_attachments(core: Core_, filter: Filter, query: String) -> Result<Vec<AttachmentRow>> {
    core.with(|s| s.list_attachments(&filter, &query))
}

#[tauri::command]
pub fn list_images(core: Core_, filter: Filter, query: String, tone: Option<String>) -> Result<Vec<AttachmentRow>> {
    core.with(|s| s.list_images(&filter, &query, tone.as_deref()))
}

#[tauri::command]
pub fn view_counts(core: Core_, filter: Filter, query: String) -> Result<ViewCounts> {
    core.with(|s| s.view_counts(&filter, &query))
}

#[tauri::command]
pub fn list_categories(core: Core_) -> Result<Vec<Category>> {
    core.with(|s| s.list_categories())
}

#[tauri::command]
pub fn create_category(core: Core_, name: String, color: String) -> Result<Category> {
    core.with(|s| s.create_category(&name, &color))
}

#[tauri::command]
pub fn update_category(core: Core_, id: String, name: Option<String>, color: Option<String>) -> Result<()> {
    core.with(|s| s.update_category(&id, name.as_deref(), color.as_deref()))
}

/// Apaga a categoria e devolve as notas que estavam nela (para o "Desfazer").
#[tauri::command]
pub fn delete_category(core: Core_, id: String) -> Result<Vec<String>> {
    core.with(|s| {
        let ids = s.category_note_ids(&id)?;
        s.delete_category(&id)?;
        Ok(ids)
    })
}

#[tauri::command]
pub fn restore_category(core: Core_, id: String, note_ids: Vec<String>) -> Result<()> {
    core.with(|s| s.restore_category(&id, &note_ids))
}

#[tauri::command]
pub fn list_tags(core: Core_) -> Result<Vec<TagCount>> {
    core.with(|s| s.list_tags())
}

#[tauri::command]
pub fn rename_tag(core: Core_, from: String, to: Option<String>) -> Result<usize> {
    core.with(|s| s.rename_tag(&from, to.as_deref()))
}

#[tauri::command]
pub fn get_note(core: Core_, id: String) -> Result<Option<NoteDetail>> {
    core.with(|s| s.get_note(&id))
}

/// Grava uma nota inteira (o estado Yjs nasce ou é atualizado a partir dela). A UI usa o Y.Doc; isto serve para
/// carregar notas prontas (testes de desempenho, importação).
#[tauri::command]
pub fn save_note(core: Core_, input: NoteInput) -> Result<NoteSummary> {
    core.with(|s| s.save_note(&input))
}

/// Estado Yjs da nota, em binário (vazio se a nota não existe): o editor abre o Y.Doc com ele.
#[tauri::command]
pub fn get_note_state(core: Core_, id: String) -> Result<Response> {
    core.with(|s| s.ydoc(&id)).map(|state| Response::new(state.unwrap_or_default()))
}

/// Atualização Yjs do editor (binária, id no cabeçalho `x-id`). Cria a nota se ela ainda não existe.
#[tauri::command]
pub fn apply_note_update(core: Core_, request: Request<'_>) -> Result<()> {
    let InvokeBody::Raw(update) = request.body() else { return Err("atualização ausente".into()) };
    let id = request.headers().get("x-id").and_then(|v| v.to_str().ok()).ok_or("nota ausente")?;
    core.with(|s| s.apply_update(id, update))
}

#[tauri::command]
pub fn set_reminder_done(core: Core_, id: String, done: bool) -> Result<()> {
    core.with(|s| s.set_reminder_done(&id, done).map(|_| ()))
}

#[tauri::command]
pub fn update_note(core: Core_, id: String, patch: Map<String, Value>) -> Result<()> {
    core.with(|s| s.update_note(&id, &patch).map(|_| ()))
}

#[tauri::command]
pub fn move_note(core: Core_, id: String, after: Option<String>, before: Option<String>) -> Result<()> {
    core.with(|s| s.move_note(&id, after.as_deref(), before.as_deref()).map(|_| ()))
}

#[tauri::command]
pub fn adopt_order(core: Core_, sort: String) -> Result<()> {
    core.with(|s| s.adopt_order(&sort).map(|_| ()))
}

#[tauri::command]
pub fn duplicate_note(core: Core_, id: String) -> Result<String> {
    core.with(|s| s.duplicate_note(&id))
}

#[tauri::command]
pub fn note_text(core: Core_, id: String) -> Result<String> {
    core.with(|s| s.note_text(&id))
}

#[tauri::command]
pub fn delete_note(core: Core_, id: String) -> Result<()> {
    core.with(|s| s.delete_note(&id).map(|_| ()))
}

#[tauri::command]
pub fn trash_count(core: Core_) -> Result<i64> {
    core.with(|s| s.trash_count())
}

#[tauri::command]
pub fn empty_trash(core: Core_) -> Result<usize> {
    core.with(|s| s.empty_trash())
}

#[tauri::command]
pub fn get_settings(core: Core_) -> Result<Value> {
    core.with(|s| s.get_settings())
}

#[tauri::command]
pub fn save_settings(core: Core_, settings: Value) -> Result<()> {
    core.with(|s| s.save_settings(&settings))
}

#[tauri::command]
pub fn sync_status(core: Core_) -> Result<SyncStatus> {
    core.with(|s| s.sync_status())
}

#[tauri::command]
pub fn get_attachments(core: Core_, hashes: Vec<String>) -> Result<Vec<Attachment>> {
    core.with(|s| s.get_attachments(&hashes))
}

/// Recebe o arquivo como corpo binário (sem passar por JSON); nome e tipo vão nos cabeçalhos.
#[tauri::command]
pub fn import_file(core: Core_, request: Request<'_>) -> Result<Attachment> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("arquivo ausente".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let name = percent_decode(&header("x-name"));
    let mime = header("x-mime");
    core.with(|s| attachments::import(s, &core.data, bytes, if name.is_empty() { "arquivo" } else { &name }, &mime))
}

/// Importa um arquivo do computador pelo caminho (arrastado para a janela): lido aqui, sem passar pela ponte.
#[tauri::command]
pub fn import_path(core: Core_, path: String) -> Result<Attachment> {
    let path = PathBuf::from(path);
    if path.is_dir() {
        return Err("pastas não podem ser anexadas".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "arquivo".into());
    core.with(|s| attachments::import(s, &core.data, &bytes, &name, attachments::mime_of(&name)))
}

/// Salva uma cópia do anexo na pasta Downloads e devolve onde ficou.
#[tauri::command]
pub fn download_attachment(app: AppHandle, core: Core_, hash: String, name: String) -> Result<String> {
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    attachments::save_copy(&core.data, &downloads, &hash, &name).map(|p| p.display().to_string())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_names() {
        assert_eq!(percent_decode("Grava%C3%A7%C3%A3o%2001.webm"), "Gravação 01.webm");
        assert_eq!(percent_decode("a%2"), "a%2");
    }

    #[test]
    fn first_run_has_the_welcome_note_once() {
        let s = Store::memory();
        welcome(&s).unwrap();
        welcome(&s).unwrap();
        let notes = s.list_notes(&Filter::default(), "active", "", "custom").unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "Bem-vindo ao Ideario");
    }
}
