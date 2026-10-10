//! Bloco de link: o endereço colado vira um cartão com título, descrição, imagem e o site. A prévia vem da própria
//! página (Open Graph, `<title>`, `meta description`), buscada em segundo plano; a imagem entra reduzida (miniatura
//! WebP, como `data:`) dentro da nota, para o cartão aparecer igual sem rede e em todos os aparelhos.

use std::io::Read;
use std::time::Duration;

use base64::Engine;
use serde::Serialize;

use crate::store::Result;

/// Até onde a página é lida (o `<head>` vem no começo).
const MAX_HTML: u64 = 1024 * 1024;
const MAX_IMAGE: u64 = 6 * 1024 * 1024;

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
pub struct LinkPreview {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site: Option<String>,
    /// Miniatura da imagem da página, como `data:image/webp;base64,…`.
    pub image: Option<String>,
}

/// O que a página diz de si (antes de buscar a imagem).
#[derive(Debug, Default, PartialEq)]
struct Meta {
    title: Option<String>,
    description: Option<String>,
    site: Option<String>,
    image: Option<String>,
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(6))
        .timeout_read(Duration::from_secs(10))
        .redirects(5)
        .user_agent("Mozilla/5.0 (compatible; Ideario; +https://github.com/wylho/ideario)")
        .build()
}

/// Só http e https.
pub fn valid_url(s: &str) -> Option<url::Url> {
    let u = url::Url::parse(s.trim()).ok()?;
    matches!(u.scheme(), "http" | "https").then_some(u).filter(|u| u.host_str().is_some())
}

/// Busca a prévia. Sem rede ou página estranha: devolve o que deu (no mínimo o site), nunca falha por isso.
pub fn fetch(url: &str) -> Result<LinkPreview> {
    let u = valid_url(url).ok_or("endereço inválido (use http ou https)")?;
    let site_host = u.host_str().map(|h| h.trim_start_matches("www.").to_string());
    let mut out = LinkPreview { url: u.to_string(), site: site_host.clone(), ..Default::default() };
    let agent = agent();
    let Ok(resp) = agent.get(u.as_str()).set("Accept", "text/html,application/xhtml+xml").call() else { return Ok(out) };
    let final_url = url::Url::parse(resp.get_url()).unwrap_or(u.clone());
    let is_html = resp.content_type().contains("html");
    if !is_html {
        return Ok(out);
    }
    let mut bytes = Vec::new();
    if resp.into_reader().take(MAX_HTML).read_to_end(&mut bytes).is_err() {
        return Ok(out);
    }
    let meta = parse(&String::from_utf8_lossy(&bytes));
    out.title = meta.title;
    out.description = meta.description;
    if meta.site.is_some() {
        out.site = meta.site;
    }
    if let Some(img) = meta.image.and_then(|i| final_url.join(&i).ok()).filter(|i| matches!(i.scheme(), "http" | "https")) {
        out.image = image(&agent, img.as_str());
    }
    Ok(out)
}

fn image(agent: &ureq::Agent, url: &str) -> Option<String> {
    let resp = agent.get(url).call().ok()?;
    let mut bytes = Vec::new();
    resp.into_reader().take(MAX_IMAGE).read_to_end(&mut bytes).ok()?;
    let thumb = crate::media::thumbnail(&bytes).ok()?;
    Some(format!("data:image/webp;base64,{}", base64::engine::general_purpose::STANDARD.encode(thumb)))
}

// ---------- ler o <head> ----------

/// Atributos de uma tag (`<meta property="og:title" content="…">`), nomes em minúsculas.
fn attrs(tag: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let b = tag.as_bytes();
    let mut i = 0;
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') {
            i += 1;
        }
        let start = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' && b[i] != b'>' {
            i += 1;
        }
        let name = tag[start..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() {
                i += 1;
            }
            let value = if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let q = b[i];
                i += 1;
                let s = i;
                while i < b.len() && b[i] != q {
                    i += 1;
                }
                let v = &tag[s..i.min(tag.len())];
                i += 1;
                v
            } else {
                let s = i;
                while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'>' {
                    i += 1;
                }
                &tag[s..i]
            };
            if !name.is_empty() {
                out.push((name, decode_entities(value)));
            }
        } else if !name.is_empty() {
            out.push((name, String::new()));
        } else {
            i += 1;
        }
    }
    out
}

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest.find(';').filter(|e| *e <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..end];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn clean(s: &str) -> Option<String> {
    let t = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let t: String = t.chars().take(300).collect();
    (!t.is_empty()).then_some(t)
}

/// Título, descrição, site e imagem: Open Graph primeiro, depois Twitter, `<title>` e `meta description`.
fn parse(html: &str) -> Meta {
    let lower = html.to_ascii_lowercase();
    // só o <head> (ou o começo da página, se não houver)
    let end = lower.find("</head>").unwrap_or(lower.len().min(200_000));
    let head = &html[..end];
    let lhead = &lower[..end];
    let mut og: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut pos = 0;
    while let Some(i) = lhead[pos..].find("<meta") {
        let start = pos + i + 5;
        let Some(close) = lhead[start..].find('>') else { break };
        let a = attrs(&head[start..start + close]);
        let key = a.iter().find(|(k, _)| k == "property" || k == "name").map(|(_, v)| v.to_ascii_lowercase());
        let content = a.iter().find(|(k, _)| k == "content").map(|(_, v)| v.clone());
        if let (Some(k), Some(c)) = (key, content) {
            og.entry(k).or_insert(c);
        }
        pos = start + close;
    }
    let title_tag = lhead.find("<title").and_then(|i| {
        let s = i + lhead[i..].find('>')? + 1;
        let e = s + lhead[s..].find("</title")?;
        Some(decode_entities(&head[s..e]))
    });
    let pick = |keys: &[&str]| keys.iter().find_map(|k| og.get(*k).and_then(|v| clean(v)));
    Meta {
        title: pick(&["og:title", "twitter:title"]).or_else(|| title_tag.as_deref().and_then(clean)),
        description: pick(&["og:description", "twitter:description", "description"]),
        site: pick(&["og:site_name"]),
        image: pick(&["og:image", "og:image:url", "twitter:image", "twitter:image:src"]),
    }
}

#[tauri::command]
pub async fn link_preview(url: String) -> Result<LinkPreview> {
    tauri::async_runtime::spawn_blocking(move || fetch(&url)).await.map_err(|e| e.to_string())?
}

/// Abre o endereço no navegador do sistema (só http e https).
#[tauri::command]
pub fn open_url(app: tauri::AppHandle, url: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let u = valid_url(&url).ok_or("endereço inválido")?;
    app.opener().open_url(u.as_str(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;

    #[test]
    fn reads_open_graph_then_falls_back() {
        let html = r#"<!doctype html><html><head>
            <meta charset="utf-8"><title> Página &amp; Cia </title>
            <meta name="description" content="Descrição simples">
            <meta property="og:title" content="Título &quot;bom&quot; &#233; esse">
            <meta content='/img/capa.png' property='og:image'>
            <meta property="og:site_name" content="Exemplo">
            </head><body><meta property="og:title" content="não conta"></body></html>"#;
        assert_eq!(
            parse(html),
            Meta { title: Some("Título \"bom\" é esse".into()), description: Some("Descrição simples".into()), site: Some("Exemplo".into()), image: Some("/img/capa.png".into()) }
        );
        let plain = "<html><head><TITLE>Só o título</TITLE></head></html>";
        assert_eq!(parse(plain), Meta { title: Some("Só o título".into()), ..Default::default() });
        assert_eq!(parse("lixo <meta sem fim"), Meta::default());
    }

    #[test]
    fn only_http_and_https() {
        assert!(valid_url("https://exemplo.com/a?b=1").is_some());
        assert!(valid_url(" http://x.y ").is_some());
        for bad in ["file:///etc/passwd", "javascript:alert(1)", "exemplo.com", "ftp://x.y", "https://"] {
            assert!(valid_url(bad).is_none(), "{bad}");
        }
    }

    /// Um site de mentira na máquina: a página com og:image relativa e a imagem.
    fn serve(pages: Vec<(&'static str, &'static str, Vec<u8>)>) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = format!("http://{}", l.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in l.incoming().take(pages.len() * 2) {
                let Ok(mut s) = stream else { continue };
                let mut buf = [0u8; 2048];
                let n = std::io::Read::read(&mut s, &mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                let (ct, body) = pages.iter().find(|(p, _, _)| *p == path).map(|(_, c, b)| (*c, b.clone())).unwrap_or(("text/plain", b"nada".to_vec()));
                let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Type: {ct}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = s.write_all(&body);
            }
        });
        addr
    }

    #[test]
    fn fetches_title_and_a_small_image() {
        let png = {
            let mut buf = std::io::Cursor::new(Vec::new());
            image::RgbImage::from_fn(1200, 630, |x, _| image::Rgb([(x / 5) as u8, 80, 160])).write_to(&mut buf, image::ImageFormat::Png).unwrap();
            buf.into_inner()
        };
        let html = br#"<html><head><meta property="og:title" content="Receita de bolo"><meta property="og:image" content="/capa.png"></head></html>"#.to_vec();
        let base = serve(vec![("/", "text/html; charset=utf-8", html), ("/capa.png", "image/png", png)]);
        let p = fetch(&format!("{base}/")).unwrap();
        assert_eq!(p.title.as_deref(), Some("Receita de bolo"));
        assert_eq!(p.site.as_deref(), Some("127.0.0.1"));
        let img = p.image.unwrap();
        assert!(img.starts_with("data:image/webp;base64,"));
        assert!(img.len() < 60_000, "miniatura, não a imagem inteira: {}", img.len());
    }

    #[test]
    fn offline_still_gives_the_site() {
        // porta fechada: sem prévia, mas o cartão tem o site
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        let p = fetch(&format!("http://127.0.0.1:{port}/artigo")).unwrap();
        assert_eq!((p.title, p.site.as_deref()), (None, Some("127.0.0.1")));
        assert!(fetch("isso não é link").is_err());
    }
}
