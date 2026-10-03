"""Create identical lossless crops for the private FSR review page."""
import argparse
import json
from pathlib import Path
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--boxes', type=Path, required=True, help='JSON object of named [left, top, right, bottom] rectangles')
    args = parser.parse_args()
    boxes = json.loads(args.boxes.read_text())
    if not isinstance(boxes, dict) or set(boxes) != {'foliage', 'weapon', 'ground'}:
        raise ValueError('Provide exactly foliage, weapon and ground crop rectangles')
    for preset in ('baseline', 'sharpness-0', 'sharpness-1', 'foliage-motion', 'reactive-coverage', 'mip-minus-half', 'mip-minus-one'):
        for frame in ('still', 'frame-240', 'frame-330', 'frame-479'):
            path = args.directory / preset / f'{frame}.png'
            with Image.open(path) as image:
                if image.size != (1920, 1080):
                    raise ValueError(f'Unexpected image dimensions: {path}')
                if max(high for low, high in image.convert('RGB').getextrema()) < 2:
                    raise ValueError(f'Empty canvas capture; rerun this take: {path}')
                for name, box in boxes.items():
                    if len(box) != 4 or not all(isinstance(value, int) for value in box):
                        raise ValueError('Crop rectangles must contain four integers')
                    if not (0 <= box[0] < box[2] <= 1920 and 0 <= box[1] < box[3] <= 1080):
                        raise ValueError('Crop rectangle is outside the image')
                    image.crop(box).save(path.with_name(f'{frame}-{name}.png'))
    print(f'Created matched crops in {args.directory}')


if __name__ == '__main__':
    main()
