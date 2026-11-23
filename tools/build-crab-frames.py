# /// script
# dependencies = ["pillow"]
# ///
"""Turn pixel-art animations into the header crab's acts.

    uv run build-crab-frames.py OUT_DIR ACT=SOURCE [ACT=SOURCE ...]

Each SOURCE is an animated GIF, a folder of PNGs (played in name order), or a
comma-separated list of PNGs. Frames are written as OUT_DIR/ACT/00.png, 01.png
and so on. ACT may end in "@MS", the milliseconds each frame stays up
("spin@250"). Frame 00 of the first act by name is the pose Claudio stands in
while idle. Everything already in OUT_DIR is replaced.

All sprites must share one canvas size, and all are cropped to one common box,
so the character stays in place within an act and between acts.

The header draws the picture in COLUMNS x ROWS terminal cells, which must match
CRAB in mod/hooks/register.tsx. Frames are made for a 7x16 px cell at twice the
size: in a taller cell, such as 7x18, the width is what limits the picture, so
both give the same exact scale. The sprite is enlarged by an even whole factor,
so it lands on whole pixels on a normal screen and on a Retina one. With another
font, change CELL to your terminal's.
"""

import shutil
import sys
from pathlib import Path

from PIL import Image, ImageSequence

COLUMNS, ROWS = 13, 5
CELL = (7, 16)
DENSITY = 2


def load(source: str) -> list[Image.Image]:
    path = Path(source)
    if path.is_dir():
        files = sorted(path.glob("*.png"))
    elif path.suffix.lower() == ".gif":
        with Image.open(path) as gif:
            return [f.convert("RGBA") for f in ImageSequence.Iterator(gif)]
    else:
        files = [Path(p) for p in source.split(",")]
    if not files:
        sys.exit(f"no PNGs in {source}")
    return [Image.open(f).convert("RGBA") for f in files]


out = Path(sys.argv[1])
acts = {}
for argument in sys.argv[2:]:
    name, _, source = argument.partition("=")
    if not name or not source:
        sys.exit(f"expected ACT=SOURCE, got {argument!r}")
    acts[name] = load(source)
if not acts:
    sys.exit("no acts given")

sprites = [s for frames in acts.values() for s in frames]
if len({s.size for s in sprites}) != 1:
    sys.exit(f"sprites differ in canvas size: {sorted({s.size for s in sprites})}")
boxes = [b for s in sprites if (b := s.getbbox())]
if not boxes:
    sys.exit("every sprite is fully transparent")
box = (
    min(b[0] for b in boxes),
    min(b[1] for b in boxes),
    max(b[2] for b in boxes),
    max(b[3] for b in boxes),
)
w, h = box[2] - box[0], box[3] - box[1]
canvas = (COLUMNS * CELL[0] * DENSITY, ROWS * CELL[1] * DENSITY)
scale = min(canvas[0] // w, canvas[1] // h) // DENSITY * DENSITY
if scale == 0:
    sys.exit(f"the drawing is {w}x{h} px; {COLUMNS}x{ROWS} cells hold {canvas[0] // DENSITY}x{canvas[1] // DENSITY}")

if out.exists():
    shutil.rmtree(out)
size = (w * scale, h * scale)
# Even offsets, for the same reason as the even factor.
at = tuple((c - s) // 2 // DENSITY * DENSITY for c, s in zip(canvas, size))
for name, frames in acts.items():
    (out / name).mkdir(parents=True)
    for index, sprite in enumerate(frames):
        frame = Image.new("RGBA", canvas, (0, 0, 0, 0))
        frame.alpha_composite(sprite.crop(box).resize(size, Image.NEAREST), at)
        frame.save(out / name / f"{index:02}.png")
    print(f"{name}: {len(frames)} frames")
print(f"drawing {w}x{h} px, enlarged {scale // DENSITY}x on a normal screen")
