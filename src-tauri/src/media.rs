//! Pipeline das fotos (Fase 3, SPEC §7), fora da thread da interface:
//! 1. aplica a orientação EXIF e descarta todos os metadados (inclusive GPS), porque a foto é recodificada;
//! 2. reduz o lado maior conforme a qualidade escolhida (padrão 2048 px; nunca aumenta);
//! 3. grava em WebP; 4. gera a miniatura (~400 px, WebP); 5. extrai a paleta (5 cores) e classifica o tom.
//!
//! Na qualidade Original os passos 1 a 3 não acontecem: o arquivo fica exatamente como veio (com GPS e tudo).
//! GIF e SVG também ficam como vieram (recodificar perderia a animação ou o vetor). Miniatura, paleta e tom saem
//! sempre que a imagem puder ser lida.

use std::io::Cursor;

use fast_image_resize::{images::Image as FirImage, FilterType, IntoImageView, ResizeAlg, ResizeOptions, Resizer};
use image::{DynamicImage, ImageDecoder, ImageReader};

/// Lado maior da miniatura (cards, Arquivos, Moodboard).
pub const THUMB_SIDE: u32 = 400;
/// Qualidade do WebP (0–100): boa para fotos, ~10× menor que o JPEG da câmera.
const WEBP_QUALITY: f32 = 80.0;
const THUMB_QUALITY: f32 = 72.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    Economy,
    Balanced,
    High,
    Original,
}

impl Quality {
    pub fn from_setting(s: &str) -> Quality {
        match s {
            "economy" => Quality::Economy,
            "high" => Quality::High,
            "original" => Quality::Original,
            _ => Quality::Balanced,
        }
    }

    /// Lado maior da foto guardada (None = como veio).
    fn max_side(self) -> Option<u32> {
        match self {
            Quality::Economy => Some(1280),
            Quality::Balanced => Some(2048),
            Quality::High => Some(3072),
            Quality::Original => None,
        }
    }
}

/// Foto pronta para guardar.
#[derive(Debug)]
pub struct Processed {
    /// O que vai para o disco (WebP, ou o arquivo original).
    pub bytes: Vec<u8>,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    /// Miniatura WebP.
    pub thumb: Vec<u8>,
    /// 5 cores em `#rrggbb`, da mais presente para a menos.
    pub palette: Vec<String>,
    pub tone: Tone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Warm,
    Cool,
    Green,
    Pink,
    Neutral,
}

impl Tone {
    /// Como o banco e a interface chamam (src/lib/types.ts `Tone`).
    pub fn as_str(self) -> &'static str {
        match self {
            Tone::Warm => "quente",
            Tone::Cool => "frio",
            Tone::Green => "verde",
            Tone::Pink => "rosa",
            Tone::Neutral => "neutro",
        }
    }
}

/// Passa a foto pelo pipeline. Erro = não é uma imagem legível (quem chama guarda o arquivo como veio).
pub fn process(bytes: &[u8], mime: &str, quality: Quality) -> Result<Processed, String> {
    let img = decode(bytes)?;
    // GIF (pode ser animado) e qualidade Original: o arquivo fica intacto.
    let keep = quality == Quality::Original || mime == "image/gif";
    let (out, out_mime, width, height) = if keep {
        (bytes.to_vec(), mime.to_string(), img.width(), img.height())
    } else {
        let max = quality.max_side().unwrap_or(u32::MAX);
        let photo = shrink(&img, max)?;
        let (w, h) = (photo.width(), photo.height());
        (smallest_webp(&photo, bytes.len())?, "image/webp".to_string(), w, h)
    };
    let small = shrink(&img, THUMB_SIDE)?;
    let thumb = encode_webp(&small, THUMB_QUALITY)?;
    let palette = palette(&small);
    let tone = tone(&palette);
    Ok(Processed {
        bytes: out,
        mime: out_mime,
        width,
        height,
        thumb,
        palette: palette.iter().map(|c| hex(c.rgb)).collect(),
        tone,
    })
}

/// Só a miniatura, a paleta e o tom de uma foto já guardada (anexos da Fase 1, que entraram sem o pipeline).
pub fn derive(bytes: &[u8]) -> Result<(Vec<u8>, Vec<String>, Tone), String> {
    let img = decode(bytes)?;
    let small = shrink(&img, THUMB_SIDE)?;
    let palette = palette(&small);
    let tone = tone(&palette);
    Ok((encode_webp(&small, THUMB_QUALITY)?, palette.iter().map(|c| hex(c.rgb)).collect(), tone))
}

/// Só a miniatura WebP de uma imagem (prévia de PDF ou vídeo gerada na interface).
pub fn thumbnail(bytes: &[u8]) -> Result<Vec<u8>, String> {
    encode_webp(&shrink(&decode(bytes)?, THUMB_SIDE)?, THUMB_QUALITY)
}

/// Lê a imagem já na orientação certa (a câmera grava "deitada" e anota a rotação no EXIF).
fn decode(bytes: &[u8]) -> Result<DynamicImage, String> {
    let reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|e| e.to_string())?;
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    img.apply_orientation(orientation);
    // 8 bits por canal, com ou sem transparência: o que o WebP grava.
    Ok(if img.color().has_alpha() { DynamicImage::ImageRgba8(img.into_rgba8()) } else { DynamicImage::ImageRgb8(img.into_rgb8()) })
}

/// Reduz para caber em `max` × `max` mantendo a proporção. Nunca aumenta.
fn shrink(img: &DynamicImage, max: u32) -> Result<DynamicImage, String> {
    let (w, h) = (img.width(), img.height());
    if w <= max && h <= max {
        return Ok(img.clone());
    }
    let scale = max as f64 / w.max(h) as f64;
    let (nw, nh) = (((w as f64 * scale).round() as u32).max(1), ((h as f64 * scale).round() as u32).max(1));
    let pixel = img.pixel_type().ok_or("formato de pixel sem suporte")?;
    let mut dst = FirImage::new(nw, nh, pixel);
    Resizer::new()
        .resize(img, &mut dst, &ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3)))
        .map_err(|e| e.to_string())?;
    let buf = dst.into_vec();
    let out = if img.color().has_alpha() {
        image::RgbaImage::from_raw(nw, nh, buf).map(DynamicImage::ImageRgba8)
    } else {
        image::RgbImage::from_raw(nw, nh, buf).map(DynamicImage::ImageRgb8)
    };
    out.ok_or_else(|| "falha ao reduzir a imagem".to_string())
}

/// WebP com perda (fotos). Se ficar maior que o arquivo de entrada (desenhos, capturas de tela com poucas cores,
/// que o PNG comprime muito bem), tenta o WebP sem perda e fica com o menor dos dois.
fn smallest_webp(img: &DynamicImage, input_len: usize) -> Result<Vec<u8>, String> {
    let lossy = encode_webp(img, WEBP_QUALITY)?;
    if lossy.len() < input_len {
        return Ok(lossy);
    }
    let enc = webp::Encoder::from_image(img).map_err(str::to_string)?;
    let lossless = enc.encode_lossless().to_vec();
    Ok(if lossless.len() < lossy.len() { lossless } else { lossy })
}

fn encode_webp(img: &DynamicImage, quality: f32) -> Result<Vec<u8>, String> {
    let enc = webp::Encoder::from_image(img).map_err(str::to_string)?;
    Ok(enc.encode(quality).to_vec())
}

// ---------- paleta e tom ----------

#[derive(Debug, Clone, Copy)]
struct Swatch {
    rgb: [u8; 3],
    /// Fração dos pixels.
    share: f64,
}

fn hex([r, g, b]: [u8; 3]) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// 5 cores dominantes por corte da mediana (determinístico: a mesma foto dá sempre a mesma paleta).
fn palette(img: &DynamicImage) -> Vec<Swatch> {
    let rgb = img.to_rgb8();
    // Até ~4 mil amostras bastam para a paleta.
    let step = ((rgb.width() as u64 * rgb.height() as u64) / 4096).max(1) as usize;
    let pixels: Vec<[u8; 3]> = rgb.pixels().step_by(step).map(|p| p.0).collect();
    let total = pixels.len().max(1) as f64;
    let mut boxes: Vec<Vec<[u8; 3]>> = vec![pixels];
    while boxes.len() < 5 {
        // Divide a caixa com a maior extensão de cor, na mediana do canal mais largo.
        let Some((i, ch, range)) = boxes
            .iter()
            .enumerate()
            .filter(|(_, b)| b.len() > 1)
            .map(|(i, b)| {
                let (ch, range) = widest(b);
                (i, ch, range)
            })
            .max_by_key(|&(_, _, r)| r)
        else {
            break;
        };
        if range == 0 {
            break;
        }
        let mut b = boxes.swap_remove(i);
        b.sort_unstable_by_key(|p| p[ch]);
        let upper = b.split_off(b.len() / 2);
        boxes.push(b);
        boxes.push(upper);
    }
    let mut out: Vec<Swatch> = boxes
        .iter()
        .filter(|b| !b.is_empty())
        .map(|b| {
            let n = b.len() as f64;
            let avg = |c: usize| (b.iter().map(|p| p[c] as f64).sum::<f64>() / n).round() as u8;
            Swatch { rgb: [avg(0), avg(1), avg(2)], share: n / total }
        })
        .collect();
    out.sort_by(|a, b| b.share.total_cmp(&a.share));
    // Imagem de pouquíssimas cores: completa repetindo, para a faixa ter sempre 5.
    while !out.is_empty() && out.len() < 5 {
        out.push(out[out.len() - 1]);
    }
    out
}

fn widest(b: &[[u8; 3]]) -> (usize, u8) {
    (0..3)
        .map(|c| {
            let (lo, hi) = b.iter().fold((255u8, 0u8), |(lo, hi), p| (lo.min(p[c]), hi.max(p[c])));
            (c, hi - lo)
        })
        .max_by_key(|&(_, r)| r)
        .unwrap_or((0, 0))
}

/// Matiz (0–360), saturação e luminosidade (0–1).
fn hsl([r, g, b]: [u8; 3]) -> (f64, f64, f64) {
    let (r, g, b) = (r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0);
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let l = (max + min) / 2.0;
    let d = max - min;
    if d < 1e-9 {
        return (0.0, 0.0, l);
    }
    let s = d / (1.0 - (2.0 * l - 1.0).abs());
    let h = if max == r {
        60.0 * (((g - b) / d) % 6.0)
    } else if max == g {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    ((h + 360.0) % 360.0, s, l)
}

/// Tom da foto pelas cores da paleta, pesadas pela presença. Pouca cor (cinzas, preto, branco) é neutro.
fn tone(palette: &[Swatch]) -> Tone {
    let mut w = [0.0f64; 5]; // quente, frio, verde, rosa, neutro
    let mut seen = std::collections::HashSet::new();
    for sw in palette.iter().filter(|s| seen.insert(s.rgb)) {
        let (h, s, l) = hsl(sw.rgb);
        let i = if s < 0.2 || !(0.1..=0.94).contains(&l) {
            4
        } else if (290.0..340.0).contains(&h) || (!(15.0..340.0).contains(&h) && l > 0.68) {
            3 // magentas e vermelhos claros
        } else if !(70.0..340.0).contains(&h) {
            0 // vermelhos, laranjas, amarelos
        } else if h < 165.0 {
            2
        } else {
            1 // cianos, azuis, violetas
        };
        // Cor viva pesa mais que cor apagada: um céu azul define a foto mais que o cinza do asfalto.
        w[i] += sw.share * if i == 4 { 1.0 } else { 0.5 + s };
    }
    let colored = w[..4].iter().sum::<f64>();
    if w[4] > colored * 1.5 {
        return Tone::Neutral;
    }
    let best = (0..4).max_by(|&a, &b| w[a].total_cmp(&w[b])).unwrap_or(4);
    [Tone::Warm, Tone::Cool, Tone::Green, Tone::Pink, Tone::Neutral][best]
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use image::{codecs::jpeg::JpegEncoder, ImageEncoder, Rgb, RgbImage, Rgba, RgbaImage};

    /// JPEG de câmera: ruído (para não comprimir a nada), e um EXIF com rotação 90° e localização (GPS).
    pub fn camera_jpeg(w: u32, h: u32, orientation: u16) -> Vec<u8> {
        let mut seed = 7u32;
        let img = RgbImage::from_fn(w, h, |x, y| {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
            let n = (seed >> 24) as u8 / 4;
            Rgb([(x * 255 / w) as u8 / 2 + n, (y * 255 / h) as u8 / 2 + n, 120u8.wrapping_add(n)])
        });
        let mut jpg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpg, 92).write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgb8).unwrap();
        // APP1 logo depois do SOI.
        let exif = exif_segment(orientation);
        let mut out = jpg[..2].to_vec();
        out.extend_from_slice(&[0xFF, 0xE1]);
        out.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        out.extend_from_slice(&exif);
        out.extend_from_slice(&jpg[2..]);
        out
    }

    /// "Exif\0\0" + TIFF (little endian): IFD0 com Orientation e o ponteiro do GPS; IFD do GPS com latitude "S".
    fn exif_segment(orientation: u16) -> Vec<u8> {
        let mut t = Vec::new();
        t.extend_from_slice(b"II*\0");
        t.extend_from_slice(&8u32.to_le_bytes());
        // IFD0 em 8: 2 entradas
        t.extend_from_slice(&2u16.to_le_bytes());
        // Orientation (0x0112), SHORT, 1
        t.extend_from_slice(&0x0112u16.to_le_bytes());
        t.extend_from_slice(&3u16.to_le_bytes());
        t.extend_from_slice(&1u32.to_le_bytes());
        t.extend_from_slice(&orientation.to_le_bytes());
        t.extend_from_slice(&[0, 0]);
        // GPSInfo (0x8825), LONG, 1 → offset 38
        t.extend_from_slice(&0x8825u16.to_le_bytes());
        t.extend_from_slice(&4u16.to_le_bytes());
        t.extend_from_slice(&1u32.to_le_bytes());
        t.extend_from_slice(&38u32.to_le_bytes());
        t.extend_from_slice(&0u32.to_le_bytes()); // sem próximo IFD
        // IFD do GPS em 38: GPSLatitudeRef (1), ASCII, 2, "S\0"
        t.extend_from_slice(&1u16.to_le_bytes());
        t.extend_from_slice(&1u16.to_le_bytes());
        t.extend_from_slice(&2u16.to_le_bytes());
        t.extend_from_slice(&2u32.to_le_bytes());
        t.extend_from_slice(b"S\0\0\0");
        t.extend_from_slice(&0u32.to_le_bytes());
        let mut seg = b"Exif\0\0".to_vec();
        seg.extend_from_slice(&t);
        seg
    }

    fn solid(rgb: [u8; 3]) -> Vec<u8> {
        let img = RgbImage::from_pixel(64, 48, Rgb(rgb));
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png).write_image(img.as_raw(), 64, 48, image::ExtendedColorType::Rgb8).unwrap();
        png
    }

    fn dims(webp: &[u8]) -> (u32, u32) {
        let i = image::load_from_memory(webp).unwrap();
        (i.width(), i.height())
    }

    #[test]
    fn big_photo_is_rotated_reduced_to_webp_and_loses_gps() {
        let jpg = camera_jpeg(1600, 1200, 6); // 6 = girar 90° no sentido horário
        let p = process(&jpg, "image/jpeg", Quality::Economy).unwrap();
        assert_eq!(p.mime, "image/webp");
        assert_eq!((p.width, p.height), (960, 1280), "em pé depois da rotação, lado maior 1280");
        assert_eq!(dims(&p.bytes), (960, 1280));
        assert!(p.bytes.len() < jpg.len() / 2, "{} → {}", jpg.len(), p.bytes.len());
        // Sem metadados: nada de EXIF nem do GPS no arquivo guardado.
        let has = |hay: &[u8], needle: &[u8]| hay.windows(needle.len()).any(|w| w == needle);
        assert!(has(&jpg, b"Exif") && !has(&p.bytes, b"Exif"));
        assert!(!has(&p.bytes, b"S\0\0\0"));
        // Miniatura em pé, lado maior 400.
        assert_eq!(dims(&p.thumb), (300, 400));
    }

    #[test]
    fn original_keeps_the_file_untouched_with_gps() {
        let jpg = camera_jpeg(800, 600, 6);
        let p = process(&jpg, "image/jpeg", Quality::Original).unwrap();
        assert_eq!(p.bytes, jpg, "byte a byte, metadados inclusos");
        assert_eq!(p.mime, "image/jpeg");
        assert_eq!((p.width, p.height), (600, 800), "dimensões já na orientação certa");
        assert_eq!(dims(&p.thumb), (300, 400));
        assert_eq!(p.palette.len(), 5);
    }

    #[test]
    fn small_images_are_never_enlarged() {
        let p = process(&solid([10, 120, 200]), "image/png", Quality::High).unwrap();
        assert_eq!((p.width, p.height), (64, 48));
        assert_eq!(dims(&p.thumb), (64, 48));
    }

    #[test]
    fn transparency_survives() {
        let img = RgbaImage::from_pixel(10, 10, Rgba([255, 0, 0, 0]));
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png).write_image(img.as_raw(), 10, 10, image::ExtendedColorType::Rgba8).unwrap();
        let p = process(&png, "image/png", Quality::Balanced).unwrap();
        assert!(image::load_from_memory(&p.bytes).unwrap().color().has_alpha());
    }

    #[test]
    fn tones() {
        let t = |rgb| process(&solid(rgb), "image/png", Quality::Balanced).unwrap().tone;
        assert_eq!(t([230, 120, 30]), Tone::Warm, "laranja");
        assert_eq!(t([200, 40, 40]), Tone::Warm, "vermelho");
        assert_eq!(t([40, 90, 200]), Tone::Cool, "azul");
        assert_eq!(t([50, 160, 70]), Tone::Green, "verde");
        assert_eq!(t([230, 120, 190]), Tone::Pink, "rosa");
        assert_eq!(t([128, 128, 130]), Tone::Neutral, "cinza");
        assert_eq!(t([250, 250, 250]), Tone::Neutral, "branco");
    }

    #[test]
    fn palette_has_five_colors_led_by_the_biggest_area() {
        // 3/4 azul, 1/4 laranja.
        let img = RgbImage::from_fn(80, 80, |x, _| if x < 60 { Rgb([30, 70, 200]) } else { Rgb([240, 140, 20]) });
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png).write_image(img.as_raw(), 80, 80, image::ExtendedColorType::Rgb8).unwrap();
        let p = process(&png, "image/png", Quality::Balanced).unwrap();
        assert_eq!(p.palette.len(), 5);
        assert_eq!(p.palette[0], "#1e46c8");
        assert!(p.palette.contains(&"#f08c14".to_string()));
        assert_eq!(p.tone, Tone::Cool);
    }

    #[test]
    fn flat_graphics_do_not_grow() {
        // Captura de tela: poucas cores, PNG pequeno. Com perda o WebP ficaria maior; sem perda, não.
        let img = RgbImage::from_fn(1200, 800, |x, y| if (x / 40 + y / 40) % 2 == 0 { Rgb([250, 250, 250]) } else { Rgb([30, 90, 200]) });
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png).write_image(img.as_raw(), 1200, 800, image::ExtendedColorType::Rgb8).unwrap();
        let p = process(&png, "image/png", Quality::Balanced).unwrap();
        assert!(p.bytes.len() <= png.len(), "{} → {}", png.len(), p.bytes.len());
        // e a cor continua a mesma (no máximo a variação mínima da compressão)
        let px = image::load_from_memory(&p.bytes).unwrap().to_rgb8().get_pixel(45, 5).0;
        assert!(px.iter().zip([30u8, 90, 200]).all(|(a, b)| a.abs_diff(b) <= 4), "{px:?}");
    }

    #[test]
    fn not_an_image_is_an_error() {
        assert!(process(b"%PDF-1.4 nada", "image/jpeg", Quality::Balanced).is_err());
        assert!(process(&[], "image/png", Quality::Balanced).is_err());
    }

    mod props {
        use super::super::*;
        use image::{Rgb, RgbImage};
        use proptest::prelude::*;

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(24))]
            #[test]
            fn any_size_fits_and_keeps_its_shape(w in 1u32..2600, h in 1u32..2600) {
                let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(w, h, Rgb([90, 30, 160])));
                let out = shrink(&img, 1280).unwrap();
                prop_assert!(out.width() <= 1280 && out.height() <= 1280);
                prop_assert!(out.width() >= 1 && out.height() >= 1);
                if w <= 1280 && h <= 1280 {
                    prop_assert_eq!((out.width(), out.height()), (w, h));
                } else {
                    // a proporção muda no máximo pelo arredondamento de 1 px
                    let (a, b) = (w as f64 / h as f64, out.width() as f64 / out.height() as f64);
                    let tol = 1.0 / out.width().min(out.height()) as f64 * a.max(1.0) + 1e-9;
                    prop_assert!((a - b).abs() <= tol * 2.0, "{}x{} → {}x{}", w, h, out.width(), out.height());
                }
            }
        }
    }
}

#[cfg(test)]
mod bench {
    /// `cargo test --release --lib media::bench -- --ignored --nocapture`: foto de celular (12 MP).
    #[test]
    #[ignore]
    fn photo_12mp() {
        let jpg = super::tests::camera_jpeg(4032, 3024, 6);
        for q in [super::Quality::Balanced, super::Quality::Original] {
            let t = std::time::Instant::now();
            let p = super::process(&jpg, "image/jpeg", q).unwrap();
            println!("{q:?}: {:.0} ms, {} KB → {} KB, {}x{}", t.elapsed().as_secs_f64() * 1e3, jpg.len() / 1024, p.bytes.len() / 1024, p.width, p.height);
        }
    }
}
