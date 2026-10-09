import sys
from PIL import Image, ImageDraw
# Mesmo desenho de source/tray.svg (coordenadas do ícone 512, recorte 128..384), com supersampling.
RECTS = [(128,128,112,112),(272,128,112,40),(272,200,112,40),(128,272,256,40),(128,344,256,40)]
def render(color, size, out):
    k = 16; S = size * k; s = S / 256
    im = Image.new('RGBA', (S, S), (0,0,0,0)); d = ImageDraw.Draw(im)
    for x,y,w,h in RECTS:
        d.rounded_rectangle([(x-128)*s, (y-128)*s, (x-128+w)*s-1, (y-128+h)*s-1], radius=20*s, fill=color)
    im.resize((size,size), Image.LANCZOS).save(out)
# Rodar dentro de src-tauri/icons: python3 source/tray-png.py
render((0,0,0,255), 64, 'tray-dark.png')
render((255,255,255,255), 64, 'tray-light.png')
