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

use crate::ydoc;
use crate::projection::{self, Projection};
use crate::text::{fold, normalize_tag};

pub type Millis = i64;
pub type Result<T> = std::result::Result<T, String>;

const DAY: Millis = 24 * 60 * 60 * 1000;
const TRASH_DAYS: Millis = 30;
/// Espaço entre posições da ordem personalizada; mover usa o meio entre vizinhos.
const STEP: f64 = 1024.0;
/// Repetições de lembrete que existem.
pub const REPEATS: [&str; 4] = ["day", "week", "month", "year"];

/// Emoji de capa aceito: um emoji só (sequências com ZWJ, tom de pele, bandeiras e teclas incluídas), sem letras nem
/// espaços. Qualquer outra coisa vira "sem emoji".
pub fn clean_emoji(s: &str) -> Option<String> {
    let s = s.trim();
    let ok = !s.is_empty()
        && s.len() <= 32
        && !s.is_ascii()
        && !s.chars().any(|c| c.is_whitespace() || c.is_control() || c.is_ascii_alphabetic());
    ok.then(|| s.to_string())
}
/// Cores das categorias (as mesmas de src/lib/colors.ts).
const CATEGORY_COLORS: [&str; 10] = ["#C26A3D", "#B8901F", "#4F8A3E", "#3E8E7E", "#3D63D6", "#8A6BC4", "#C2557A", "#C0392B", "#8B5E3C", "#5F7380"];
/// Formato da projeção gravada (2: blocos de arquivo levam o hash, para a miniatura).
const PROJECTION_VERSION: u32 = 2;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn now() -> Millis {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as Millis).unwrap_or(0)
}

// ---------- tipos (mesmo formato de src/lib/types.ts) ----------

/// Filtro "Sem categoria" (em `Filter::category_id`) e "Sem tags" (em `Filter::tags`): não é um id nem uma tag
/// possível (`~` não entra em tag). O mesmo valor de `NO_CATEGORY`/`NO_TAGS` em src/lib/types.ts.
pub const NO_CATEGORY: &str = "~none";
pub const NO_TAGS: &str = "~none";

/// Quantas notas ativas estão sem categoria e sem tags (a lateral mostra ao lado de "Sem categoria" e "Sem tags").
#[derive(Debug, Serialize, PartialEq)]
pub struct OrphanCounts {
    pub uncategorized: i64,
    pub untagged: i64,
}

/// SQL: a nota não tem categoria (ou a dela foi apagada).
const UNCATEGORIZED: &str = "(n.category_id IS NULL OR n.category_id NOT IN (SELECT id FROM categories WHERE deleted = 0))";
/// SQL: a nota não tem tag nenhuma (nem manual nem `#tag` do texto).
const UNTAGGED: &str = "NOT EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id)";

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
    /// Oculta: as notas dela não aparecem em Tudo, na busca nem nas outras visões (só abrindo a categoria).
    pub hidden: bool,
    /// Tem PIN: oculta e só abre com o PIN.
    pub locked: bool,
    /// Com PIN, mas já desbloqueada nesta sessão do app.
    pub unlocked: bool,
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
    /// Repetição do lembrete: "day" | "week" | "month" | "year" (None = uma vez).
    pub reminder_repeat: Option<String>,
    /// Emoji grande de capa (None = sem).
    pub emoji: Option<String>,
    pub tags: Vec<String>,
    pub created_at: Millis,
    pub updated_at: Millis,
    pub position: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub reminder_repeat: Option<String>,
    pub emoji: Option<String>,
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
    pub reminder_repeat: Option<String>,
    #[serde(default)]
    pub emoji: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Categoria como o sync a vê (com a ordem e a marca de apagada).
#[derive(Debug, Clone, PartialEq)]
pub struct CategoryRow {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort: i64,
    pub deleted: bool,
    pub hidden: bool,
    /// Hash do PIN (o mesmo em todos os aparelhos).
    pub pin: Option<String>,
}

/// O que mudou aqui e ainda não foi para o Drive (a linha do sync compara duas olhadas seguidas: igual = a escrita
/// parou e dá para enviar).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LocalChanges {
    pub dirty: i64,
    pub dirty_edited_at: Millis,
    pub deletes: i64,
    pub uploads: i64,
    pub categories_changed_at: Millis,
}

impl LocalChanges {
    pub fn has_work(&self) -> bool {
        self.dirty > 0 || self.deletes > 0 || self.uploads > 0
    }
}

/// Lembrete vencido, para o agendador avisar.
#[derive(Debug)]
pub struct DueReminder {
    pub id: String,
    /// Rótulo da nota (título, ou a primeira linha).
    pub title: String,
    pub at: Millis,
    pub repeat: Option<String>,
    /// É a volta de um adiamento (a série não muda).
    pub snoozed: bool,
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
    /// O sync existe nesta versão (o app foi compilado com o cliente OAuth do Google).
    pub configured: bool,
    pub connected: bool,
    /// "ok" | "syncing" | "offline" | "error" (preenchido pelo sync).
    pub state: &'static str,
    pub error: Option<String>,
    /// E-mail da conta Google conectada.
    pub account: Option<String>,
    /// Notas com mudança ainda não enviada.
    pub pending: i64,
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
    // 2 — Fase 2: cada nota é um Y.Doc; o estado binário é a fonte da verdade e body_json passa a ser derivado dele.
    // As notas da Fase 1 ganham o estado logo depois (Store::backfill_ydocs).
    r#"
    ALTER TABLE notes ADD COLUMN ydoc BLOB;
    "#,
    // 3 — Fase 4: lembrete que se repete (projeção do meta do Y.Doc) e quando este aparelho já avisou (local, não
    // sincroniza: cada aparelho avisa uma vez).
    r#"
    ALTER TABLE notes ADD COLUMN reminder_repeat TEXT;
    ALTER TABLE notes ADD COLUMN notified_at INTEGER;
    "#,
    // 4 — Fase 5 (Sync com o Drive): id do arquivo de cada nota no Drive, arquivos a apagar lá (notas excluídas de
    // vez) e estados Yjs que não são notas (categorias).
    r#"
    ALTER TABLE notes ADD COLUMN drive_file_id TEXT;
    ALTER TABLE notes ADD COLUMN drive_rev TEXT;
    CREATE INDEX IF NOT EXISTS notes_drive ON notes (drive_file_id);
    CREATE TABLE IF NOT EXISTS pending_deletes (drive_file_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS sync_blobs (key TEXT PRIMARY KEY, value BLOB NOT NULL);
    "#,
    // 5 — adiar um lembrete que se repete: avisa de novo mais tarde sem mexer no horário da série (local, como
    // `notified_at`).
    r#"
    ALTER TABLE notes ADD COLUMN snoozed_until INTEGER;
    "#,
    // 6 — MCP: o que outro processo (o `ideario --mcp`) mudou no banco, para o app aberto atualizar a tela na hora.
    // `note_id` nulo = categorias, tags ou anexos (a lista inteira recarrega).
    r#"
    CREATE TABLE external_changes (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id TEXT,
      removed INTEGER NOT NULL DEFAULT 0
    );
    "#,
    // 7 — categoria oculta e categoria com PIN (os dois vão no categories.ydoc, valem em todos os aparelhos).
    r#"
    ALTER TABLE categories ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE categories ADD COLUMN pin_hash TEXT;
    "#,
    // 8 — emoji grande de capa da nota (projeção do meta do Y.Doc).
    r#"
    ALTER TABLE notes ADD COLUMN emoji TEXT;
    "#,
];

/// SQL: a nota não está numa categoria oculta ou com PIN — a não ser a categoria escolhida (`?N`, ou NULL), que mostra
/// as notas dela (com PIN, só depois de desbloquear nesta sessão: `temp.unlocked`).
fn private_clause(selected: usize) -> String {
    format!(
        "NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = n.category_id AND c.deleted = 0 AND (c.hidden = 1 OR c.pin_hash IS NOT NULL) \
         AND NOT (c.id IS ?{selected} AND (c.pin_hash IS NULL OR c.id IN (SELECT id FROM temp.unlocked))))"
    )
}

/// O mesmo, sem categoria escolhida (contagens da lateral, tags).
const NOT_PRIVATE: &str = "NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = n.category_id AND c.deleted = 0 AND (c.hidden = 1 OR c.pin_hash IS NOT NULL))";

/// Hash do PIN da categoria (o id entra junto: o mesmo PIN em duas categorias dá hashes diferentes).
fn pin_hash(category: &str, pin: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(format!("ideario-pin:{category}:{pin}").as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Nota no backup: id, estado Yjs, criação e última edição.
pub type BackupNote = (String, Vec<u8>, Millis, Millis);

/// Mudança feita por outro processo no banco (o MCP).
#[derive(Debug, Clone, PartialEq)]
pub struct ExternalChange {
    pub seq: i64,
    pub note_id: Option<String>,
    pub removed: bool,
}

pub struct Store {
    pub conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Store> {
        let conn = Connection::open(path).map_err(err)?;
        // Antes de migrar um banco que já tem notas, guarda uma cópia ao lado (ideario.db.v1.bak, …).
        let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(err)?;
        if version > 0 && version < MIGRATIONS.len() {
            let backup = path.with_extension(format!("db.v{version}.bak"));
            if !backup.exists() {
                conn.execute("VACUUM INTO ?1", [backup.to_string_lossy()]).map_err(err)?;
            }
        }
        Store::setup(conn)
    }

    #[cfg(test)]
    pub fn memory() -> Store {
        Store::setup(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn setup(conn: Connection) -> Result<Store> {
        // O app e o MCP (`ideario --mcp`) abrem o mesmo banco: quem chega com o outro escrevendo espera um pouco
        // em vez de falhar (o rusqlite já usa 5 s; fica explícito porque o MCP depende disso).
        conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(err)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;").map_err(err)?;
        let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(err)?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
            conn.execute_batch(&format!("BEGIN; {sql}; PRAGMA user_version = {}; COMMIT;", i + 1)).map_err(err)?;
        }
        // Categorias com PIN desbloqueadas nesta sessão: tabela temporária, só desta conexão (fechar o app bloqueia
        // de novo; o MCP, outro processo, nunca vê as desbloqueadas aqui).
        conn.execute_batch("CREATE TEMP TABLE IF NOT EXISTS unlocked (id TEXT PRIMARY KEY)").map_err(err)?;
        let store = Store { conn };
        store.backfill_ydocs()?;
        store.reproject_if_outdated()?;
        store.purge_trash()?;
        Ok(store)
    }

    /// A projeção (prévia, capa, rótulo) mudou de formato: recalcula todas as notas uma vez, sem mudar datas.
    /// Suba `PROJECTION_VERSION` quando o que a projeção grava mudar.
    fn reproject_if_outdated(&self) -> Result<()> {
        let key = format!("projection_v{PROJECTION_VERSION}");
        if self.flag(&key)? {
            return Ok(());
        }
        for id in self.ids("SELECT id FROM notes", [])? {
            if let (Some(n), Some(state)) = (self.note_input(&id)?, self.ydoc(&id)?) {
                self.write_note(&n, false, &state)?;
            }
        }
        self.set_flag(&key)
    }

    /// Notas sem estado Yjs (vindas da Fase 1): o estado nasce do JSON e dos metadados atuais, sem mudar a data.
    fn backfill_ydocs(&self) -> Result<()> {
        let ids = self.ids("SELECT id FROM notes WHERE ydoc IS NULL", [])?;
        if ids.is_empty() {
            return Ok(());
        }
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        for id in &ids {
            if let Some(n) = self.note_input(id)? {
                tx.execute("UPDATE notes SET ydoc = ?2 WHERE id = ?1", params![id, ydoc::from_note(&n)]).map_err(err)?;
            }
        }
        tx.commit().map_err(err)
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
            "live" => "n.trashed_at IS NULL".to_string(),
            _ => "n.archived = 0 AND n.trashed_at IS NULL".to_string(),
        }];
        // Categorias ocultas e com PIN ficam de fora (a escolhida no filtro mostra as dela).
        args.push(match filter.category_id.as_deref() {
            Some(NO_CATEGORY) | None => rusqlite::types::Value::Null,
            Some(c) => c.to_string().into(),
        });
        w.push(private_clause(args.len()));
        match filter.category_id.as_deref() {
            Some(NO_CATEGORY) => w.push(UNCATEGORIZED.into()),
            Some(c) => {
                args.push(c.to_string().into());
                w.push(format!("n.category_id = ?{}", args.len()));
            }
            None => {}
        }
        for t in &filter.tags {
            if t == NO_TAGS {
                w.push(UNTAGGED.into());
                continue;
            }
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
        n.category_id, n.color, n.pinned, n.archived, n.trashed_at, n.reminder_at, n.reminder_done, n.created_at, n.updated_at, n.position, n.reminder_repeat, n.emoji";

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
            preview: RawValue::from_string(preview)
                .or_else(|_| RawValue::from_string("[]".into()))
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e)))?,
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
            reminder_repeat: r.get(18)?,
            emoji: r.get(19)?,
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
        // Arquivar não tira o lembrete: ele avisa e aparece aqui (só a lixeira tira).
        let mut w = Self::where_clause("live", filter, query, &mut args);
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
        // Lembretes contam as arquivadas também (aparecem em Lembretes); Notas e Moodboard, só as ativas.
        let w = Self::where_clause("live", filter, query, &mut args);
        let now = now();
        let (notes, reminders, overdue, moodboard): (i64, i64, i64, i64) = self
            .conn
            .query_row(
                &format!(
                    "SELECT COALESCE(SUM(n.archived = 0), 0), \
                     COALESCE(SUM(n.reminder_at IS NOT NULL AND n.reminder_done = 0), 0), \
                     COALESCE(SUM(n.reminder_at IS NOT NULL AND n.reminder_done = 0 AND n.reminder_at < {now}), 0), \
                     COALESCE(SUM(CASE WHEN n.archived = 0 THEN n.image_count ELSE 0 END), 0) FROM notes n WHERE {w}"
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
                 (SELECT COUNT(*) FROM notes n WHERE n.category_id = c.id AND n.archived = 0 AND n.trashed_at IS NULL), \
                 c.hidden, c.pin_hash IS NOT NULL, c.id IN (SELECT id FROM temp.unlocked) \
                 FROM categories c WHERE c.deleted = 0 ORDER BY c.sort, c.name",
            )
            .map_err(err)?;
        let rows = st
            .query_map([], |r| {
                Ok(Category {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                    icon: None,
                    note_count: r.get(3)?,
                    hidden: r.get(4)?,
                    locked: r.get(5)?,
                    unlocked: r.get(6)?,
                })
            })
            .map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }

    pub fn create_category(&self, name: &str, color: &str) -> Result<Category> {
        let name = name.trim();
        if name.is_empty() {
            return Err("nome vazio".into());
        }
        self.insert_category(&uuid::Uuid::now_v7().to_string(), name, color)
    }

    fn insert_category(&self, id: &str, name: &str, color: &str) -> Result<Category> {
        let id = id.to_string();
        let sort: i64 = self.conn.query_row("SELECT COALESCE(MAX(sort), -1) + 1 FROM categories", [], |r| r.get(0)).map_err(err)?;
        self.conn
            .execute("INSERT INTO categories (id, name, color, sort, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![id, name, color, sort, now()])
            .map_err(err)?;
        Ok(Category { id, name: name.to_string(), color: color.to_string(), icon: None, note_count: 0, hidden: false, locked: false, unlocked: false })
    }

    /// Categoria pelo nome (sem diferenciar maiúsculas nem acentos); se não existe, cria com a próxima cor livre.
    /// Devolve o id e se foi criada agora.
    pub fn category_by_name_or_create(&self, name: &str) -> Result<(String, bool)> {
        let key = fold(name.trim());
        let cats = self.list_categories()?;
        if let Some(c) = cats.iter().find(|c| fold(&c.name) == key) {
            return Ok((c.id.clone(), false));
        }
        let used: Vec<String> = cats.iter().map(|c| c.color.to_lowercase()).collect();
        let color = CATEGORY_COLORS
            .iter()
            .find(|c| !used.contains(&c.to_lowercase()))
            .copied()
            .unwrap_or(CATEGORY_COLORS[cats.len() % CATEGORY_COLORS.len()]);
        // Id que sai do nome: a mesma categoria criada em dois aparelhos (o mesmo Takeout importado nos dois) é uma só.
        let id = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_URL, format!("ideario:category:{key}").as_bytes()).to_string();
        let name = name.trim();
        if name.is_empty() {
            return Err("nome vazio".into());
        }
        if self.conn.query_row("SELECT EXISTS (SELECT 1 FROM categories WHERE id = ?1)", [&id], |r| r.get(0)).map_err(err)? {
            // Já existiu e foi apagada: volta.
            self.conn.execute("UPDATE categories SET deleted = 0, name = ?2, updated_at = ?3 WHERE id = ?1", params![id, name, now()]).map_err(err)?;
            return Ok((id, true));
        }
        Ok((self.insert_category(&id, name, color)?.id, true))
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

    /// Oculta (ou mostra) a categoria nas listas.
    pub fn set_category_hidden(&self, id: &str, hidden: bool) -> Result<()> {
        self.conn.execute("UPDATE categories SET hidden = ?2, updated_at = ?3 WHERE id = ?1", params![id, hidden, now()]).map_err(err)?;
        Ok(())
    }

    /// Põe (4 a 8 números) ou tira (`None`) o PIN da categoria. Quem chama confere o PIN antigo.
    pub fn set_category_pin(&self, id: &str, pin: Option<&str>) -> Result<()> {
        let hash = match pin {
            Some(p) if (4..=8).contains(&p.len()) && p.chars().all(|c| c.is_ascii_digit()) => Some(pin_hash(id, p)),
            Some(_) => return Err("o PIN tem de 4 a 8 números".into()),
            None => None,
        };
        self.conn.execute("UPDATE categories SET pin_hash = ?2, updated_at = ?3 WHERE id = ?1", params![id, hash, now()]).map_err(err)?;
        // PIN novo: a categoria começa desbloqueada (quem acabou de pôr o PIN está vendo); sem PIN, nada a lembrar.
        match hash {
            Some(_) => self.conn.execute("INSERT OR IGNORE INTO temp.unlocked (id) VALUES (?1)", [id]),
            None => self.conn.execute("DELETE FROM temp.unlocked WHERE id = ?1", [id]),
        }
        .map_err(err)?;
        Ok(())
    }

    /// O PIN confere?
    pub fn check_pin(&self, id: &str, pin: &str) -> Result<bool> {
        let saved: Option<String> =
            self.conn.query_row("SELECT pin_hash FROM categories WHERE id = ?1", [id], |r| r.get(0)).optional().map_err(err)?.flatten();
        Ok(saved.is_some_and(|h| h == pin_hash(id, pin)))
    }

    /// Desbloqueia a categoria até o app fechar (ou `lock_category`). Devolve se o PIN conferiu.
    pub fn unlock_category(&self, id: &str, pin: &str) -> Result<bool> {
        if !self.check_pin(id, pin)? {
            return Ok(false);
        }
        self.conn.execute("INSERT OR IGNORE INTO temp.unlocked (id) VALUES (?1)", [id]).map_err(err)?;
        Ok(true)
    }

    pub fn lock_category(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM temp.unlocked WHERE id = ?1", [id]).map_err(err)?;
        Ok(())
    }

    /// A nota está numa categoria com PIN ainda bloqueada.
    pub fn note_locked(&self, id: &str) -> Result<bool> {
        self.conn
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM notes n JOIN categories c ON c.id = n.category_id WHERE n.id = ?1 AND c.deleted = 0 \
                 AND c.pin_hash IS NOT NULL AND c.id NOT IN (SELECT id FROM temp.unlocked))",
                [id],
                |r| r.get(0),
            )
            .map_err(err)
    }

    /// Apaga a categoria; as notas dela ficam sem categoria (nada some).
    pub fn delete_category(&self, id: &str) -> Result<()> {
        self.conn.execute("UPDATE categories SET deleted = 1, updated_at = ?2 WHERE id = ?1", params![id, now()]).map_err(err)?;
        // Pelo Y.Doc de cada nota, para a mudança ir junto no sync.
        let mut patch = Map::new();
        patch.insert("categoryId".into(), Value::Null);
        for n in self.category_note_ids(id)? {
            self.patch_note(&n, &patch, true)?;
        }
        Ok(())
    }

    /// Recria uma categoria apagada (Desfazer), com as mesmas notas de antes.
    pub fn restore_category(&self, id: &str, note_ids: &[String]) -> Result<()> {
        self.conn.execute("UPDATE categories SET deleted = 0, updated_at = ?2 WHERE id = ?1", params![id, now()]).map_err(err)?;
        let mut patch = Map::new();
        patch.insert("categoryId".into(), Value::from(id));
        for n in note_ids {
            self.patch_note(n, &patch, false)?;
        }
        Ok(())
    }

    pub fn category_note_ids(&self, id: &str) -> Result<Vec<String>> {
        self.ids("SELECT id FROM notes WHERE category_id = ?1", params![id])
    }

    pub fn orphan_counts(&self) -> Result<OrphanCounts> {
        self.conn
            .query_row(
                &format!(
                    "SELECT COALESCE(SUM({UNCATEGORIZED}), 0), COALESCE(SUM({UNTAGGED}), 0) FROM notes n \
                     WHERE n.archived = 0 AND n.trashed_at IS NULL AND {NOT_PRIVATE}"
                ),
                [],
                |r| Ok(OrphanCounts { uncategorized: r.get(0)?, untagged: r.get(1)? }),
            )
            .map_err(err)
    }

    pub fn list_tags(&self) -> Result<Vec<TagCount>> {
        let mut st = self
            .conn
            .prepare_cached(
                &format!(
                    "SELECT t.tag, COUNT(DISTINCT t.note_id) AS c FROM note_tags t JOIN notes n ON n.id = t.note_id \
                     WHERE n.archived = 0 AND n.trashed_at IS NULL AND {NOT_PRIVATE} GROUP BY t.tag ORDER BY c DESC, t.tag"
                ),
            )
            .map_err(err)?;
        let rows = st.query_map([], |r| Ok(TagCount { name: r.get(0)?, count: r.get(1)? })).map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }

    /// Renomeia (ou, com `to = None`, tira) uma tag em todas as notas: nas tags manuais e nas `#tags` do texto
    /// (que vira palavra comum ao tirar). Devolve quantas notas mudaram.
    /// Notas com a tag (manual ou `#tag` do texto).
    pub fn note_ids_with_tag(&self, tag: &str) -> Result<Vec<String>> {
        self.ids("SELECT DISTINCT note_id FROM note_tags WHERE tag = ?1", params![tag])
    }

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
            let state = ydoc::update(&self.ydoc(id)?.unwrap_or_default(), &input, true)?;
            self.write_note(&input, false, &state)?;
        }
        Ok(ids.len())
    }

    // ---------- uma nota ----------

    pub fn note_input(&self, id: &str) -> Result<Option<NoteInput>> {
        self.conn
            .query_row(
                "SELECT id, title, body_json, category_id, color, pinned, archived, trashed_at, reminder_at, reminder_done, reminder_repeat, emoji FROM notes WHERE id = ?1",
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
                        reminder_repeat: r.get(10)?,
                        emoji: r.get(11)?,
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
            reminder_repeat: n.reminder_repeat,
            emoji: n.emoji,
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
        let state = match (self.note_input(&input.id)?, self.ydoc(&input.id)?) {
            (Some(prev), _) if same_content(&prev, &input) => return self.summary(&input.id),
            (Some(_), Some(state)) => ydoc::update(&state, &input, true)?,
            _ => ydoc::from_note(&input),
        };
        self.write_note(&input, true, &state)?;
        self.summary(&input.id)
    }

    /// Estado Yjs da nota (para o editor abrir e, na Fase 5, para o Drive).
    pub fn note_exists(&self, id: &str) -> Result<bool> {
        self.conn.query_row("SELECT EXISTS (SELECT 1 FROM notes WHERE id = ?1)", [id], |r| r.get(0)).map_err(err)
    }

    /// Datas vindas de fora (importação do Keep): criação e última edição originais.
    pub fn set_times(&self, id: &str, created: Millis, updated: Millis) -> Result<()> {
        self.conn.execute("UPDATE notes SET created_at = ?2, updated_at = ?3 WHERE id = ?1", params![id, created, updated]).map_err(err)?;
        Ok(())
    }

    pub fn ydoc(&self, id: &str) -> Result<Option<Vec<u8>>> {
        self.conn
            .query_row("SELECT ydoc FROM notes WHERE id = ?1", [id], |r| r.get::<_, Option<Vec<u8>>>(0))
            .optional()
            .map(Option::flatten)
            .map_err(err)
    }

    /// Junta uma atualização Yjs (do editor; na Fase 5, de outro aparelho) e reprojeta a nota. Cria a nota se ela
    /// ainda não existe. A data de edição só muda se algo visível mudou.
    pub fn apply_update(&self, id: &str, update: &[u8]) -> Result<()> {
        let prev = self.note_input(id)?;
        let state = ydoc::apply(&self.ydoc(id)?.unwrap_or_default(), update)?;
        let mut n = ydoc::to_note(id, &state)?;
        let mut seen = HashSet::new();
        n.tags.retain(|t| seen.insert(t.clone()));
        let touch = !prev.as_ref().is_some_and(|p| same_content(p, &n));
        self.write_note(&n, touch, &state)
    }

    /// Grava a nota e recalcula a projeção, as tags, os anexos e a busca.
    fn write_note(&self, n: &NoteInput, touch: bool, state: &[u8]) -> Result<()> {
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
             category_id, color, pinned, archived, trashed_at, reminder_at, reminder_done, position, created_at, updated_at, ydoc, reminder_repeat, emoji, dirty) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, 1) \
             ON CONFLICT(id) DO UPDATE SET ydoc = excluded.ydoc, body_json = excluded.body_json, title = excluded.title, label = excluded.label, \
             label_fold = excluded.label_fold, body_text = excluded.body_text, preview_json = excluded.preview_json, \
             cover_json = excluded.cover_json, image_count = excluded.image_count, file_count = excluded.file_count, \
             category_id = excluded.category_id, color = excluded.color, pinned = excluded.pinned, archived = excluded.archived, \
             trashed_at = excluded.trashed_at, reminder_at = excluded.reminder_at, reminder_done = excluded.reminder_done, \
             reminder_repeat = excluded.reminder_repeat, emoji = excluded.emoji, \
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
                state,
                n.reminder_repeat,
                n.emoji,
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
        let mut patch = Map::new();
        patch.insert("reminderDone".into(), Value::Bool(done));
        // Concluir o lembrete não é editar a nota: a data fica.
        self.patch_note(id, &patch, false)
    }

    /// Lembretes vencidos até `now` que este aparelho ainda não avisou.
    /// Só notas ativas ou arquivadas (lixeira não avisa) e não concluídas.
    pub fn due_reminders(&self, now: Millis) -> Result<Vec<DueReminder>> {
        // Nota de categoria com PIN avisa sem mostrar o título (a notificação aparece na tela de qualquer jeito).
        const LABEL: &str = "CASE WHEN EXISTS (SELECT 1 FROM categories c WHERE c.id = n.category_id AND c.deleted = 0 AND c.pin_hash IS NOT NULL) \
                             THEN 'Nota protegida' ELSE n.label END";
        let mut st = self
            .conn
            .prepare_cached(&format!(
                "SELECT id, {LABEL}, reminder_at, reminder_repeat, 0 FROM notes n \
                 WHERE reminder_at IS NOT NULL AND reminder_at <= ?1 AND reminder_done = 0 AND trashed_at IS NULL \
                 AND (notified_at IS NULL OR notified_at < reminder_at) \
                 UNION ALL \
                 SELECT id, {LABEL}, snoozed_until, reminder_repeat, 1 FROM notes n \
                 WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?1 AND trashed_at IS NULL \
                 ORDER BY 3"
            ))
            .map_err(err)?;
        let rows = st
            .query_map([now], |r| {
                Ok(DueReminder { id: r.get(0)?, title: r.get(1)?, at: r.get(2)?, repeat: r.get(3)?, snoozed: r.get(4)? })
            })
            .map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }

    /// Lembrete da nota: (quando, repetição).
    pub fn reminder_of(&self, id: &str) -> Result<Option<(Millis, Option<String>)>> {
        self.conn
            .query_row("SELECT reminder_at, reminder_repeat FROM notes WHERE id = ?1 AND reminder_at IS NOT NULL", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()
            .map_err(err)
    }

    /// Adiamento local de um lembrete que se repete (None = sem adiamento).
    pub fn set_snooze(&self, id: &str, until: Option<Millis>) -> Result<()> {
        self.conn.execute("UPDATE notes SET snoozed_until = ?2 WHERE id = ?1", params![id, until]).map_err(err)?;
        Ok(())
    }

    /// Este aparelho já avisou o lembrete marcado para `at` (local: não sincroniza).
    pub fn mark_notified(&self, id: &str, at: Millis) -> Result<()> {
        self.conn.execute("UPDATE notes SET notified_at = ?2 WHERE id = ?1", params![id, at]).map_err(err)?;
        Ok(())
    }

    /// Muda o lembrete sem contar como edição da nota (próxima vez de um lembrete que se repete).
    pub fn reschedule(&self, id: &str, patch: &Map<String, Value>) -> Result<bool> {
        self.patch_note(id, patch, false)
    }

    /// Muda metadados sem abrir o editor (menus de contexto). Só as chaves presentes mudam; `null` limpa.
    pub fn update_note(&self, id: &str, patch: &Map<String, Value>) -> Result<bool> {
        self.patch_note(id, patch, true)
    }

    fn patch_note(&self, id: &str, patch: &Map<String, Value>, touch: bool) -> Result<bool> {
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
                "reminderRepeat" => n.reminder_repeat = v.as_str().filter(|r| REPEATS.contains(r)).map(str::to_string),
                "emoji" => n.emoji = v.as_str().and_then(clean_emoji),
                _ => {}
            }
        }
        if same_content(&before, &n) {
            return Ok(false);
        }
        let state = ydoc::update(&self.ydoc(id)?.unwrap_or_default(), &n, false)?;
        self.write_note(&n, touch, &state)?;
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
        if let (Some(a), Some(b), Some(after), Some(before)) = (a, b, after, before) {
            if !(pos > a && pos < b) {
                // Sem espaço entre os vizinhos: renumera tudo e tenta de novo.
                self.renumber("n.position ASC")?;
                let (a, b) = (pos_of(after)?.unwrap_or(0.0), pos_of(before)?.unwrap_or(0.0));
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
        self.write_note(&n, true, &ydoc::from_note(&n))?;
        self.conn.execute("UPDATE notes SET position = ?2 WHERE id = ?1", params![n.id, pos - 1.0]).map_err(err)?;
        Ok(n.id)
    }

    pub fn note_text(&self, id: &str) -> Result<String> {
        let Some(n) = self.note_input(id)? else { return Ok(String::new()) };
        Ok(projection::plain_text(&n.title, &self.project(&n.body)?))
    }

    pub fn delete_note(&self, id: &str) -> Result<bool> {
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        // Excluída de vez: o arquivo no Drive também sai (no próximo sync).
        tx.execute(
            "INSERT OR IGNORE INTO pending_deletes (drive_file_id) SELECT drive_file_id FROM notes WHERE id = ?1 AND drive_file_id IS NOT NULL",
            [id],
        )
        .map_err(err)?;
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
        self.attachment_rows("active", filter, "", None, |r, q| q.is_empty() || fold(&format!("{} {}", r.a.name, r.note_title)).contains(q), query)
    }

    /// Fotos das notas ativas que passam no filtro e na busca, para o Moodboard.
    /// Fotos para o Moodboard; com `archived`, as das notas arquivadas também.
    pub fn list_images(&self, filter: &Filter, query: &str, tone: Option<&str>, archived: bool) -> Result<Vec<AttachmentRow>> {
        let box_ = if archived { "live" } else { "active" };
        let rows = self.attachment_rows(box_, filter, query, Some("image"), |_, _| true, "")?;
        Ok(rows.into_iter().filter(|r| tone.is_none() || r.a.tone.as_deref() == tone).collect())
    }

    fn attachment_rows(
        &self,
        box_: &str,
        filter: &Filter,
        note_query: &str,
        kind: Option<&str>,
        keep: impl Fn(&AttachmentRow, &str) -> bool,
        name_query: &str,
    ) -> Result<Vec<AttachmentRow>> {
        let mut args = Vec::new();
        let mut w = Self::where_clause(box_, filter, note_query, &mut args);
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

    pub fn attachment_kind(&self, hash: &str) -> Result<Option<String>> {
        self.conn.query_row("SELECT kind FROM attachments WHERE hash = ?1", [hash], |r| r.get(0)).optional().map_err(err)
    }

    /// PDFs e vídeos (para gerar a prévia). Quem chama filtra os que já têm miniatura.
    pub fn previewable(&self) -> Result<Vec<(String, String)>> {
        let mut st = self
            .conn
            .prepare_cached("SELECT hash, kind FROM attachments WHERE kind IN ('pdf', 'video')")
            .map_err(err)?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
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

    /// Fotos sem paleta (entraram antes do pipeline da Fase 3).
    pub fn images_without_palette(&self) -> Result<Vec<String>> {
        self.ids("SELECT hash FROM attachments WHERE kind = 'image' AND palette IS NULL", [])
    }

    /// Grava a paleta e o tom calculados depois (lista vazia = não deu para ler a foto; não tenta de novo).
    pub fn set_palette(&self, hash: &str, palette: &[String], tone: Option<&str>) -> Result<()> {
        self.conn
            .execute(
                "UPDATE attachments SET palette = ?2, tone = ?3 WHERE hash = ?1",
                params![hash, serde_json::to_string(palette).map_err(err)?, tone],
            )
            .map_err(err)?;
        Ok(())
    }

    // ---------- sync com o Drive (Fase 5) ----------

    /// Notas com mudança local ainda não enviada: (id, arquivo no Drive, se já tem).
    pub fn dirty_notes(&self) -> Result<Vec<(String, Option<String>)>> {
        let mut st = self.conn.prepare_cached("SELECT id, drive_file_id FROM notes WHERE dirty = 1 ORDER BY updated_at").map_err(err)?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }

    /// Nota do arquivo do Drive e a versão do arquivo que este aparelho já tem.
    pub fn note_by_file(&self, file_id: &str) -> Result<Option<String>> {
        self.conn.query_row("SELECT id FROM notes WHERE drive_file_id = ?1", [file_id], |r| r.get(0)).optional().map_err(err)
    }

    /// Arquivo da nota no Drive e a versão dele já juntada aqui.
    pub fn note_file(&self, id: &str) -> Result<Option<(Option<String>, Option<String>)>> {
        self.conn.query_row("SELECT drive_file_id, drive_rev FROM notes WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(err)
    }

    /// Junta a versão do Drive na nota local (ou cria a nota). As datas vêm do Drive (de quem enviou): a de edição
    /// só muda se algo visível mudou. Continua "a subir" se o local tiver algo que o Drive não tem. Devolve se algo
    /// visível mudou.
    pub fn merge_remote_note(&self, id: &str, remote: &[u8], file: (&str, &str), created: Millis, edited: Millis) -> Result<bool> {
        let prev = self.note_input(id)?;
        let state = ydoc::apply(&self.ydoc(id)?.unwrap_or_default(), remote)?;
        let mut n = ydoc::to_note(id, &state)?;
        let mut seen = HashSet::new();
        n.tags.retain(|t| seen.insert(t.clone()));
        let changed = !prev.as_ref().is_some_and(|p| same_content(p, &n));
        self.write_note(&n, false, &state)?;
        let dirty = ydoc::has_more_than(&state, remote)?;
        let (fresh, file_id, rev) = (prev.is_none(), file.0, file.1);
        self.conn
            .execute(
                "UPDATE notes SET dirty = ?2, drive_file_id = ?3, drive_rev = ?4, \
                 updated_at = CASE WHEN ?5 THEN ?7 WHEN ?6 THEN MAX(updated_at, ?7) ELSE updated_at END, \
                 created_at = CASE WHEN ?5 THEN ?8 ELSE created_at END WHERE id = ?1",
                params![id, dirty, file_id, rev, fresh, changed, edited, created],
            )
            .map_err(err)?;
        Ok(changed)
    }

    /// Criação e última edição da nota (vão junto com o arquivo para o Drive).
    pub fn note_times(&self, id: &str) -> Result<(Millis, Millis)> {
        self.conn.query_row("SELECT created_at, updated_at FROM notes WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)
    }

    /// Enviada: limpa a marca de mudança só se a nota não mudou de novo enquanto subia.
    /// Devolve false se a nota não existe mais (foi excluída enquanto subia).
    pub fn mark_uploaded(&self, id: &str, uploaded: &[u8], file_id: &str, rev: &str) -> Result<bool> {
        let n = self
            .conn
            .execute(
                "UPDATE notes SET drive_file_id = ?3, drive_rev = ?4, dirty = CASE WHEN ydoc = ?2 THEN 0 ELSE dirty END WHERE id = ?1",
                params![id, uploaded, file_id, rev],
            )
            .map_err(err)?;
        Ok(n > 0)
    }

    /// O arquivo da nota sumiu do Drive (outro aparelho a excluiu de vez): sai daqui também. Se havia mudança aqui
    /// ainda não enviada, a nota fica (volta ao Drive no próximo envio): nenhuma edição se perde.
    pub fn remove_synced_note(&self, file_id: &str) -> Result<bool> {
        let Some(id) = self.note_by_file(file_id)? else { return Ok(false) };
        self.conn.execute("UPDATE notes SET drive_file_id = NULL, drive_rev = NULL WHERE id = ?1", [&id]).map_err(err)?;
        let dirty: bool = self.conn.query_row("SELECT dirty FROM notes WHERE id = ?1", [&id], |r| r.get(0)).map_err(err)?;
        if dirty {
            return Ok(false);
        }
        self.delete_note(&id)
    }

    pub fn is_pending_delete(&self, file_id: &str) -> Result<bool> {
        self.conn.query_row("SELECT EXISTS (SELECT 1 FROM pending_deletes WHERE drive_file_id = ?1)", [file_id], |r| r.get(0)).map_err(err)
    }

    pub fn mark_dirty(&self, id: &str) -> Result<()> {
        self.conn.execute("UPDATE notes SET dirty = 1 WHERE id = ?1", [id]).map_err(err)?;
        Ok(())
    }

    pub fn add_pending_delete(&self, file_id: &str) -> Result<()> {
        self.conn.execute("INSERT OR IGNORE INTO pending_deletes (drive_file_id) VALUES (?1)", [file_id]).map_err(err)?;
        Ok(())
    }

    pub fn pending_deletes(&self) -> Result<Vec<String>> {
        self.ids("SELECT drive_file_id FROM pending_deletes", [])
    }

    pub fn clear_pending_delete(&self, file_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM pending_deletes WHERE drive_file_id = ?1", [file_id]).map_err(err)?;
        Ok(())
    }

    /// Anexos usados por notas e ainda não enviados.
    pub fn attachments_to_upload(&self) -> Result<Vec<Attachment>> {
        let hashes = self.ids(
            "SELECT DISTINCT a.hash FROM attachments a JOIN note_attachments na ON na.hash = a.hash WHERE a.drive_file_id IS NULL AND a.local_state = 'full'",
            [],
        )?;
        self.get_attachments(&hashes)
    }

    pub fn set_attachment_file(&self, hash: &str, file_id: &str) -> Result<()> {
        self.conn.execute("UPDATE attachments SET drive_file_id = ?2, uploaded = 1 WHERE hash = ?1", params![hash, file_id]).map_err(err)?;
        Ok(())
    }

    /// Anexo que existe no Drive: o arquivo dele (para baixar quando faltar aqui).
    pub fn attachment_file(&self, hash: &str) -> Result<Option<String>> {
        self.conn
            .query_row("SELECT drive_file_id FROM attachments WHERE hash = ?1", [hash], |r| r.get(0))
            .optional()
            .map(Option::flatten)
            .map_err(err)
    }

    /// Anexo que outro aparelho subiu: entra registrado (com o arquivo no Drive), mas o conteúdo ainda não está aqui.
    pub fn register_remote_attachment(&self, a: &Attachment, file_id: &str) -> Result<()> {
        let known: bool = self.conn.query_row("SELECT EXISTS (SELECT 1 FROM attachments WHERE hash = ?1)", [&a.hash], |r| r.get(0)).map_err(err)?;
        if !known {
            self.insert_attachment(a)?;
            self.conn.execute("UPDATE attachments SET local_state = 'missing' WHERE hash = ?1", [&a.hash]).map_err(err)?;
        }
        self.set_attachment_file(&a.hash, file_id)
    }

    /// Anexos registrados sem o conteúdo aqui: (hash, arquivo no Drive, tipo, tamanho).
    pub fn missing_attachments(&self) -> Result<Vec<(String, String, String, i64)>> {
        let mut st = self
            .conn
            .prepare_cached(
                "SELECT hash, drive_file_id, kind, bytes FROM attachments WHERE local_state = 'missing' AND drive_file_id IS NOT NULL ORDER BY added_at DESC",
            )
            .map_err(err)?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }

    pub fn set_attachment_missing(&self, hash: &str) -> Result<()> {
        self.conn.execute("UPDATE attachments SET local_state = 'missing' WHERE hash = ?1", [hash]).map_err(err)?;
        Ok(())
    }

    pub fn set_attachment_local(&self, hash: &str) -> Result<()> {
        self.conn.execute("UPDATE attachments SET local_state = 'full' WHERE hash = ?1", [hash]).map_err(err)?;
        Ok(())
    }

    /// Nota de boas-vindas ainda como nasceu (nunca editada nem enviada): sai quando este aparelho entra numa conta
    /// que já tem notas (não faz sentido ganhar uma cópia dela a cada aparelho).
    pub fn drop_untouched_welcome(&self) -> Result<bool> {
        let Some(id) = self.sync_value("welcome_note")? else { return Ok(false) };
        self.set_sync_value("welcome_note", None)?;
        let untouched: bool = self
            .conn
            .query_row("SELECT EXISTS (SELECT 1 FROM notes WHERE id = ?1 AND created_at = updated_at AND drive_file_id IS NULL)", [&id], |r| r.get(0))
            .map_err(err)?;
        if untouched {
            self.delete_note(&id)?;
        }
        Ok(untouched)
    }

    pub fn sync_blob(&self, key: &str) -> Result<Option<Vec<u8>>> {
        self.conn.query_row("SELECT value FROM sync_blobs WHERE key = ?1", [key], |r| r.get(0)).optional().map_err(err)
    }

    pub fn set_sync_blob(&self, key: &str, value: &[u8]) -> Result<()> {
        self.conn
            .execute("INSERT INTO sync_blobs (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value])
            .map_err(err)?;
        Ok(())
    }

    pub fn sync_value(&self, key: &str) -> Result<Option<String>> {
        self.conn.query_row("SELECT value FROM sync_state WHERE key = ?1", [key], |r| r.get(0)).optional().map(Option::flatten).map_err(err)
    }

    pub fn set_sync_value(&self, key: &str, value: Option<&str>) -> Result<()> {
        match value {
            Some(v) => self
                .conn
                .execute("INSERT INTO sync_state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, v]),
            None => self.conn.execute("DELETE FROM sync_state WHERE key = ?1", [key]),
        }
        .map_err(err)?;
        Ok(())
    }

    pub fn local_changes(&self) -> Result<LocalChanges> {
        self.conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM notes WHERE dirty = 1), (SELECT COALESCE(MAX(updated_at), 0) FROM notes WHERE dirty = 1), \
                 (SELECT COUNT(*) FROM pending_deletes), \
                 (SELECT COUNT(DISTINCT a.hash) FROM attachments a JOIN note_attachments na ON na.hash = a.hash WHERE a.drive_file_id IS NULL AND a.local_state = 'full'), \
                 (SELECT COALESCE(MAX(updated_at), 0) FROM categories)",
                [],
                |r| Ok(LocalChanges { dirty: r.get(0)?, dirty_edited_at: r.get(1)?, deletes: r.get(2)?, uploads: r.get(3)?, categories_changed_at: r.get(4)? }),
            )
            .map_err(err)
    }

    /// Saiu da conta: as notas ficam, mas nada aqui aponta mais para o Drive. Entrar de novo envia tudo outra vez
    /// (e junta com o que já estiver lá).
    pub fn reset_sync(&self) -> Result<()> {
        self.conn
            .execute_batch(
                "BEGIN; UPDATE notes SET drive_file_id = NULL, drive_rev = NULL, dirty = 1; \
                 UPDATE attachments SET drive_file_id = NULL, uploaded = 0; DELETE FROM pending_deletes; DELETE FROM sync_blobs; \
                 DELETE FROM sync_state WHERE key IN ('account', 'drive_token', 'last_sync', 'categories_file', 'categories_rev'); COMMIT;",
            )
            .map_err(err)
    }

    /// Todas as categorias, inclusive as apagadas (o sync precisa saber que foram apagadas).
    pub fn category_rows(&self) -> Result<Vec<CategoryRow>> {
        let mut st = self.conn.prepare_cached("SELECT id, name, color, sort, deleted, hidden, pin_hash FROM categories").map_err(err)?;
        let rows = st
            .query_map([], |r| {
                Ok(CategoryRow { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, sort: r.get(3)?, deleted: r.get(4)?, hidden: r.get(5)?, pin: r.get(6)? })
            })
            .map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }

    /// Grava as categorias que vieram do Drive. Só o que mudou, e sem mexer na data: o que veio de fora não é mudança
    /// local (senão o sync acharia que há algo a enviar).
    pub fn put_category_rows(&self, rows: &[CategoryRow]) -> Result<()> {
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        for c in rows {
            tx.execute(
                "INSERT INTO categories (id, name, color, sort, deleted, hidden, pin_hash, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0) \
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, sort = excluded.sort, deleted = excluded.deleted, \
                 hidden = excluded.hidden, pin_hash = excluded.pin_hash \
                 WHERE name IS NOT excluded.name OR color IS NOT excluded.color OR sort IS NOT excluded.sort OR deleted IS NOT excluded.deleted \
                 OR hidden IS NOT excluded.hidden OR pin_hash IS NOT excluded.pin_hash",
                params![c.id, c.name, c.color, c.sort, c.deleted, c.hidden, c.pin],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
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
                "SELECT (SELECT COUNT(*) FROM notes WHERE trashed_at IS NULL), (SELECT COALESCE(SUM(bytes), 0) FROM attachments WHERE local_state = 'full')",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        Ok(SyncStatus {
            configured: false,
            state: "ok",
            error: None,
            connected: self.sync_value("account")?.is_some(),
            account: self.sync_value("account")?,
            last_sync_at: self.sync_value("last_sync")?.and_then(|v| v.parse().ok()),
            pending: self.conn.query_row("SELECT COUNT(*) FROM notes WHERE dirty = 1", [], |r| r.get(0)).map_err(err)?,
            note_count: notes,
            cache_used_bytes: bytes,
        })
    }

    // ---------- backup local ----------

    /// Todas as notas (inclusive arquivadas e na lixeira) com o estado Yjs e as datas, para o backup.
    pub fn backup_notes(&self) -> Result<Vec<BackupNote>> {
        let mut st = self.conn.prepare_cached("SELECT id, ydoc, created_at, updated_at FROM notes WHERE ydoc IS NOT NULL").map_err(err)?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }

    /// Todos os anexos (o backup leva os que estão neste computador).
    pub fn all_attachments(&self) -> Result<Vec<Attachment>> {
        let mut st = self.conn.prepare_cached(&format!("SELECT {ATTACHMENT_COLS} FROM attachments a ORDER BY a.added_at")).map_err(err)?;
        let rows = st.query_map([], attachment_row).map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }

    /// Restaurar junta: categoria que não existe aqui entra; apagada aqui e viva no backup volta. As que existem ficam
    /// como estão. Conta como mudança local (o sync leva). Devolve quantas entraram ou voltaram.
    pub fn merge_backup_categories(&self, rows: &[CategoryRow]) -> Result<usize> {
        let local: HashMap<String, CategoryRow> = self.category_rows()?.into_iter().map(|c| (c.id.clone(), c)).collect();
        let mut n = 0;
        for c in rows.iter().filter(|c| !c.deleted) {
            match local.get(&c.id) {
                Some(l) if !l.deleted => continue,
                Some(_) => {
                    self.conn.execute("UPDATE categories SET deleted = 0, updated_at = ?2 WHERE id = ?1", params![c.id, now()]).map_err(err)?;
                }
                None => {
                    self.conn
                        .execute(
                            "INSERT INTO categories (id, name, color, sort, deleted, hidden, pin_hash, updated_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7)",
                            params![c.id, c.name, c.color, c.sort, c.hidden, c.pin, now()],
                        )
                        .map_err(err)?;
                }
            }
            n += 1;
        }
        Ok(n)
    }

    // ---------- mudanças de outro processo (MCP) ----------

    /// Anota que este processo (o MCP) mudou a nota (`None`: categorias, tags ou anexos), para o app aberto ver.
    pub fn log_external(&self, note_id: Option<&str>, removed: bool) -> Result<()> {
        self.conn.execute("INSERT INTO external_changes (note_id, removed) VALUES (?1, ?2)", params![note_id, removed]).map_err(err)?;
        Ok(())
    }

    /// Mudanças anotadas depois de `seq`, na ordem.
    pub fn external_after(&self, seq: i64) -> Result<Vec<ExternalChange>> {
        let mut st = self.conn.prepare_cached("SELECT seq, note_id, removed FROM external_changes WHERE seq > ?1 ORDER BY seq").map_err(err)?;
        let rows = st.query_map([seq], |r| Ok(ExternalChange { seq: r.get(0)?, note_id: r.get(1)?, removed: r.get(2)? })).map_err(err)?;
        rows.collect::<std::result::Result<_, _>>().map_err(err)
    }

    /// Esquece as mudanças até `seq` (já mostradas).
    pub fn forget_external(&self, seq: i64) -> Result<()> {
        self.conn.execute("DELETE FROM external_changes WHERE seq <= ?1", [seq]).map_err(err)?;
        Ok(())
    }

    /// Muda quando outra conexão grava no banco (barato: serve para o app olhar a cada instante).
    pub fn data_version(&self) -> Result<i64> {
        self.conn.query_row("PRAGMA data_version", [], |r| r.get(0)).map_err(err)
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
        && a.reminder_repeat == b.reminder_repeat
        && a.emoji == b.emoji
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
            reminder_repeat: None,
            emoji: None,
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
    fn without_category_and_without_tags() {
        let s = Store::memory();
        let casa = s.create_category("Casa", "#C26A3D").unwrap();
        let mut a = note("a", "Com tudo", "lista #mercado");
        a.category_id = Some(casa.id.clone());
        let mut b = note("b", "Só tag manual", "x");
        b.tags = vec!["casa".into()];
        let c = note("c", "Nada", "y");
        let d = note("d", "Categoria que sumiu", "z");
        for n in [&a, &b, &c, &d] {
            s.save_note(n).unwrap();
        }
        // categoria apagada em outro aparelho: a nota aparece como sem categoria
        s.conn.execute("UPDATE notes SET category_id = 'sumiu' WHERE id = 'd'", []).unwrap();
        let list = |f: Filter| {
            let mut t: Vec<String> = s.list_notes(&f, "active", "", "updated").unwrap().into_iter().map(|n| n.label).collect();
            t.sort();
            t
        };
        let no_cat = || Filter { category_id: Some(NO_CATEGORY.into()), tags: vec![] };
        let no_tags = || Filter { category_id: None, tags: vec![NO_TAGS.into()] };
        assert_eq!(list(no_cat()), vec!["Categoria que sumiu", "Nada", "Só tag manual"]);
        assert_eq!(list(no_tags()), vec!["Categoria que sumiu", "Nada"], "nem manual nem #tag do texto");
        assert_eq!(list(Filter { category_id: Some(NO_CATEGORY.into()), tags: vec![NO_TAGS.into()] }), vec!["Categoria que sumiu", "Nada"]);
        assert_eq!(s.orphan_counts().unwrap(), OrphanCounts { uncategorized: 3, untagged: 2 });
        // arquivada e na lixeira não contam (como nas categorias)
        let mut p = Map::new();
        p.insert("archived".into(), json!(true));
        s.update_note("c", &p).unwrap();
        assert_eq!(s.orphan_counts().unwrap(), OrphanCounts { uncategorized: 2, untagged: 1 });
        // os outros lugares que filtram também entendem (lembretes, contagens)
        assert_eq!(s.view_counts(&no_tags(), "").unwrap().notes, 1);
    }

    #[test]
    fn hidden_and_pin_protected_categories() {
        let s = Store::memory();
        let senhas = s.create_category("Senhas", "#C0392B").unwrap();
        let casa = s.create_category("Casa", "#4F8A3E").unwrap();
        let mut a = note("a", "Banco", "agência 123 #financas");
        a.category_id = Some(senhas.id.clone());
        a.reminder_at = Some(now() - 1000);
        let mut b = note("b", "Mercado", "leite #compras");
        b.category_id = Some(casa.id.clone());
        for n in [&a, &b, &note("c", "Solta", "texto")] {
            s.save_note(n).unwrap();
        }
        let list = |f: Filter, q: &str| {
            let mut t: Vec<String> = s.list_notes(&f, "active", q, "updated").unwrap().into_iter().map(|n| n.label).collect();
            t.sort();
            t
        };
        let cat = |id: &str| Filter { category_id: Some(id.into()), tags: vec![] };
        let tags = || s.list_tags().unwrap().into_iter().map(|t| t.name).collect::<Vec<_>>();
        assert_eq!(list(Filter::default(), ""), vec!["Banco", "Mercado", "Solta"]);
        // ocultar Casa: some de Tudo, da busca e das tags; abrir a categoria mostra
        s.set_category_hidden(&casa.id, true).unwrap();
        assert_eq!(list(Filter::default(), ""), vec!["Banco", "Solta"]);
        assert!(list(Filter::default(), "leite").is_empty());
        assert_eq!(list(cat(&casa.id), ""), vec!["Mercado"]);
        assert!(!tags().contains(&"compras".to_string()));
        // PIN em Senhas: some de tudo e, mesmo escolhida, só abre depois do PIN
        s.set_category_pin(&senhas.id, Some("1234")).unwrap();
        assert_eq!(list(Filter::default(), ""), vec!["Solta"]);
        // quem acabou de pôr o PIN continua vendo, até bloquear (ou fechar o app)
        assert_eq!(list(cat(&senhas.id), ""), vec!["Banco"]);
        s.lock_category(&senhas.id).unwrap();
        assert!(list(cat(&senhas.id), "").is_empty());
        assert!(s.note_locked("a").unwrap());
        assert!(!s.unlock_category(&senhas.id, "0000").unwrap());
        assert!(s.unlock_category(&senhas.id, "1234").unwrap());
        assert_eq!(list(cat(&senhas.id), ""), vec!["Banco"]);
        assert_eq!(list(Filter::default(), ""), vec!["Solta"], "desbloqueada continua fora do Tudo");
        assert!(!s.note_locked("a").unwrap());
        s.lock_category(&senhas.id).unwrap();
        assert!(list(cat(&senhas.id), "").is_empty());
        // o lembrete avisa sem mostrar o título
        assert_eq!(s.due_reminders(now()).unwrap()[0].title, "Nota protegida");
        let cats = s.list_categories().unwrap();
        let get = |id: &str| cats.iter().find(|c| c.id == id).unwrap();
        assert!(get(&senhas.id).locked && !get(&senhas.id).unlocked && !get(&senhas.id).hidden);
        assert!(get(&casa.id).hidden && !get(&casa.id).locked);
        // PIN de 4 a 8 números
        for bad in ["12", "abcd", "123456789"] {
            assert!(s.set_category_pin(&senhas.id, Some(bad)).is_err(), "{bad}");
        }
        // vai para o sync (os outros aparelhos recebem o mesmo PIN)
        let rows = s.category_rows().unwrap();
        let row = rows.iter().find(|r| r.id == senhas.id).unwrap();
        assert!(row.pin.as_deref().is_some_and(|p| p.len() == 64 && !p.contains("1234")));
        assert!(rows.iter().find(|r| r.id == casa.id).unwrap().hidden);
        // tirar o PIN e mostrar
        s.set_category_pin(&senhas.id, None).unwrap();
        s.set_category_hidden(&casa.id, false).unwrap();
        assert_eq!(list(Filter::default(), ""), vec!["Banco", "Mercado", "Solta"]);
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
        assert_eq!(s.list_images(&Filter::default(), "", None, false).unwrap().len(), 1);
        assert_eq!(s.get_note("a").unwrap().unwrap().media.len(), 2);
        assert_eq!(s.view_counts(&Filter::default(), "").unwrap().files, 2);
        // Moodboard: a foto da nota arquivada só aparece pedindo os arquivados; a da lixeira, nunca
        let mut p = Map::new();
        p.insert("archived".into(), json!(true));
        s.update_note("a", &p).unwrap();
        assert!(s.list_images(&Filter::default(), "", None, false).unwrap().is_empty());
        assert_eq!(s.list_images(&Filter::default(), "", None, true).unwrap().len(), 1);
        let mut p = Map::new();
        p.insert("trashedAt".into(), json!(now()));
        s.update_note("a", &p).unwrap();
        assert!(s.list_images(&Filter::default(), "", None, true).unwrap().is_empty());
    }

    #[test]
    fn yjs_updates_create_edit_and_project() {
        let s = Store::memory();
        // O editor manda o estado inteiro de uma nota nova; depois, só o que mudou.
        let first = ydoc::from_note(&note("y1", "Ideias", "texto com #tag"));
        s.apply_update("y1", &first).unwrap();
        let n = &s.list_notes(&Filter::default(), "active", "", "custom").unwrap()[0];
        assert_eq!(n.title, "Ideias");
        assert!(n.tags.contains(&"tag".to_string()));
        let before = s.ydoc("y1").unwrap().unwrap();
        let mut edited = ydoc::to_note("y1", &before).unwrap();
        edited.pinned = true;
        let after = ydoc::update(&before, &edited, false).unwrap();
        s.apply_update("y1", &after).unwrap();
        assert!(s.get_note("y1").unwrap().unwrap().pinned);
        // Menus que mudam metadados também passam pelo Y.Doc.
        let mut patch = Map::new();
        patch.insert("color".into(), json!("sky"));
        s.update_note("y1", &patch).unwrap();
        assert_eq!(ydoc::to_note("y1", &s.ydoc("y1").unwrap().unwrap()).unwrap().color, "sky");
        // Atualização que não muda nada visível não muda a data.
        let t = s.get_note("y1").unwrap().unwrap().updated_at;
        std::thread::sleep(std::time::Duration::from_millis(5));
        s.apply_update("y1", &after).unwrap();
        assert_eq!(s.get_note("y1").unwrap().unwrap().updated_at, t);
    }

    #[test]
    fn cover_emoji_set_listed_and_cleared() {
        let s = Store::memory();
        s.save_note(&note("e1", "Receitas", "bolo")).unwrap();
        let mut patch = Map::new();
        patch.insert("emoji".into(), json!("🍰"));
        assert!(s.update_note("e1", &patch).unwrap());
        assert_eq!(s.get_note("e1").unwrap().unwrap().emoji.as_deref(), Some("🍰"));
        assert_eq!(s.list_notes(&Filter::default(), "active", "", "custom").unwrap()[0].emoji.as_deref(), Some("🍰"));
        assert_eq!(ydoc::to_note("e1", &s.ydoc("e1").unwrap().unwrap()).unwrap().emoji.as_deref(), Some("🍰"), "vai no Y.Doc (sincroniza)");
        // texto não é emoji: não muda nada
        patch.insert("emoji".into(), json!("oi"));
        assert!(s.update_note("e1", &patch).unwrap(), "inválido = sem emoji");
        assert_eq!(s.get_note("e1").unwrap().unwrap().emoji, None);
        patch.insert("emoji".into(), json!("👨‍👩‍👧"));
        s.update_note("e1", &patch).unwrap();
        patch.insert("emoji".into(), Value::Null);
        assert!(s.update_note("e1", &patch).unwrap());
        assert_eq!(s.list_notes(&Filter::default(), "active", "", "custom").unwrap()[0].emoji, None);
    }

    #[test]
    fn what_counts_as_a_cover_emoji() {
        for ok in ["🍰", "👨‍👩‍👧‍👦", "🇧🇷", "1️⃣", "#️⃣", "👍🏽", "❤️", " 🌎 ", "🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}"] {
            assert!(clean_emoji(ok).is_some(), "{ok}");
        }
        assert_eq!(clean_emoji(" 🌎 ").as_deref(), Some("🌎"));
        for bad in ["", "  ", "a", "oi", "12", "🍰 bolo", "🍰\n🍰", "🍰\u{7}", "🍰🍰🍰🍰🍰🍰🍰🍰🍰"] {
            assert!(clean_emoji(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn phase_1_notes_get_a_ydoc_on_open() {
        let path = std::env::temp_dir().join(format!("ideario-mig-{}.db", uuid::Uuid::now_v7()));
        {
            let s = Store::open(&path).unwrap();
            s.save_note(&note("m1", "Antiga", "corpo da fase 1")).unwrap();
            // Como era na Fase 1: sem a coluna do estado Yjs, esquema na versão 1.
            s.conn
                .execute_batch(
                    "DROP INDEX notes_drive; ALTER TABLE notes DROP COLUMN ydoc; ALTER TABLE notes DROP COLUMN reminder_repeat; ALTER TABLE notes DROP COLUMN emoji; \
                     ALTER TABLE notes DROP COLUMN notified_at; ALTER TABLE notes DROP COLUMN drive_file_id; ALTER TABLE notes DROP COLUMN drive_rev; \
                     ALTER TABLE notes DROP COLUMN snoozed_until; DROP TABLE external_changes; \
                     ALTER TABLE categories DROP COLUMN hidden; ALTER TABLE categories DROP COLUMN pin_hash; PRAGMA user_version = 1",
                )
                .unwrap();
        }
        let s = Store::open(&path).unwrap();
        let backup = path.with_extension("db.v1.bak");
        assert!(backup.exists(), "cópia de segurança antes de migrar");
        let state = s.ydoc("m1").unwrap().expect("estado criado na abertura");
        let n = ydoc::to_note("m1", &state).unwrap();
        assert_eq!(n.title, "Antiga");
        assert_eq!(n.body, note("m1", "", "corpo da fase 1").body);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&backup);
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
                reminder_repeat: None,
                emoji: None,
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
