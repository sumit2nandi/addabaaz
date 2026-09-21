"""Regenerate small UI copies of the original logo (requires Pillow).
The original artwork is never overwritten. Run from the repository root.
"""
from pathlib import Path
from PIL import Image

source = Path('images/addabaaz-logo.png')
with Image.open(source) as image:
    logo = image.convert('RGB')
    logo.thumbnail((480, 480), Image.Resampling.LANCZOS)
    logo.save('images/addabaaz-logo-small.webp', 'WEBP', quality=85, method=6)
    icon = image.convert('RGBA')
    icon.thumbnail((180, 180), Image.Resampling.LANCZOS)
    icon.save('images/addabaaz-icon.png', optimize=True)
for name in ['addabaaz-logo-small.webp', 'addabaaz-icon.png']:
    path = Path('images') / name
    print(f'{path}: {path.stat().st_size:,} bytes')
