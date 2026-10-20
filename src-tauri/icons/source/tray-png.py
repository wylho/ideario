import os

from PIL import Image, ImageChops, ImageDraw
# Mesmo desenho de source/tray.svg (coordenadas do ícone 512, recorte 64..448), com supersampling: os três
# quadrados numa cor só, cada um separado do de trás por um vão (o de cima, aumentado, recorta o de trás).
SQUARES = [(96, 64, 178, 179, 32), (148, 149, 215, 215, 36), (238, 269, 178, 179, 32)]
GAP = 20
def render(color, size):
    k = 16; S = size * k; s = S / 384
    def box(x, y, w, h, grow=0):
        return [(x - grow - 64) * s, (y - grow - 64) * s, (x + w + grow - 64) * s - 1, (y + h + grow - 64) * s - 1]
    alpha = Image.new('L', (S, S), 0)
    for x, y, w, h, r in SQUARES:
        cut = Image.new('L', (S, S), 0)
        ImageDraw.Draw(cut).rounded_rectangle(box(x, y, w, h, GAP), radius=(r + GAP) * s, fill=255)
        alpha = ImageChops.subtract(alpha, cut)
        ImageDraw.Draw(alpha).rounded_rectangle(box(x, y, w, h), radius=r * s, fill=255)
    im = Image.new('RGBA', (S, S), color)
    im.putalpha(alpha)
    return im.resize((size, size), Image.LANCZOS)
# Rodar dentro de src-tauri/icons: python3 source/tray-png.py
render((0, 0, 0, 255), 64).save('tray-dark.png')
render((255, 255, 255, 255), 64).save('tray-light.png')
# Notificação do Android (ic_stat_ideario): o mesmo desenho, branco, 24 dp com 2 dp de margem; o sistema pinta.
RES = '../gen/android/app/src/main/res'
for density, k in [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]:
    n, inner = int(24 * k), int(20 * k)
    canvas = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    canvas.paste(render((255, 255, 255, 255), inner), ((n - inner) // 2, (n - inner) // 2))
    os.makedirs(f'{RES}/drawable-{density}', exist_ok=True)
    canvas.save(f'{RES}/drawable-{density}/ic_stat_ideario.png')
