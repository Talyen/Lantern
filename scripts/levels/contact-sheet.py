"""Local private captures only; Pillow is already used by Lantern asset tooling."""
import sys
import json
from pathlib import Path
from PIL import Image, ImageDraw
folder = Path(sys.argv[1])
files = [folder / ('view-' + name + '.png') for name in ['entrance','center','exit','review-1','review-2','overview']]
metadata = json.loads((folder/'manifest.json').read_text())
header = 32 if metadata['status'] == 'incomplete' else 0
sheet = Image.new('RGB', (960, ((len(files)+1)//2)*294 + header), '#172326')
draw = ImageDraw.Draw(sheet)
if header:
    draw.text((8, 8), ('INCOMPLETE ART: ' + ', '.join(metadata['missing']))[:140], fill='#ffb0a0')
for i, file in enumerate(files):
    image = Image.open(file).convert('RGB'); image.thumbnail((480,270))
    x,y=(i%2)*480,(i//2)*294+header
    sheet.paste(image,(x,y));draw.text((x+8,y+273),file.stem,fill='white')
sheet.save(folder/'contact-sheet.png')
