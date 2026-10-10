//! Backup local: um arquivo `.ideario` (zip) com tudo o que precisa para trazer as notas de volta, inclusive sem o
//! Google Drive. Restaurar **junta** com o que já está no app (como o sync): nada se perde.
//!
//! Dentro do arquivo:
//! - `manifest.json`: formato, versão do app, data, contagens;
//! - `notes/<id>.ydoc`: o estado Yjs de cada nota (a fonte da verdade, inclusive arquivadas e na lixeira);
//! - `notes.json`: criação e última edição de cada nota;
//! - `categories.json`: as categorias (nome, cor, ordem, oculta, PIN);
//! - `attachments.json` + `attachments/<hash>` (+ `thumbs/<hash>.webp`): os anexos que estão neste computador;
//! - `leitura/*.md`: cada nota em Markdown, para ler sem o app.
//!
//! O automático faz um por semana numa pasta escolhida e guarda os 4 últimos.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::commands::Core;
use crate::store::{now, Attachment, CategoryRow, Millis, Result, Store};
use crate::{attachments, markdown, ydoc};

const FORMAT: u32 = 1;
pub const EXTENSION: &str = "ideario";
const AUTO_PREFIX: &str = "Ideario backup ";
const WEEK: Millis = 7 * 24 * 60 * 60 * 1000;
/// Quantos backups automáticos ficam na pasta.
const KEEP: usize = 4;

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    pub path: String,
    pub notes: usize,
    pub attachments: usize,
    /// Anexos que não estão neste computador (só no Drive) e ficaram de fora.
    pub skipped_attachments: usize,
    pub bytes: u64,
}

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    /// Notas que não existiam aqui (apagadas para sempre, por exemplo) e voltaram.
    pub new_notes: usize,
    /// Notas que já existiam: o backup se juntou a elas.
    pub merged_notes: usize,
    pub categories: usize,
    pub attachments: usize,
    /// Ids das notas mexidas (o editor aberto numa delas junta na hora).
    #[serde(skip)]
    pub ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: u32,
    pub app_version: String,
    pub created_at: Millis,
    pub notes: usize,
    pub attachments: usize,
}

#[derive(Serialize, Deserialize)]
struct Times {
    created: Millis,
    updated: Millis,
}

#[derive(Serialize, Deserialize)]
struct CategoryEntry {
    id: String,
    name: String,
    color: String,
    sort: i64,
    deleted: bool,
    hidden: bool,
    pin: Option<String>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn opts(method: CompressionMethod) -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(method).large_file(true)
}

/// Nome de arquivo seguro para a cópia em Markdown.
fn safe_name(title: &str, id: &str) -> String {
    let t: String = title.chars().map(|c| if "/\\:*?\"<>|\n\r\t".contains(c) { ' ' } else { c }).collect::<String>().trim().chars().take(60).collect();
    let short = id.get(..8).unwrap_or(id);
    if t.is_empty() {
        format!("Sem título {short}.md")
    } else {
        format!("{t} {short}.md")
    }
}

/// Grava o backup em `dest` (num arquivo ao lado e depois troca: nunca fica um backup pela metade).
/// A trava do banco só é pega para ler o que vai no arquivo; os anexos são copiados sem ela.
pub fn export(core: &Core, dest: &Path, progress: impl Fn(usize, usize)) -> Result<BackupReport> {
    let (notes, cats, atts, texts) = core.with(|s| {
        let notes = s.backup_notes()?;
        let names = |h: &str| s.get_attachments(&[h.to_string()]).ok().and_then(|v| v.into_iter().next()).map(|a| a.name);
        // a cópia de leitura: só as notas fora da lixeira
        let mut texts = Vec::new();
        for (id, state, _, _) in &notes {
            if let Ok(n) = ydoc::to_note(id, state) {
                if n.trashed_at.is_none() {
                    let md = markdown::to_markdown(&n.body, &names);
                    let title = if n.title.is_empty() { String::new() } else { format!("# {}\n\n", n.title) };
                    texts.push((safe_name(&n.title, id), format!("{title}{md}\n")));
                }
            }
        }
        Ok((notes, s.category_rows()?, s.all_attachments()?, texts))
    })?;
    let dir = attachments::dir(&core.data);
    let (present, missing): (Vec<Attachment>, Vec<Attachment>) = atts.into_iter().partition(|a| dir.join(&a.hash).is_file());
    let total = notes.len() + present.len();
    let part = dest.with_extension(format!("{EXTENSION}.part"));
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(err)?;
    }
    let result = (|| -> Result<()> {
        let mut z = ZipWriter::new(BufWriter::new(File::create(&part).map_err(err)?));
        let deflate = opts(CompressionMethod::Deflated);
        let stored = opts(CompressionMethod::Stored);
        let manifest = Manifest { format: FORMAT, app_version: env!("CARGO_PKG_VERSION").into(), created_at: now(), notes: notes.len(), attachments: present.len() };
        z.start_file("manifest.json", deflate).map_err(err)?;
        z.write_all(&serde_json::to_vec_pretty(&manifest).map_err(err)?).map_err(err)?;
        let times: HashMap<&str, Times> = notes.iter().map(|(id, _, c, u)| (id.as_str(), Times { created: *c, updated: *u })).collect();
        z.start_file("notes.json", deflate).map_err(err)?;
        z.write_all(&serde_json::to_vec(&times).map_err(err)?).map_err(err)?;
        let cats: Vec<CategoryEntry> = cats
            .into_iter()
            .map(|c| CategoryEntry { id: c.id, name: c.name, color: c.color, sort: c.sort, deleted: c.deleted, hidden: c.hidden, pin: c.pin })
            .collect();
        z.start_file("categories.json", deflate).map_err(err)?;
        z.write_all(&serde_json::to_vec_pretty(&cats).map_err(err)?).map_err(err)?;
        z.start_file("attachments.json", deflate).map_err(err)?;
        z.write_all(&serde_json::to_vec(&present).map_err(err)?).map_err(err)?;
        let mut done = 0;
        for (id, state, _, _) in &notes {
            z.start_file(format!("notes/{id}.ydoc"), deflate).map_err(err)?;
            z.write_all(state).map_err(err)?;
            done += 1;
            progress(done, total);
        }
        let mut seen = std::collections::HashSet::new();
        for (name, text) in &texts {
            let mut name = name.clone();
            while !seen.insert(name.clone()) {
                name = format!("_{name}");
            }
            z.start_file(format!("leitura/{name}"), deflate).map_err(err)?;
            z.write_all(text.as_bytes()).map_err(err)?;
        }
        for a in &present {
            // fotos (WebP), vídeo e áudio já vêm comprimidos: guardar como estão
            z.start_file(format!("attachments/{}", a.hash), stored).map_err(err)?;
            std::io::copy(&mut BufReader::new(File::open(dir.join(&a.hash)).map_err(err)?), &mut z).map_err(err)?;
            let thumb = attachments::thumb_path(&core.data, &a.hash);
            if thumb.is_file() {
                z.start_file(format!("thumbs/{}.webp", a.hash), stored).map_err(err)?;
                std::io::copy(&mut BufReader::new(File::open(&thumb).map_err(err)?), &mut z).map_err(err)?;
            }
            done += 1;
            progress(done, total);
        }
        z.finish().map_err(err)?.flush().map_err(err)?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    std::fs::rename(&part, dest).map_err(err)?;
    Ok(BackupReport {
        path: dest.display().to_string(),
        notes: notes.len(),
        attachments: present.len(),
        skipped_attachments: missing.len(),
        bytes: std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0),
    })
}

fn open(path: &Path) -> Result<ZipArchive<BufReader<File>>> {
    let file = File::open(path).map_err(|e| format!("não consegui abrir {}: {e}", path.display()))?;
    ZipArchive::new(BufReader::new(file)).map_err(|_| "este arquivo não é um backup do Ideario".to_string())
}

fn read_entry<R: Read + std::io::Seek>(z: &mut ZipArchive<R>, name: &str) -> Result<Option<Vec<u8>>> {
    match z.by_name(name) {
        Ok(mut f) => {
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).map_err(err)?;
            Ok(Some(buf))
        }
        Err(zip::result::ZipError::FileNotFound) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// O que tem no backup (para perguntar antes de restaurar).
pub fn inspect(path: &Path) -> Result<Manifest> {
    let mut z = open(path)?;
    let bytes = read_entry(&mut z, "manifest.json")?.ok_or("este arquivo não é um backup do Ideario")?;
    let m: Manifest = serde_json::from_slice(&bytes).map_err(|_| "este arquivo não é um backup do Ideario".to_string())?;
    if m.format > FORMAT {
        return Err("este backup foi feito por uma versão mais nova do Ideario; atualize o app".into());
    }
    Ok(m)
}

/// Junta o backup com o que está no app: anexos que faltam, categorias que faltam e cada nota (a mesma nota nos dois
/// lados se junta pelo Y.Doc, como no sync). Uma nota por vez, com a trava do banco só durante a gravação dela.
pub fn restore(core: &Core, path: &Path, progress: impl Fn(usize, usize)) -> Result<RestoreReport> {
    inspect(path)?;
    let mut z = open(path)?;
    let mut r = RestoreReport::default();
    // anexos primeiro: as notas que entram já acham o nome e o tipo deles
    let atts: Vec<Attachment> = serde_json::from_slice(&read_entry(&mut z, "attachments.json")?.unwrap_or_else(|| b"[]".to_vec())).map_err(err)?;
    let dir = attachments::dir(&core.data);
    let note_names: Vec<String> = z.file_names().filter(|n| n.starts_with("notes/") && n.ends_with(".ydoc")).map(str::to_string).collect();
    let total = atts.len() + note_names.len();
    let mut done = 0;
    for a in &atts {
        if !dir.join(&a.hash).is_file() {
            if let Some(bytes) = read_entry(&mut z, &format!("attachments/{}", a.hash))? {
                attachments::store_file(&core.data, &a.hash, &bytes)?;
                if let Some(thumb) = read_entry(&mut z, &format!("thumbs/{}.webp", a.hash))? {
                    attachments::store_thumb(&core.data, &a.hash, &thumb)?;
                }
                core.with(|s| {
                    s.insert_attachment(a)?;
                    s.set_attachment_local(&a.hash)
                })?;
                r.attachments += 1;
            }
        }
        done += 1;
        progress(done, total);
    }
    let cats: Vec<CategoryEntry> = serde_json::from_slice(&read_entry(&mut z, "categories.json")?.unwrap_or_else(|| b"[]".to_vec())).map_err(err)?;
    let rows: Vec<CategoryRow> = cats
        .into_iter()
        .map(|c| CategoryRow { id: c.id, name: c.name, color: c.color, sort: c.sort, deleted: c.deleted, hidden: c.hidden, pin: c.pin })
        .collect();
    r.categories = core.with(|s| s.merge_backup_categories(&rows))?;
    // App recém-instalado: a nota de boas-vindas intocada sai (senão ficariam duas, a daqui e a do backup).
    let welcome = core.with(|s| s.sync_value("welcome_note"))?;
    if welcome.is_some_and(|w| !note_names.iter().any(|n| n.contains(w.as_str()))) {
        core.with(|s| s.drop_untouched_welcome())?;
    }
    let times: HashMap<String, Times> = serde_json::from_slice(&read_entry(&mut z, "notes.json")?.unwrap_or_else(|| b"{}".to_vec())).map_err(err)?;
    for name in &note_names {
        let id = name.trim_start_matches("notes/").trim_end_matches(".ydoc").to_string();
        let state = read_entry(&mut z, name)?.unwrap_or_default();
        // estado que não abre (arquivo estragado): pula essa nota, não o backup inteiro
        if id.is_empty() || id.chars().any(|c| !c.is_ascii_alphanumeric() && c != '-') || ydoc::to_note(&id, &state).is_err() {
            done += 1;
            continue;
        }
        let is_new = core.with(|s| merge_note(s, &id, &state, times.get(&id)))?;
        if is_new {
            r.new_notes += 1;
        } else {
            r.merged_notes += 1;
        }
        r.ids.push(id);
        done += 1;
        progress(done, total);
    }
    Ok(r)
}

/// Junta uma nota do backup. Devolve se ela não existia aqui.
fn merge_note(s: &Store, id: &str, state: &[u8], times: Option<&Times>) -> Result<bool> {
    let existed = s.note_exists(id)?;
    s.apply_update(id, state)?;
    if !existed {
        if let Some(t) = times {
            s.set_times(id, t.created, t.updated)?;
        }
    }
    Ok(!existed)
}

// ---------- automático ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub auto: bool,
    /// Pasta dos automáticos (escolhida, ou a sugerida: Documentos/Ideario backups).
    pub dir: Option<String>,
    pub last: Option<Millis>,
}

fn default_dir() -> Option<PathBuf> {
    dirs::document_dir().or_else(dirs::home_dir).map(|d| d.join("Ideario backups"))
}

pub fn status(s: &Store) -> Result<BackupStatus> {
    Ok(BackupStatus {
        auto: s.sync_value("backup_auto")?.as_deref() == Some("1"),
        dir: s.sync_value("backup_dir")?.or_else(|| default_dir().map(|d| d.display().to_string())),
        last: s.sync_value("backup_last")?.and_then(|v| v.parse().ok()),
    })
}

/// Nome do backup automático de hoje (com a hora, se já houver um de hoje).
pub(crate) fn auto_name(dir: &Path, at: Millis) -> PathBuf {
    let local = chrono::TimeZone::timestamp_millis_opt(&chrono::Local, at).single().unwrap_or_else(chrono::Local::now);
    let day = dir.join(format!("{AUTO_PREFIX}{}.{EXTENSION}", local.format("%Y-%m-%d")));
    if day.exists() {
        dir.join(format!("{AUTO_PREFIX}{}.{EXTENSION}", local.format("%Y-%m-%d %Hh%M")))
    } else {
        day
    }
}

/// Deixa só os `KEEP` backups automáticos mais novos na pasta (os outros arquivos da pasta ficam).
pub fn prune(dir: &Path, keep: usize) -> Result<usize> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(err)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.starts_with(AUTO_PREFIX) && name.ends_with(&format!(".{EXTENSION}"))
        })
        .collect();
    // o nome tem a data (e a hora): a ordem do nome é a ordem do tempo
    found.sort();
    let extra = found.len().saturating_sub(keep);
    for p in &found[..extra] {
        std::fs::remove_file(p).map_err(err)?;
    }
    Ok(extra)
}

/// Faz o backup automático se está ligado e o último tem uma semana ou mais.
pub fn auto_if_due(core: &Core, at: Millis) -> Result<Option<BackupReport>> {
    let st = core.with(status)?;
    let (true, Some(dir)) = (st.auto, st.dir) else { return Ok(None) };
    if st.last.is_some_and(|l| at - l < WEEK) {
        return Ok(None);
    }
    let dir = PathBuf::from(dir);
    let report = export(core, &auto_name(&dir, at), |_, _| ())?;
    core.with(|s| s.set_sync_value("backup_last", Some(&at.to_string())))?;
    prune(&dir, KEEP)?;
    Ok(Some(report))
}

/// Linha de fundo do automático: confere um minuto depois de abrir e, depois, de hora em hora.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(60));
        loop {
            let core = app.state::<Core>();
            if let Err(e) = auto_if_due(&core, now()) {
                eprintln!("backup automático: {e}");
            }
            std::thread::sleep(Duration::from_secs(60 * 60));
        }
    });
}

// ---------- comandos ----------

type Core_<'a> = tauri::State<'a, Core>;

#[tauri::command]
pub fn backup_status(core: Core_) -> Result<BackupStatus> {
    core.with(status)
}

/// Liga/desliga o automático e escolhe a pasta. Ligar faz o primeiro em seguida (na linha de fundo).
#[tauri::command]
pub fn backup_set_auto(app: AppHandle, core: Core_, enabled: bool, dir: Option<String>) -> Result<BackupStatus> {
    core.with(|s| {
        s.set_sync_value("backup_auto", enabled.then_some("1"))?;
        if let Some(d) = dir.as_deref().filter(|d| !d.is_empty()) {
            s.set_sync_value("backup_dir", Some(d))?;
        }
        Ok(())
    })?;
    if enabled {
        std::thread::spawn(move || {
            let core = app.state::<Core>();
            if let Err(e) = auto_if_due(&core, now()) {
                eprintln!("backup automático: {e}");
            }
        });
    }
    core.with(status)
}

#[tauri::command]
pub async fn backup_export(app: AppHandle, path: String) -> Result<BackupReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let core = app.state::<Core>();
        let r = export(&core, Path::new(&path), |done, total| {
            let _ = app.emit("backup-progress", (done, total));
        })?;
        core.with(|s| s.set_sync_value("backup_last_manual", Some(&now().to_string())))?;
        Ok(r)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn backup_inspect(path: String) -> Result<Manifest> {
    tauri::async_runtime::spawn_blocking(move || inspect(Path::new(&path))).await.map_err(err)?
}

#[tauri::command]
pub async fn backup_restore(app: AppHandle, path: String) -> Result<RestoreReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let core = app.state::<Core>();
        let r = restore(&core, Path::new(&path), |done, total| {
            let _ = app.emit("backup-progress", (done, total));
        })?;
        let _ = app.emit("notes-synced", &r.ids);
        let _ = app.emit("core-changed", ());
        Ok(r)
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn core(tag: &str) -> (Core, Tmp) {
        let dir = std::env::temp_dir().join(format!("ideario-backup-{tag}-{}", uuid::Uuid::now_v7()));
        (Core::open(dir.join("data")).unwrap(), Tmp(dir))
    }

    fn note(id: &str, title: &str, text: &str) -> crate::store::NoteInput {
        crate::store::NoteInput {
            id: id.into(),
            title: title.into(),
            body: json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]}),
            category_id: None,
            color: "none".into(),
            pinned: false,
            archived: false,
            trashed_at: None,
            reminder_at: None,
            reminder_done: false,
            reminder_repeat: None,
            tags: vec![],
        }
    }

    fn texts(c: &Core) -> Vec<String> {
        let mut t: Vec<String> = c
            .with(|s| s.backup_notes())
            .unwrap()
            .iter()
            .map(|(id, st, _, _)| {
                let n = ydoc::to_note(id, st).unwrap();
                format!("{}: {}", n.title, n.body.to_string().len())
            })
            .collect();
        t.sort();
        t
    }

    #[test]
    fn export_and_restore_merge_without_losing_anything() {
        let (a, t) = core("a");
        // notas (uma na lixeira), categoria com PIN, uma foto
        let cat = a.with(|s| s.create_category("Senhas", "#C0392B")).unwrap();
        a.with(|s| s.set_category_pin(&cat.id, Some("1234"))).unwrap();
        let mut n1 = note("0199aaaa-0000-7000-8000-000000000001", "Mercado", "leite e pão");
        n1.category_id = Some(cat.id.clone());
        let mut n2 = note("0199aaaa-0000-7000-8000-000000000002", "Velha", "na lixeira");
        n2.trashed_at = Some(now());
        let png = {
            let mut buf = std::io::Cursor::new(Vec::new());
            image::RgbImage::from_fn(32, 24, |x, _| image::Rgb([x as u8 * 8, 100, 200])).write_to(&mut buf, image::ImageFormat::Png).unwrap();
            buf.into_inner()
        };
        let att = a.with(|s| attachments::import(s, &a.data, &png, "praia.png", "image/png")).unwrap();
        let mut n3 = note("0199aaaa-0000-7000-8000-000000000003", "Foto", "x");
        n3.body = json!({"type":"doc","content":[{"type":"noteImage","attrs":{"hash": att.hash}}]});
        for n in [&n1, &n2, &n3] {
            a.with(|s| s.save_note(n).map(|_| ())).unwrap();
        }
        a.with(|s| s.set_times(&n1.id, 1_000, 2_000)).unwrap();
        let file = t.0.join("meu backup.ideario");
        let r = export(&a, &file, |_, _| ()).unwrap();
        assert_eq!((r.notes, r.attachments, r.skipped_attachments), (4, 1, 0), "3 + a de boas-vindas");
        assert!(!t.0.join("meu backup.ideario.part").exists());
        let m = inspect(&file).unwrap();
        assert_eq!((m.format, m.notes, m.attachments), (FORMAT, 4, 1));
        // a cópia de leitura em Markdown (sem a da lixeira)
        let mut z = open(&file).unwrap();
        let reading: Vec<String> = z.file_names().filter(|n| n.starts_with("leitura/")).map(str::to_string).collect();
        assert_eq!(reading.len(), 3, "{reading:?}");
        let md = String::from_utf8(read_entry(&mut z, reading.iter().find(|n| n.contains("Mercado")).unwrap()).unwrap().unwrap()).unwrap();
        assert_eq!(md, "# Mercado\n\nleite e pão\n");

        // outro computador, vazio: volta tudo, com as datas, a categoria com o PIN e a foto
        let (b, _tb) = core("b");
        let rr = restore(&b, &file, |_, _| ()).unwrap();
        assert_eq!((rr.new_notes, rr.categories, rr.attachments), (4, 1, 1), "{rr:?}");
        assert_eq!(texts(&a), texts(&b));
        assert_eq!(b.with(|s| s.note_times(&n1.id)).unwrap(), (1_000, 2_000));
        assert!(b.with(|s| s.check_pin(&cat.id, "1234")).unwrap());
        assert!(attachments::dir(&b.data).join(&att.hash).is_file());
        assert!(b.with(|s| s.get_note(&n2.id)).unwrap().unwrap().trashed_at.is_some(), "a da lixeira volta na lixeira");

        // no mesmo computador, depois de mexer: junta (o que foi escrito depois fica; a apagada volta)
        let mut edited = a.with(|s| s.note_input(&n1.id)).unwrap().unwrap();
        edited.title = "Mercado da semana".into();
        a.with(|s| s.save_note(&edited).map(|_| ())).unwrap();
        a.with(|s| s.delete_note(&n2.id).map(|_| ())).unwrap();
        let rr = restore(&a, &file, |_, _| ()).unwrap();
        assert_eq!((rr.new_notes, rr.merged_notes), (1, 3));
        assert_eq!(a.with(|s| s.get_note(&n1.id)).unwrap().unwrap().title, "Mercado da semana");
        assert!(a.with(|s| s.note_exists(&n2.id)).unwrap());
        // restaurar de novo não muda nada
        let before = texts(&a);
        restore(&a, &file, |_, _| ()).unwrap();
        assert_eq!(texts(&a), before);
    }

    #[test]
    fn not_a_backup_is_a_clear_error() {
        let (c, t) = core("x");
        let f = t.0.join("x.ideario");
        std::fs::write(&f, b"qualquer coisa").unwrap();
        assert_eq!(inspect(&f).unwrap_err(), "este arquivo não é um backup do Ideario");
        assert!(restore(&c, &f, |_, _| ()).is_err());
        // zip qualquer (sem manifest)
        let mut z = ZipWriter::new(File::create(&f).unwrap());
        z.start_file("a.txt", SimpleFileOptions::default()).unwrap();
        z.write_all(b"oi").unwrap();
        z.finish().unwrap();
        assert!(inspect(&f).is_err());
    }

    #[test]
    fn automatic_weekly_and_keeps_the_last_four() {
        let (c, t) = core("auto");
        let dir = t.0.join("backups");
        c.with(|s| {
            s.set_sync_value("backup_auto", Some("1"))?;
            s.set_sync_value("backup_dir", Some(&dir.display().to_string()))
        })
        .unwrap();
        let day = 24 * 60 * 60 * 1000;
        let t0 = now();
        assert!(auto_if_due(&c, t0).unwrap().is_some());
        assert!(auto_if_due(&c, t0 + 3 * day).unwrap().is_none(), "menos de uma semana");
        for w in 1..=6 {
            assert!(auto_if_due(&c, t0 + w * 7 * day).unwrap().is_some());
        }
        let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        // ficam os 4 mais novos (semanas 3 a 6)
        let expect: Vec<String> = (3..=6).map(|w| auto_name(Path::new(""), t0 + w * 7 * day).display().to_string()).collect();
        assert_eq!(left, expect);
        // outros arquivos da pasta não são tocados
        std::fs::write(dir.join("minha planilha.xlsx"), b"x").unwrap();
        assert_eq!(prune(&dir, 1).unwrap(), KEEP - 1);
        assert!(dir.join("minha planilha.xlsx").exists());
        // desligado: não faz
        c.with(|s| s.set_sync_value("backup_auto", None)).unwrap();
        assert!(auto_if_due(&c, t0 + 100 * day).unwrap().is_none());
        let st = c.with(status).unwrap();
        assert!(!st.auto && st.last.is_some());
        let _: Value = json!(st.dir);
    }
}
