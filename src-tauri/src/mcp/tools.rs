//! Ferramentas do MCP: tudo o que dá para fazer no app (notas, checklists, lembretes, categorias, tags, anexos,
//! arquivo e lixeira, importar do Keep), sobre o mesmo `Store`. Cada mudança é anotada para o app aberto ver.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use base64::Engine;
use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveDateTime, SecondsFormat, TimeZone};
use serde_json::{json, Map, Value};

use crate::commands::Core;
use crate::markdown::{from_markdown, to_markdown, ATT};
use crate::store::{Attachment, Filter, Millis, NoteInput, Result, Store, NO_CATEGORY, NO_TAGS, REPEATS};
use crate::text::{fold, normalize_tag};
use crate::{attachments, reminders};

const NOTE_COLORS: [(&str, &str); 7] =
    [("none", "Padrão"), ("sand", "Areia"), ("sage", "Sálvia"), ("sky", "Céu"), ("rose", "Rosa"), ("lilac", "Lilás"), ("butter", "Manteiga")];
const CATEGORY_COLORS: [(&str, &str); 10] = [
    ("#C26A3D", "Terracota"),
    ("#B8901F", "Mostarda"),
    ("#4F8A3E", "Verde"),
    ("#3E8E7E", "Verde-água"),
    ("#3D63D6", "Azul"),
    ("#8A6BC4", "Roxo"),
    ("#C2557A", "Rosa"),
    ("#C0392B", "Vermelho"),
    ("#8B5E3C", "Marrom"),
    ("#5F7380", "Cinza"),
];
/// Foto maior que isto vai como miniatura (o modelo não precisa de 6 MB para ver uma foto).
const FULL_IMAGE_MAX: u64 = 3 * 1024 * 1024;
/// Texto de anexo (txt, md, csv…) até este tamanho volta inteiro.
const TEXT_MAX: usize = 200_000;

// ---------- lista ----------

/// Definição de uma ferramenta: nome, título, descrição, parâmetros e se só lê.
struct Def {
    name: &'static str,
    title: &'static str,
    description: &'static str,
    params: Value,
    required: &'static [&'static str],
    read_only: bool,
    destructive: bool,
}

fn s(desc: &str) -> Value {
    json!({ "type": "string", "description": desc })
}
fn b(desc: &str) -> Value {
    json!({ "type": "boolean", "description": desc })
}
fn n(desc: &str) -> Value {
    json!({ "type": "integer", "description": desc })
}
fn one_of(values: &[&str], desc: &str) -> Value {
    json!({ "type": "string", "enum": values, "description": desc })
}
fn strings(desc: &str) -> Value {
    json!({ "type": "array", "items": { "type": "string" }, "description": desc })
}

const ID: &str = "id da nota (de search_notes ou create_note)";
const WHEN: &str = "data e hora em ISO 8601, no fuso do usuário (ex.: 2026-10-11T09:00) ou com fuso; só a data = 9h";

fn defs() -> Vec<Def> {
    let colors = NOTE_COLORS.map(|c| c.0);
    let repeat = ["none", "day", "week", "month", "year"];
    vec![
        Def {
            name: "app_overview",
            title: "Visão geral",
            description: "Data e hora de agora, quantas notas, lembretes (e atrasados), arquivos e fotos há, categorias, tags e o estado do sync. Bom para começar.",
            params: json!({}),
            required: &[],
            read_only: true,
            destructive: false,
        },
        Def {
            name: "search_notes",
            title: "Buscar notas",
            description: "Lista notas, com busca (ignora acentos; todas as palavras; prefixo) e filtros. Devolve id, título, trecho, categoria, tags, cor, fixada, lembrete e datas. Sem `query`, lista na ordem pedida.",
            params: json!({
                "query": s("palavras a buscar no título, no texto e nas tags"),
                "category": s("nome ou id da categoria"),
                "tag": s("tag (sem #)"),
                "no_category": b("só notas sem categoria"),
                "no_tags": b("só notas sem tag nenhuma"),
                "where": one_of(&["active", "archived", "trash", "all"], "active (padrão) = notas da tela principal; archived = Arquivo; trash = Lixeira; all = ativas e arquivadas"),
                "sort": one_of(&["updated", "created", "title", "custom"], "ordem (padrão: editadas por último primeiro; custom = a ordem arrastada no app)"),
                "limit": n("quantas (padrão 20, até 100)"),
                "offset": n("pular as primeiras (paginação)"),
            }),
            required: &[],
            read_only: true,
            destructive: false,
        },
        Def {
            name: "get_note",
            title: "Ler nota",
            description: "A nota inteira: metadados e o corpo em Markdown (checklists com - [ ] e - [x], fotos e anexos como links ideario://att/<hash>), mais a lista de anexos.",
            params: json!({ "id": s(ID) }),
            required: &["id"],
            read_only: true,
            destructive: false,
        },
        Def {
            name: "create_note",
            title: "Criar nota",
            description: "Cria uma nota (entra no topo). Corpo em Markdown; para uma lista de compras use checklist (- [ ] item).",
            params: json!({
                "title": s("título (pode ficar vazio)"),
                "content": s("corpo em Markdown"),
                "category": s("nome ou id de uma categoria existente"),
                "tags": strings("tags (sem #)"),
                "color": one_of(&colors, "cor do card"),
                "pinned": b("fixar no topo"),
                "reminder": s(WHEN),
                "repeat": one_of(&repeat, "repetição do lembrete"),
            }),
            required: &[],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "update_note",
            title: "Alterar nota",
            description: "Muda título, corpo (Markdown: substitui o corpo inteiro), categoria, tags, cor ou fixada. Só o que vier muda. Para trocar um trecho do texto, prefira edit_note_text.",
            params: json!({
                "id": s(ID),
                "title": s("título novo"),
                "content": s("corpo novo inteiro, em Markdown (mantenha as linhas de fotos e anexos que devem ficar)"),
                "category": s("nome ou id da categoria; vazio = sem categoria"),
                "tags": strings("tags manuais (substituem as atuais; as #tags do texto continuam)"),
                "color": one_of(&colors, "cor do card"),
                "pinned": b("fixada"),
            }),
            required: &["id"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "edit_note_text",
            title: "Trocar trecho da nota",
            description: "Troca um trecho do corpo (no Markdown de get_note) por outro, sem mexer no resto. `find` precisa aparecer uma vez só (ou use all). Serve também para marcar itens, mudar a ordem de linhas, apagar uma linha (replace vazio).",
            params: json!({
                "id": s(ID),
                "find": s("trecho exato do Markdown atual"),
                "replace": s("o que entra no lugar"),
                "all": b("trocar todas as ocorrências"),
            }),
            required: &["id", "find", "replace"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "append_to_note",
            title: "Acrescentar à nota",
            description: "Acrescenta Markdown no fim (ou no começo) do corpo.",
            params: json!({
                "id": s(ID),
                "content": s("Markdown a acrescentar"),
                "at": one_of(&["end", "start"], "onde (padrão: end)"),
            }),
            required: &["id", "content"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "set_checklist_items",
            title: "Marcar itens do checklist",
            description: "Marca ou desmarca itens de checklist pelo texto (sem acento e maiúsculas tanto faz; basta um pedaço que só um item tenha). Marcar um item marca os subitens dele, como no app.",
            params: json!({
                "id": s(ID),
                "items": { "type": "array", "description": "itens a mudar", "items": { "type": "object", "properties": {
                    "text": s("texto do item"), "checked": b("marcado") }, "required": ["text", "checked"] } },
            }),
            required: &["id", "items"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "add_checklist_items",
            title: "Acrescentar itens ao checklist",
            description: "Acrescenta itens ao checklist da nota (o último, se houver mais de um; se não houver, cria um no fim). Com `under`, entram como subitens daquele item.",
            params: json!({
                "id": s(ID),
                "items": strings("textos dos itens (aceitam **negrito** e *itálico*)"),
                "under": s("texto do item pai (para subitens)"),
                "checked": b("já marcados"),
            }),
            required: &["id", "items"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "remove_checklist_items",
            title: "Tirar itens do checklist",
            description: "Tira itens do checklist (com os subitens): pelo texto, ou todos os marcados (checked_only).",
            params: json!({
                "id": s(ID),
                "items": strings("textos dos itens a tirar"),
                "checked_only": b("tirar todos os itens marcados"),
            }),
            required: &["id"],
            read_only: false,
            destructive: true,
        },
        Def {
            name: "move_note",
            title: "Arquivar, mandar para a Lixeira ou restaurar",
            description: "Move a nota: active (tela principal; restaura do Arquivo ou da Lixeira), archived (Arquivo) ou trash (Lixeira, some em 30 dias).",
            params: json!({ "id": s(ID), "to": one_of(&["active", "archived", "trash"], "para onde") }),
            required: &["id", "to"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "delete_note_forever",
            title: "Apagar para sempre",
            description: "Apaga de vez uma nota que já está na Lixeira (não tem volta). Notas fora da Lixeira: use move_note para trash.",
            params: json!({ "id": s(ID) }),
            required: &["id"],
            read_only: false,
            destructive: true,
        },
        Def {
            name: "empty_trash",
            title: "Esvaziar a Lixeira",
            description: "Apaga de vez todas as notas da Lixeira (não tem volta). Confirme com o usuário antes.",
            params: json!({}),
            required: &[],
            read_only: false,
            destructive: true,
        },
        Def {
            name: "duplicate_note",
            title: "Duplicar nota",
            description: "Faz uma cópia da nota (sem lembrete e sem fixar), logo antes dela.",
            params: json!({ "id": s(ID) }),
            required: &["id"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "reorder_note",
            title: "Mudar a nota de lugar",
            description: "Põe a nota entre duas outras na ordem personalizada (a que o usuário arrasta). Informe after, before ou os dois.",
            params: json!({ "id": s(ID), "after": s("id da nota que fica antes"), "before": s("id da nota que fica depois") }),
            required: &["id"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "list_reminders",
            title: "Lembretes",
            description: "Notas com lembrete, da mais próxima para a mais distante (atrasados primeiro).",
            params: json!({ "include_done": b("incluir os concluídos"), "overdue_only": b("só os atrasados") }),
            required: &[],
            read_only: true,
            destructive: false,
        },
        Def {
            name: "set_reminder",
            title: "Pôr lembrete",
            description: "Põe (ou muda) o lembrete da nota. O app avisa na hora com notificação do sistema.",
            params: json!({ "id": s(ID), "at": s(WHEN), "repeat": one_of(&repeat, "repetição (padrão: none)") }),
            required: &["id", "at"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "clear_reminder",
            title: "Tirar lembrete",
            description: "Tira o lembrete da nota (e a repetição).",
            params: json!({ "id": s(ID) }),
            required: &["id"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "complete_reminder",
            title: "Concluir lembrete",
            description: "Conclui o lembrete. Se ele se repete, pula para a próxima vez.",
            params: json!({ "id": s(ID), "done": b("false = reabrir um concluído (padrão: true)") }),
            required: &["id"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "snooze_reminder",
            title: "Adiar lembrete",
            description: "Adia o aviso para mais tarde (num lembrete que se repete, a série continua no horário de sempre).",
            params: json!({ "id": s(ID), "until": s(WHEN), "minutes": n("ou: daqui a quantos minutos") }),
            required: &["id"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "list_categories",
            title: "Categorias",
            description: "Categorias (nome, cor e quantas notas).",
            params: json!({}),
            required: &[],
            read_only: true,
            destructive: false,
        },
        Def {
            name: "create_category",
            title: "Criar categoria",
            description: "Cria uma categoria. Categorias só têm nome e cor.",
            params: json!({ "name": s("nome"), "color": one_of(&CATEGORY_COLORS.map(|c| c.0), "cor (padrão: a próxima livre)") }),
            required: &["name"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "update_category",
            title: "Renomear ou mudar a cor da categoria",
            description: "Renomeia ou muda a cor de uma categoria.",
            params: json!({ "category": s("nome ou id"), "name": s("nome novo"), "color": one_of(&CATEGORY_COLORS.map(|c| c.0), "cor nova") }),
            required: &["category"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "delete_category",
            title: "Apagar categoria",
            description: "Apaga a categoria. As notas continuam, sem categoria.",
            params: json!({ "category": s("nome ou id") }),
            required: &["category"],
            read_only: false,
            destructive: true,
        },
        Def {
            name: "list_tags",
            title: "Tags",
            description: "Tags em uso e quantas notas têm cada uma (manuais e #tags do texto).",
            params: json!({}),
            required: &[],
            read_only: true,
            destructive: false,
        },
        Def {
            name: "rename_tag",
            title: "Renomear tag",
            description: "Renomeia a tag em todas as notas (também as #tags escritas no texto).",
            params: json!({ "from": s("tag atual"), "to": s("nome novo") }),
            required: &["from", "to"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "delete_tag",
            title: "Apagar tag",
            description: "Tira a tag de todas as notas (as notas ficam).",
            params: json!({ "name": s("tag") }),
            required: &["name"],
            read_only: false,
            destructive: true,
        },
        Def {
            name: "list_attachments",
            title: "Arquivos e fotos",
            description: "Anexos das notas (fotos, PDFs, áudios, vídeos, documentos) com hash, nome, tipo, tamanho e a nota. Fotos trazem a paleta de cores e o tom (como no Moodboard).",
            params: json!({
                "query": s("busca no nome do arquivo ou da nota"),
                "kind": one_of(&["image", "video", "audio", "pdf", "doc", "sheet", "other"], "tipo"),
                "note_id": s("só os desta nota (inclui arquivadas e na Lixeira)"),
                "tone": one_of(&["warm", "cool", "neutral", "dark", "light"], "tom das fotos"),
                "limit": n("quantos (padrão 50)"),
            }),
            required: &[],
            read_only: true,
            destructive: false,
        },
        Def {
            name: "get_attachment",
            title: "Ver anexo",
            description: "Mostra o anexo: foto como imagem, texto (txt, md, csv, json…) como texto; os outros, os dados e onde está o arquivo no computador.",
            params: json!({ "hash": s("hash do anexo (de get_note ou list_attachments)"), "size": one_of(&["thumb", "full"], "foto: miniatura (padrão) ou inteira") }),
            required: &["hash"],
            read_only: true,
            destructive: false,
        },
        Def {
            name: "attach_file",
            title: "Anexar arquivo",
            description: "Anexa um arquivo do computador (caminho completo) à nota: fotos passam pelo mesmo tratamento do app (reduz, WebP, tira a localização) e entram no corpo; o resto entra como anexo.",
            params: json!({ "id": s(ID), "path": s("caminho completo do arquivo"), "at": one_of(&["end", "start"], "onde (padrão: end)") }),
            required: &["id", "path"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "export_attachment",
            title: "Salvar anexo no computador",
            description: "Salva uma cópia do anexo numa pasta (padrão: Downloads) e diz onde ficou.",
            params: json!({ "hash": s("hash do anexo"), "folder": s("pasta de destino (padrão: Downloads)") }),
            required: &["hash"],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "create_backup",
            title: "Fazer backup local",
            description: "Grava um backup completo (notas, categorias, anexos e uma cópia em Markdown) num arquivo .ideario. Restaurar é no app (Configurações → Backup local) e junta com o que existe.",
            params: json!({ "folder": s("pasta onde gravar (padrão: a pasta de backups das Configurações, ou Documentos/Ideario backups)") }),
            required: &[],
            read_only: false,
            destructive: false,
        },
        Def {
            name: "import_keep",
            title: "Importar do Google Keep",
            description: "Importa o .zip do Google Takeout com as notas do Keep (fotos, checklists, marcadores, cores, arquivadas). Notas já importadas são puladas.",
            params: json!({ "path": s("caminho completo do .zip do Takeout") }),
            required: &["path"],
            read_only: false,
            destructive: false,
        },
    ]
}

/// A lista que vai em `tools/list`.
pub fn list() -> Vec<Value> {
    defs()
        .into_iter()
        .map(|d| {
            json!({
                "name": d.name,
                "title": d.title,
                "description": d.description,
                "inputSchema": { "type": "object", "properties": d.params, "required": d.required },
                "annotations": {
                    "title": d.title,
                    "readOnlyHint": d.read_only,
                    "destructiveHint": d.destructive,
                    "idempotentHint": d.read_only,
                    "openWorldHint": false,
                },
            })
        })
        .collect()
}

// ---------- chamada ----------

/// Resultado de uma ferramenta (texto, ou imagem com legenda).
enum Out {
    Text(String),
    Json(Value),
    Image { data: Vec<u8>, mime: String, caption: String },
}

/// Executa a ferramenta. Erro de uso (nota que não existe, parâmetro faltando) volta como resultado com `isError`,
/// para o modelo ler e corrigir.
pub fn call(core: &Core, name: &str, args: &Value) -> Value {
    let args = args.as_object().cloned().unwrap_or_default();
    match run(core, name, &Args(&args)) {
        Ok(Out::Text(t)) => json!({ "content": [{ "type": "text", "text": t }] }),
        Ok(Out::Json(v)) => {
            let text = serde_json::to_string_pretty(&v).unwrap_or_default();
            json!({ "content": [{ "type": "text", "text": text }] })
        }
        Ok(Out::Image { data, mime, caption }) => json!({ "content": [
            { "type": "image", "data": base64::engine::general_purpose::STANDARD.encode(data), "mimeType": mime },
            { "type": "text", "text": caption },
        ] }),
        Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
    }
}

struct Args<'a>(&'a Map<String, Value>);

impl Args<'_> {
    fn str(&self, k: &str) -> Option<&str> {
        self.0.get(k).and_then(Value::as_str)
    }
    fn need(&self, k: &str) -> Result<&str> {
        self.str(k).ok_or_else(|| format!("falta o parâmetro `{k}`"))
    }
    fn bool(&self, k: &str) -> Option<bool> {
        self.0.get(k).and_then(Value::as_bool)
    }
    fn int(&self, k: &str) -> Option<i64> {
        self.0.get(k).and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
    }
    fn strings(&self, k: &str) -> Option<Vec<String>> {
        self.0.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
    }
}

fn run(core: &Core, name: &str, a: &Args) -> Result<Out> {
    match name {
        "app_overview" => overview(core),
        "search_notes" => search(core, a),
        "get_note" => core.with(|s| note_text(s, a.need("id")?)).map(Out::Text),
        "create_note" => create(core, a),
        "update_note" => update(core, a),
        "edit_note_text" => edit_text(core, a),
        "append_to_note" => append(core, a),
        "set_checklist_items" => set_items(core, a),
        "add_checklist_items" => add_items(core, a),
        "remove_checklist_items" => remove_items(core, a),
        "move_note" => move_to(core, a),
        "delete_note_forever" => delete_forever(core, a),
        "empty_trash" => core.with(|s| {
            let ids = s.list_notes(&Filter::default(), "trash", "", "updated")?.into_iter().map(|n| n.id).collect::<Vec<_>>();
            let gone = s.empty_trash()?;
            for id in &ids {
                s.log_external(Some(id), true)?;
            }
            Ok(Out::Text(format!("Lixeira esvaziada: {gone} nota(s) apagada(s) para sempre.")))
        }),
        "duplicate_note" => core.with(|s| {
            let id = existing(s, a.need("id")?)?;
            let copy = s.duplicate_note(&id)?;
            s.log_external(Some(&copy), false)?;
            Ok(Out::Text(format!("Cópia criada: {copy}")))
        }),
        "reorder_note" => core.with(|s| {
            let id = existing(s, a.need("id")?)?;
            s.move_note(&id, a.str("after"), a.str("before"))?;
            s.log_external(None, false)?;
            Ok(Out::Text("Ordem personalizada atualizada.".into()))
        }),
        "list_reminders" => reminders_list(core, a),
        "set_reminder" => set_reminder(core, a),
        "clear_reminder" => patch(core, a.need("id")?, json!({ "reminderAt": null, "reminderRepeat": null, "reminderDone": false }), "Lembrete tirado."),
        "complete_reminder" => complete(core, a),
        "snooze_reminder" => snooze(core, a),
        "list_categories" => core.with(|s| {
            let cats: Vec<Value> = s
                .list_categories()?
                .into_iter()
                .map(|c| {
                    let mut v = json!({ "id": c.id, "name": c.name, "color": c.color, "colorName": color_name(&c.color), "notes": c.note_count });
                    if c.hidden {
                        v["hidden"] = json!(true);
                    }
                    if c.locked {
                        v["protectedByPin"] = json!(true);
                    }
                    v
                })
                .collect();
            Ok(Out::Json(Value::Array(cats)))
        }),
        "create_category" => core.with(|s| {
            let name = a.need("name")?.trim();
            if name.is_empty() {
                return Err("o nome não pode ficar vazio".into());
            }
            if category_id(s, name).is_ok() {
                return Err(format!("já existe a categoria \"{name}\""));
            }
            let color = match a.str("color") {
                Some(c) => category_color(c)?,
                None => next_color(s)?,
            };
            let c = s.create_category(name, &color)?;
            s.log_external(None, false)?;
            Ok(Out::Json(json!({ "id": c.id, "name": c.name, "color": c.color })))
        }),
        "update_category" => core.with(|s| {
            let id = category_id(s, a.need("category")?)?;
            not_protected(s, &id)?;
            let color = a.str("color").map(category_color).transpose()?;
            s.update_category(&id, a.str("name").map(str::trim).filter(|n| !n.is_empty()), color.as_deref())?;
            s.log_external(None, false)?;
            Ok(Out::Text("Categoria atualizada.".into()))
        }),
        "delete_category" => core.with(|s| {
            let id = category_id(s, a.need("category")?)?;
            not_protected(s, &id)?;
            let notes = s.category_note_ids(&id)?;
            s.delete_category(&id)?;
            for n in &notes {
                s.log_external(Some(n), false)?;
            }
            s.log_external(None, false)?;
            Ok(Out::Text(format!("Categoria apagada; {} nota(s) ficaram sem categoria.", notes.len())))
        }),
        "list_tags" => core.with(|s| Ok(Out::Json(serde_json::to_value(s.list_tags()?).map_err(|e| e.to_string())?))),
        "rename_tag" => core.with(|s| {
            let from = normalize_tag(a.need("from")?);
            let to = normalize_tag(a.need("to")?);
            if to.is_empty() {
                return Err("o nome novo não pode ficar vazio (para tirar a tag, use delete_tag)".into());
            }
            let ids = s.note_ids_with_tag(&from)?;
            let n = s.rename_tag(&from, Some(&to))?;
            for id in &ids {
                s.log_external(Some(id), false)?;
            }
            Ok(Out::Text(format!("#{from} → #{to} em {n} nota(s).")))
        }),
        "delete_tag" => core.with(|s| {
            let tag = normalize_tag(a.need("name")?);
            let ids = s.note_ids_with_tag(&tag)?;
            let n = s.rename_tag(&tag, None)?;
            for id in &ids {
                s.log_external(Some(id), false)?;
            }
            Ok(Out::Text(format!("#{tag} tirada de {n} nota(s).")))
        }),
        "list_attachments" => list_attachments(core, a),
        "get_attachment" => get_attachment(core, a),
        "attach_file" => attach(core, a),
        "export_attachment" => export(core, a),
        "create_backup" => {
            let folder = match a.str("folder") {
                Some(f) => PathBuf::from(f),
                None => PathBuf::from(core.with(crate::backup::status)?.dir.ok_or("não achei uma pasta para o backup; diga qual (folder)")?),
            };
            let r = crate::backup::export(core, &crate::backup::auto_name(&folder, crate::store::now()), |_, _| ())?;
            Ok(Out::Json(serde_json::to_value(r).map_err(|e| e.to_string())?))
        }
        "import_keep" => {
            let report = core.import_keep(Path::new(a.need("path")?), |_, _| ())?;
            core.with(|s| s.log_external(None, false))?;
            Ok(Out::Json(serde_json::to_value(report).map_err(|e| e.to_string())?))
        }
        other => Err(format!("ferramenta desconhecida: {other}")),
    }
}

// ---------- datas ----------

/// ISO 8601 → milissegundos. Sem fuso = fuso do usuário; só a data = 9h.
fn parse_time(s: &str) -> Result<Millis> {
    let s = s.trim();
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return Ok(d.timestamp_millis());
    }
    let local = |n: NaiveDateTime| Local.from_local_datetime(&n).earliest().map(|d| d.timestamp_millis()).ok_or_else(|| format!("{s}: horário que não existe neste fuso"));
    for f in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(s, f) {
            return local(n);
        }
    }
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        if let Some(n) = d.and_hms_opt(9, 0, 0) {
            return local(n);
        }
    }
    Err(format!("data não entendida: \"{s}\" (use ISO 8601, ex.: 2026-10-11T09:00)"))
}

const WEEKDAYS: [&str; 7] = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

/// Milissegundos → ISO 8601 no fuso do usuário, com o dia da semana (ex.: "2026-10-11T09:00:00-03:00 (domingo)").
fn fmt_time(ms: Millis) -> String {
    match Local.timestamp_millis_opt(ms).single() {
        Some(d) => format!("{} ({})", d.to_rfc3339_opts(SecondsFormat::Secs, false), WEEKDAYS[d.weekday().num_days_from_monday() as usize]),
        None => ms.to_string(),
    }
}

fn repeat_label(r: Option<&str>) -> &'static str {
    match r {
        Some("day") => "todo dia",
        Some("week") => "toda semana",
        Some("month") => "todo mês",
        Some("year") => "todo ano",
        _ => "",
    }
}

// ---------- notas ----------

const PROTECTED: &str = "esta nota está numa categoria protegida por PIN; o Claude não tem acesso a ela";

fn existing(s: &Store, id: &str) -> Result<String> {
    if !s.note_exists(id)? {
        return Err(format!("não existe nota com id {id} (use search_notes)"));
    }
    if s.note_locked(id)? {
        return Err(PROTECTED.into());
    }
    Ok(id.to_string())
}

fn note(s: &Store, id: &str) -> Result<NoteInput> {
    existing(s, id)?;
    s.note_input(id)?.ok_or_else(|| format!("não existe nota com id {id} (use search_notes)"))
}

/// Categoria com PIN: o Claude não renomeia nem apaga (apagar soltaria as notas dela).
fn not_protected(s: &Store, id: &str) -> Result<()> {
    if s.list_categories()?.iter().any(|c| c.id == id && c.locked) {
        return Err("categoria protegida por PIN; só no app".into());
    }
    Ok(())
}

fn names(s: &Store) -> impl Fn(&str) -> Option<String> + '_ {
    move |h: &str| s.get_attachments(&[h.to_string()]).ok().and_then(|v| v.into_iter().next()).map(|a| a.name)
}

fn category_names(s: &Store) -> Result<HashMap<String, String>> {
    Ok(s.list_categories()?.into_iter().map(|c| (c.id, c.name)).collect())
}

/// Categoria pelo id ou pelo nome (sem acento e maiúsculas tanto faz).
fn category_id(s: &Store, key: &str) -> Result<String> {
    let cats = s.list_categories()?;
    let k = fold(key.trim());
    cats.iter()
        .find(|c| c.id == key || fold(&c.name) == k)
        .map(|c| c.id.clone())
        .ok_or_else(|| format!("não existe a categoria \"{key}\". Existem: {}", cats.iter().map(|c| c.name.as_str()).collect::<Vec<_>>().join(", ")))
}

fn category_color(c: &str) -> Result<String> {
    let k = fold(c.trim());
    CATEGORY_COLORS
        .iter()
        .find(|(hex, name)| hex.eq_ignore_ascii_case(c.trim()) || fold(name) == k)
        .map(|(hex, _)| hex.to_string())
        .ok_or_else(|| format!("cor de categoria desconhecida: {c} (use {})", CATEGORY_COLORS.map(|c| c.0).join(", ")))
}

fn color_name(hex: &str) -> &'static str {
    CATEGORY_COLORS.iter().find(|(h, _)| h.eq_ignore_ascii_case(hex)).map(|(_, n)| *n).unwrap_or("")
}

fn next_color(s: &Store) -> Result<String> {
    let used: Vec<String> = s.list_categories()?.into_iter().map(|c| c.color.to_lowercase()).collect();
    let free = CATEGORY_COLORS.iter().find(|(c, _)| !used.contains(&c.to_lowercase()));
    Ok(free.map(|(c, _)| *c).unwrap_or(CATEGORY_COLORS[used.len() % CATEGORY_COLORS.len()].0).to_string())
}

fn note_color(c: &str) -> Result<String> {
    let k = fold(c.trim());
    NOTE_COLORS
        .iter()
        .find(|(id, label)| *id == c.trim() || fold(label) == k)
        .map(|(id, _)| id.to_string())
        .ok_or_else(|| format!("cor desconhecida: {c} (use {})", NOTE_COLORS.map(|c| c.0).join(", ")))
}

fn repeat_of(a: &Args) -> Result<Option<String>> {
    match a.str("repeat") {
        None | Some("none") | Some("") => Ok(None),
        Some(r) if REPEATS.contains(&r) => Ok(Some(r.to_string())),
        Some(r) => Err(format!("repetição desconhecida: {r} (use none, day, week, month ou year)")),
    }
}

fn where_of(n: &NoteInput) -> &'static str {
    if n.trashed_at.is_some() {
        "Lixeira"
    } else if n.archived {
        "Arquivo"
    } else {
        "Notas"
    }
}

/// A nota como o modelo lê: cabeçalho com os metadados e o corpo em Markdown.
fn note_text(s: &Store, id: &str) -> Result<String> {
    let d = s.get_note(id)?.ok_or_else(|| format!("não existe nota com id {id} (use search_notes)"))?;
    let n = note(s, id)?;
    let cats = category_names(s)?;
    let body: Value = serde_json::from_str(d.body.get()).map_err(|e| e.to_string())?;
    let mut head = vec![format!("id: {}", d.id), format!("título: {}", d.title), format!("onde: {}", where_of(&n))];
    if let Some(name) = d.category_id.as_ref().and_then(|c| cats.get(c)) {
        head.push(format!("categoria: {name}"));
    }
    // tags: as manuais e as #tags do texto
    let tags = tags_of(s, id)?;
    if !tags.is_empty() {
        head.push(format!("tags: {}", tags.join(", ")));
    }
    if d.color != "none" {
        head.push(format!("cor: {}", d.color));
    }
    if d.pinned {
        head.push("fixada: sim".into());
    }
    if let Some(at) = d.reminder_at {
        let mut r = format!("lembrete: {}", fmt_time(at));
        let rep = repeat_label(d.reminder_repeat.as_deref());
        if !rep.is_empty() {
            r.push_str(&format!(", {rep}"));
        }
        if d.reminder_done {
            r.push_str(", concluído");
        }
        head.push(r);
    }
    if let Some(t) = d.trashed_at {
        head.push(format!("na lixeira desde: {}", fmt_time(t)));
    }
    head.push(format!("criada: {}", fmt_time(d.created_at)));
    head.push(format!("editada: {}", fmt_time(d.updated_at)));
    let atts: Vec<&Attachment> = d.media.iter().chain(d.files.iter()).collect();
    if !atts.is_empty() {
        head.push("anexos:".into());
        for a in atts {
            head.push(format!("  - {} ({}, {}) hash {}", a.name, a.kind, human_bytes(a.bytes), a.hash));
        }
    }
    Ok(format!("---\n{}\n---\n{}", head.join("\n"), to_markdown(&body, &names(s))))
}

fn tags_of(s: &Store, id: &str) -> Result<Vec<String>> {
    let mut st = s.conn.prepare_cached("SELECT tag FROM note_tags WHERE note_id = ?1 ORDER BY tag").map_err(|e| e.to_string())?;
    let rows = st.query_map([id], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    let mut tags: Vec<String> = rows.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())?;
    tags.dedup();
    Ok(tags)
}

fn human_bytes(b: i64) -> String {
    let b = b as f64;
    if b < 1024.0 {
        format!("{b} B")
    } else if b < 1024.0 * 1024.0 {
        format!("{:.0} KB", b / 1024.0)
    } else {
        format!("{:.1} MB", b / 1024.0 / 1024.0)
    }
}

fn overview(core: &Core) -> Result<Out> {
    core.with(|s| {
        let counts = s.view_counts(&Filter::default(), "")?;
        let sync = s.sync_status()?;
        let cats: Vec<Value> = s.list_categories()?.into_iter().map(|c| json!({ "name": c.name, "notes": c.note_count })).collect();
        let tags: Vec<String> = s.list_tags()?.into_iter().map(|t| format!("#{} ({})", t.name, t.count)).collect();
        let now = Local::now();
        Ok(Out::Json(json!({
            "agora": fmt_time(now.timestamp_millis()),
            "fuso": now.format("%:z").to_string(),
            "notas": counts.notes,
            "arquivadas": s.list_notes(&Filter::default(), "archive", "", "updated")?.len(),
            "naLixeira": s.trash_count()?,
            "lembretesAbertos": counts.reminders,
            "lembretesAtrasados": counts.overdue,
            "arquivos": counts.files,
            "fotos": counts.moodboard,
            "categorias": cats,
            "tags": tags,
            "sync": {
                "contaGoogle": sync.account,
                "mudancasParaEnviar": sync.pending,
                "ultimoSync": sync.last_sync_at.map(fmt_time),
                "obs": "o app envia ao Drive quando está aberto",
            },
            "versao": env!("CARGO_PKG_VERSION"),
        })))
    })
}

fn summary_json(s: &Store, n: &crate::store::NoteSummary, cats: &HashMap<String, String>) -> Result<Value> {
    let text = s.note_text(&n.id)?;
    let body = text.strip_prefix(&n.title).unwrap_or(&text).trim();
    let excerpt: String = body.chars().take(240).collect();
    let mut v = json!({
        "id": n.id,
        "title": n.title,
        "excerpt": if body.chars().count() > 240 { format!("{excerpt}…") } else { excerpt },
        "updated": fmt_time(n.updated_at),
    });
    let o = v.as_object_mut().ok_or("nota")?;
    if let Some(name) = n.category_id.as_ref().and_then(|c| cats.get(c)) {
        o.insert("category".into(), json!(name));
    }
    if !n.tags.is_empty() {
        o.insert("tags".into(), json!(n.tags));
    }
    if n.color != "none" {
        o.insert("color".into(), json!(n.color));
    }
    if n.pinned {
        o.insert("pinned".into(), json!(true));
    }
    if n.archived {
        o.insert("archived".into(), json!(true));
    }
    if n.trashed_at.is_some() {
        o.insert("trashed".into(), json!(true));
    }
    if let Some(at) = n.reminder_at {
        o.insert("reminder".into(), json!(fmt_time(at)));
        if let Some(r) = &n.reminder_repeat {
            o.insert("repeat".into(), json!(r));
        }
        if n.reminder_done {
            o.insert("reminderDone".into(), json!(true));
        }
    }
    if n.image_count + n.file_count > 0 {
        o.insert("attachments".into(), json!(n.image_count + n.file_count));
    }
    Ok(v)
}

fn search(core: &Core, a: &Args) -> Result<Out> {
    core.with(|s| {
        let mut filter = Filter {
            category_id: a.str("category").filter(|c| !c.is_empty()).map(|c| category_id(s, c)).transpose()?,
            tags: a.str("tag").map(normalize_tag).filter(|t| !t.is_empty()).into_iter().collect(),
        };
        if a.bool("no_category") == Some(true) {
            filter.category_id = Some(NO_CATEGORY.into());
        }
        if a.bool("no_tags") == Some(true) {
            filter.tags = vec![NO_TAGS.into()];
        }
        let box_ = match a.str("where").unwrap_or("active") {
            "archived" => "archive",
            "trash" => "trash",
            "all" => "live",
            _ => "active",
        };
        let sort = match a.str("sort").unwrap_or("updated") {
            "created" => "created",
            "title" => "title",
            "custom" => "custom",
            _ => "updated",
        };
        let all = s.list_notes(&filter, box_, a.str("query").unwrap_or(""), sort)?;
        let limit = a.int("limit").unwrap_or(20).clamp(1, 100) as usize;
        let offset = a.int("offset").unwrap_or(0).max(0) as usize;
        let cats = category_names(s)?;
        let notes: Vec<Value> = all.iter().skip(offset).take(limit).map(|n| summary_json(s, n, &cats)).collect::<Result<_>>()?;
        Ok(Out::Json(json!({ "total": all.len(), "offset": offset, "notes": notes })))
    })
}

fn create(core: &Core, a: &Args) -> Result<Out> {
    core.with(|s| {
        let reminder_at = a.str("reminder").filter(|r| !r.is_empty()).map(parse_time).transpose()?;
        let input = NoteInput {
            id: uuid::Uuid::now_v7().to_string(),
            title: a.str("title").unwrap_or("").trim().to_string(),
            body: from_markdown(a.str("content").unwrap_or("")),
            category_id: a.str("category").filter(|c| !c.is_empty()).map(|c| category_id(s, c)).transpose()?,
            color: a.str("color").map(note_color).transpose()?.unwrap_or_else(|| "none".into()),
            pinned: a.bool("pinned").unwrap_or(false),
            archived: false,
            trashed_at: None,
            reminder_at,
            reminder_done: false,
            reminder_repeat: if reminder_at.is_some() { repeat_of(a)? } else { None },
            tags: clean_tags(a.strings("tags").unwrap_or_default()),
        };
        s.save_note(&input)?;
        s.log_external(Some(&input.id), false)?;
        Ok(Out::Text(format!("Nota criada.\n{}", note_text(s, &input.id)?)))
    })
}

fn clean_tags(tags: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in tags.iter().map(|t| normalize_tag(t)).filter(|t| !t.is_empty()) {
        if !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

/// Grava a nota mudada (só o que mudou vai para o Y.Doc) e anota para o app aberto.
fn save(s: &Store, n: &NoteInput) -> Result<()> {
    s.save_note(n)?;
    s.log_external(Some(&n.id), false)
}

fn update(core: &Core, a: &Args) -> Result<Out> {
    core.with(|s| {
        let mut n = note(s, a.need("id")?)?;
        if let Some(t) = a.str("title") {
            n.title = t.trim().to_string();
        }
        if let Some(c) = a.str("content") {
            n.body = from_markdown(c);
        }
        if let Some(c) = a.str("category") {
            n.category_id = if c.trim().is_empty() { None } else { Some(category_id(s, c)?) };
        }
        if let Some(tags) = a.strings("tags") {
            n.tags = clean_tags(tags);
        }
        if let Some(c) = a.str("color") {
            n.color = note_color(c)?;
        }
        if let Some(p) = a.bool("pinned") {
            n.pinned = p;
        }
        save(s, &n)?;
        Ok(Out::Text(format!("Nota atualizada.\n{}", note_text(s, &n.id)?)))
    })
}

fn markdown_of(s: &Store, n: &NoteInput) -> String {
    to_markdown(&n.body, &names(s))
}

fn edit_text(core: &Core, a: &Args) -> Result<Out> {
    core.with(|s| {
        let mut n = note(s, a.need("id")?)?;
        let find = a.need("find")?;
        let replace = a.need("replace")?;
        if find.is_empty() {
            return Err("`find` não pode ficar vazio".into());
        }
        let md = markdown_of(s, &n);
        let count = md.matches(find).count();
        if count == 0 {
            return Err(format!("o trecho não aparece no corpo. O Markdown atual é:\n{md}"));
        }
        if count > 1 && !a.bool("all").unwrap_or(false) {
            return Err(format!("o trecho aparece {count} vezes; inclua mais contexto ou use all=true"));
        }
        n.body = from_markdown(&md.replace(find, replace));
        save(s, &n)?;
        Ok(Out::Text(format!("Trocado ({count}x). Corpo agora:\n{}", markdown_of(s, &n))))
    })
}

fn append(core: &Core, a: &Args) -> Result<Out> {
    core.with(|s| {
        let mut n = note(s, a.need("id")?)?;
        let extra = from_markdown(a.need("content")?);
        let mut content = blocks_of(&n.body);
        // nota vazia (só um parágrafo vazio): o novo conteúdo ocupa o lugar
        if content.len() == 1 && content[0] == json!({"type": "paragraph"}) {
            content.clear();
        }
        let new = blocks_of(&extra);
        if a.str("at") == Some("start") {
            content.splice(0..0, new);
        } else {
            content.extend(new);
        }
        n.body = json!({ "type": "doc", "content": content });
        save(s, &n)?;
        Ok(Out::Text(format!("Acrescentado. Corpo agora:\n{}", markdown_of(s, &n))))
    })
}

fn blocks_of(body: &Value) -> Vec<Value> {
    body.get("content").and_then(Value::as_array).cloned().unwrap_or_default()
}

fn patch(core: &Core, id: &str, patch: Value, done: &str) -> Result<Out> {
    core.with(|s| {
        let id = existing(s, id)?;
        let map = patch.as_object().cloned().unwrap_or_default();
        s.update_note(&id, &map)?;
        s.log_external(Some(&id), false)?;
        Ok(Out::Text(done.to_string()))
    })
}

fn move_to(core: &Core, a: &Args) -> Result<Out> {
    let id = a.need("id")?;
    let (p, msg) = match a.need("to")? {
        "active" => (json!({ "archived": false, "trashedAt": null }), "Nota de volta para Notas."),
        "archived" => (json!({ "archived": true, "trashedAt": null }), "Nota arquivada."),
        "trash" => (json!({ "trashedAt": crate::store::now() }), "Nota na Lixeira (apagada de vez em 30 dias; move_note para active restaura)."),
        other => return Err(format!("destino desconhecido: {other} (use active, archived ou trash)")),
    };
    patch(core, id, p, msg)
}

fn delete_forever(core: &Core, a: &Args) -> Result<Out> {
    core.with(|s| {
        let n = note(s, a.need("id")?)?;
        if n.trashed_at.is_none() {
            return Err("só dá para apagar para sempre uma nota que já está na Lixeira (use move_note com to=trash)".into());
        }
        s.delete_note(&n.id)?;
        s.log_external(Some(&n.id), true)?;
        Ok(Out::Text("Nota apagada para sempre.".into()))
    })
}

// ---------- checklist ----------

/// Caminho de um item dentro do corpo: índices de `content` desde a raiz.
type Path_ = Vec<usize>;

fn task_items(node: &Value, path: &mut Path_, out: &mut Vec<(Path_, String)>) {
    for (i, child) in node.get("content").and_then(Value::as_array).into_iter().flatten().enumerate() {
        path.push(i);
        if child.get("type").and_then(Value::as_str) == Some("taskItem") {
            out.push((path.clone(), item_text(child)));
        }
        task_items(child, path, out);
        path.pop();
    }
}

fn item_text(item: &Value) -> String {
    fn text(v: &Value) -> String {
        match v.get("text").and_then(Value::as_str) {
            Some(t) => t.to_string(),
            None => v.get("content").and_then(Value::as_array).into_iter().flatten().map(text).collect::<Vec<_>>().join(""),
        }
    }
    item.get("content").and_then(Value::as_array).and_then(|c| c.first()).map(text).unwrap_or_default()
}

fn at_path<'a>(root: &'a mut Value, path: &[usize]) -> Option<&'a mut Value> {
    let mut cur = root;
    for &i in path {
        cur = cur.get_mut("content")?.get_mut(i)?;
    }
    Some(cur)
}

/// O item que o texto aponta: igual (sem acento/maiúsculas) ou, se nenhum for igual, o único que contém o texto.
fn find_item(items: &[(Path_, String)], query: &str) -> Result<Path_> {
    let q = fold(query.trim());
    let exact: Vec<&(Path_, String)> = items.iter().filter(|(_, t)| fold(t.trim()) == q).collect();
    let pick = if exact.is_empty() { items.iter().filter(|(_, t)| fold(t).contains(&q)).collect() } else { exact };
    match pick.as_slice() {
        [one] => Ok(one.0.clone()),
        [] => Err(format!(
            "nenhum item do checklist tem \"{query}\". Itens: {}",
            items.iter().map(|(_, t)| format!("\"{t}\"")).collect::<Vec<_>>().join(", ")
        )),
        many => Err(format!(
            "\"{query}\" combina com {} itens ({}); escreva o texto inteiro",
            many.len(),
            many.iter().map(|(_, t)| format!("\"{t}\"")).collect::<Vec<_>>().join(", ")
        )),
    }
}

fn set_checked(item: &mut Value, checked: bool) {
    if item.get("type").and_then(Value::as_str) == Some("taskItem") {
        item["attrs"]["checked"] = json!(checked);
    }
    for child in item.get_mut("content").and_then(Value::as_array_mut).into_iter().flatten() {
        set_checked(child, checked);
    }
}

fn set_items(core: &Core, a: &Args) -> Result<Out> {
    core.with(|s| {
        let mut n = note(s, a.need("id")?)?;
        let wanted = a.0.get("items").and_then(Value::as_array).ok_or("falta o parâmetro `items`")?;
        let mut items = Vec::new();
        task_items(&n.body, &mut Vec::new(), &mut items);
        if items.is_empty() {
            return Err("esta nota não tem checklist".into());
        }
        for w in wanted {
            let text = w.get("text").and_then(Value::as_str).ok_or("cada item precisa de `text`")?;
            let checked = w.get("checked").and_then(Value::as_bool).ok_or("cada item precisa de `checked`")?;
            let path = find_item(&items, text)?;
            if let Some(item) = at_path(&mut n.body, &path) {
                set_checked(item, checked);
            }
        }
        save(s, &n)?;
        Ok(Out::Text(format!("Checklist atualizado:\n{}", markdown_of(s, &n))))
    })
}

fn new_item(text: &str, checked: bool) -> Value {
    // o texto aceita negrito/itálico: lido como Markdown, fica o conteúdo do primeiro parágrafo
    let doc = from_markdown(text);
    let para = doc["content"]
        .as_array()
        .and_then(|c| c.iter().find(|b| b["type"] == "paragraph"))
        .cloned()
        .unwrap_or_else(|| json!({"type": "paragraph", "content": [{"type": "text", "text": text}]}));
    json!({"type": "taskItem", "attrs": {"checked": checked}, "content": [para]})
}

fn add_items(core: &Core, a: &Args) -> Result<Out> {
    core.with(|s| {
        let mut n = note(s, a.need("id")?)?;
        let texts = a.strings("items").filter(|v| !v.is_empty()).ok_or("falta o parâmetro `items`")?;
        let checked = a.bool("checked").unwrap_or(false);
        let new: Vec<Value> = texts.iter().map(|t| new_item(t, checked)).collect();
        if let Some(under) = a.str("under") {
            let mut items = Vec::new();
            task_items(&n.body, &mut Vec::new(), &mut items);
            let path = find_item(&items, under)?;
            let parent = at_path(&mut n.body, &path).ok_or("item não encontrado")?;
            let content = parent["content"].as_array_mut().ok_or("item sem conteúdo")?;
            match content.iter_mut().find(|c| c["type"] == "taskList") {
                Some(list) => list["content"].as_array_mut().ok_or("lista vazia")?.extend(new),
                None => content.push(json!({"type": "taskList", "content": new})),
            }
        } else {
            let content = n.body["content"].as_array_mut().ok_or("corpo vazio")?;
            match content.iter_mut().rev().find(|c| c["type"] == "taskList") {
                Some(list) => list["content"].as_array_mut().ok_or("lista vazia")?.extend(new),
                None => {
                    if content.len() == 1 && content[0] == json!({"type": "paragraph"}) {
                        content.clear();
                    }
                    content.push(json!({"type": "taskList", "content": new}))
                }
            }
        }
        save(s, &n)?;
        Ok(Out::Text(format!("Itens acrescentados:\n{}", markdown_of(s, &n))))
    })
}

fn remove_items(core: &Core, a: &Args) -> Result<Out> {
    core.with(|s| {
        let mut n = note(s, a.need("id")?)?;
        let mut items = Vec::new();
        task_items(&n.body, &mut Vec::new(), &mut items);
        let mut gone: Vec<Path_> = Vec::new();
        for t in a.strings("items").unwrap_or_default() {
            gone.push(find_item(&items, &t)?);
        }
        if a.bool("checked_only").unwrap_or(false) {
            for (p, _) in &items {
                if at_path(&mut n.body, p).and_then(|i| i["attrs"]["checked"].as_bool()) == Some(true) {
                    gone.push(p.clone());
                }
            }
        }
        if gone.is_empty() {
            return Err("diga quais itens (items) ou use checked_only=true".into());
        }
        // De trás para frente (e os mais fundos antes), para os caminhos que faltam continuarem valendo.
        gone.sort();
        gone.dedup();
        let count = gone.len();
        for p in gone.iter().rev() {
            let Some((last, parent)) = p.split_last() else { continue };
            if let Some(list) = at_path(&mut n.body, parent).and_then(|l| l.get_mut("content")).and_then(Value::as_array_mut) {
                if *last < list.len() {
                    list.remove(*last);
                }
            }
        }
        prune_empty_lists(&mut n.body);
        save(s, &n)?;
        Ok(Out::Text(format!("{count} item(ns) tirado(s). Corpo agora:\n{}", markdown_of(s, &n))))
    })
}

/// Lista que ficou sem itens sai (a nota não fica com um checklist vazio); corpo vazio vira um parágrafo vazio.
fn prune_empty_lists(node: &mut Value) {
    if let Some(content) = node.get_mut("content").and_then(Value::as_array_mut) {
        for c in content.iter_mut() {
            prune_empty_lists(c);
        }
        content.retain(|c| !(c["type"] == "taskList" && c["content"].as_array().map_or(true, |v| v.is_empty())));
    }
    if node["type"] == "doc" && node["content"].as_array().map_or(true, |v| v.is_empty()) {
        node["content"] = json!([{"type": "paragraph"}]);
    }
}

// ---------- lembretes ----------

fn reminders_list(core: &Core, a: &Args) -> Result<Out> {
    core.with(|s| {
        let now = crate::store::now();
        let cats = category_names(s)?;
        let list = s.list_reminders(&Filter::default(), "", a.bool("include_done").unwrap_or(false))?;
        let out: Vec<Value> = list
            .iter()
            .filter(|n| !a.bool("overdue_only").unwrap_or(false) || (n.reminder_at.is_some_and(|t| t < now) && !n.reminder_done))
            .map(|n| {
                let mut v = summary_json(s, n, &cats)?;
                if n.reminder_at.is_some_and(|t| t < now) && !n.reminder_done {
                    v["overdue"] = json!(true);
                }
                Ok(v)
            })
            .collect::<Result<_>>()?;
        Ok(Out::Json(json!({ "agora": fmt_time(now), "reminders": out })))
    })
}

fn set_reminder(core: &Core, a: &Args) -> Result<Out> {
    let at = parse_time(a.need("at")?)?;
    let repeat = repeat_of(a)?;
    let msg = format!(
        "Lembrete para {}{}.",
        fmt_time(at),
        repeat.as_deref().map(|r| format!(", {}", repeat_label(Some(r)))).unwrap_or_default()
    );
    let past = if at < crate::store::now() { " Atenção: esse horário já passou; o app vai avisar como atrasado." } else { "" };
    patch(core, a.need("id")?, json!({ "reminderAt": at, "reminderDone": false, "reminderRepeat": repeat }), &format!("{msg}{past}"))
}

fn complete(core: &Core, a: &Args) -> Result<Out> {
    core.with(|s| {
        let id = existing(s, a.need("id")?)?;
        let (_, repeat) = s.reminder_of(&id)?.ok_or("esta nota não tem lembrete")?;
        let msg = if a.bool("done") == Some(false) {
            s.set_reminder_done(&id, false)?;
            "Lembrete reaberto.".to_string()
        } else {
            reminders::complete(s, &id, crate::store::now(), &Local)?;
            match (repeat, s.reminder_of(&id)?) {
                (Some(_), Some((next, _))) => format!("Feito por esta vez; o próximo é {}.", fmt_time(next)),
                _ => "Lembrete concluído.".to_string(),
            }
        };
        s.log_external(Some(&id), false)?;
        Ok(Out::Text(msg))
    })
}

fn snooze(core: &Core, a: &Args) -> Result<Out> {
    let until = match (a.str("until"), a.int("minutes")) {
        (Some(u), _) => parse_time(u)?,
        (None, Some(m)) if m > 0 => crate::store::now() + m * 60_000,
        _ => return Err("diga até quando (until) ou daqui a quantos minutos (minutes)".into()),
    };
    core.with(|s| {
        let id = existing(s, a.need("id")?)?;
        s.reminder_of(&id)?.ok_or("esta nota não tem lembrete")?;
        reminders::snooze(s, &id, until)?;
        s.log_external(Some(&id), false)?;
        Ok(Out::Text(format!("Adiado para {}.", fmt_time(until))))
    })
}

// ---------- anexos ----------

fn attachment_json(a: &Attachment) -> Value {
    let mut v = json!({ "hash": a.hash, "name": a.name, "kind": a.kind, "mime": a.mime, "size": human_bytes(a.bytes) });
    if let (Some(w), Some(h)) = (a.width, a.height) {
        v["dimensions"] = json!(format!("{w}×{h}"));
    }
    if let Some(p) = &a.palette {
        if !p.is_empty() {
            v["palette"] = json!(p);
        }
    }
    if let Some(t) = &a.tone {
        v["tone"] = json!(t);
    }
    v
}

fn list_attachments(core: &Core, a: &Args) -> Result<Out> {
    core.with(|s| {
        let limit = a.int("limit").unwrap_or(50).clamp(1, 500) as usize;
        let kind = a.str("kind");
        let tone = a.str("tone");
        let keep = |at: &Attachment| kind.map_or(true, |k| at.kind == k) && tone.map_or(true, |t| at.tone.as_deref() == Some(t));
        let rows: Vec<Value> = if let Some(id) = a.str("note_id") {
            existing(s, id)?;
            let d = s.get_note(id)?.ok_or_else(|| format!("não existe nota com id {id}"))?;
            d.media.iter().chain(d.files.iter()).filter(|x| keep(x)).take(limit).map(attachment_json).collect()
        } else {
            s.list_attachments(&Filter::default(), a.str("query").unwrap_or(""))?
                .into_iter()
                .filter(|r| keep(&r.a))
                .take(limit)
                .map(|r| {
                    let mut v = attachment_json(&r.a);
                    v["note"] = json!({ "id": r.note_id, "title": r.note_title });
                    v
                })
                .collect()
        };
        Ok(Out::Json(Value::Array(rows)))
    })
}

fn attachment(s: &Store, hash: &str) -> Result<Attachment> {
    s.get_attachments(&[hash.to_string()])?.into_iter().next().ok_or_else(|| format!("não existe anexo com hash {hash}"))
}

fn get_attachment(core: &Core, a: &Args) -> Result<Out> {
    let hash = a.need("hash")?;
    let att = core.with(|s| attachment(s, hash))?;
    let path = attachments::dir(&core.data).join(&att.hash);
    if !path.exists() {
        return Err(format!("{} ainda não foi baixado neste computador (está no Google Drive). Abra a nota no app para baixar.", att.name));
    }
    let info = serde_json::to_string_pretty(&json!({ "attachment": attachment_json(&att), "file": path.display().to_string() })).unwrap_or_default();
    if att.kind == "image" {
        let thumb = attachments::thumb_path(&core.data, &att.hash);
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(u64::MAX);
        let full = a.str("size") == Some("full") && size <= FULL_IMAGE_MAX;
        let (file, mime) = if !full && thumb.exists() { (thumb, "image/webp".to_string()) } else { (path.clone(), att.mime.clone()) };
        if mime.starts_with("image/") && ["image/png", "image/jpeg", "image/gif", "image/webp"].contains(&mime.as_str()) {
            let data = std::fs::read(&file).map_err(|e| e.to_string())?;
            return Ok(Out::Image { data, mime, caption: info });
        }
    }
    let texty = att.mime.starts_with("text/") || ["application/json", "application/xml", "application/x-yaml"].contains(&att.mime.as_str()) || {
        let ext = att.name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
        ["txt", "md", "csv", "json", "tsv", "xml", "yaml", "yml", "log", "html", "css", "js", "ts", "py", "rs"].contains(&ext.as_str())
    };
    if texty {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&bytes);
        let cut: String = text.chars().take(TEXT_MAX).collect();
        let more = if text.chars().count() > TEXT_MAX { "\n[… cortado]" } else { "" };
        return Ok(Out::Text(format!("{info}\n--- conteúdo ---\n{cut}{more}")));
    }
    Ok(Out::Text(format!("{info}\n(Este tipo não é mostrado aqui; o arquivo está no caminho acima.)")))
}

fn attach(core: &Core, a: &Args) -> Result<Out> {
    let id = core.with(|s| existing(s, a.need("id")?))?;
    let path = PathBuf::from(a.need("path")?);
    if path.is_dir() {
        return Err("pastas não podem ser anexadas".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("não consegui ler {}: {e}", path.display()))?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "arquivo".into());
    let mime = attachments::mime_of(&name).to_string();
    let quality = core.with(|s| Ok(attachments::quality(s)))?;
    // O pipeline das fotos roda sem a trava do banco (o app aberto continua livre).
    let prepared = attachments::prepare(bytes, &name, &mime, quality);
    core.with(|s| {
        let att = attachments::save(s, &core.data, prepared)?;
        let mut n = note(s, &id)?;
        let node = if att.kind == "image" {
            json!({"type": "noteImage", "attrs": {"hash": att.hash}})
        } else {
            json!({"type": "noteFile", "attrs": {"hash": att.hash}})
        };
        let mut content = blocks_of(&n.body);
        if content.len() == 1 && content[0] == json!({"type": "paragraph"}) {
            content.clear();
        }
        if a.str("at") == Some("start") {
            content.insert(0, node);
        } else {
            content.push(node);
        }
        n.body = json!({"type": "doc", "content": content});
        save(s, &n)?;
        s.log_external(None, false)?;
        let line = if att.kind == "image" { format!("![{}]({ATT}{})", att.name, att.hash) } else { format!("[📎 {}]({ATT}{})", att.name, att.hash) };
        Ok(Out::Json(json!({ "attached": attachment_json(&att), "markdown": line })))
    })
}

fn export(core: &Core, a: &Args) -> Result<Out> {
    let att = core.with(|s| attachment(s, a.need("hash")?))?;
    let folder = match a.str("folder") {
        Some(f) => PathBuf::from(f),
        None => dirs::download_dir().or_else(|| dirs::home_dir().map(|h| h.join("Downloads"))).ok_or("não achei a pasta Downloads")?,
    };
    if !attachments::dir(&core.data).join(&att.hash).exists() {
        return Err(format!("{} ainda não foi baixado neste computador (está no Google Drive). Abra a nota no app para baixar.", att.name));
    }
    let dest = attachments::save_copy(&core.data, &folder, &att.hash, &att.name)?;
    Ok(Out::Text(format!("Salvo em {}", dest.display())))
}
