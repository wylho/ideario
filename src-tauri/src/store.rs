//! Armazenamento local (Fase 1, SPEC §5): SQLite com FTS5, migrações e as consultas que a UI usa.
//! Cada método corresponde a um método da interface `Api` (src/lib/api/index.ts); o mock em memória faz o mesmo
//! papel no navegador e nos testes e2e. Nada aqui toca a rede.
//!
//! Na Fase 1 o corpo da nota fica como JSON do TipTap (`body_json`); na Fase 2 ele passa a ser um Y.Doc e as
//! colunas derivadas continuam as mesmas.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::{Map, Value};

use crate::projection::{self, Projection};
use crate::text::{fold, normalize_tag};

pub type Millis = i64;
pub type Result<T> = std::result::Result<T, String>;

const DAY: Millis = 24 * 60 * 60 * 1000;
const TRASH_DAYS: Millis = 30;
/// Espaço entre posições da ordem personalizada; mover usa o meio entre vizinhos.
const STEP: f64 = 1024.0;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn now() -> Millis {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as Millis).unwrap_or(0)
}

// ---------- tipos (mesmo formato de src/lib/types.ts) ----------

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub category_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub note_count: i64,
}

#[derive(Debug, Serialize)]
pub struct TagCount {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cover {
    pub hash: String,
    pub width: i64,
    pub height: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub label: String,
    pub preview: Box<RawValue>,
    pub cover: Vec<Cover>,
    pub image_count: i64,
    pub file_count: i64,
    pub category_id: Option<String>,
    pub color: String,
    pub pinned: bool,
    pub archived: bool,
    pub trashed_at: Option<Millis>,
    pub reminder_at: Option<Millis>,
    pub reminder_done: bool,
    pub tags: Vec<String>,
    pub created_at: Millis,
    pub updated_at: Millis,
    pub position: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub hash: String,
    pub kind: String,
    pub mime: String,
    pub name: String,
    pub bytes: i64,
    pub orig_bytes: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub palette: Option<Vec<String>>,
    pub tone: Option<String>,
    pub added_at: Millis,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRow {
    #[serde(flatten)]
    pub a: Attachment,
    pub note_id: String,
    pub note_title: String,
    pub category_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDetail {
    pub id: String,
    pub title: String,
    pub body: Box<RawValue>,
    pub category_id: Option<String>,
    pub color: String,
    pub pinned: bool,
    pub archived: bool,
    pub trashed_at: Option<Millis>,
    pub reminder_at: Option<Millis>,
    pub reminder_done: bool,
    pub tags: Vec<String>,
    pub files: Vec<Attachment>,
    pub media: Vec<Attachment>,
    pub created_at: Millis,
    pub updated_at: Millis,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    pub id: String,
    pub title: String,
    pub body: Value,
    pub category_id: Option<String>,
    pub color: String,
    pub pinned: bool,
    pub archived: bool,
    pub trashed_at: Option<Millis>,
    pub reminder_at: Option<Millis>,
    pub reminder_done: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ViewCounts {
    pub notes: i64,
    pub reminders: i64,
    pub overdue: i64,
    pub files: i64,
    pub moodboard: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub connected: bool,
    pub last_sync_at: Option<Millis>,
    pub note_count: i64,
    pub cache_used_bytes: i64,
}

// ---------- abertura e migrações ----------

/// Cada item é uma migração; a posição + 1 é a versão (PRAGMA user_version). Nunca editar uma que já saiu.
const MIGRATIONS: &[&str] = &[
    // 1 — Fase 1: notas (corpo em JSON + colunas derivadas), categorias, tags, anexos, busca, configurações.
    r#"
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      body_json TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      label_fold TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      preview_json TEXT NOT NULL DEFAULT '[]',
      cover_json TEXT NOT NULL DEFAULT '[]',
      image_count INTEGER NOT NULL DEFAULT 0,
      file_count INTEGER NOT NULL DEFAULT 0,
      category_id TEXT,
      color TEXT NOT NULL DEFAULT 'none',
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      trashed_at INTEGER,
      reminder_at INTEGER,
      reminder_done INTEGER NOT NULL DEFAULT 0,
      position REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      dirty INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX notes_box ON notes (trashed_at, archived, updated_at);
    CREATE INDEX notes_reminder ON notes (reminder_at) WHERE reminder_at IS NOT NULL;
    -- tags manuais (manual = 1) e as #tags do corpo (manual = 0)
    CREATE TABLE note_tags (
      note_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      manual INTEGER NOT NULL,
      PRIMARY KEY (note_id, tag, manual)
    );
    CREATE INDEX note_tags_tag ON note_tags (tag);
    CREATE TABLE attachments (
      hash TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      mime TEXT NOT NULL,
      name TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      orig_bytes INTEGER,
      width INTEGER,
      height INTEGER,
      palette TEXT,
      tone TEXT,
      has_original INTEGER NOT NULL DEFAULT 0,
      local_state TEXT NOT NULL DEFAULT 'full',
      last_access INTEGER,
      drive_file_id TEXT,
      uploaded INTEGER NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL
    );
    -- anexos de cada nota, na ordem do corpo (inline = 1) ou à parte (inline = 0)
    CREATE TABLE note_attachments (
      note_id TEXT NOT NULL,
      hash TEXT NOT NULL,
      position INTEGER NOT NULL,
      inline INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (note_id, hash)
    );
    CREATE INDEX note_attachments_hash ON note_attachments (hash);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT);
    CREATE VIRTUAL TABLE notes_fts USING fts5(
      note_id UNINDEXED, title, body_text, tags,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    "#,
];

pub struct Store {
    pub conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Store> {
        let conn = Connection::open(path).map_err(err)?;
        Store::setup(conn)
    }

    #[cfg(test)]
    pub fn memory() -> Store {
        Store::setup(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn setup(conn: Connection) -> Result<Store> {
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;").map_err(err)?;
        let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(err)?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
            conn.execute_batch(&format!("BEGIN; {sql}; PRAGMA user_version = {}; COMMIT;", i + 1)).map_err(err)?;
        }
        let store = Store { conn };
        store.purge_trash()?;
        Ok(store)
    }

    /// Notas na lixeira há mais de 30 dias saem de vez (ao abrir o app).
    pub fn purge_trash(&self) -> Result<usize> {
        let limit = now() - TRASH_DAYS * DAY;
        let ids: Vec<String> = self.ids("SELECT id FROM notes WHERE trashed_at IS NOT NULL AND trashed_at < ?1", params![limit])?;
        for id in &ids {
            self.delete_note(id)?;
        }
        Ok(ids.len())
    }

    fn ids(&self, sql: &str, p: impl rusqlite::Params) -> Result<Vec<String>> {
        let mut st = self.conn.prepare_cached(sql).map_err(err)?;
        let rows = st.query_map(p, |r| r.get(0)).map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }

    // ---------- consultas de notas ----------

    /// WHERE comum: caixa (ativas, arquivo, lixeira), filtro (categoria + todas as tags) e busca (FTS5).
    fn where_clause(box_: &str, filter: &Filter, query: &str, args: &mut Vec<rusqlite::types::Value>) -> String {
        let mut w = vec![match box_ {
            "trash" => "n.trashed_at IS NOT NULL".to_string(),
            "archive" => "n.archived = 1 AND n.trashed_at IS NULL".to_string(),
            _ => "n.archived = 0 AND n.trashed_at IS NULL".to_string(),
        }];
        if let Some(c) = &filter.category_id {
            args.push(c.clone().into());
            w.push(format!("n.category_id = ?{}", args.len()));
        }
        for t in &filter.tags {
            args.push(t.clone().into());
            w.push(format!("EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND t.tag = ?{})", args.len()));
        }
        if let Some(m) = fts_query(query) {
            args.push(m.into());
            w.push(format!("n.id IN (SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?{})", args.len()));
        }
        w.join(" AND ")
    }

    fn order_by(sort: &str) -> &'static str {
        match sort {
            "custom" => "n.position ASC",
            "created" => "n.created_at DESC",
            "title" => "n.label_fold ASC",
            // Grupos na ordem das categorias; sem categoria no fim.
            "category" => "COALESCE((SELECT c.sort FROM categories c WHERE c.id = n.category_id AND c.deleted = 0), 1e9) ASC, n.position ASC",
            _ => "n.updated_at DESC",
        }
    }

    const SUMMARY_COLS: &'static str = "n.id, n.title, n.label, NULL, n.preview_json, n.cover_json, n.image_count, n.file_count, \
        n.category_id, n.color, n.pinned, n.archived, n.trashed_at, n.reminder_at, n.reminder_done, n.created_at, n.updated_at, n.position";

    fn summaries(&self, sql: &str, args: &[rusqlite::types::Value]) -> Result<Vec<NoteSummary>> {
        let mut st = self.conn.prepare_cached(sql).map_err(err)?;
        let rows = st.query_map(params_from_iter(args.iter()), Self::summary_row).map_err(err)?;
        let mut out: Vec<NoteSummary> = rows.collect::<std::result::Result<_, _>>().map_err(err)?;
        self.fill_tags_and_covers(&mut out)?;
        Ok(out)
    }

    fn summary_row(r: &Row) -> rusqlite::Result<NoteSummary> {
        let preview: String = r.get(4)?;
        let cover: String = r.get(5)?;
        Ok(NoteSummary {
            id: r.get(0)?,
            title: r.get(1)?,
            label: r.get(2)?,
            preview: RawValue::from_string(preview).unwrap_or_else(|_| RawValue::from_string("[]".into()).unwrap()),
            // provisório: só os hashes; as dimensões entram em fill_tags_and_covers
            cover: serde_json::from_str::<Vec<String>>(&cover)
                .unwrap_or_default()
                .into_iter()
                .map(|hash| Cover { hash, width: 4, height: 3 })
                .collect(),
            image_count: r.get(6)?,
            file_count: r.get(7)?,
            category_id: r.get(8)?,
            color: r.get(9)?,
            pinned: r.get(10)?,
            archived: r.get(11)?,
            trashed_at: r.get(12)?,
            reminder_at: r.get(13)?,
            reminder_done: r.get(14)?,
            tags: Vec::new(),
            created_at: r.get(15)?,
            updated_at: r.get(16)?,
            position: r.get(17)?,
        })
    }

    /// Tags (manuais primeiro, depois as do corpo) e dimensões das capas, numa consulta por lista.
    fn fill_tags_and_covers(&self, notes: &mut [NoteSummary]) -> Result<()> {
        if notes.is_empty() {
            return Ok(());
        }
        let mut tags: HashMap<String, Vec<String>> = HashMap::new();
        {
            let mut st = self.conn.prepare_cached("SELECT note_id, tag FROM note_tags ORDER BY manual DESC, rowid").map_err(err)?;
            let wanted: HashSet<&str> = notes.iter().map(|n| n.id.as_str()).collect();
            let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(err)?;
            for row in rows {
                let (id, tag) = row.map_err(err)?;
                if wanted.contains(id.as_str()) {
                    let list = tags.entry(id).or_default();
                    if !list.contains(&tag) {
                        list.push(tag);
                    }
                }
            }
        }
        let mut dims: HashMap<String, (i64, i64)> = HashMap::new();
        let hashes: HashSet<String> = notes.iter().flat_map(|n| n.cover.iter().map(|c| c.hash.clone())).collect();
        if !hashes.is_empty() {
            let mut st = self.conn.prepare_cached("SELECT width, height FROM attachments WHERE hash = ?1").map_err(err)?;
            for h in hashes {
                if let Some((w, hh)) = st
                    .query_row([&h], |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?)))
                    .optional()
                    .map_err(err)?
                {
                    dims.insert(h, (w.unwrap_or(4), hh.unwrap_or(3)));
                }
            }
        }
        for n in notes.iter_mut() {
            n.tags = tags.remove(&n.id).unwrap_or_default();
            n.cover.retain(|c| dims.contains_key(&c.hash));
            for c in n.cover.iter_mut() {
                (c.width, c.height) = dims[&c.hash];
            }
        }
        Ok(())
    }

    pub fn list_notes(&self, filter: &Filter, box_: &str, query: &str, sort: &str) -> Result<Vec<NoteSummary>> {
        let mut args = Vec::new();
        let w = Self::where_clause(box_, filter, query, &mut args);
        self.summaries(&format!("SELECT {} FROM notes n WHERE {w} ORDER BY {}", Self::SUMMARY_COLS, Self::order_by(sort)), &args)
    }

    pub fn list_reminders(&self, filter: &Filter, query: &str, include_done: bool) -> Result<Vec<NoteSummary>> {
        let mut args = Vec::new();
        let mut w = Self::where_clause("active", filter, query, &mut args);
        w.push_str(" AND n.reminder_at IS NOT NULL");
        if !include_done {
            w.push_str(" AND n.reminder_done = 0");
        }
        self.summaries(&format!("SELECT {} FROM notes n WHERE {w} ORDER BY n.reminder_at ASC", Self::SUMMARY_COLS), &args)
    }

    fn summary(&self, id: &str) -> Result<NoteSummary> {
        let mut out = self.summaries(&format!("SELECT {} FROM notes n WHERE n.id = ?1", Self::SUMMARY_COLS), &[id.to_string().into()])?;
        out.pop().ok_or_else(|| "nota não encontrada".into())
    }

    pub fn view_counts(&self, filter: &Filter, query: &str) -> Result<ViewCounts> {
        let mut args = Vec::new();
        let w = Self::where_clause("active", filter, query, &mut args);
        let now = now();
        let (notes, reminders, overdue, moodboard): (i64, i64, i64, i64) = self
            .conn
            .query_row(
                &format!(
                    "SELECT COUNT(*), \
                     COALESCE(SUM(n.reminder_at IS NOT NULL AND n.reminder_done = 0), 0), \
                     COALESCE(SUM(n.reminder_at IS NOT NULL AND n.reminder_done = 0 AND n.reminder_at < {now}), 0), \
                     COALESCE(SUM(n.image_count), 0) FROM notes n WHERE {w}"
                ),
                params_from_iter(args.iter()),
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .map_err(err)?;
        let files = self.list_attachments(filter, query)?.len() as i64;
        Ok(ViewCounts { notes, reminders, overdue, files, moodboard })
    }

    // ---------- categorias e tags ----------

    pub fn list_categories(&self) -> Result<Vec<Category>> {
        let mut st = self
            .conn
            .prepare_cached(
                "SELECT c.id, c.name, c.color, \
                 (SELECT COUNT(*) FROM notes n WHERE n.category_id = c.id AND n.archived = 0 AND n.trashed_at IS NULL) \
                 FROM categories c WHERE c.deleted = 0 ORDER BY c.sort, c.name",
            )
            .map_err(err)?;
        let rows = st
            .query_map([], |r| Ok(Category { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, icon: None, note_count: r.get(3)? }))
            .map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }

    pub fn create_category(&self, name: &str, color: &str) -> Result<Category> {
        let name = name.trim();
        if name.is_empty() {
            return Err("nome vazio".into());
        }
        let id = uuid::Uuid::now_v7().to_string();
        let sort: i64 = self.conn.query_row("SELECT COALESCE(MAX(sort), -1) + 1 FROM categories", [], |r| r.get(0)).map_err(err)?;
        self.conn
            .execute("INSERT INTO categories (id, name, color, sort, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![id, name, color, sort, now()])
            .map_err(err)?;
        Ok(Category { id, name: name.to_string(), color: color.to_string(), icon: None, note_count: 0 })
    }

    pub fn update_category(&self, id: &str, name: Option<&str>, color: Option<&str>) -> Result<()> {
        if let Some(n) = name.map(str::trim).filter(|n| !n.is_empty()) {
            self.conn.execute("UPDATE categories SET name = ?2, updated_at = ?3 WHERE id = ?1", params![id, n, now()]).map_err(err)?;
        }
        if let Some(c) = color {
            self.conn.execute("UPDATE categories SET color = ?2, updated_at = ?3 WHERE id = ?1", params![id, c, now()]).map_err(err)?;
        }
        Ok(())
    }

    /// Apaga a categoria; as notas dela ficam sem categoria (nada some).
    pub fn delete_category(&self, id: &str) -> Result<()> {
        let t = now();
        self.conn.execute("UPDATE categories SET deleted = 1, updated_at = ?2 WHERE id = ?1", params![id, t]).map_err(err)?;
        self.conn
            .execute("UPDATE notes SET category_id = NULL, updated_at = ?2, dirty = 1 WHERE category_id = ?1", params![id, t])
            .map_err(err)?;
        Ok(())
    }

    /// Recria uma categoria apagada (Desfazer), com as mesmas notas de antes.
    pub fn restore_category(&self, id: &str, note_ids: &[String]) -> Result<()> {
        self.conn.execute("UPDATE categories SET deleted = 0, updated_at = ?2 WHERE id = ?1", params![id, now()]).map_err(err)?;
        for n in note_ids {
            self.conn.execute("UPDATE notes SET category_id = ?2, dirty = 1 WHERE id = ?1", params![n, id]).map_err(err)?;
        }
        Ok(())
    }

    pub fn category_note_ids(&self, id: &str) -> Result<Vec<String>> {
        self.ids("SELECT id FROM notes WHERE category_id = ?1", params![id])
    }

    pub fn list_tags(&self) -> Result<Vec<TagCount>> {
        let mut st = self
            .conn
            .prepare_cached(
                "SELECT t.tag, COUNT(DISTINCT t.note_id) AS c FROM note_tags t JOIN notes n ON n.id = t.note_id \
                 WHERE n.archived = 0 AND n.trashed_at IS NULL GROUP BY t.tag ORDER BY c DESC, t.tag",
            )
            .map_err(err)?;
        let rows = st.query_map([], |r| Ok(TagCount { name: r.get(0)?, count: r.get(1)? })).map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }

    /// Renomeia (ou, com `to = None`, tira) uma tag em todas as notas: nas tags manuais e nas `#tags` do texto
    /// (que vira palavra comum ao tirar). Devolve quantas notas mudaram.
    pub fn rename_tag(&self, from: &str, to: Option<&str>) -> Result<usize> {
        let to = to.map(normalize_tag).filter(|t| !t.is_empty());
        let ids = self.ids("SELECT DISTINCT note_id FROM note_tags WHERE tag = ?1", params![from])?;
        for id in &ids {
            let Some(mut input) = self.note_input(id)? else { continue };
            input.tags = input
                .tags
                .iter()
                .filter_map(|t| if t == from { to.clone() } else { Some(t.clone()) })
                .collect::<Vec<_>>();
            input.tags.dedup();
            rewrite_hashtag(&mut input.body, from, to.as_deref());
            self.write_note(&input, false)?;
        }
        Ok(ids.len())
    }

    // ---------- uma nota ----------

    fn note_input(&self, id: &str) -> Result<Option<NoteInput>> {
        self.conn
            .query_row(
                "SELECT id, title, body_json, category_id, color, pinned, archived, trashed_at, reminder_at, reminder_done FROM notes WHERE id = ?1",
                [id],
                |r| {
                    Ok(NoteInput {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        body: serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or(Value::Null),
                        category_id: r.get(3)?,
                        color: r.get(4)?,
                        pinned: r.get(5)?,
                        archived: r.get(6)?,
                        trashed_at: r.get(7)?,
                        reminder_at: r.get(8)?,
                        reminder_done: r.get(9)?,
                        tags: Vec::new(),
                    })
                },
            )
            .optional()
            .map_err(err)?
            .map(|mut n| {
                n.tags = self.ids("SELECT tag FROM note_tags WHERE note_id = ?1 AND manual = 1 ORDER BY rowid", params![n.id])?;
                Ok(n)
            })
            .transpose()
    }

    pub fn get_note(&self, id: &str) -> Result<Option<NoteDetail>> {
        let Some(n) = self.note_input(id)? else { return Ok(None) };
        let (created_at, updated_at): (Millis, Millis) =
            self.conn.query_row("SELECT created_at, updated_at FROM notes WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
        let atts = |inline: bool| -> Result<Vec<Attachment>> {
            let mut st = self
                .conn
                .prepare_cached(&format!(
                    "SELECT {} FROM note_attachments na JOIN attachments a ON a.hash = na.hash WHERE na.note_id = ?1 AND na.inline = ?2 ORDER BY na.position",
                    ATTACHMENT_COLS
                ))
                .map_err(err)?;
            let rows = st.query_map(params![id, inline], attachment_row).map_err(err)?;
            rows.collect::<std::result::Result<_, _>>().map_err(err)
        };
        Ok(Some(NoteDetail {
            id: n.id,
            title: n.title,
            body: RawValue::from_string(n.body.to_string()).map_err(err)?,
            category_id: n.category_id,
            color: n.color,
            pinned: n.pinned,
            archived: n.archived,
            trashed_at: n.trashed_at,
            reminder_at: n.reminder_at,
            reminder_done: n.reminder_done,
            tags: n.tags,
            files: atts(false)?,
            media: atts(true)?,
            created_at,
            updated_at,
        }))
    }

    /// Cria ou atualiza. Sem mudança de conteúdo, não mexe (nem na data): abrir e fechar não "edita" a nota.
    pub fn save_note(&self, input: &NoteInput) -> Result<NoteSummary> {
        let mut input = input.clone();
        let mut seen = HashSet::new();
        input.tags.retain(|t| seen.insert(t.clone()));
        if let Some(prev) = self.note_input(&input.id)? {
            if same_content(&prev, &input) {
                return self.summary(&input.id);
            }
        }
        self.write_note(&input, true)?;
        self.summary(&input.id)
    }

    /// Grava a nota e recalcula a projeção, as tags, os anexos e a busca.
    fn write_note(&self, n: &NoteInput, touch: bool) -> Result<()> {
        let p = self.project(&n.body)?;
        let label = projection::label(&n.title, &p);
        let t = now();
        let existing: Option<(Millis, Millis, f64)> = self
            .conn
            .query_row("SELECT created_at, updated_at, position FROM notes WHERE id = ?1", [&n.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()
            .map_err(err)?;
        let (created, updated, position) = match existing {
            Some((c, u, pos)) => (c, if touch { t } else { u }, pos),
            // Nota nova entra no topo da ordem personalizada.
            None => (t, t, self.min_position()? - STEP),
        };
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        tx.execute(
            "INSERT INTO notes (id, body_json, title, label, label_fold, body_text, preview_json, cover_json, image_count, file_count, \
             category_id, color, pinned, archived, trashed_at, reminder_at, reminder_done, position, created_at, updated_at, dirty) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, 1) \
             ON CONFLICT(id) DO UPDATE SET body_json = excluded.body_json, title = excluded.title, label = excluded.label, \
             label_fold = excluded.label_fold, body_text = excluded.body_text, preview_json = excluded.preview_json, \
             cover_json = excluded.cover_json, image_count = excluded.image_count, file_count = excluded.file_count, \
             category_id = excluded.category_id, color = excluded.color, pinned = excluded.pinned, archived = excluded.archived, \
             trashed_at = excluded.trashed_at, reminder_at = excluded.reminder_at, reminder_done = excluded.reminder_done, \
             updated_at = excluded.updated_at, dirty = 1",
            params![
                n.id,
                n.body.to_string(),
                n.title,
                label,
                fold(&label),
                p.text,
                serde_json::to_string(&p.preview).map_err(err)?,
                serde_json::to_string(&p.cover).map_err(err)?,
                p.images.len() as i64,
                p.files.len() as i64,
                n.category_id,
                n.color,
                n.pinned,
                n.archived,
                n.trashed_at,
                n.reminder_at,
                n.reminder_done,
                position,
                created,
                updated,
            ],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM note_tags WHERE note_id = ?1", [&n.id]).map_err(err)?;
        for tag in &n.tags {
            tx.execute("INSERT OR IGNORE INTO note_tags (note_id, tag, manual) VALUES (?1, ?2, 1)", params![n.id, tag]).map_err(err)?;
        }
        for tag in &p.hash_tags {
            tx.execute("INSERT OR IGNORE INTO note_tags (note_id, tag, manual) VALUES (?1, ?2, 0)", params![n.id, tag]).map_err(err)?;
        }
        tx.execute("DELETE FROM note_attachments WHERE note_id = ?1 AND inline = 1", [&n.id]).map_err(err)?;
        for (i, h) in p.images.iter().chain(p.files.iter()).enumerate() {
            tx.execute("INSERT OR IGNORE INTO note_attachments (note_id, hash, position, inline) VALUES (?1, ?2, ?3, 1)", params![n.id, h, i as i64])
                .map_err(err)?;
        }
        let mut all_tags: Vec<&String> = n.tags.iter().chain(p.hash_tags.iter()).collect();
        all_tags.dedup();
        tx.execute("DELETE FROM notes_fts WHERE note_id = ?1", [&n.id]).map_err(err)?;
        tx.execute(
            "INSERT INTO notes_fts (note_id, title, body_text, tags) VALUES (?1, ?2, ?3, ?4)",
            params![n.id, n.title, p.text, all_tags.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(" ")],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    }

    fn project(&self, body: &Value) -> Result<Projection> {
        let st = std::cell::RefCell::new(self.conn.prepare_cached("SELECT name, kind FROM attachments WHERE hash = ?1").map_err(err)?);
        let lookup =
            |h: &str| st.borrow_mut().query_row([h], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).optional().ok().flatten();
        Ok(projection::project(body, &lookup))
    }

    fn min_position(&self) -> Result<f64> {
        self.conn.query_row("SELECT MIN(0, COALESCE(MIN(position), 0)) FROM notes", [], |r| r.get(0)).map_err(err)
    }

    pub fn set_reminder_done(&self, id: &str, done: bool) -> Result<bool> {
        let n = self
            .conn
            .execute("UPDATE notes SET reminder_done = ?2, dirty = 1 WHERE id = ?1 AND reminder_done != ?2", params![id, done])
            .map_err(err)?;
        Ok(n > 0)
    }

    /// Muda metadados sem abrir o editor (menus de contexto). Só as chaves presentes mudam; `null` limpa.
    pub fn update_note(&self, id: &str, patch: &Map<String, Value>) -> Result<bool> {
        let Some(mut n) = self.note_input(id)? else { return Ok(false) };
        let before = n.clone();
        for (k, v) in patch {
            match k.as_str() {
                "pinned" => n.pinned = v.as_bool().unwrap_or(n.pinned),
                "color" => n.color = v.as_str().unwrap_or(&n.color).to_string(),
                "categoryId" => n.category_id = v.as_str().map(str::to_string),
                "archived" => n.archived = v.as_bool().unwrap_or(n.archived),
                "trashedAt" => n.trashed_at = v.as_i64(),
                "reminderAt" => n.reminder_at = v.as_i64(),
                "reminderDone" => n.reminder_done = v.as_bool().unwrap_or(n.reminder_done),
                _ => {}
            }
        }
        if same_content(&before, &n) {
            return Ok(false);
        }
        self.conn
            .execute(
                "UPDATE notes SET pinned = ?2, color = ?3, category_id = ?4, archived = ?5, trashed_at = ?6, reminder_at = ?7, \
                 reminder_done = ?8, updated_at = ?9, dirty = 1 WHERE id = ?1",
                params![id, n.pinned, n.color, n.category_id, n.archived, n.trashed_at, n.reminder_at, n.reminder_done, now()],
            )
            .map_err(err)?;
        Ok(true)
    }

    /// Ordem personalizada: põe a nota entre `after` e `before` (vizinhos; None nas pontas).
    pub fn move_note(&self, id: &str, after: Option<&str>, before: Option<&str>) -> Result<bool> {
        let pos_of = |x: &str| -> Result<Option<f64>> {
            self.conn.query_row("SELECT position FROM notes WHERE id = ?1", [x], |r| r.get(0)).optional().map_err(err)
        };
        let Some(cur) = pos_of(id)? else { return Ok(false) };
        let a = after.map(pos_of).transpose()?.flatten();
        let b = before.map(pos_of).transpose()?.flatten();
        let mut pos = match (a, b) {
            (Some(a), Some(b)) => (a + b) / 2.0,
            (Some(a), None) => a + STEP,
            (None, Some(b)) => b - STEP,
            (None, None) => cur,
        };
        if let (Some(a), Some(b)) = (a, b) {
            if !(pos > a && pos < b) {
                // Sem espaço entre os vizinhos: renumera tudo e tenta de novo.
                self.renumber("n.position ASC")?;
                let (a, b) = (pos_of(after.unwrap())?.unwrap_or(0.0), pos_of(before.unwrap())?.unwrap_or(0.0));
                pos = (a + b) / 2.0;
            }
        }
        if pos == cur {
            return Ok(false);
        }
        self.conn.execute("UPDATE notes SET position = ?2 WHERE id = ?1", params![id, pos]).map_err(err)?;
        Ok(true)
    }

    /// A ordem personalizada passa a ser igual à ordem `sort` (ao começar a arrastar numa ordem por data).
    pub fn adopt_order(&self, sort: &str) -> Result<bool> {
        if sort == "custom" {
            return Ok(false);
        }
        self.renumber(Self::order_by(sort))?;
        Ok(true)
    }

    fn renumber(&self, order: &str) -> Result<()> {
        let ids = self.ids(&format!("SELECT n.id FROM notes n ORDER BY {order}"), [])?;
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute("UPDATE notes SET position = ?2 WHERE id = ?1", params![id, i as f64 * STEP]).map_err(err)?;
        }
        tx.commit().map_err(err)
    }

    /// Cópia da nota (sem lembrete e sem fixar), logo antes dela na ordem personalizada.
    pub fn duplicate_note(&self, id: &str) -> Result<String> {
        let mut n = self.note_input(id)?.ok_or("nota não encontrada")?;
        let pos: f64 = self.conn.query_row("SELECT position FROM notes WHERE id = ?1", [id], |r| r.get(0)).map_err(err)?;
        n.id = uuid::Uuid::now_v7().to_string();
        if !n.title.is_empty() {
            n.title = format!("{} (cópia)", n.title);
        }
        n.pinned = false;
        n.reminder_at = None;
        n.reminder_done = false;
        self.write_note(&n, true)?;
        self.conn.execute("UPDATE notes SET position = ?2 WHERE id = ?1", params![n.id, pos - 1.0]).map_err(err)?;
        Ok(n.id)
    }

    pub fn note_text(&self, id: &str) -> Result<String> {
        let Some(n) = self.note_input(id)? else { return Ok(String::new()) };
        Ok(projection::plain_text(&n.title, &self.project(&n.body)?))
    }

    pub fn delete_note(&self, id: &str) -> Result<bool> {
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        for t in ["note_tags", "note_attachments", "notes_fts"] {
            tx.execute(&format!("DELETE FROM {t} WHERE note_id = ?1"), [id]).map_err(err)?;
        }
        let n = tx.execute("DELETE FROM notes WHERE id = ?1", [id]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(n > 0)
    }

    pub fn trash_count(&self) -> Result<i64> {
        self.conn.query_row("SELECT COUNT(*) FROM notes WHERE trashed_at IS NOT NULL", [], |r| r.get(0)).map_err(err)
    }

    pub fn empty_trash(&self) -> Result<usize> {
        let ids = self.ids("SELECT id FROM notes WHERE trashed_at IS NOT NULL", [])?;
        for id in &ids {
            self.delete_note(id)?;
        }
        Ok(ids.len())
    }

    // ---------- anexos ----------

    /// Anexos das notas ativas que passam no filtro (mais recentes primeiro, na ordem do corpo), filtrados pela busca
    /// no nome do arquivo ou da nota.
    pub fn list_attachments(&self, filter: &Filter, query: &str) -> Result<Vec<AttachmentRow>> {
        self.attachment_rows(filter, "", None, |r, q| q.is_empty() || fold(&format!("{} {}", r.a.name, r.note_title)).contains(q), query)
    }

    /// Fotos das notas ativas que passam no filtro e na busca, para o Moodboard.
    pub fn list_images(&self, filter: &Filter, query: &str, tone: Option<&str>) -> Result<Vec<AttachmentRow>> {
        let rows = self.attachment_rows(filter, query, Some("image"), |_, _| true, "")?;
        Ok(rows.into_iter().filter(|r| tone.is_none() || r.a.tone.as_deref() == tone).collect())
    }

    fn attachment_rows(
        &self,
        filter: &Filter,
        note_query: &str,
        kind: Option<&str>,
        keep: impl Fn(&AttachmentRow, &str) -> bool,
        name_query: &str,
    ) -> Result<Vec<AttachmentRow>> {
        let mut args = Vec::new();
        let mut w = Self::where_clause("active", filter, note_query, &mut args);
        if let Some(k) = kind {
            args.push(k.to_string().into());
            w.push_str(&format!(" AND a.kind = ?{}", args.len()));
        }
        let sql = format!(
            "SELECT {ATTACHMENT_COLS}, n.id, n.label, n.category_id FROM notes n \
             JOIN note_attachments na ON na.note_id = n.id JOIN attachments a ON a.hash = na.hash \
             WHERE {w} ORDER BY n.updated_at DESC, na.inline DESC, na.position"
        );
        let mut st = self.conn.prepare_cached(&sql).map_err(err)?;
        let rows = st
            .query_map(params_from_iter(args.iter()), |r| {
                Ok(AttachmentRow { a: attachment_row(r)?, note_id: r.get(11)?, note_title: r.get(12)?, category_id: r.get(13)? })
            })
            .map_err(err)?;
        let q = fold(name_query.trim());
        let mut out = Vec::new();
        for row in rows {
            let row = row.map_err(err)?;
            if keep(&row, &q) {
                out.push(row);
            }
        }
        Ok(out)
    }

    pub fn get_attachments(&self, hashes: &[String]) -> Result<Vec<Attachment>> {
        let mut st = self.conn.prepare_cached(&format!("SELECT {ATTACHMENT_COLS} FROM attachments a WHERE a.hash = ?1")).map_err(err)?;
        let mut out = Vec::new();
        for h in hashes {
            if let Some(a) = st.query_row([h], attachment_row).optional().map_err(err)? {
                out.push(a);
            }
        }
        Ok(out)
    }

    pub fn attachment_mime(&self, hash: &str) -> Result<Option<String>> {
        self.conn.query_row("SELECT mime FROM attachments WHERE hash = ?1", [hash], |r| r.get(0)).optional().map_err(err)
    }

    pub fn insert_attachment(&self, a: &Attachment) -> Result<()> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO attachments (hash, kind, mime, name, bytes, orig_bytes, width, height, palette, tone, added_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    a.hash,
                    a.kind,
                    a.mime,
                    a.name,
                    a.bytes,
                    a.orig_bytes,
                    a.width,
                    a.height,
                    a.palette.as_ref().map(|p| serde_json::to_string(p).unwrap_or_default()),
                    a.tone,
                    a.added_at
                ],
            )
            .map_err(err)?;
        Ok(())
    }

    // ---------- configurações e sync ----------

    pub fn get_settings(&self) -> Result<Value> {
        let saved: Option<String> = self.conn.query_row("SELECT value FROM settings WHERE key = 'app'", [], |r| r.get(0)).optional().map_err(err)?;
        let mut s = serde_json::json!({ "wifiOnly": true, "photoQuality": "balanced", "cacheLimitGb": 2 });
        if let Some(Value::Object(saved)) = saved.and_then(|v| serde_json::from_str(&v).ok()) {
            for (k, v) in saved {
                s[k] = v;
            }
        }
        Ok(s)
    }

    pub fn save_settings(&self, s: &Value) -> Result<()> {
        self.conn
            .execute("INSERT INTO settings (key, value) VALUES ('app', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [s.to_string()])
            .map_err(err)?;
        Ok(())
    }

    pub fn sync_status(&self) -> Result<SyncStatus> {
        let (notes, bytes): (i64, i64) = self
            .conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM notes WHERE trashed_at IS NULL), (SELECT COALESCE(SUM(bytes), 0) FROM attachments)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        // Sync com o Drive é a Fase 5; até lá, tudo fica só neste aparelho.
        Ok(SyncStatus { connected: false, last_sync_at: None, note_count: notes, cache_used_bytes: bytes })
    }

    pub fn is_empty(&self) -> Result<bool> {
        self.conn.query_row("SELECT NOT EXISTS (SELECT 1 FROM notes)", [], |r| r.get(0)).map_err(err)
    }

    pub fn flag(&self, key: &str) -> Result<bool> {
        self.conn.query_row("SELECT EXISTS (SELECT 1 FROM sync_state WHERE key = ?1)", [key], |r| r.get(0)).map_err(err)
    }

    pub fn set_flag(&self, key: &str) -> Result<()> {
        self.conn.execute("INSERT OR IGNORE INTO sync_state (key, value) VALUES (?1, '1')", [key]).map_err(err)?;
        Ok(())
    }
}

const ATTACHMENT_COLS: &str = "a.hash, a.kind, a.mime, a.name, a.bytes, a.orig_bytes, a.width, a.height, a.palette, a.tone, a.added_at";

fn attachment_row(r: &Row) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        hash: r.get(0)?,
        kind: r.get(1)?,
        mime: r.get(2)?,
        name: r.get(3)?,
        bytes: r.get(4)?,
        orig_bytes: r.get(5)?,
        width: r.get(6)?,
        height: r.get(7)?,
        palette: r.get::<_, Option<String>>(8)?.and_then(|p| serde_json::from_str(&p).ok()),
        tone: r.get(9)?,
        added_at: r.get(10)?,
    })
}

fn same_content(a: &NoteInput, b: &NoteInput) -> bool {
    a.title == b.title
        && a.body == b.body
        && a.category_id == b.category_id
        && a.color == b.color
        && a.pinned == b.pinned
        && a.archived == b.archived
        && a.trashed_at == b.trashed_at
        && a.reminder_at == b.reminder_at
        && a.reminder_done == b.reminder_done
        && a.tags == b.tags
}

/// Busca como o SPEC pede: sem acento, todos os termos, por prefixo. `#` é ignorado ("#casa" acha a tag casa).
fn fts_query(q: &str) -> Option<String> {
    let terms: Vec<String> = q
        .replace('#', " ")
        .split_whitespace()
        .map(|t| t.chars().filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-').collect::<String>())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

/// Troca `#de` por `#para` (ou por `de`, sem o `#`, quando a tag sai) nos textos do corpo.
fn rewrite_hashtag(node: &mut Value, from: &str, to: Option<&str>) {
    match node {
        Value::Object(o) => {
            if o.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(Value::String(t)) = o.get_mut("text") {
                    *t = replace_tag(t, from, to);
                }
            }
            if let Some(Value::Array(c)) = o.get_mut("content") {
                for n in c {
                    rewrite_hashtag(n, from, to);
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|n| rewrite_hashtag(n, from, to)),
        _ => {}
    }
}

fn replace_tag(text: &str, from: &str, to: Option<&str>) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let starts = chars[i] == '#' && (i == 0 || !(chars[i - 1].is_alphanumeric() || chars[i - 1] == '_'));
        if starts {
            let mut j = i + 1;
            while j < chars.len() && (chars[j].is_alphanumeric() || chars[j] == '_' || chars[j] == '-') {
                j += 1;
            }
            let word: String = chars[i + 1..j].iter().collect();
            if j > i + 1 && word.to_lowercase() == from {
                match to {
                    Some(t) => {
                        out.push('#');
                        out.push_str(t);
                    }
                    None => out.push_str(&word),
                }
                i = j;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn note(id: &str, title: &str, text: &str) -> NoteInput {
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
            tags: vec![],
        }
    }

    fn titles(v: &[NoteSummary]) -> Vec<&str> {
        v.iter().map(|n| n.label.as_str()).collect()
    }

    #[test]
    fn create_list_search_without_accents() {
        let s = Store::memory();
        s.save_note(&note("a", "Pão de queijo", "receita da vovó #cozinha")).unwrap();
        s.save_note(&note("b", "Reunião", "pauta do time")).unwrap();
        let all = s.list_notes(&Filter::default(), "active", "", "updated").unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(titles(&s.list_notes(&Filter::default(), "active", "pao", "updated").unwrap()), vec!["Pão de queijo"]);
        assert_eq!(titles(&s.list_notes(&Filter::default(), "active", "VOVO rec", "updated").unwrap()), vec!["Pão de queijo"]);
        assert_eq!(titles(&s.list_notes(&Filter::default(), "active", "#cozinha", "updated").unwrap()), vec!["Pão de queijo"]);
        assert!(s.list_notes(&Filter::default(), "active", "pao reuniao", "updated").unwrap().is_empty());
        // tags do corpo entram no filtro
        let f = Filter { category_id: None, tags: vec!["cozinha".into()] };
        assert_eq!(titles(&s.list_notes(&f, "active", "", "updated").unwrap()), vec!["Pão de queijo"]);
        assert_eq!(s.list_tags().unwrap()[0].name, "cozinha");
    }

    #[test]
    fn saving_same_content_keeps_the_date_and_new_notes_go_on_top() {
        let s = Store::memory();
        let a = s.save_note(&note("a", "A", "x")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let again = s.save_note(&note("a", "A", "x")).unwrap();
        assert_eq!(a.updated_at, again.updated_at);
        s.save_note(&note("b", "B", "y")).unwrap();
        assert_eq!(titles(&s.list_notes(&Filter::default(), "active", "", "custom").unwrap()), vec!["B", "A"]);
    }

    #[test]
    fn boxes_patch_and_trash() {
        let s = Store::memory();
        s.save_note(&note("a", "A", "x")).unwrap();
        s.save_note(&note("b", "B", "y")).unwrap();
        let mut p = Map::new();
        p.insert("archived".into(), json!(true));
        assert!(s.update_note("a", &p).unwrap());
        assert_eq!(titles(&s.list_notes(&Filter::default(), "archive", "", "updated").unwrap()), vec!["A"]);
        let mut p = Map::new();
        p.insert("trashedAt".into(), json!(now()));
        s.update_note("b", &p).unwrap();
        assert_eq!(s.trash_count().unwrap(), 1);
        assert_eq!(s.empty_trash().unwrap(), 1);
        assert!(s.get_note("b").unwrap().is_none());
        // lixeira com mais de 30 dias some ao abrir
        let mut p = Map::new();
        p.insert("trashedAt".into(), json!(now() - 31 * DAY));
        s.update_note("a", &p).unwrap();
        assert_eq!(s.purge_trash().unwrap(), 1);
    }

    #[test]
    fn reminders_counts_and_custom_order() {
        let s = Store::memory();
        for id in ["a", "b", "c"] {
            s.save_note(&note(id, &id.to_uppercase(), "x")).unwrap();
        }
        let mut p = Map::new();
        p.insert("reminderAt".into(), json!(now() - 1000));
        s.update_note("a", &p).unwrap();
        let c = s.view_counts(&Filter::default(), "").unwrap();
        assert_eq!((c.notes, c.reminders, c.overdue), (3, 1, 1));
        s.set_reminder_done("a", true).unwrap();
        assert_eq!(s.list_reminders(&Filter::default(), "", false).unwrap().len(), 0);
        assert_eq!(s.list_reminders(&Filter::default(), "", true).unwrap().len(), 1);
        // C B A → arrasta A para entre C e B
        assert_eq!(titles(&s.list_notes(&Filter::default(), "active", "", "custom").unwrap()), vec!["C", "B", "A"]);
        s.move_note("a", Some("c"), Some("b")).unwrap();
        assert_eq!(titles(&s.list_notes(&Filter::default(), "active", "", "custom").unwrap()), vec!["C", "A", "B"]);
        s.adopt_order("title").unwrap();
        assert_eq!(titles(&s.list_notes(&Filter::default(), "active", "", "custom").unwrap()), vec!["A", "B", "C"]);
    }

    #[test]
    fn categories_and_tags() {
        let s = Store::memory();
        let c = s.create_category("Trabalho", "#3d63d6").unwrap();
        let mut n = note("a", "A", "texto com #velha");
        n.category_id = Some(c.id.clone());
        n.tags = vec!["velha".into(), "outra".into()];
        s.save_note(&n).unwrap();
        assert_eq!(s.list_categories().unwrap()[0].note_count, 1);
        s.update_category(&c.id, Some("Trampo"), None).unwrap();
        assert_eq!(s.list_categories().unwrap()[0].name, "Trampo");
        // renomear a tag muda a manual e a #tag do texto
        assert_eq!(s.rename_tag("velha", Some("nova")).unwrap(), 1);
        let d = s.get_note("a").unwrap().unwrap();
        assert_eq!(d.tags, vec!["nova", "outra"]);
        assert!(d.body.get().contains("#nova"));
        // tirar a tag deixa a palavra no texto
        s.rename_tag("nova", None).unwrap();
        let d = s.get_note("a").unwrap().unwrap();
        assert_eq!(d.tags, vec!["outra"]);
        assert!(d.body.get().contains("com nova"));
        // apagar a categoria deixa a nota sem categoria
        s.delete_category(&c.id).unwrap();
        assert!(s.list_categories().unwrap().is_empty());
        assert_eq!(s.get_note("a").unwrap().unwrap().category_id, None);
    }

    #[test]
    fn attachments_cover_and_files() {
        let s = Store::memory();
        let att = |hash: &str, kind: &str, w: Option<i64>| Attachment {
            hash: hash.into(),
            kind: kind.into(),
            mime: "x".into(),
            name: format!("{hash}.bin"),
            bytes: 10,
            orig_bytes: None,
            width: w,
            height: w,
            palette: None,
            tone: None,
            added_at: now(),
        };
        s.insert_attachment(&att("foto", "image", Some(200))).unwrap();
        s.insert_attachment(&att("doc", "pdf", None)).unwrap();
        let mut n = note("a", "Com mídia", "x");
        n.body = json!({"type":"doc","content":[{"type":"noteImage","attrs":{"hash":"foto"}},{"type":"noteFile","attrs":{"hash":"doc"}}]});
        let sum = s.save_note(&n).unwrap();
        assert_eq!(sum.cover.len(), 1);
        assert_eq!((sum.cover[0].width, sum.image_count, sum.file_count), (200, 1, 1));
        assert_eq!(s.list_attachments(&Filter::default(), "").unwrap().len(), 2);
        assert_eq!(s.list_attachments(&Filter::default(), "doc").unwrap().len(), 1);
        assert_eq!(s.list_images(&Filter::default(), "", None).unwrap().len(), 1);
        assert_eq!(s.get_note("a").unwrap().unwrap().media.len(), 2);
        assert_eq!(s.view_counts(&Filter::default(), "").unwrap().files, 2);
    }
}

#[cfg(test)]
mod bench {
    use super::*;
    use serde_json::json;

    /// `cargo test --release --lib bench -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn list_5000() {
        let s = Store::memory();
        for i in 0..5000 {
            let p = |t: String| json!({"type":"paragraph","content":[{"type":"text","text":t}]});
            s.save_note(&NoteInput {
                id: format!("{i:05}"),
                title: format!("Nota {i}"),
                body: json!({"type":"doc","content":[p(format!("Texto de exemplo número {i} com reunião, orçamento e #tag{}", i % 20)), p("Mais uma linha.".into())]}),
                category_id: None,
                color: "none".into(),
                pinned: false,
                archived: false,
                trashed_at: None,
                reminder_at: None,
                reminder_done: false,
                tags: vec![],
            })
            .unwrap();
        }
        let f = Filter::default();
        for _ in 0..2 {
            let t = std::time::Instant::now();
            let v = s.list_notes(&f, "active", "", "custom").unwrap();
            let q = t.elapsed();
            let json = serde_json::to_string(&v).unwrap();
            println!("list: {:?} consulta, {:?} total com JSON ({} KB)", q, t.elapsed(), json.len() / 1024);
        }
    }
}
