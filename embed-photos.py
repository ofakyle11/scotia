#!/usr/bin/env python3
"""Embed the two photographs into for-mom.html as data URIs.

    python3 embed-photos.py seadoo.jpg deck.jpg

Photo one goes in the hero frame at the top of the card, photo two in the
family snapshot further down. The card must stay self-contained -- no external
image files -- so the bytes are inlined directly. Run it once; to start over,
restore the placeholders with `git checkout for-mom.html`.
"""

import base64
import mimetypes
import re
import sys
from pathlib import Path

CARD = Path(__file__).parent / "for-mom.html"
MAX_BYTES = 15_000_000  # the published page has to come in under 16 MB
ALTS = [
    "My mother and me on the Sea-Doo out on the lake",
    "The whole family together on the deck at the cottage",
]

# the placeholder block sitting in each frame, replaced in document order
PLACEHOLDER = re.compile(r'<div class="awaiting">.*?</div>\s*', re.DOTALL)


def downscale(data: bytes, max_width: int = 1800) -> bytes:
    """Shrink an oversized photo if Pillow happens to be installed."""
    try:
        import io

        from PIL import Image
    except ImportError:
        return data

    img = Image.open(io.BytesIO(data))
    if img.width <= max_width:
        return data
    height = round(img.height * max_width / img.width)
    img = img.convert("RGB").resize((max_width, height), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82, optimize=True, progressive=True)
    return buf.getvalue()


def data_uri(path: Path) -> str:
    if path.suffix.lower() in {".heic", ".heif"}:
        sys.exit(f"{path.name}: browsers can't display HEIC -- export it as JPEG first.")
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    data = downscale(path.read_bytes())
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def main(argv: list[str]) -> None:
    if len(argv) != 2:
        sys.exit(__doc__)

    photos = [Path(p) for p in argv]
    for photo in photos:
        if not photo.is_file():
            sys.exit(f"No such file: {photo}")

    html = CARD.read_text()
    if len(PLACEHOLDER.findall(html)) != 2:
        sys.exit("Expected two photo placeholders -- run `git checkout for-mom.html` first.")

    for photo, alt in zip(photos, ALTS):
        tag = f'<img src="{data_uri(photo)}" alt="{alt}" />\n      '
        html = PLACEHOLDER.sub(lambda _m, t=tag: t, html, count=1)

    size = len(html.encode())
    if size > MAX_BYTES:
        sys.exit(
            f"The card would be {size / 1e6:.1f} MB, over the 16 MB limit. "
            "Shrink the photos (or `pip install pillow` and re-run to downscale them)."
        )

    CARD.write_text(html)
    print(f"Embedded both photographs. for-mom.html is now {size / 1e6:.1f} MB.")


if __name__ == "__main__":
    main(sys.argv[1:])
