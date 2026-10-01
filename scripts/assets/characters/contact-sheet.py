"""Labeled private roster and motion review pages from native gallery captures."""
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
root = Path(sys.argv[1])
manifest = json.loads((root / 'captures.json').read_text())
try:
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 16)
except OSError:
    font = ImageFont.load_default()
for family in sorted({row['family'] for row in manifest['captures']}):
    rows = [row for row in manifest['captures'] if row['family'] == family]
    slug = family.lower().replace(' ', '-')
    for page in range(math.ceil(len(rows) / 24)):
        group = rows[page * 24:(page + 1) * 24]
        sheet = Image.new('RGB', (1200, 44 + math.ceil(len(group) / 6) * 320), '#151c23')
        draw = ImageDraw.Draw(sheet)
        draw.text((15, 12), f'{family} — {page + 1} — {len(rows)} characters', font=font, fill='#e8edf1')
        for index, row in enumerate(group):
            x, y = (index % 6) * 200, 44 + (index // 6) * 320
            with Image.open(row['image']) as source:
                image = ImageOps.contain(source.convert('RGB'), (196, 270))
                sheet.paste(image, (x + (200 - image.width) // 2, y))
            words = row['name'].split(); lines = ['']
            for word in words:
                if draw.textlength(lines[-1] + ' ' + word, font=font) > 190: lines.append(word)
                else: lines[-1] = (lines[-1] + ' ' + word).strip()
            draw.text((x + 5, y + 272), '\n'.join(lines[:2]), font=font, fill='#e8edf1')
        sheet.save(root / f'roster-{slug}-{page + 1}.jpg', quality=90)
    # Compact representative frames for every available motion; no animation assertion from a still.
    motion_rows = [(row, role, file) for row in rows for role, file in row['motions'].items()]
    for page in range(math.ceil(len(motion_rows) / 24)):
        group = motion_rows[page * 24:(page + 1) * 24]
        sheet = Image.new('RGB', (1200, 44 + math.ceil(len(group) / 6) * 290), '#151c23'); draw = ImageDraw.Draw(sheet)
        draw.text((15, 12), f'{family} — motion review {page + 1}', font=font, fill='white')
        for index, (row, role, file) in enumerate(group):
            x, y = index % 6 * 200, 44 + index // 6 * 290
            with Image.open(file) as source:
                image = ImageOps.contain(source.convert('RGB'), (196, 240)); sheet.paste(image, (x, y))
            label = row['name']
            while draw.textlength(label, font=font) > 190: label = label[:-1]
            draw.text((x + 4, y + 242), label + '\n' + role, font=font, fill='white')
        sheet.save(root / f'motions-{slug}-{page + 1}.jpg', quality=90)
print(f'Contact sheets saved under {root}')
