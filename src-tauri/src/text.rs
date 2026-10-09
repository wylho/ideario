//! Utilidades de texto compartilhadas pelo núcleo: comparar sem acento, extrair `#tags`, limpar espaços.
//! Espelham `fold`, `hashTags` e `normalizeTag` de src/lib/format.ts.

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Minúsculas e sem acento ("Ação" → "acao"), para ordenar e comparar como as pessoas esperam.
pub fn fold(s: &str) -> String {
    s.nfd().filter(|c| !is_combining_mark(*c)).flat_map(char::to_lowercase).collect()
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-'
}

/// Tags digitadas como `#palavra` no texto, em minúsculas, na ordem em que aparecem (sem repetir).
pub fn hash_tags(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let starts = chars[i] == '#' && (i == 0 || !(chars[i - 1].is_alphanumeric() || chars[i - 1] == '_'));
        if starts {
            let mut j = i + 1;
            while j < chars.len() && is_tag_char(chars[j]) {
                j += 1;
            }
            if j > i + 1 {
                let tag: String = chars[i + 1..j].iter().flat_map(|c| c.to_lowercase()).collect();
                if !out.contains(&tag) {
                    out.push(tag);
                }
            }
            i = j;
        } else {
            i += 1;
        }
    }
    out
}

/// Como a UI normaliza uma tag digitada: sem `#`, espaços viram hífen, minúsculas.
pub fn normalize_tag(raw: &str) -> String {
    raw.trim().trim_start_matches('#').split_whitespace().collect::<Vec<_>>().join("-").to_lowercase()
}

/// Espaços e tabulações repetidos viram um só; espaços em volta de quebras de linha somem.
pub fn clean(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending_space = false;
    for c in s.chars() {
        match c {
            ' ' | '\t' => pending_space = true,
            '\n' => {
                while out.ends_with(' ') {
                    out.pop();
                }
                out.push('\n');
                pending_space = false;
            }
            _ => {
                if pending_space && !out.is_empty() && !out.ends_with('\n') {
                    out.push(' ');
                }
                pending_space = false;
                out.push(c);
            }
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_removes_accents() {
        assert_eq!(fold("Ação Pão ÍNDIO"), "acao pao indio");
    }

    #[test]
    fn hash_tags_like_the_ui() {
        assert_eq!(hash_tags("Ver #Casa e #compras-do-mês, não e-mail#x"), vec!["casa", "compras-do-mês"]);
        assert_eq!(hash_tags("#a #a #b"), vec!["a", "b"]);
        assert!(hash_tags("# solto").is_empty());
    }

    #[test]
    fn clean_spaces() {
        assert_eq!(clean("  a   b \n  c\t\td  "), "a b\nc d");
    }

    #[test]
    fn normalize() {
        assert_eq!(normalize_tag(" ##Lista de Compras "), "lista-de-compras");
    }
}
