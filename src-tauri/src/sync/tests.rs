//! Dois (ou três) aparelhos, cada um com o seu banco, sincronizando pelo mesmo Drive (em memória).
//! O critério da Fase 5: editar a mesma nota offline nos dois e sincronizar preserva as duas edições.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use proptest::prelude::*;
use serde_json::{json, Map, Value};

use super::memory::MemoryDrive;
use super::*;
use crate::store::{NoteInput, Store};

struct Dev {
    store: Mutex<Store>,
    data: PathBuf,
}

impl Dev {
    fn new() -> Dev {
        let data = std::env::temp_dir().join(format!("ideario-sync-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&data).unwrap();
        let store = Store::open(&data.join("ideario.db")).unwrap();
        Dev { store: Mutex::new(store), data }
    }

    fn s(&self) -> MutexGuard<'_, Store> {
        self.store.lock().unwrap()
    }

    fn sync(&self, drive: &MemoryDrive) -> SResult<Report> {
        sync_once(&Device { store: &self.store, data: &self.data }, &mut drive.clone())
    }

    fn pull(&self, drive: &MemoryDrive) {
        pull(&Device { store: &self.store, data: &self.data }, &mut drive.clone(), &mut Report::default()).unwrap();
    }

    fn push(&self, drive: &MemoryDrive) {
        push(&Device { store: &self.store, data: &self.data }, &mut drive.clone(), &mut Report::default()).unwrap();
    }

    fn note(&self, id: &str) -> Option<NoteInput> {
        let state = self.s().ydoc(id).unwrap()?;
        Some(crate::ydoc::to_note(id, &state).unwrap())
    }

    fn text(&self, id: &str) -> String {
        self.s().note_text(id).unwrap()
    }

    fn create(&self, id: &str, title: &str, text: &str) {
        self.s().save_note(&input(id, title, text)).unwrap();
    }

    /// Digita no corpo, como o editor (atualização Yjs).
    fn type_text(&self, id: &str, block: u32, at: u32, text: &str) {
        let s = self.s();
        let state = s.ydoc(id).unwrap().unwrap_or_default();
        s.apply_update(id, &crate::ydoc::type_text(&state, block, at, text)).unwrap();
    }

    fn patch(&self, id: &str, key: &str, value: Value) {
        let mut m = Map::new();
        m.insert(key.into(), value);
        self.s().update_note(id, &m).unwrap();
    }

    fn ids(&self) -> Vec<String> {
        let s = self.s();
        let mut v: Vec<String> = ["active", "archive", "trash"]
            .iter()
            .flat_map(|b| s.list_notes(&Default::default(), b, "", "updated").unwrap())
            .map(|n| n.id)
            .collect();
        v.sort();
        v
    }
}

fn input(id: &str, title: &str, text: &str) -> NoteInput {
    NoteInput {
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

/// Os dois aparelhos veem exatamente as mesmas notas, com o mesmo conteúdo.
fn assert_same(a: &Dev, b: &Dev) {
    assert_eq!(a.ids(), b.ids());
    for id in a.ids() {
        let (x, y) = (a.note(&id).unwrap(), b.note(&id).unwrap());
        assert_eq!((x.title, x.body, x.pinned, x.color, x.trashed_at), (y.title, y.body, y.pinned, y.color, y.trashed_at), "nota {id}");
    }
}

#[test]
fn a_note_goes_to_the_other_device() {
    let drive = MemoryDrive::default();
    let (a, b) = (Dev::new(), Dev::new());
    a.create("n1", "Mercado", "arroz e feijão");
    let r = a.sync(&drive).unwrap();
    assert_eq!(r.sent, 1);
    assert!(a.s().dirty_notes().unwrap().is_empty(), "enviada, não fica pendente");
    let r = b.sync(&drive).unwrap();
    assert_eq!(r.received, 1);
    assert!(r.changed_here());
    assert_eq!(b.text("n1"), a.text("n1"));
    assert!(b.s().dirty_notes().unwrap().is_empty(), "chegou do Drive, não volta para lá");
    // as datas vêm junto
    assert_eq!(b.s().note_times("n1").unwrap(), a.s().note_times("n1").unwrap());
    assert_same(&a, &b);
}

#[test]
fn offline_edits_on_two_devices_are_both_kept() {
    let drive = MemoryDrive::default();
    let (a, b) = (Dev::new(), Dev::new());
    a.create("n1", "Mercado", "arroz");
    a.sync(&drive).unwrap();
    b.sync(&drive).unwrap();
    // offline: cada um edita a mesma nota
    a.type_text("n1", 0, 0, "comprar ");
    a.patch("n1", "pinned", json!(true));
    b.type_text("n1", 0, 99, " e café");
    b.patch("n1", "color", json!("sky"));
    // voltam: sincronizam em qualquer ordem
    a.sync(&drive).unwrap();
    b.sync(&drive).unwrap();
    a.sync(&drive).unwrap();
    assert_eq!(a.text("n1"), "Mercado\ncomprar arroz e café");
    let n = a.note("n1").unwrap();
    assert!(n.pinned);
    assert_eq!(n.color, "sky");
    assert_same(&a, &b);
    // e para de trafegar: nada pendente, nada a subir
    let before = drive.traffic();
    a.sync(&drive).unwrap();
    b.sync(&drive).unwrap();
    assert_eq!(drive.traffic().0, before.0, "sem mudanças, nada sobe");
}

#[test]
fn simultaneous_overwrite_converges_on_the_next_round() {
    // B lê o Drive, A envia, e só depois B envia a versão dele (sem a edição de A) por cima.
    let drive = MemoryDrive::default();
    let (a, b) = (Dev::new(), Dev::new());
    a.create("n1", "", "base");
    a.sync(&drive).unwrap();
    b.sync(&drive).unwrap();
    a.type_text("n1", 0, 4, " de A");
    b.type_text("n1", 0, 0, "B: ");
    b.pull(&drive);
    a.sync(&drive).unwrap();
    b.push(&drive);
    // a edição de A sumiu do Drive por um momento, mas A ainda tem e volta a enviar
    a.sync(&drive).unwrap();
    b.sync(&drive).unwrap();
    assert_eq!(a.text("n1"), "B: base de A");
    assert_same(&a, &b);
}

#[test]
fn trash_and_permanent_delete_reach_the_other_device() {
    let drive = MemoryDrive::default();
    let (a, b) = (Dev::new(), Dev::new());
    a.create("n1", "Lixo", "x");
    a.create("n2", "Some", "y");
    a.sync(&drive).unwrap();
    b.sync(&drive).unwrap();
    a.patch("n1", "trashedAt", json!(1_700_000_000_000_i64));
    a.s().delete_note("n2").unwrap();
    a.sync(&drive).unwrap();
    assert_eq!(drive.files().len(), 1, "o arquivo da excluída de vez sai do Drive");
    let r = b.sync(&drive).unwrap();
    assert_eq!(r.removed, 1);
    assert_eq!(b.note("n1").unwrap().trashed_at, Some(1_700_000_000_000));
    assert!(b.note("n2").is_none());
    assert_same(&a, &b);
}

#[test]
fn a_note_edited_here_survives_being_deleted_elsewhere() {
    let drive = MemoryDrive::default();
    let (a, b) = (Dev::new(), Dev::new());
    a.create("n1", "", "importante");
    a.sync(&drive).unwrap();
    b.sync(&drive).unwrap();
    a.s().delete_note("n1").unwrap();
    b.type_text("n1", 0, 99, " e editada");
    a.sync(&drive).unwrap();
    b.sync(&drive).unwrap();
    a.sync(&drive).unwrap();
    assert_eq!(b.text("n1"), "importante e editada");
    assert_eq!(a.text("n1"), "importante e editada", "a edição não se perde: a nota volta");
}

#[test]
fn categories_sync_and_merge_field_by_field() {
    let drive = MemoryDrive::default();
    let (a, b) = (Dev::new(), Dev::new());
    let casa = a.s().create_category("Casa", "#C26A3D").unwrap();
    a.create("n1", "", "x");
    a.patch("n1", "categoryId", json!(casa.id));
    a.sync(&drive).unwrap();
    b.sync(&drive).unwrap();
    let names = |d: &Dev| d.s().list_categories().unwrap().into_iter().map(|c| (c.name, c.color, c.note_count)).collect::<Vec<_>>();
    assert_eq!(names(&b), vec![("Casa".to_string(), "#C26A3D".to_string(), 1)]);
    // um renomeia, o outro muda a cor
    a.s().update_category(&casa.id, Some("Lar"), None).unwrap();
    b.s().update_category(&casa.id, None, Some("#3D63D6")).unwrap();
    a.sync(&drive).unwrap();
    b.sync(&drive).unwrap();
    a.sync(&drive).unwrap();
    assert_eq!(names(&a), vec![("Lar".to_string(), "#3D63D6".to_string(), 1)]);
    assert_eq!(names(&a), names(&b));
    // apagar a categoria tira das notas nos dois
    b.s().delete_category(&casa.id).unwrap();
    b.sync(&drive).unwrap();
    a.sync(&drive).unwrap();
    assert!(a.s().list_categories().unwrap().is_empty());
    assert_eq!(a.note("n1").unwrap().category_id, None);
}

#[test]
fn photos_go_up_once_and_come_down_with_thumbnail() {
    let drive = MemoryDrive::default();
    let (a, b) = (Dev::new(), Dev::new());
    let png = {
        let img = image::RgbImage::from_fn(64, 48, |x, y| image::Rgb([(x * 4) as u8, (y * 5) as u8, 90]));
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    };
    let att = crate::attachments::import(&a.s(), &a.data, &png, "foto.png", "image/png").unwrap();
    let mut n = input("n1", "Com foto", "olha");
    n.body = json!({"type":"doc","content":[{"type":"noteImage","attrs":{"hash":att.hash}}]});
    a.s().save_note(&n).unwrap();
    a.sync(&drive).unwrap();
    a.sync(&drive).unwrap();
    assert_eq!(drive.files().iter().filter(|f| f.kind() == Some(ATTACHMENT)).count(), 1, "sobe uma vez só");
    let r = b.sync(&drive).unwrap();
    assert_eq!(r.files, 1);
    let got = b.s().get_attachments(std::slice::from_ref(&att.hash)).unwrap();
    assert_eq!(got[0].palette, att.palette, "paleta e tom vêm junto, sem recalcular");
    assert_eq!(std::fs::read(crate::attachments::dir(&b.data).join(&att.hash)).unwrap(), std::fs::read(crate::attachments::dir(&a.data).join(&att.hash)).unwrap());
    assert!(crate::attachments::thumb_path(&b.data, &att.hash).exists(), "miniatura feita aqui");
    assert_eq!(b.s().get_note("n1").unwrap().unwrap().media.len(), 1);
    // B não reenvia o que veio do Drive
    let ups = drive.traffic().0;
    b.sync(&drive).unwrap();
    assert_eq!(drive.traffic().0, ups);
}

#[test]
fn a_corrupted_download_is_not_stored() {
    let drive = MemoryDrive::default();
    let (a, b) = (Dev::new(), Dev::new());
    let att = crate::attachments::import(&a.s(), &a.data, b"%PDF-1.4 conteudo", "doc.pdf", "application/pdf").unwrap();
    let mut n = input("n1", "", "");
    n.body = json!({"type":"doc","content":[{"type":"noteFile","attrs":{"hash":att.hash}}]});
    a.s().save_note(&n).unwrap();
    a.sync(&drive).unwrap();
    let file = drive.files().into_iter().find(|f| f.kind() == Some(ATTACHMENT)).unwrap();
    drive.overwrite(&file.id, b"outra coisa");
    let r = b.sync(&drive).unwrap();
    assert_eq!(r.files, 0);
    assert!(!crate::attachments::dir(&b.data).join(&att.hash).exists());
}

#[test]
fn joining_an_account_drops_the_untouched_welcome_note() {
    let drive = MemoryDrive::default();
    let a = Dev::new();
    a.create("n1", "Minha", "nota");
    a.sync(&drive).unwrap();
    let b = Dev::new();
    b.create("welcome", "Bem-vindo", "oi");
    b.s().set_sync_value("welcome_note", Some("welcome")).unwrap();
    b.sync(&drive).unwrap();
    assert_eq!(b.ids(), vec!["n1".to_string()]);
    // num Drive vazio (primeiro aparelho), ela fica
    let (empty, c) = (MemoryDrive::default(), Dev::new());
    c.create("welcome", "Bem-vindo", "oi");
    c.s().set_sync_value("welcome_note", Some("welcome")).unwrap();
    c.sync(&empty).unwrap();
    assert_eq!(c.ids(), vec!["welcome".to_string()]);
}

#[test]
fn the_same_note_created_on_two_devices_is_one_note() {
    // O mesmo Takeout importado nos dois antes de sincronizar: mesmo id, mesmo conteúdo.
    let drive = MemoryDrive::default();
    let (a, b) = (Dev::new(), Dev::new());
    a.create("keep-1", "Do Keep", "texto importado");
    b.create("keep-1", "Do Keep", "texto importado");
    a.sync(&drive).unwrap();
    b.sync(&drive).unwrap();
    a.sync(&drive).unwrap();
    assert_eq!(b.text("keep-1"), "Do Keep\ntexto importado", "sem texto duplicado");
    assert_same(&a, &b);
    assert_eq!(drive.files().iter().filter(|f| f.kind() == Some(NOTE)).count(), 1);
}

#[test]
fn two_files_for_one_note_collapse_into_one() {
    // A e B criam o arquivo da mesma nota ao mesmo tempo (cada um sem ver o do outro).
    let drive = MemoryDrive::default();
    let (a, b) = (Dev::new(), Dev::new());
    a.create("n1", "", "x");
    a.sync(&drive).unwrap();
    b.create("n1", "", "x");
    b.type_text("n1", 0, 1, "y");
    b.pull(&drive);
    // Esquece o arquivo que acabou de juntar: B vai criar o dele.
    b.s().conn.execute("UPDATE notes SET drive_file_id = NULL, dirty = 1", []).unwrap();
    b.push(&drive);
    assert_eq!(drive.files().len(), 2);
    for _ in 0..2 {
        a.sync(&drive).unwrap();
        b.sync(&drive).unwrap();
    }
    assert_eq!(drive.files().len(), 1, "fica um arquivo só");
    assert_eq!(a.text("n1"), "xy");
    assert_same(&a, &b);
}

#[test]
fn an_interrupted_sync_resumes_without_losing_or_duplicating() {
    let drive = MemoryDrive::default();
    let (a, b) = (Dev::new(), Dev::new());
    for i in 0..5 {
        a.create(&format!("n{i}"), &format!("Nota {i}"), "texto");
    }
    // a rede cai no meio do envio
    drive.fail_after(5);
    assert!(matches!(a.sync(&drive), Err(SyncError::Offline(_))));
    assert!(!a.s().dirty_notes().unwrap().is_empty(), "o que não subiu continua pendente");
    a.sync(&drive).unwrap();
    assert_eq!(drive.files().len(), 5, "nenhum arquivo duplicado");
    drive.fail_after(3);
    assert!(b.sync(&drive).is_err());
    b.sync(&drive).unwrap();
    assert_same(&a, &b);
}

#[test]
fn three_devices_converge() {
    let drive = MemoryDrive::default();
    let devs = [Dev::new(), Dev::new(), Dev::new()];
    devs[0].create("n1", "", "um");
    for d in &devs {
        d.sync(&drive).unwrap();
    }
    for (i, d) in devs.iter().enumerate() {
        d.type_text("n1", 0, 99, &format!(" {i}"));
        d.create(&format!("de-{i}"), "", "nova");
    }
    for _ in 0..2 {
        for d in &devs {
            d.sync(&drive).unwrap();
        }
    }
    let t = devs[0].text("n1");
    for i in 0..3 {
        assert!(t.contains(&format!(" {i}")), "{t}");
    }
    assert_same(&devs[0], &devs[1]);
    assert_same(&devs[1], &devs[2]);
    assert_eq!(devs[0].ids().len(), 4);
}

/// Uma ação de um aparelho, nos testes de propriedade.
#[derive(Debug, Clone)]
enum Op {
    Type { dev: usize, note: usize, at: u32, text: String },
    Pin { dev: usize, note: usize, on: bool },
    Trash { dev: usize, note: usize },
    Sync { dev: usize },
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        4 => (0..2usize, 0..3usize, 0..20u32, "[a-zé]{1,4}").prop_map(|(dev, note, at, text)| Op::Type { dev, note, at, text }),
        1 => (0..2usize, 0..3usize, any::<bool>()).prop_map(|(dev, note, on)| Op::Pin { dev, note, on }),
        1 => (0..2usize, 0..3usize).prop_map(|(dev, note)| Op::Trash { dev, note }),
        3 => (0..2usize).prop_map(|dev| Op::Sync { dev }),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 24, ..ProptestConfig::default() })]

    /// Qualquer sequência de edições e syncs em dois aparelhos termina igual nos dois, sem perder nenhum texto
    /// digitado.
    #[test]
    fn any_history_converges_without_losing_text(ops in prop::collection::vec(op(), 1..30)) {
        let drive = MemoryDrive::default();
        let devs = [Dev::new(), Dev::new()];
        let typed: std::cell::RefCell<Vec<(usize, String)>> = Default::default();
        for d in &devs {
            for n in 0..3 {
                d.create(&format!("n{n}"), "", "");
            }
        }
        for o in &ops {
            match o {
                Op::Type { dev, note, at, text } => {
                    devs[*dev].type_text(&format!("n{note}"), 0, *at, text);
                    typed.borrow_mut().push((*note, text.clone()));
                }
                Op::Pin { dev, note, on } => devs[*dev].patch(&format!("n{note}"), "pinned", json!(on)),
                Op::Trash { dev, note } => devs[*dev].patch(&format!("n{note}"), "trashedAt", json!(1_700_000_000_000_i64)),
                Op::Sync { dev } => { devs[*dev].sync(&drive).unwrap(); }
            }
        }
        for _ in 0..2 {
            for d in &devs {
                d.sync(&drive).unwrap();
            }
        }
        assert_same(&devs[0], &devs[1]);
        for (note, text) in typed.borrow().iter() {
            let all = devs[0].text(&format!("n{note}"));
            // cada pedaço digitado continua lá, mesmo que outro tenha caído no meio dele
            for ch in text.chars() {
                prop_assert!(all.contains(ch), "{text:?} sumiu de {all:?}");
            }
        }
    }
}

/// O Drive falso em memória atrás de um servidor HTTP que fala a API v3: o motor passa pelo `DriveApi` de verdade
/// (multipart, `appProperties`, `version`, `modifiedTime`, lista de mudanças).
fn http_drive(mem: MemoryDrive) -> String {
    use super::drive::tests::{serve, Req};
    let reply = |code: u16, v: Value| (code, vec![], v.to_string().into_bytes());
    let file_json = |f: &RemoteFile| {
        let t = chrono::DateTime::from_timestamp_millis(f.modified).unwrap_or_default().to_rfc3339();
        json!({"id": f.id, "version": f.rev, "modifiedTime": t, "appProperties": f.props, "description": f.description})
    };
    // metadados e conteúdo de um corpo multipart/related
    let parts = |r: &Req| -> (Value, Vec<u8>) {
        let ct = r.header("content-type").unwrap_or_default();
        let boundary = format!("--{}", ct.split("boundary=").nth(1).unwrap_or_default());
        let b = &r.body;
        let find = |from: usize, pat: &[u8]| b[from..].windows(pat.len()).position(|w| w == pat).map(|i| i + from).unwrap();
        let meta_start = find(0, b"\r\n\r\n") + 4;
        let meta_end = find(meta_start, format!("\r\n{boundary}").as_bytes());
        let media_start = find(meta_end + 2, b"\r\n\r\n") + 4;
        let media_end = find(media_start, format!("\r\n{boundary}--").as_bytes());
        (serde_json::from_slice(&b[meta_start..meta_end]).unwrap(), b[media_start..media_end].to_vec())
    };
    let props_of = |v: &Value| -> Props {
        v["appProperties"].as_object().map(|m| m.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string())).collect()).unwrap_or_default()
    };
    let (base, _) = serve(Box::new(move |r: &Req| {
        let mut d = mem.clone();
        let (path, query) = r.path.split_once('?').unwrap_or((&r.path, ""));
        let q = |k: &str| query.split('&').filter_map(|p| p.split_once('=')).find(|(n, _)| *n == k).map(|(_, v)| v.to_string());
        let out = match (r.method.as_str(), path) {
            ("GET", "/drive/v3/changes/startPageToken") => d.start_token().map(|t| reply(200, json!({"startPageToken": t}))),
            ("GET", "/drive/v3/files") => d.list_all().map(|fs| reply(200, json!({"files": fs.iter().map(file_json).collect::<Vec<_>>()}))),
            ("GET", "/drive/v3/changes") => d.changes(&q("pageToken").unwrap_or_default()).map(|(cs, next)| {
                let cs: Vec<Value> = cs
                    .iter()
                    .map(|c| match c {
                        Change::Upsert(f) => json!({"fileId": f.id, "removed": false, "file": file_json(f)}),
                        Change::Removed(id) => json!({"fileId": id, "removed": true}),
                    })
                    .collect();
                reply(200, json!({"newStartPageToken": next, "changes": cs}))
            }),
            ("GET", p) if q("alt").as_deref() == Some("media") => d.download(p.trim_start_matches("/drive/v3/files/")).map(|b| (200, vec![], b)),
            ("POST", "/upload/drive/v3/files") => {
                let (meta, bytes) = parts(r);
                assert_eq!(meta["parents"], json!(["appDataFolder"]));
                let file = NewFile {
                    name: meta["name"].as_str().unwrap_or("").into(),
                    props: props_of(&meta),
                    description: meta["description"].as_str().map(str::to_string),
                    mime: "application/octet-stream",
                    bytes: &bytes,
                };
                d.create(&file).map(|f| reply(200, file_json(&f)))
            }
            ("PATCH", p) => {
                let (meta, bytes) = parts(r);
                d.update(p.trim_start_matches("/upload/drive/v3/files/"), &props_of(&meta), &bytes).map(|f| reply(200, file_json(&f)))
            }
            ("DELETE", p) => d.delete(p.trim_start_matches("/drive/v3/files/")).map(|_| (204, vec![], vec![])),
            _ => Ok(reply(400, json!({"erro": r.path}))),
        };
        out.unwrap_or_else(|e| match e {
            SyncError::NotFound => (404, vec![], vec![]),
            _ => (503, vec![], vec![]),
        })
    }));
    base
}

#[test]
fn two_devices_through_the_drive_http_api() {
    use super::drive::{tests::Fake, DriveApi, MULTIPART_LIMIT};
    let mem = MemoryDrive::default();
    let base = http_drive(mem.clone());
    let (a, b) = (Dev::new(), Dev::new());
    let sync = |d: &Dev| sync_once(&Device { store: &d.store, data: &d.data }, &mut DriveApi::local(&base, Fake::default(), MULTIPART_LIMIT));
    a.create("n1", "Mercado", "arroz");
    a.s().create_category("Casa", "#C26A3D").unwrap();
    sync(&a).unwrap();
    sync(&b).unwrap();
    a.type_text("n1", 0, 0, "comprar ");
    b.type_text("n1", 0, 99, " e café");
    for _ in 0..2 {
        sync(&a).unwrap();
        sync(&b).unwrap();
    }
    assert_eq!(a.text("n1"), "Mercado\ncomprar arroz e café");
    assert_same(&a, &b);
    assert_eq!(b.s().list_categories().unwrap()[0].name, "Casa");
    assert_eq!(b.s().note_times("n1").unwrap().0, a.s().note_times("n1").unwrap().0, "data de criação pelo appProperties");
    assert!(mem.files().iter().all(|f| !f.rev.is_empty()));
}
