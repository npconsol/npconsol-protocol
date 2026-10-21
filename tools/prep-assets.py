"""One-off asset prep. Reads brand/ and reference/ byte-level, writes src/assets/* and src/palette.json.
Run: python -I tools/prep-assets.py"""
import json, struct, numpy as np
from PIL import Image
from sklearn.cluster import KMeans

LOGO = 'brand/LOGO NPC PNG...png'
BANNER = 'reference/NPC.jpg.jpeg'
COVER = 'reference/SAMPUL  NPC JPG.jpg.jpeg'

raw = open(LOGO, 'rb').read()
w, h, bd, ct = struct.unpack('>IIBB', raw[16:26])
print('IHDR', w, h, 'bitdepth', bd, 'colortype', ct)
im = Image.open(LOGO).convert('RGBA')
a = np.array(im)
alpha = a[..., 3]
hist = np.bincount(alpha.ravel(), minlength=256)
print('alpha zero', hist[0], 'opaque', hist[255], 'partial', hist[1:255].sum())
black_clear = ((alpha == 0) & (a[..., :3].sum(-1) == 0)).sum()
print('pure-black fully transparent px', black_clear, '-> premultiplied resize required')

ys, xs = np.where(alpha > 8)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
side = int(max(x1 - x0, y1 - y0) * 1.06)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
crop = a[box[1]:box[3], box[0]:box[2]].astype(np.float64)

def premul_resize(arr, size):
    f = arr.copy()
    al = f[..., 3:4] / 255.0
    f[..., :3] = f[..., :3] * al
    chans = [Image.fromarray(f[..., i].astype(np.float32), mode='F').resize((size, size), Image.LANCZOS) for i in range(4)]
    o = np.stack([np.array(c) for c in chans], -1)
    al2 = np.clip(o[..., 3:4] / 255.0, 0, 1)
    rgb = np.where(al2 > 1e-4, o[..., :3] / np.maximum(al2, 1e-4), 0)
    return np.clip(np.concatenate([rgb, al2 * 255], -1), 0, 255).round().astype(np.uint8)

for s in (512, 192):
    Image.fromarray(premul_resize(crop, s), 'RGBA').save(f'src/assets/logo-{s}.png', optimize=True)
print('logo crop box', box)

def snap(img_path, hexes_hint=None):
    im2 = Image.open(img_path).convert('RGBA'); b = np.array(im2)
    return b

def pixel_of(path, rgb, opaque_only=False):
    b = np.array(Image.open(path).convert('RGBA'))
    m = (b[..., 0] == rgb[0]) & (b[..., 1] == rgb[1]) & (b[..., 2] == rgb[2])
    if opaque_only: m &= b[..., 3] == 255
    yy, xx = np.where(m)
    return int(xx[0]), int(yy[0])

def km_snap(path, k=6):
    b = np.array(Image.open(path).convert('RGBA'))
    op = b[b[..., 3] > 200][:, :3]
    s = op[np.random.RandomState(1).choice(len(op), min(60000, len(op)), replace=False)]
    km = KMeans(k, n_init=4, random_state=1).fit(s)
    cnt = np.bincount(km.labels_); out = []
    for i in np.argsort(-cnt):
        c = km.cluster_centers_[i]; d = ((op.astype(float) - c) ** 2).sum(1); j = d.argmin()
        out.append((tuple(int(v) for v in op[j]), round(100 * cnt[i] / len(s), 1)))
    return out

# tokens: (name, rgb, file) picked from k-means clusters of the assets, snapped to real pixels
picks = [
 ('bg',        (12, 8, 7),     BANNER),
 ('panel',     (20, 16, 13),   COVER),
 ('shadow',    (38, 18, 11),   BANNER),
 ('line',      (72, 44, 32),   COVER),
 ('deep',      (110, 43, 16),  BANNER),
 ('text',      (232, 232, 230),BANNER),
 ('muted',     (153, 152, 150),BANNER) ,
 ('orange',    (244, 90, 23),  LOGO),
 ('orange-soft',(242, 120, 63),LOGO),
 ('ember',     (232, 107, 49), BANNER),
 ('graphite',  (79, 79, 78),   LOGO),
 ('white',     (248, 247, 247),LOGO),
]
# 'muted' above: NPC.jpg.jpeg cluster 0.5% #999896 -> (153,152,150)
pal = []
for name, rgb, f in picks:
    try:
        x, y = pixel_of(f, rgb, opaque_only=(f == LOGO))
    except Exception:
        # nearest real pixel
        b = np.array(Image.open(f).convert('RGBA')); m = b[..., 3] > 250
        d = ((b[..., :3].astype(int) - np.array(rgb)) ** 2).sum(-1); d[~m] = 1 << 30
        yy, xx = np.unravel_index(d.argmin(), d.shape); x, y = int(xx), int(yy); rgb = tuple(int(v) for v in b[y, x, :3])
    pal.append({'token': name, 'hex': '#%02x%02x%02x' % rgb, 'file': f, 'x': x, 'y': y})
json.dump({'method': 'k-means (k=6, seed 1) on opaque pixels of each asset, centre snapped to nearest real pixel; x,y is that pixel',
           'palette': pal}, open('src/palette.json', 'w'), indent=2)
for p in pal: print(p)

# favicon traced from the 32x32 premultiplied pixel grid
g = premul_resize(crop, 32)
cols = {'o': (244, 90, 23), 's': (242, 120, 63), 'g': (79, 79, 78), 'w': (248, 247, 247)}
rows = []
for yy in range(32):
    row = []
    for xx in range(32):
        r, gg, bb, aa = [int(v) for v in g[yy, xx]]
        if aa < 110: row.append(None); continue
        k = min(cols, key=lambda c: sum((np.array(cols[c]) - np.array([r, gg, bb])) ** 2))
        row.append(k)
    rows.append(row)
hexof = {k: '#%02x%02x%02x' % v for k, v in cols.items()}
rects = []
for yy, row in enumerate(rows):
    xx = 0
    while xx < 32:
        k = row[xx]
        if k is None: xx += 1; continue
        e = xx
        while e + 1 < 32 and row[e + 1] == k: e += 1
        rects.append((xx, yy, e - xx + 1, k)); xx = e + 1
svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">']
for k in cols:
    rs = [r for r in rects if r[3] == k]
    if rs:
        d = ''.join('M%d %dh%dv1h-%dz' % (x, y, ww, ww) for x, y, ww, _ in rs)
        svg.append(f'<path fill="{hexof[k]}" d="{d}"/>')
svg.append('</svg>')
open('src/assets/favicon.svg', 'w').write('\n'.join(svg))
print('favicon rects', len(rects))
