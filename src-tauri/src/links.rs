//! Visão Links: os links das notas num lugar só, como num gerenciador de favoritos.
//!
//! Regras puras (sem banco): achar os links no corpo da nota (cartões de link e links na palavra), juntar o mesmo
//! endereço, dizer o tipo pelo endereço e preencher a prévia de um cartão. A consulta fica em `Store::list_links`.

use serde::Serialize;
use serde_json::Value;

/// Um link achado no corpo de uma nota.
#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    pub url: String,
    pub title: String,
    pub description: Option<String>,
    pub site: String,
    pub image: Option<String>,
    /// Link na palavra (sem cartão): sem imagem nem descrição.
    pub word: bool,
}

/// Um endereço na visão Links, com as notas onde ele aparece.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRow {
    pub url: String,
    pub title: String,
    pub description: Option<String>,
    pub site: String,
    pub image: Option<String>,
    /// Só aparece como link na palavra (em nenhuma nota é cartão).
    pub word: bool,
    /// "article" | "video" | "audio" | "image" | "doc" | "code".
    pub kind: &'static str,
    /// As notas onde ele está, a mais recente primeiro.
    pub note_ids: Vec<String>,
    /// As tags dessas notas (manuais e #tags do texto), sem repetir.
    pub tags: Vec<String>,
    /// A edição mais recente entre essas notas.
    pub updated_at: i64,
}

/// O site do endereço, sem o "www.".
pub fn host(url: &str) -> String {
    url::Url::parse(url.trim())
        .ok()
        .and_then(|u| {
            u.host_str()
                .map(|h| h.trim_start_matches("www.").to_string())
        })
        .unwrap_or_default()
}

/// Chave para juntar o mesmo endereço: sem o "#trecho", sem a barra do fim, esquema e site em minúsculas.
pub fn key(url: &str) -> String {
    match url::Url::parse(url.trim()) {
        Ok(mut u) => {
            u.set_fragment(None);
            let s = u.to_string();
            s.strip_suffix('/').map(str::to_string).unwrap_or(s)
        }
        Err(_) => url.trim().to_string(),
    }
}

/// Tipo do link pelo endereço (site e extensão). O que não se reconhece é artigo.
pub fn kind_of(url: &str) -> &'static str {
    let Ok(u) = url::Url::parse(url.trim()) else {
        return "article";
    };
    let h = u
        .host_str()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_ascii_lowercase();
    let path = u.path().to_ascii_lowercase();
    let ext = path
        .rsplit_once('.')
        .map(|(_, e)| e)
        .filter(|e| !e.contains('/'))
        .unwrap_or("");
    let on = |sites: &[&str]| {
        sites
            .iter()
            .any(|s| h == *s || h.ends_with(&format!(".{s}")))
    };
    if matches!(ext, "mp4" | "webm" | "mov" | "mkv" | "avi")
        || on(&[
            "youtube.com",
            "youtu.be",
            "vimeo.com",
            "twitch.tv",
            "tiktok.com",
            "dailymotion.com",
            "loom.com",
        ])
    {
        "video"
    } else if matches!(ext, "mp3" | "m4a" | "ogg" | "oga" | "wav" | "flac" | "opus")
        || on(&[
            "spotify.com",
            "soundcloud.com",
            "podcasts.apple.com",
            "music.apple.com",
            "bandcamp.com",
            "deezer.com",
        ])
    {
        "audio"
    } else if matches!(
        ext,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" | "heic"
    ) || on(&[
        "unsplash.com",
        "imgur.com",
        "flickr.com",
        "dribbble.com",
        "behance.net",
        "pinterest.com",
    ]) {
        "image"
    } else if matches!(
        ext,
        "pdf"
            | "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "odt"
            | "ods"
            | "odp"
            | "csv"
            | "epub"
    ) || h == "docs.google.com"
        || h == "drive.google.com"
    {
        "doc"
    } else if on(&[
        "github.com",
        "gitlab.com",
        "codeberg.org",
        "bitbucket.org",
        "npmjs.com",
        "crates.io",
        "pypi.org",
        "stackoverflow.com",
        "developer.mozilla.org",
        "docs.rs",
        "huggingface.co",
    ]) {
        "code"
    } else {
        "article"
    }
}

fn text_of(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Os links do corpo (JSON do TipTap), na ordem do texto: cartões de link e links na palavra. Pedaços seguidos com o
/// mesmo endereço (a palavra com negrito no meio) viram um link só.
pub fn extract(body: &Value) -> Vec<Found> {
    let mut out = Vec::new();
    walk(body, &mut out);
    out
}

fn walk(node: &Value, out: &mut Vec<Found>) {
    if node.get("type").and_then(Value::as_str) == Some("linkCard") {
        let a = node.get("attrs").cloned().unwrap_or(Value::Null);
        if let Some(url) = text_of(&a, "url") {
            out.push(Found {
                title: text_of(&a, "title").unwrap_or_else(|| url.clone()),
                description: text_of(&a, "description"),
                site: text_of(&a, "site").unwrap_or_else(|| host(&url)),
                image: text_of(&a, "image"),
                word: false,
                url,
            });
        }
        return;
    }
    let Some(children) = node.get("content").and_then(Value::as_array) else {
        return;
    };
    // Links na palavra: texto com a marca `link`, juntando os pedaços seguidos do mesmo endereço.
    let mut run: Option<(String, String)> = None;
    let flush = |run: &mut Option<(String, String)>, out: &mut Vec<Found>| {
        if let Some((url, text)) = run.take() {
            let title = text.trim().to_string();
            out.push(Found {
                site: host(&url),
                title: if title.is_empty() { url.clone() } else { title },
                description: None,
                image: None,
                word: true,
                url,
            });
        }
    };
    for c in children {
        let href = (c.get("type").and_then(Value::as_str) == Some("text"))
            .then(|| c.get("marks").and_then(Value::as_array))
            .flatten()
            .and_then(|ms| {
                ms.iter()
                    .find(|m| m.get("type").and_then(Value::as_str) == Some("link"))
            })
            .and_then(|m| m.get("attrs").and_then(|a| text_of(a, "href")));
        match href {
            Some(h) => {
                let t = c.get("text").and_then(Value::as_str).unwrap_or("");
                match &mut run {
                    Some((u, text)) if *u == h => text.push_str(t),
                    _ => {
                        flush(&mut run, out);
                        run = Some((h, t.to_string()));
                    }
                }
            }
            None => {
                flush(&mut run, out);
                walk(c, out);
            }
        }
    }
    flush(&mut run, out);
}

/// Junta os links das notas (cada nota com o que tem: id, tags, data) numa linha por endereço. Um cartão vale mais
/// que um link na palavra para título, descrição e imagem. A ordem é a da primeira vez que o endereço aparece.
pub fn group<'a>(
    notes: impl IntoIterator<Item = (&'a str, &'a [String], i64, Vec<Found>)>,
) -> Vec<LinkRow> {
    let mut rows: Vec<LinkRow> = Vec::new();
    let mut at: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (id, tags, updated, found) in notes {
        for f in found {
            let k = key(&f.url);
            let i = *at.entry(k).or_insert_with(|| {
                rows.push(LinkRow {
                    kind: kind_of(&f.url),
                    url: f.url.clone(),
                    title: f.title.clone(),
                    description: None,
                    site: f.site.clone(),
                    image: None,
                    word: true,
                    note_ids: Vec::new(),
                    tags: Vec::new(),
                    updated_at: updated,
                });
                rows.len() - 1
            });
            let r = &mut rows[i];
            if !f.word && r.word {
                // o primeiro cartão traz o título e o site dele
                r.word = false;
                r.title = f.title.clone();
                r.site = f.site.clone();
            }
            if !f.word {
                r.description = r.description.take().or(f.description);
                r.image = r.image.take().or(f.image);
            }
            if !r.note_ids.iter().any(|n| n == id) {
                r.note_ids.push(id.to_string());
            }
            for t in tags {
                if !r.tags.contains(t) {
                    r.tags.push(t.clone());
                }
            }
            r.updated_at = r.updated_at.max(updated);
        }
    }
    rows
}

/// O que a visão Links pede de uma vez: os endereços e as notas onde eles estão (para o card de cada uma).
#[derive(Debug, Serialize)]
pub struct LinkList {
    pub links: Vec<LinkRow>,
    pub notes: Vec<crate::store::NoteSummary>,
}

/// Corpo da nota de um link salvo: o cartão (com o que já se sabe da página) e uma linha vazia para escrever.
pub fn card_body(
    url: &str,
    title: Option<&str>,
    description: Option<&str>,
    site: Option<&str>,
    image: Option<&str>,
) -> Value {
    serde_json::json!({
        "type": "doc",
        "content": [
            { "type": "linkCard", "attrs": {
                "url": url, "title": title, "description": description,
                "site": site.map(str::to_string).unwrap_or_else(|| host(url)), "image": image,
            } },
            { "type": "paragraph" },
        ],
    })
}

/// Põe a prévia da página nos cartões deste endereço que ainda não têm título, descrição ou imagem. Devolve se mudou.
pub fn fill(
    body: &mut Value,
    url: &str,
    title: Option<&str>,
    description: Option<&str>,
    site: Option<&str>,
    image: Option<&str>,
) -> bool {
    let k = key(url);
    let mut changed = false;
    fill_in(
        body,
        &k,
        &[
            ("title", title),
            ("description", description),
            ("site", site),
            ("image", image),
        ],
        &mut changed,
    );
    changed
}

fn fill_in(node: &mut Value, k: &str, with: &[(&str, Option<&str>)], changed: &mut bool) {
    if node.get("type").and_then(Value::as_str) == Some("linkCard") {
        if let Some(a) = node.get_mut("attrs").and_then(Value::as_object_mut) {
            if a.get("url").and_then(Value::as_str).map(key).as_deref() == Some(k) {
                for (name, v) in with {
                    let Some(v) = v.map(str::trim).filter(|v| !v.is_empty()) else {
                        continue;
                    };
                    let empty = a
                        .get(*name)
                        .and_then(Value::as_str)
                        .map_or(true, |s| s.trim().is_empty());
                    // o site do cartão novo é o endereço; o nome que a página dá a si mesma é melhor
                    let host_only = *name == "site"
                        && a.get("site").and_then(Value::as_str) == Some(host(k).as_str());
                    if empty || host_only {
                        a.insert(name.to_string(), Value::String(v.to_string()));
                        *changed = true;
                    }
                }
            }
        }
        return;
    }
    if let Some(cs) = node.get_mut("content").and_then(Value::as_array_mut) {
        for c in cs {
            fill_in(c, k, with, changed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn word(text: &str, href: &str) -> Value {
        json!({ "type": "text", "text": text, "marks": [{ "type": "link", "attrs": { "href": href } }] })
    }

    #[test]
    fn finds_cards_and_words_in_order() {
        let body = json!({ "type": "doc", "content": [
            { "type": "paragraph", "content": [
                { "type": "text", "text": "veja a " },
                word("plani", "https://exemplo.com/vendas"),
                { "type": "text", "text": "lha", "marks": [{ "type": "bold" }, { "type": "link", "attrs": { "href": "https://exemplo.com/vendas" } }] },
                { "type": "text", "text": " e " },
                word("slides", "https://exemplo.com/q3"),
            ] },
            { "type": "linkCard", "attrs": { "url": "https://www.exemplo.org/artigo", "title": "Um artigo", "description": "Resumo", "image": "data:image/webp;base64,AA" } },
            { "type": "taskList", "content": [{ "type": "taskItem", "content": [{ "type": "paragraph", "content": [word("tarefa", "https://exemplo.net/t")] }] }] },
        ] });
        let f = extract(&body);
        let urls: Vec<_> = f
            .iter()
            .map(|x| (x.url.as_str(), x.title.as_str(), x.word))
            .collect();
        assert_eq!(
            urls,
            vec![
                ("https://exemplo.com/vendas", "planilha", true),
                ("https://exemplo.com/q3", "slides", true),
                ("https://www.exemplo.org/artigo", "Um artigo", false),
                ("https://exemplo.net/t", "tarefa", true),
            ]
        );
        assert_eq!(f[2].site, "exemplo.org");
        assert_eq!(f[2].description.as_deref(), Some("Resumo"));
        assert!(f[0].image.is_none() && f[0].description.is_none());
    }

    #[test]
    fn card_without_title_shows_the_address() {
        let f = extract(
            &json!({ "type": "doc", "content": [{ "type": "linkCard", "attrs": { "url": "https://exemplo.com/x" } }] }),
        );
        assert_eq!(f[0].title, "https://exemplo.com/x");
        assert_eq!(f[0].site, "exemplo.com");
    }

    #[test]
    fn same_address_in_several_notes_is_one_row() {
        let card = |u: &str| Found {
            url: u.into(),
            title: "Cartão".into(),
            description: Some("d".into()),
            site: "exemplo.com".into(),
            image: Some("img".into()),
            word: false,
        };
        let word = |u: &str| Found {
            url: u.into(),
            title: "palavra".into(),
            description: None,
            site: "exemplo.com".into(),
            image: None,
            word: true,
        };
        let (ta, tb) = (
            vec!["estudo".to_string()],
            vec!["estudo".to_string(), "app".to_string()],
        );
        let rows = group(vec![
            ("a", ta.as_slice(), 10, vec![word("https://exemplo.com/x/")]),
            (
                "b",
                tb.as_slice(),
                30,
                vec![
                    card("https://exemplo.com/x#parte"),
                    word("https://exemplo.com/y"),
                ],
            ),
            ("b", tb.as_slice(), 30, vec![card("https://exemplo.com/x")]),
        ]);
        assert_eq!(rows.len(), 2);
        let x = &rows[0];
        assert_eq!(x.note_ids, vec!["a", "b"]);
        assert_eq!(x.tags, vec!["estudo", "app"]);
        assert!(
            !x.word,
            "um cartão em qualquer nota tira o link de 'só na palavra'"
        );
        assert_eq!(
            (x.title.as_str(), x.image.as_deref(), x.updated_at),
            ("Cartão", Some("img"), 30)
        );
        assert!(rows[1].word);
    }

    #[test]
    fn kind_by_site_and_extension() {
        for (u, k) in [
            ("https://www.youtube.com/watch?v=1", "video"),
            ("https://youtu.be/abc", "video"),
            ("https://open.spotify.com/episode/1", "audio"),
            ("https://exemplo.com/a.mp3", "audio"),
            ("https://exemplo.com/relatorio.PDF", "doc"),
            ("https://docs.google.com/spreadsheets/d/1", "doc"),
            ("https://exemplo.com/foto.jpg?w=200", "image"),
            ("https://github.com/exemplo/repo", "code"),
            ("https://exemplo.com/blog/um.post/", "article"),
            ("nem é endereço", "article"),
        ] {
            assert_eq!(kind_of(u), k, "{u}");
        }
    }

    #[test]
    fn fill_only_what_is_missing_on_the_matching_card() {
        let mut body = card_body("https://exemplo.com/a", None, None, None, None);
        body["content"].as_array_mut().unwrap().push(
            json!({ "type": "linkCard", "attrs": { "url": "https://outro.com", "title": null } }),
        );
        assert!(fill(
            &mut body,
            "https://exemplo.com/a/",
            Some("Título"),
            Some("Desc"),
            Some("Exemplo"),
            Some("data:img")
        ));
        let a = &body["content"][0]["attrs"];
        assert_eq!(
            (
                a["title"].as_str(),
                a["description"].as_str(),
                a["site"].as_str(),
                a["image"].as_str()
            ),
            (
                Some("Título"),
                Some("Desc"),
                Some("Exemplo"),
                Some("data:img")
            )
        );
        assert!(
            body["content"][2]["attrs"]["title"].is_null(),
            "outro endereço fica como estava"
        );
        // o que a pessoa já tem não muda
        assert!(!fill(
            &mut body,
            "https://exemplo.com/a",
            Some("Outro"),
            None,
            None,
            None
        ));
        assert_eq!(body["content"][0]["attrs"]["title"], "Título");
    }
}
