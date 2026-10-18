"""Ícones "antigos" do Android (ic_launcher e ic_launcher_round, usados no Android 7 e em launchers sem ícone
adaptativo), feitos a partir do ícone adaptativo: frente sobre fundo, o recorte dos 72 dp do meio e a forma. O
`tauri icon` gera esses dois ampliados e cortados; rode isto depois dele:

    npx tauri icon src-tauri/icons/source/icon-manifest.json && python3 src-tauri/icons/source/android-legacy.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

RES = Path(__file__).resolve().parents[2] / "gen/android/app/src/main/res"

src = RES / "mipmap-xxxhdpi"
fg = Image.open(src / "ic_launcher_foreground.png").convert("RGBA")
bg = Image.open(src / "ic_launcher_background.png").convert("RGBA").resize(fg.size)
full = Image.alpha_composite(bg, fg)
w = full.size[0]
c = w * 72 // 108
o = (w - c) // 2
visible = full.crop((o, o, o + c, o + c))

for density in ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]:
    folder = RES / f"mipmap-{density}"
    n = Image.open(folder / "ic_launcher.png").size[0]
    big = n * 4  # desenha grande e reduz: borda sem serrilhado
    pad = big * 4 // 48
    inner = visible.resize((big - 2 * pad, big - 2 * pad), Image.LANCZOS)
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    canvas.paste(inner, (pad, pad))
    for name, shape in [("ic_launcher", "rounded"), ("ic_launcher_round", "circle")]:
        mask = Image.new("L", (big, big), 0)
        draw = ImageDraw.Draw(mask)
        box = (pad, pad, big - pad - 1, big - pad - 1)
        if shape == "circle":
            draw.ellipse(box, fill=255)
        else:
            draw.rounded_rectangle(box, radius=(big - 2 * pad) // 5, fill=255)
        out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        out.paste(canvas, (0, 0), mask)
        out.resize((n, n), Image.LANCZOS).save(folder / f"{name}.png")
