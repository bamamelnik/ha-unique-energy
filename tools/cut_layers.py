"""Cuts the layers of the card out of aligned variants of one image.

Usage:  python -I tools/cut_layers.py sources/lowpoly dist/lowpoly

Expects four edits of the same picture in the source folder (same size, same
camera): low-poly_full.jpg (everything), low-poly_base.jpg (no optional
components), low-poly_no_cars.jpg (full without cars), low-poly_one_car.jpg
(full without the front car).

Each layer is cut from the image pair in which it is not covered: difference
> 30 inside a rectangle, holes filled, noise dropped. Result: PNG with alpha at
full image size, aligned with the base image.
"""
import shutil
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, out = sys.argv[1], sys.argv[2]


def load(name):
    return np.asarray(Image.open(f"{src}/{name}").convert("RGB")).astype(np.int16)


full = load("low-poly_full.jpg")
base = load("low-poly_base.jpg")
no_cars = load("low-poly_no_cars.jpg")
one_car = load("low-poly_one_car.jpg")
H, W = full.shape[:2]

# name: (image with the component, image without, rectangle x0,y0,x1,y1, seed point)
LAYERS = {
    "pv-roof":    (full, base, (478, 88, 808, 318), (640, 200)),
    "pv-balcony": (full, base, (678, 232, 850, 352), (765, 300)),
    "heat-pump":  (full, base, (378, 362, 472, 452), None),
    "battery":    (full, base, (493, 362, 562, 492), None),
    "barn":       (no_cars, base, (1012, 212, 1362, 520), None),
    "wallbox":    (no_cars, base, (828, 410, 896, 512), (855, 460)),
    "car-2":      (one_car, no_cars, (890, 430, 1180, 620), (1010, 495)),
    "car-1":      (full, one_car, (725, 485, 1020, 650), (850, 570)),
}


def mask(with_, without, box, seed):
    x0, y0, x1, y1 = box
    diff = np.abs(with_ - without).max(axis=2) > 30
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = diff[y0:y1, x0:x1]
    m = ndi.binary_closing(m, structure=np.ones((5, 5)), iterations=2)
    m = ndi.binary_fill_holes(m)
    lab, n = ndi.label(m)
    if seed:
        keep = [lab[seed[1], seed[0]]]
    else:
        sizes = ndi.sum(m, lab, range(1, n + 1))
        keep = [i + 1 for i, s in enumerate(sizes) if s >= 150]
    m = np.isin(lab, keep)
    m[:y0], m[y1:], m[:, :x0], m[:, x1:] = False, False, False, False
    return ndi.binary_dilation(m, iterations=1)


# Nothing on the balcony is green: foliage of the tree touching the railing post is dropped
NO_GREEN = {"pv-balcony"}

for name, (with_, without, box, seed) in LAYERS.items():
    m = mask(with_, without, box, seed)
    if name in NO_GREEN:
        r, g, b = with_[..., 0], with_[..., 1], with_[..., 2]
        m &= ~((g > r + 12) & (g > b + 12))
    rgb = np.where(m[..., None], with_, 0).astype(np.uint8)
    Image.fromarray(np.dstack([rgb, (m * 255).astype(np.uint8)]), "RGBA").save(
        f"{out}/{name}.png", optimize=True)
    print(f"{name:12s} {int(m.sum()):6d} px")

# The base image needs no transparency: copy the original instead of re-encoding it
shutil.copyfile(f"{src}/low-poly_base.jpg", f"{out}/base.jpg")
print("base.jpg     copied")
