"""MakeHuman data (CC0): the human base mesh, body shapes, skeleton and clothes."""
import json
import os
import re

import numpy as np

UNIT = 0.1  # MakeHuman works in decimeters


def load_obj(path):
    """Vertices, uvs, and faces as (group, [vertex], [uv])."""
    v, vt, faces, group = [], [], [], ''
    for line in open(path, encoding='utf8', errors='replace'):
        t = line.split()
        if not t:
            continue
        if t[0] == 'v':
            v.append([float(x) for x in t[1:4]])
        elif t[0] == 'vt':
            vt.append([float(x) for x in t[1:3]])
        elif t[0] == 'g':
            group = t[1] if len(t) > 1 else ''
        elif t[0] == 'f':
            idx = [p.split('/') for p in t[1:]]
            faces.append((
                group,
                [int(p[0]) - 1 for p in idx],
                [int(p[1]) - 1 if len(p) > 1 and p[1] else 0 for p in idx],
            ))
    return np.array(v), np.array(vt), faces


class Base:
    """The base mesh with its skin weights; shaped into one person by `shape`."""

    def __init__(self, core):
        self.core = core
        self.v0, self.vt, self.faces = load_obj(f'{core}/base.obj')
        self.cubes = {}
        for g, vs, _ in self.faces:
            if g.startswith('joint-'):
                self.cubes.setdefault(g, set()).update(vs)
        self.rig = json.load(open(f'{core}/rig.game_engine.json'))
        # Parents before children.
        self.bones = []

        def add(name):
            if name in self.bones or name == 'Root':
                return
            p = self.rig[name]['parent']
            if p:
                add(p)
            self.bones.append(name)

        for name in self.rig:
            add(name)
        w = json.load(open(f'{core}/weights.game_engine.json'))['weights']
        self.weights = np.zeros((len(self.v0), len(self.bones)))
        for b, name in enumerate(self.bones):
            for i, x in w.get(name, []):
                self.weights[i, b] = x
        # Vertices only the (dropped) root moved follow the pelvis.
        none = self.weights.sum(1) < 1e-6
        self.weights[none, self.bones.index('pelvis')] = 1
        self.weights /= self.weights.sum(1, keepdims=True)

    def target(self, name):
        out = np.zeros_like(self.v0)
        for line in open(f'{self.core}/t/{name}.target'):
            if line.startswith('#') or not line.strip():
                continue
            i, x, y, z = line.split()
            out[int(i)] = [float(x), float(y), float(z)]
        return out

    def shape(self, gender, races, muscle=0.7, lean=0.2, ideal=0.5, tall=0.0, extra=()):
        """Vertices (meters) of a young adult. muscle and tall: 0 average … 1 most."""
        v = self.v0.copy()
        for race, k in races.items():
            v += self.target(f'{race}-{gender}-young') * k
        m = muscle
        for mus, km in (('averagemuscle', 1 - m), ('maxmuscle', m)):
            for wei, kw in (('averageweight', 1 - lean), ('minweight', lean)):
                if km * kw > 0:
                    v += self.target(f'universal-{gender}-young-{mus}-{wei}') * km * kw
            if km * ideal > 0:
                v += self.target(f'prop-{gender}-young-{mus}-averageweight-idealproportions') * km * ideal
        if tall > 0:
            v += self.target(f'height-{gender}-young-averagemuscle-averageweight-maxheight') * tall
        for name, k in extra:
            v += self.target(name) * k
        return v * UNIT

    def point(self, v, spec):
        if spec['strategy'] == 'CUBE':
            return v[sorted(self.cubes[spec['cube_name']])].mean(0)
        if spec['strategy'] == 'MEAN':
            return v[spec['vertex_indices']].mean(0)
        return v[spec['vertex_index']]

    def joints(self, v):
        """Head and tail of every bone."""
        head = np.array([self.point(v, self.rig[b]['head']) for b in self.bones])
        tail = np.array([self.point(v, self.rig[b]['tail']) for b in self.bones])
        return head, tail

    def parents(self):
        return [self.bones.index(self.rig[b]['parent']) if self.rig[b]['parent'] in self.bones else -1
                for b in self.bones]


class Clothes:
    """Something worn: every vertex hangs on a triangle of the base mesh."""

    def __init__(self, folder, name=None):
        name = name or os.path.basename(folder)
        path = f'{folder}/{name}.mhclo'
        self.folder = folder
        self.scales, self.rows, self.deleted, mode = {}, [], set(), ''
        obj = f'{name}.obj'
        for line in open(path, encoding='utf8', errors='replace'):
            t = line.split()
            if not t or t[0].startswith('#'):
                continue
            if t[0] == 'obj_file':
                obj = t[1]
            elif t[0] in ('x_scale', 'y_scale', 'z_scale'):
                self.scales[t[0][0]] = (int(t[1]), int(t[2]), float(t[3]))
            elif t[0] == 'verts':
                mode = 'verts'
            elif t[0] == 'weights':
                mode = 'weights'
            elif t[0] == 'delete_verts':
                mode = 'delete'
            elif mode == 'verts' and re.match(r'^\d+$', t[0]):
                self.rows.append([float(x) for x in t])
            elif mode == 'delete':
                for part in re.findall(r'(\d+)\s*(?:-\s*(\d+))?', line):
                    a = int(part[0])
                    b = int(part[1]) if part[1] else a
                    self.deleted.update(range(a, b + 1))
        self.vo, self.vt, self.faces = load_obj(f'{folder}/{obj}')
        assert len(self.rows) == len(self.vo), (name, len(self.rows), len(self.vo))

    def fit(self, base, v):
        """Positions and skin weights on a body with vertices v (meters)."""
        s = np.ones(3)
        for k, axis in enumerate('xyz'):
            if axis in self.scales:
                a, b, d = self.scales[axis]
                s[k] = abs(v[a, k] - v[b, k]) / (d * UNIT)
        pos = np.zeros((len(self.rows), 3))
        wts = np.zeros((len(self.rows), base.weights.shape[1]))
        for i, r in enumerate(self.rows):
            if len(r) < 9:
                j = int(r[0])
                pos[i], wts[i] = v[j], base.weights[j]
                continue
            tri = [int(x) for x in r[:3]]
            w = np.array(r[3:6])
            pos[i] = w @ v[tri] + np.array(r[6:9]) * UNIT * s
            k = np.clip(w, 0, None)
            wts[i] = (k / k.sum()) @ base.weights[tri]
        return pos, wts

    def components(self):
        """Faces split into connected pieces (a shirt and trousers, two shoes…)."""
        parent = list(range(len(self.vo)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for _, vs, _ in self.faces:
            for b in vs[1:]:
                parent[find(vs[0])] = find(b)
        groups = {}
        for f in self.faces:
            groups.setdefault(find(f[1][0]), []).append(f)
        return sorted(groups.values(), key=len, reverse=True)
