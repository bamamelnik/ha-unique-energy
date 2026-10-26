"""Draws the flow paths and label anchors of a layout onto the full image.

Usage:  python -I tools/path_preview.py dist/ha-unique-energy.js sources/lowpoly/low-poly_full.jpg preview.png [layout]

Reads the JSON block between /*LAYOUT-START*/ and /*LAYOUT-END*/ from the card,
so preview and card never drift apart. Supports M, L, Q, C.
"""
import json
import re
import sys

from PIL import Image, ImageDraw

js, image, target = sys.argv[1], sys.argv[2], sys.argv[3]
name = sys.argv[4] if len(sys.argv) > 4 else "lowpoly"
text = open(js, encoding="utf-8").read()
block = text.split("/*LAYOUT-START*/")[1].split("/*LAYOUT-END*/")[0]
layout = json.loads(block)[name]


def points(d):
    tok = re.findall(r"[MLQC]|-?\d+(?:\.\d+)?", d)
    out, cur, i = [], None, 0
    while i < len(tok):
        cmd = tok[i]
        i += 1
        n = {"M": 2, "L": 2, "Q": 4, "C": 6}[cmd]
        v = [float(x) for x in tok[i:i + n]]
        i += n
        if cmd in "ML":
            cur = (v[0], v[1])
            out.append(cur)
            continue
        p = [cur] + [(v[k], v[k + 1]) for k in range(0, n, 2)]
        for s in range(1, 41):
            t = s / 40
            if cmd == "Q":
                x = (1 - t) ** 2 * p[0][0] + 2 * (1 - t) * t * p[1][0] + t * t * p[2][0]
                y = (1 - t) ** 2 * p[0][1] + 2 * (1 - t) * t * p[1][1] + t * t * p[2][1]
            else:
                x = sum(c * q[0] for c, q in zip([(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3], p))
                y = sum(c * q[1] for c, q in zip([(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3], p))
            out.append((x, y))
        cur = p[-1]
    return out


im = Image.open(image).convert("RGB")
dr = ImageDraw.Draw(im)
for key, c in layout["components"].items():
    pts = points(c["path"])
    dr.line(pts, fill=(229, 72, 77), width=4)
    dr.ellipse([pts[0][0] - 5, pts[0][1] - 5, pts[0][0] + 5, pts[0][1] + 5], fill=(47, 140, 255))
    x, y = c["label"]
    dr.rectangle([x - 40, y - 14, x + 40, y + 14], outline=(0, 0, 0), width=2)
    dr.text((x - 36, y - 6), key, fill=(0, 0, 0))
x, y = layout["home_label"]
dr.rectangle([x - 40, y - 14, x + 40, y + 14], outline=(0, 0, 0), width=2)
dr.text((x - 36, y - 6), "home", fill=(0, 0, 0))
im.save(target)
