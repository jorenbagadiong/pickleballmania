"""Builds the players' GLB files from MakeHuman data (all CC0). See README.md."""
import glob
import os
import sys

import numpy as np
from PIL import Image, ImageChops, ImageFilter

from glb import Glb, join, make_part
from mh import Base, Clothes

CORE, SYS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
only = sys.argv[4:]

PEOPLE = {
    'm1': dict(gender='male', races={'caucasian': 1}, muscle=0.7, lean=0.4, tall=0.04,
               skin='young_caucasian_male', hair='short01', hair_tint=(1.9, 1.45, 1.1), brow='eyebrow008',
               eyes='brown', shoes='white'),
    'm2': dict(gender='male', races={'african': 1}, muscle=0.74, lean=0.45, tall=0.0,
               skin='young_african_male', hair='afro01', hair_tint=(1.0, 0.95, 0.9), brow='eyebrow001',
               eyes='brown', shoes='dark'),
    'm3': dict(gender='male', races={'asian': 1}, muscle=0.66, lean=0.45, tall=0.22,
               skin='young_asian_male', hair='short02', hair_tint=(0.45, 0.42, 0.4), brow='eyebrow008',
               eyes='brown', shoes='white'),
    'f1': dict(gender='female', races={'caucasian': 1}, muscle=0.62, lean=0.5, tall=0.1,
               skin='young_caucasian_female', hair='ponytail01', hair_tint=(1.25, 1.05, 0.8), brow='eyebrow010',
               eyes='blue', shoes='dark'),
    'f2': dict(gender='female', races={'african': 1}, muscle=0.64, lean=0.5, tall=0.1,
               skin='young_african_female', hair='braid01', hair_tint=(0.8, 0.75, 0.7), brow='eyebrow010',
               eyes='brown', shoes='white'),
    'f3': dict(gender='female', races={'asian': 1}, muscle=0.58, lean=0.5, tall=0.32,
               skin='young_asian_female', hair='ponytail01', hair_tint=(0.45, 0.4, 0.38), brow='eyebrow005',
               eyes='brown', shoes='dark'),
}


def find(pattern):
    hits = sorted(glob.glob(pattern))
    if not hits:
        raise SystemExit(f'missing {pattern}')
    return hits[0]


def rgb(path, size):
    return Image.open(path).convert('RGB').resize((size, size), Image.LANCZOS)


def rgba(path, size):
    """Resized with the color bled under the transparent parts, so edges don't go dark."""
    im = Image.open(path).convert('RGBA')
    a = im.getchannel('A')
    solid = Image.new('RGB', im.size)
    solid.paste(im.convert('RGB'), mask=a)
    small = solid.resize((size, size), Image.BOX)
    sa = a.resize((size, size), Image.BOX)
    arr, al = np.asarray(small).astype(float), np.asarray(sa).astype(float)[..., None] / 255
    col = np.where(al > 0.02, arr / np.maximum(al, 0.02), 0)
    known = (al[..., 0] > 0.6).astype(float)
    mean = (col * known[..., None]).sum((0, 1)) / max(1, known.sum())
    # Where little of the picture is solid its color can't be trusted.
    trust = np.clip((al - 0.25) / 0.5, 0, 1)
    out = np.minimum(col, mean * 2.2) * trust + mean * (1 - trust)
    return Image.merge('RGBA', [*Image.fromarray(np.clip(out, 0, 255).astype('uint8')).split(), sa])


def tinted(im, tint):
    bands = im.split()
    out = [b.point(lambda x, k=k: min(255, int(x * k))) for b, k in zip(bands[:3], tint)]
    return Image.merge(im.mode, [*out, *bands[3:]])


def calm(im):
    """Less saturated and a bit darker: eyes sit in shade."""
    a = np.asarray(im).astype(float)
    g = a.mean(-1, keepdims=True)
    return Image.fromarray(np.clip((g + (a - g) * 0.55) * 0.82, 0, 255).astype('uint8'))


def fabric(ao_path, size, low=0.5):
    """White cloth with its folds shaded; tinted by the material color in the game."""
    ao = Image.open(ao_path).convert('L').resize((size, size), Image.LANCZOS)
    a = np.asarray(ao).astype(float) / 255
    a = low + (1 - low) * np.clip((a - 0.25) / 0.75, 0, 1)
    # A fine knit, so it doesn't look like plastic up close.
    y, x = np.mgrid[0:size, 0:size]
    knit = 1 - 0.035 * (((x // 2 + y // 2) % 2) == 0) - 0.02 * np.random.default_rng(1).random((size, size))
    g = np.clip(a * knit * 255, 0, 255).astype('uint8')
    return Image.merge('RGB', [Image.fromarray(g)] * 3)


def plain_shoes(path, size, style):
    """Court shoes without the marks of the photographed pair, in plain colors."""
    im = rgb(path, 1024)
    patch = lambda box, src: im.paste(im.crop((src[0], src[1], src[0] + box[2] - box[0], src[1] + box[3] - box[1])), box)
    # Logo on the toe, and the label inside.
    patch((452, 806, 536, 868), (560, 800))
    patch((448, 384, 600, 500), (300, 300))
    a = np.asarray(im).astype(float)
    lum = a @ np.array([0.3, 0.59, 0.11]) / 255
    out = np.zeros_like(a)
    y, x = np.mgrid[0:1024, 0:1024]
    sole = (y < 290) & (x > 240)
    socks = (x > 780) & (y > 868)
    detail = np.clip(lum * 2.1, 0, 1)
    if style == 'white':
        upper, trim, under = np.array([238, 239, 242.0]), np.array([196, 200, 208.0]), np.array([120, 112, 100.0])
        shade = 0.42 + 0.58 * detail
    else:
        upper, trim, under = np.array([62, 66, 76.0]), np.array([225, 226, 230.0]), np.array([205, 196, 178.0])
        shade = 0.45 + 0.75 * detail
    pale = lum > 0.5  # piping and lining
    out[:] = upper * shade[..., None]
    out[pale] = (trim * (0.55 + 0.5 * lum[..., None]))[pale]
    out[sole] = (under * (0.5 + 0.9 * lum[..., None]))[sole]
    out[socks] = (np.array([244, 245, 247.0]) * (0.45 + 0.75 * lum[..., None]))[socks]
    return Image.fromarray(np.clip(out, 0, 255).astype('uint8')).resize((size, size), Image.LANCZOS)


def cut_shorts(pos, faces, base_v, leg_joint, knee):
    """Trousers to shorts: keeps what is above a hem over the knee, and lets the hem hang loose."""
    hem = knee[1] + 0.085
    keep = [f for f in faces if pos[f[1], 1].max() > hem - 0.004]
    used = sorted({i for _, vs, _ in keep for i in vs})
    out = pos.copy()
    top = leg_joint[1] - 0.06
    for i in used:
        y = out[i, 1]
        t = np.clip((top - y) / (top - hem), 0, 1.15)
        if t <= 0:
            continue
        # Away from the middle of the thigh, more toward the hem.
        side = np.sign(out[i, 0]) or 1
        k = np.clip((leg_joint[1] - y) / (leg_joint[1] - knee[1]), 0, 1)
        center = np.array([side * abs(leg_joint[0] + (knee[0] - leg_joint[0]) * k), 0,
                           leg_joint[2] + (knee[2] - leg_joint[2]) * k])
        d = out[i] - center
        d[1] = 0
        inner = side * d[0] < 0
        out[i, [0, 2]] += (d / max(np.linalg.norm(d), 1e-6))[[0, 2]] * t * (0.006 if inner else 0.02)
        out[i, 1] = max(y, hem)
    return out, keep, hem


def build(name, p, base):
    v = base.shape(p['gender'], p['races'], p['muscle'], p['lean'], 0.6, p['tall'])
    heads, tails = base.joints(v)
    H = dict(zip(base.bones, heads))
    parts, hidden = {}, set()

    shoes = Clothes(f'{SYS}/clothes/shoes06')
    sp, sw = shoes.fit(base, v)
    hidden |= shoes.deleted
    parts['shoes'] = (sp, sw, shoes.vt, shoes.faces)

    suit_name = 'male_casualsuit06' if p['gender'] == 'male' else 'female_casualsuit02'
    suit = Clothes(f'{SYS}/clothes/{suit_name}')
    cp, cw = suit.fit(base, v)
    comps = suit.components()
    height = lambda f: np.mean([cp[x[1], 1].mean() for x in f])
    waist = H['spine_01'][1] + 0.02
    top = [f for c in comps if height(c) > waist for f in c]
    bottom = [f for c in comps if height(c) <= waist for f in c]
    parts['shirt'] = (cp, cw, suit.vt, top)
    if p['gender'] == 'male':
        bp, bottom, hem = cut_shorts(cp, bottom, v, H['thigh_l'], H['calf_l'])
        legs = {i for i in suit.deleted if v[i, 1] < hem + 0.05}
        hidden |= suit.deleted - legs
        parts['shorts'] = (bp, cw, suit.vt, bottom)
    else:
        hidden |= suit.deleted
        parts['shorts'] = (cp, cw, suit.vt, bottom)

    # Skin well inside a sleeve or a leg of the shorts isn't drawn, so it can't show through.
    for garment, limb, end, inset in (('shirt', 'upperarm', 'lowerarm', 0.16), ('shorts', 'thigh', 'calf', 0.12)):
        gp, _, _, gf = parts[garment]
        used = sorted({i for f in gf for i in f[1]})
        for s in 'lr':
            a, b = H[f'{limb}_{s}'], H[f'{end}_{s}']
            d = (b - a) / ((b - a) @ (b - a))
            along = lambda q: (q - a) @ d
            off = lambda q: np.linalg.norm(q - a - along(q)[:, None] * (b - a), axis=1)
            g_near = gp[used][off(gp[used]) < (0.13 if limb == 'upperarm' else 0.2)]
            t = along(g_near)
            edge = np.percentile(t[t < 1.1], 99) - inset
            inside = (along(v) < edge) & (along(v) > 0.02) & (off(v) < (0.11 if limb == 'upperarm' else 0.17))
            inside &= np.sign(v[:, 0]) == np.sign(a[0])
            hidden |= set(np.nonzero(inside)[0].tolist())

    body = [f for f in base.faces if f[0] == 'body' and not all(i in hidden for i in f[1])]
    parts['skin'] = (v, base.weights, base.vt, body)

    eyes = Clothes(f'{SYS}/eyes/low-poly')
    ep, ew = eyes.fit(base, v)
    parts['eyes'] = (ep, ew, eyes.vt, eyes.faces)

    # Hair, brows and lashes share one picture: hair on the left half…
    atlas = Image.new('RGBA', (1536, 1024), (40, 30, 25, 0))
    hairy = []
    for kind, box in (('hair', (0, 0, 1024, 1024)), ('eyebrows', (1024, 0, 512, 512)), ('eyelashes', (1024, 512, 512, 512))):
        item = {'hair': p['hair'], 'eyebrows': p['brow'], 'eyelashes': 'eyelashes01'}[kind]
        folder = f'{SYS}/{kind}/{item}'
        c = Clothes(folder)
        hp, hw = c.fit(base, v)
        tex = [l.split()[1] for l in open(f'{folder}/{item}.mhmat') if l.startswith('diffuseTexture')][0]
        im = rgba(f'{folder}/{os.path.basename(tex)}', box[2])
        if kind == 'hair':
            im = tinted(im, p['hair_tint'])
            a = np.asarray(im).astype(float)
            solid = a[..., 3] > 200
            tone = a[solid][:, :3].mean(0)
            # Closes pinholes between the strands.
            im.putalpha(im.getchannel('A').filter(ImageFilter.MaxFilter(5)))
        elif kind == 'eyebrows':
            # The color of the hair, and thinner than the picture.
            al = im.getchannel('A').point(lambda x: int(x * 0.62))
            im = Image.merge('RGBA', [Image.new('L', im.size, int(c * 0.75)) for c in tone] + [al])
        atlas.paste(im, box[:2])
        uv = c.vt.copy()
        uv[:, 0] = (box[0] + (uv[:, 0] % 1.0001) * box[2]) / 1536
        uv[:, 1] = 1 - (box[1] + (1 - uv[:, 1] % 1.0001) * box[3]) / 1024
        hairy.append(make_part(hp, hw, uv, c.faces))

    # Stand on the ground.
    ground = min(sp[:, 1].min(), v[[i for f in body for i in f[1]], 1].min())
    shift = np.array([0, -ground, 0])

    g = Glb()
    parents = base.parents()
    first, _ = g.skeleton(base.bones, parents, heads + shift)
    skin = g.skin(first, base.bones, heads + shift)

    skin_tex = [l.split()[1] for l in open(f'{SYS}/skins/{p["skin"]}/{p["skin"]}.mhmat') if l.startswith('diffuseTexture')][0]
    ao = find(f'{SYS}/clothes/{suit_name}/*_ao.png')
    normal_path = f'{SYS}/clothes/{suit_name}/{suit_name}_normal.png'
    normal = g.image(rgb(normal_path, 1024), 88) if os.path.exists(normal_path) else None
    cloth = g.image(fabric(ao, 1024), 86)
    shoe_tex = g.image(plain_shoes(find(f'{SYS}/clothes/shoes06/*_diffuse.png'), 512, p['shoes']), 88)
    eye_tex = g.image(calm(rgb(f'{SYS}/eyes/materials/{p["eyes"]}_eye.png', 256)), 92)
    mats = {
        'skin': g.material('skin', g.image(rgb(f'{SYS}/skins/{p["skin"]}/{os.path.basename(skin_tex)}', 1024), 88), rough=0.62),
        'shirt': g.material('shirt', cloth, normal, 0.86, double=True),
        'shorts': g.material('shorts', cloth, normal, 0.8, (0.03, 0.045, 0.075), double=True),
        'shoes': g.material('shoes', shoe_tex, rough=0.6),
        'eyes': g.material('eyes', eye_tex, rough=0.18),
        'hair': g.material('hair', g.image(atlas, 90), rough=0.55, mask=0.3, double=True),
    }
    tris = 0
    for key, (pos, w, vt, faces) in parts.items():
        part = make_part(pos, w, vt, faces)
        part['pos'] = part['pos'] + shift
        tris += len(part['tri'])
        g.mesh(key, part, mats[key], skin)
    hair = join(hairy)
    hair['pos'] = hair['pos'] + shift
    tris += len(hair['tri'])
    g.mesh('hair', hair, mats['hair'], skin)
    path = f'{OUT}/{name}.glb'
    g.save(path)
    print(name, 'height %.2f m' % (v[:, 1].max() - ground), tris, 'triangles', os.path.getsize(path) // 1024, 'KB', flush=True)


if __name__ == '__main__':
    base = Base(CORE)
    os.makedirs(OUT, exist_ok=True)
    for name, p in PEOPLE.items():
        if not only or name in only:
            build(name, p, base)
