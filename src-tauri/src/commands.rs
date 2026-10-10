//! Comandos que a UI chama (`invoke`). Um para cada método da interface `Api` (src/lib/api/index.ts).
//! Todos rodam no núcleo, só com o banco local: nenhum espera a rede.

use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Map, Value};
use tauri::ipc::{InvokeBody, Request, Response};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{attachments, keep, media};
use crate::store::{
    Attachment, AttachmentRow, Category, Filter, NoteDetail, NoteInput, NoteSummary, Result, Store, TagCount, ViewCounts,
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

    /// Fotos da Fase 1 ganham miniatura, paleta e tom (sem recomprimir). Em segundo plano, uma de cada vez; a trava
    /// do banco só é pega para ler a lista e gravar cada resultado.
    pub fn backfill_media(&self) {
        let Ok(hashes) = self.with(|s| s.images_without_palette()) else { return };
        for h in hashes {
            let derived = std::fs::read(attachments::dir(&self.data).join(&h)).map_err(|e| e.to_string()).and_then(|b| media::derive(&b));
            let _ = match derived {
                Ok((thumb, palette, tone)) => std::fs::create_dir_all(self.data.join("thumbs"))
                    .and_then(|_| std::fs::write(attachments::thumb_path(&self.data, &h), thumb))
                    .map_err(|e| e.to_string())
                    .and_then(|_| self.with(|s| s.set_palette(&h, &palette, Some(tone.as_str())))),
                Err(_) => self.with(|s| s.set_palette(&h, &[], None)),
            };
        }
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
        reminder_repeat: None,
        tags: vec![],
    };
    store.save_note(&note)?;
    store.set_sync_value("welcome_note", Some(&note.id))?;
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
pub fn get_attachments(core: Core_, hashes: Vec<String>) -> Result<Vec<Attachment>> {
    core.with(|s| s.get_attachments(&hashes))
}

/// Recebe o arquivo como corpo binário (sem passar por JSON); nome e tipo vão nos cabeçalhos.
/// Assíncrono: a foto passa pelo pipeline numa thread à parte, com a janela livre e o banco destravado.
#[tauri::command]
pub async fn import_file(core: Core_<'_>, request: Request<'_>) -> Result<Attachment> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("arquivo ausente".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let name = percent_decode(&header("x-name"));
    let name = if name.is_empty() { "arquivo".to_string() } else { name };
    import(&core, bytes.clone(), name, header("x-mime")).await
}

async fn import(core: &Core, bytes: Vec<u8>, name: String, mime: String) -> Result<Attachment> {
    let quality = core.with(|s| Ok(attachments::quality(s)))?;
    let prepared = tauri::async_runtime::spawn_blocking(move || attachments::prepare(bytes, &name, &mime, quality))
        .await
        .map_err(|e| e.to_string())?;
    core.with(|s| attachments::save(s, &core.data, prepared))
}

/// Importa um arquivo do computador pelo caminho (arrastado para a janela): lido aqui, sem passar pela ponte.
#[tauri::command]
pub async fn import_path(core: Core_<'_>, path: String) -> Result<Attachment> {
    let path = PathBuf::from(path);
    if path.is_dir() {
        return Err("pastas não podem ser anexadas".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "arquivo".into());
    let mime = attachments::mime_of(&name).to_string();
    import(&core, bytes, name, mime).await
}

/// PDFs e vídeos ainda sem prévia: a interface gera (pdf.js, um quadro do vídeo) e devolve por `set_preview`.
#[tauri::command]
pub fn pending_previews(core: Core_) -> Result<Vec<Value>> {
    let all = core.with(|s| s.previewable())?;
    Ok(all
        .into_iter()
        .filter(|(h, _)| !attachments::thumb_path(&core.data, h).exists())
        .map(|(hash, kind)| json!({ "hash": hash, "kind": kind }))
        .collect())
}

/// Prévia em PNG (corpo binário; hash no cabeçalho `x-hash`). Corpo vazio = sem prévia possível.
#[tauri::command]
pub async fn set_preview(core: Core_<'_>, request: Request<'_>) -> Result<()> {
    let InvokeBody::Raw(png) = request.body() else { return Err("prévia ausente".into()) };
    let hash: String = request.headers().get("x-hash").and_then(|v| v.to_str().ok()).unwrap_or("").chars().filter(char::is_ascii_hexdigit).collect();
    if hash.is_empty() {
        return Err("anexo ausente".into());
    }
    let (data, png) = (core.data.clone(), png.clone());
    tauri::async_runtime::spawn_blocking(move || attachments::save_preview(&data, &hash, &png)).await.map_err(|e| e.to_string())?
}

// ---------- importar do Google Keep ----------

/// O que entrou numa importação do Keep (o resumo que a interface mostra).
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepReport {
    pub notes: usize,
    /// Já tinham entrado numa importação anterior.
    pub skipped: usize,
    pub photos: usize,
    /// Citadas nas notas mas fora do zip (apagadas, por exemplo).
    pub missing_media: usize,
    /// Marcadores que viraram categorias novas.
    pub categories: Vec<String>,
    pub archived: usize,
    pub trashed: usize,
}

fn open_takeout(path: &Path) -> Result<Option<keep::Takeout<BufReader<File>>>> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    keep::Takeout::open(BufReader::new(file))
}

/// É um Takeout do Keep? Quantas notas e mídias. `None` = um zip qualquer (vira anexo).
#[tauri::command]
pub async fn inspect_takeout(path: String) -> Result<Option<Value>> {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(Some(t)) = open_takeout(Path::new(&path)) else { return Ok(None) };
        let media: usize = t.notes.iter().map(|n| n.attachments.len()).sum();
        Ok(Some(json!({ "notes": t.notes.len(), "media": media })))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Importa o Takeout em segundo plano, avisando o progresso pelo evento `keep-progress` (`[feitas, total]`).
#[tauri::command]
pub async fn import_keep(app: AppHandle, path: String) -> Result<KeepReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let core = app.state::<Core>();
        core.import_keep(Path::new(&path), |done, total| {
            let _ = app.emit("keep-progress", (done, total));
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

impl Core {
    /// Uma nota de cada vez, da mais antiga para a mais nova (as mais novas ficam no topo). As fotos passam pelo
    /// pipeline fora da trava do banco; cada nota é gravada com as datas originais. Notas já importadas são puladas.
    pub fn import_keep(&self, path: &Path, progress: impl Fn(usize, usize)) -> Result<KeepReport> {
        let mut t = open_takeout(path)?.ok_or("este zip não é uma exportação do Google Keep")?;
        let quality = self.with(|s| Ok(attachments::quality(s)))?;
        let mut notes = std::mem::take(&mut t.notes);
        notes.sort_by_key(keep::edited_ms);
        let total = notes.len();
        let mut r = KeepReport::default();
        for (i, n) in notes.iter().enumerate() {
            progress(i, total);
            let id = keep::note_id(n);
            if self.with(|s| s.note_exists(&id))? {
                r.skipped += 1;
                continue;
            }
            let (mut images, mut files) = (Vec::new(), Vec::new());
            for a in &n.attachments {
                let Some(bytes) = t.media(&a.file_path) else {
                    r.missing_media += 1;
                    continue;
                };
                let name = a.file_path.rsplit('/').next().unwrap_or(&a.file_path);
                let prepared = attachments::prepare(bytes, name, &a.mimetype, quality);
                let att = self.with(|s| attachments::save(s, &self.data, prepared))?;
                if att.kind == "image" {
                    r.photos += 1;
                    images.push(att.hash);
                } else {
                    files.push(att.hash);
                }
            }
            let (category, tags) = keep::category_and_tags(n);
            let category_id = match category {
                Some(name) => {
                    let (cid, created) = self.with(|s| s.category_by_name_or_create(&name))?;
                    if created {
                        r.categories.push(name);
                    }
                    Some(cid)
                }
                None => None,
            };
            let input = NoteInput {
                id: id.clone(),
                title: n.title.trim().to_string(),
                body: keep::body(n, &images, &files),
                category_id,
                color: keep::color(&n.color).into(),
                pinned: n.is_pinned,
                archived: n.is_archived,
                // Na lixeira desde agora: os 30 dias contam a partir da importação.
                trashed_at: n.is_trashed.then(crate::store::now),
                reminder_at: None,
                reminder_done: false,
                reminder_repeat: None,
                tags,
            };
            self.with(|s| {
                s.save_note(&input)?;
                s.set_times(&id, keep::created_ms(n), keep::edited_ms(n))
            })?;
            r.notes += 1;
            r.archived += usize::from(n.is_archived);
            r.trashed += usize::from(n.is_trashed);
        }
        progress(total, total);
        Ok(r)
    }
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
    fn old_photos_get_thumbnail_and_palette_in_the_background() {
        let tmp = std::env::temp_dir().join(format!("ideario-core-{}", uuid::Uuid::now_v7()));
        let core = Core::open(tmp.clone()).unwrap();
        // Como entrou na Fase 1: o arquivo cru, sem paleta nem miniatura.
        let jpg = crate::media::tests::camera_jpeg(640, 480, 1);
        std::fs::create_dir_all(attachments::dir(&tmp)).unwrap();
        std::fs::write(attachments::dir(&tmp).join("abc1"), &jpg).unwrap();
        std::fs::write(attachments::dir(&tmp).join("abc2"), b"isto nao e foto").unwrap();
        core.with(|s| {
            for h in ["abc1", "abc2"] {
                s.insert_attachment(&crate::store::Attachment {
                    hash: h.into(), kind: "image".into(), mime: "image/jpeg".into(), name: "x.jpg".into(), bytes: 1,
                    orig_bytes: None, width: None, height: None, palette: None, tone: None, added_at: 0,
                })?;
            }
            Ok(())
        })
        .unwrap();
        core.backfill_media();
        let atts = core.with(|s| s.get_attachments(&["abc1".into(), "abc2".into()])).unwrap();
        let ok = atts.iter().find(|a| a.hash == "abc1").unwrap();
        assert_eq!(ok.palette.as_ref().map(Vec::len), Some(5));
        assert!(attachments::thumb_path(&tmp, "abc1").exists());
        // A ilegível fica marcada (paleta vazia) para não tentar de novo a cada abertura.
        assert_eq!(atts.iter().find(|a| a.hash == "abc2").unwrap().palette, Some(vec![]));
        assert!(core.with(|s| s.images_without_palette()).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn importing_a_keep_takeout_twice_does_not_duplicate() {
        let tmp = std::env::temp_dir().join(format!("ideario-keep-{}", uuid::Uuid::now_v7()));
        let core = Core::open(tmp.clone()).unwrap();
        let zip = tmp.join("takeout.zip");
        std::fs::write(&zip, crate::keep::tests::fake_takeout()).unwrap();
        let steps = std::cell::RefCell::new(Vec::new());
        let r = core.import_keep(&zip, |d, t| steps.borrow_mut().push((d, t))).unwrap();
        assert_eq!((r.notes, r.skipped, r.photos, r.missing_media, r.archived, r.trashed), (3, 0, 1, 1, 1, 1));
        assert_eq!(r.categories, vec!["Casa"]);
        assert_eq!(steps.borrow().last(), Some(&(3, 3)));
        // (sem a nota de boas-vindas do primeiro uso)
        let all = |b: &str| {
            let mut v = core.with(|s| s.list_notes(&Filter::default(), b, "", "updated")).unwrap();
            v.retain(|n| n.title != "Bem-vindo ao Ideario");
            v
        };
        let active = all("active");
        // ativas: Mercado (fixada, na categoria Casa, com a tag do segundo marcador) e a da lixeira não aparece
        assert_eq!(active.iter().map(|n| n.title.as_str()).collect::<Vec<_>>(), vec!["Mercado"]);
        assert!(active[0].pinned && active[0].category_id.is_some() && active[0].tags.contains(&"compras-mensais".to_string()));
        assert_eq!(active[0].updated_at, 1_700_000_500_000, "data original da última edição");
        assert_eq!(all("archive")[0].title, "☎️ Senha");
        let trash = all("trash");
        assert_eq!(trash[0].image_count, 1, "a foto que estava no zip, pelo pipeline");
        assert!(trash[0].tags.contains(&"praia".to_string()), "#tag do texto");
        // de novo: nada duplica
        let again = core.import_keep(&zip, |_, _| {}).unwrap();
        assert_eq!((again.notes, again.skipped), (0, 3));
        assert_eq!(core.with(|s| s.list_categories()).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Takeout real, só nesta máquina: `IDEARIO_TAKEOUT=/caminho.zip cargo test --release real_takeout -- --ignored --nocapture`.
    /// Mostra só contagens (nada do conteúdo das notas) e confere que toda nota passa pelo Y.Doc sem perda.
    #[test]
    #[ignore]
    fn real_takeout() {
        let Ok(path) = std::env::var("IDEARIO_TAKEOUT") else { return };
        let tmp = std::env::temp_dir().join(format!("ideario-real-{}", uuid::Uuid::now_v7()));
        let core = Core::open(tmp.clone()).unwrap();
        let t0 = std::time::Instant::now();
        let r = core.import_keep(Path::new(&path), |_, _| {}).unwrap();
        println!("{r:?} em {:.1} s", t0.elapsed().as_secs_f64());
        let ids = core.with(|s| s.list_notes(&Filter::default(), "active", "", "updated")).unwrap().len()
            + core.with(|s| s.list_notes(&Filter::default(), "archive", "", "updated")).unwrap().len()
            + core.with(|s| s.list_notes(&Filter::default(), "trash", "", "updated")).unwrap().len();
        println!("notas no banco (com a de boas-vindas): {ids}");
        let all: Vec<String> = core.with(|s| s.list_notes(&Filter::default(), "active", "", "updated")).unwrap().into_iter().map(|n| n.id).collect();
        let mut bad = 0;
        for id in &all {
            let state = core.with(|s| s.ydoc(id)).unwrap().unwrap();
            let n = crate::ydoc::to_note(id, &state).unwrap();
            let again = crate::ydoc::to_note(id, &crate::ydoc::from_note(&n)).unwrap();
            if again.body != n.body {
                bad += 1;
            }
        }
        println!("ida e volta pelo Y.Doc: {} de {} iguais", all.len() - bad, all.len());
        let empty = core.with(|s| s.list_notes(&Filter::default(), "active", "", "updated")).unwrap().iter().filter(|n| n.label.is_empty()).count();
        println!("notas sem rótulo (sem título nem texto): {empty}");
        let _ = std::fs::remove_dir_all(&tmp);
        assert_eq!(bad, 0);
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
