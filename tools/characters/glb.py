"""Writes skinned characters and motions as binary glTF."""
import io
import json
import struct

import numpy as np


class Glb:
    def __init__(self):
        self.j = {'asset': {'version': '2.0', 'generator': 'pickleball character tools'}, 'scene': 0,
                  'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [], 'accessors': [], 'bufferViews': [],
                  'materials': [], 'textures': [], 'images': [], 'samplers': [{'magFilter': 9729, 'minFilter': 9987}]}
        self.bin = bytearray()

    def view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.bin += data
        self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def accessor(self, a, kind, target=None, bounds=False, normalized=False):
        types = {np.dtype('float32'): 5126, np.dtype('uint16'): 5123, np.dtype('uint32'): 5125,
                 np.dtype('uint8'): 5121, np.dtype('int16'): 5122, np.dtype('int8'): 5120}
        acc = {'bufferView': self.view(a.tobytes(), target), 'componentType': types[a.dtype],
               'count': len(a), 'type': kind}
        if normalized:
            acc['normalized'] = True
        if bounds:
            acc['min'], acc['max'] = np.atleast_1d(a.min(0)).tolist(), np.atleast_1d(a.max(0)).tolist()
        self.j['accessors'].append(acc)
        return len(self.j['accessors']) - 1

    def image(self, im, quality=84, lossless=False):
        """Adds a PIL image as a WebP texture."""
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=quality, method=6, lossless=lossless, exact=True)
        self.j['images'].append({'mimeType': 'image/webp', 'bufferView': self.view(buf.getvalue())})
        self.j['textures'].append({'sampler': 0, 'extensions': {
            'EXT_texture_webp': {'source': len(self.j['images']) - 1}}})
        for k in ('extensionsUsed', 'extensionsRequired'):
            self.j.setdefault(k, [])
            if 'EXT_texture_webp' not in self.j[k]:
                self.j[k].append('EXT_texture_webp')
        return len(self.j['textures']) - 1

    def material(self, name, texture=None, normal=None, rough=0.8, color=(1, 1, 1), mask=None, double=False):
        m = {'name': name, 'pbrMetallicRoughness': {
            'baseColorFactor': [*color, 1], 'metallicFactor': 0, 'roughnessFactor': rough}}
        if texture is not None:
            m['pbrMetallicRoughness']['baseColorTexture'] = {'index': texture}
        if normal is not None:
            m['normalTexture'] = {'index': normal}
        if mask is not None:
            m['alphaMode'], m['alphaCutoff'] = 'MASK', mask
        if double:
            m['doubleSided'] = True
        self.j['materials'].append(m)
        return len(self.j['materials']) - 1

    def skeleton(self, names, parents, heads):
        first = len(self.j['nodes'])
        for i, n in enumerate(names):
            p = heads[i] - (heads[parents[i]] if parents[i] >= 0 else 0)
            self.j['nodes'].append({'name': n, 'translation': p.tolist()})
        for i, p in enumerate(parents):
            if p >= 0:
                self.j['nodes'][first + p].setdefault('children', []).append(first + i)
        roots = [first + i for i, p in enumerate(parents) if p < 0]
        self.j['scenes'][0]['nodes'] += roots
        return first, roots

    def skin(self, first, names, heads):
        m = np.repeat(np.eye(4, dtype='float32')[None], len(names), 0)
        m[:, 3, :3] = -heads  # column-major: translation is the last row
        self.j['skins'] = [{'joints': [first + i for i in range(len(names))],
                            'inverseBindMatrices': self.accessor(m.astype('float32').reshape(-1, 16), 'MAT4')}]
        return 0

    def mesh(self, name, part, material, skin=None):
        attrs = {'POSITION': self.accessor(part['pos'].astype('float32'), 'VEC3', 34962, bounds=True),
                 'NORMAL': self.accessor(part['nor'].astype('float32'), 'VEC3', 34962),
                 'TEXCOORD_0': self.accessor(part['uv'].astype('float32'), 'VEC2', 34962)}
        if skin is not None:
            attrs['JOINTS_0'] = self.accessor(part['joints'].astype('uint8'), 'VEC4', 34962)
            attrs['WEIGHTS_0'] = self.accessor(part['weights'].astype('float32'), 'VEC4', 34962)
        idx = part['tri'].astype('uint16' if len(part['pos']) < 65535 else 'uint32').reshape(-1)
        self.j['meshes'].append({'name': name, 'primitives': [{
            'attributes': attrs, 'indices': self.accessor(idx, 'SCALAR', 34963), 'material': material}]})
        node = {'name': name, 'mesh': len(self.j['meshes']) - 1}
        if skin is not None:
            node['skin'] = skin
        self.j['nodes'].append(node)
        self.j['scenes'][0]['nodes'].append(len(self.j['nodes']) - 1)

    def save(self, path):
        for k in ('materials', 'textures', 'images', 'meshes'):
            if not self.j[k]:
                del self.j[k]
        while len(self.bin) % 4:
            self.bin.append(0)
        self.j['buffers'] = [{'byteLength': len(self.bin)}]
        js = json.dumps(self.j, separators=(',', ':')).encode()
        js += b' ' * (-len(js) % 4)
        with open(path, 'wb') as f:
            f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(self.bin)))
            f.write(struct.pack('<I4s', len(js), b'JSON') + js)
            f.write(struct.pack('<I4s', len(self.bin), b'BIN\0') + bytes(self.bin))


def make_part(pos, weights, vt, faces, flip_v=True):
    """Indexed triangles with smooth normals; corners sharing vertex and uv are shared."""
    # Normals are smooth over the original vertices, also across uv seams.
    tris = []
    for _, vs, ts in faces:
        for k in range(1, len(vs) - 1):
            tris.append(((vs[0], ts[0]), (vs[k], ts[k]), (vs[k + 1], ts[k + 1])))
    vi = np.array([[c[0] for c in t] for t in tris])
    n = np.zeros_like(pos)
    fn = np.cross(pos[vi[:, 1]] - pos[vi[:, 0]], pos[vi[:, 2]] - pos[vi[:, 0]])
    for k in range(3):
        np.add.at(n, vi[:, k], fn)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    key, out, order = {}, [], []
    for t in tris:
        row = []
        for c in t:
            if c not in key:
                key[c] = len(order)
                order.append(c)
            row.append(key[c])
        out.append(row)
    v = np.array([c[0] for c in order])
    uv = np.array([vt[c[1]] for c in order])
    if flip_v:
        uv = np.stack([uv[:, 0], 1 - uv[:, 1]], 1)
    top = np.argsort(-weights[v], axis=1)[:, :4]
    w = np.take_along_axis(weights[v], top, 1)
    w /= w.sum(1, keepdims=True)
    return {'pos': pos[v], 'nor': n[v], 'uv': uv, 'tri': np.array(out), 'joints': top, 'weights': w}


def join(parts):
    out, base = {}, 0
    for k in ('pos', 'nor', 'uv', 'joints', 'weights'):
        out[k] = np.concatenate([p[k] for p in parts])
    tri = []
    for p in parts:
        tri.append(p['tri'] + base)
        base += len(p['pos'])
    out['tri'] = np.concatenate(tri)
    return out
