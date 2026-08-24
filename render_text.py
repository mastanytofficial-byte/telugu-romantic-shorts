import sys
from PIL import Image, ImageDraw, ImageFont

text_path, out_path = sys.argv[1], sys.argv[2]
W, H = 1080, 1920
BOX_X, BOX_Y, BOX_W, BOX_H = 55, 650, 970, 620
PAD_X = 60
FONT_PATH = '/usr/share/fonts/truetype/teluguvijayam/ramabhadra.ttf'
FONT_SIZE = 46
LINE_GAP = 18

with open(text_path, 'r', encoding='utf-8') as f:
    text = f.read().strip()

font = ImageFont.truetype(FONT_PATH, FONT_SIZE, layout_engine=ImageFont.Layout.RAQM)
img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

max_line_w = BOX_W - 2 * PAD_X
words = text.split()
lines = []
line = ''
for w in words:
    candidate = f'{line} {w}'.strip()
    if line and draw.textlength(candidate, font=font) > max_line_w:
        lines.append(line)
        line = w
    else:
        line = candidate
if line:
    lines.append(line)

line_height = font.getbbox('అఆఇఈఉ')[3] + LINE_GAP
block_h = line_height * len(lines)
y = BOX_Y + (BOX_H - block_h) / 2

draw.rectangle([BOX_X, BOX_Y, BOX_X + BOX_W, BOX_Y + BOX_H], fill=(0, 0, 0, 66))

for ln in lines:
    w = draw.textlength(ln, font=font)
    x = (W - w) / 2
    draw.text((x + 2, y + 3), ln, font=font, fill=(0, 0, 0, 230))
    draw.text((x, y), ln, font=font, fill=(255, 255, 255, 255))
    y += line_height

img.save(out_path)
