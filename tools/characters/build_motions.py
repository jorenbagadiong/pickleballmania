"""Builds motions.glb: the captured movements, on the game skeleton. See README.md."""
import json
import sys

import numpy as np

from bvh import Bvh
from glb import Glb
from mh import Base
from motions import BONES, FPS, Clip, Retarget, best_loop

CORE, CMU, OUT = sys.argv[1:4]
base = Base(CORE)
# Fitted to an average athlete; bone names and rest pose are the same for everyone.
v = base.shape('male', {'caucasian': 1}, 0.7, 0.45, 0.6, 0.1)
heads, _ = base.joints(v)
H = dict(zip(base.bones, heads))
rt = Retarget(H)
g = Glb()
first, _ = g.skeleton(base.bones, base.parents(), heads)
node = {b: first + i for i, b in enumerate(base.bones)}
g.j['animations'] = []
info = {}


def add(name, clip, loop):
    n = len(clip)
    times = np.arange(n + (1 if loop else 0), dtype='float32') / FPS
    close = (lambda a: np.concatenate([a, a[:1]])) if loop else (lambda a: a)
    t = g.accessor(times, 'SCALAR', bounds=True)
    anim = {'name': name, 'samplers': [], 'channels': []}

    def channel(bone, path, data, kind):
        anim['samplers'].append({'input': t, 'output': g.accessor(data.astype('float32'), kind)})
        anim['channels'].append({'sampler': len(anim['samplers']) - 1, 'target': {'node': node[bone], 'path': path}})

    for bone in BONES:
        channel(bone, 'rotation', close(clip.q[bone]), 'VEC4')
    channel('pelvis', 'translation', close(clip.pelvis + H['pelvis']), 'VEC3')
    g.j['animations'].append(anim)
    info[name] = {'seconds': round(float(times[-1]), 3), 'loop': loop,
                  # Meters per second the feet cover: +x is the body's left, +z forward.
                  'velocity': [round(float(x), 3) for x in clip.velocity]}
    print(name, info[name], flush=True)


def foot_phase(clip):
    """Frame where the left foot lands furthest forward (or out, for a shuffle)."""
    rot = {}
    # Forward kinematics of the left leg, from local rotations.
    from motions import PARENT

    def mat(q):
        x, y, z, w = np.moveaxis(q, -1, 0)
        return np.moveaxis(np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]), -1, 0)

    for bone in BONES:
        p = PARENT.get(bone)
        m = mat(clip.q[bone])
        rot[bone] = m if p is None else rot[p] @ m
    l, r = rt.feet(rot, clip.pelvis + H['pelvis'])
    way = np.array([clip.velocity[0], 0, clip.velocity[1]])
    way /= max(np.linalg.norm(way), 1e-6)
    return int(np.argmax((l - r) @ way))


def cycle(name, file, lo, hi, shortest, longest, mirrored=None, heading=None):
    b = Bvh(f'{CMU}/{file}.bvh')
    d, i, e = best_loop(b, lo, hi, shortest, longest)
    clip = Clip(rt, b, i, e + 1, heading).in_place().loop()
    clip.roll(foot_phase(clip))
    print(f'  {file} {i}-{e} mismatch {d:.3f}')
    add(name, clip, True)
    if mirrored:
        m = clip.mirror()
        m.roll(foot_phase(m))
        add(mirrored, m, True)


def once(name, file, lo, hi, mirrored=None):
    b = Bvh(f'{CMU}/{file}.bvh')
    clip = Clip(rt, b, lo, min(hi, b.frames)).in_place().smooth()
    add(name, clip, False)
    if mirrored:
        add(mirrored, clip.mirror(), False)


# Relaxed, and the low stance of someone about to move.
cycle('idle', '104_57', 322, 385, 46, 62)
cycle('ready', '102_24', 225, 285, 36, 56)
cycle('walk', '35_01', 1, 400, 110, 160)
cycle('jog', '16_35', 1, 163, 80, 110)
cycle('run', '09_01', 1, 149, 70, 110)
cycle('sprint', '143_01', 1, 101, 60, 96)
cycle('walkBack', '143_39', 250, 480, 90, 190)
cycle('backpedal', '141_31', 60, 260, 70, 130)
# Sideways: a step, and the low shuffle of a basketball defender.
cycle('sideLeft', '141_33', 740, 860, 60, 84, 'sideRight')
cycle('shuffleRight', '102_26', 225, 285, 40, 60, 'shuffleLeft')
cycle('fastShuffleRight', '102_27', 70, 140, 46, 66, 'fastShuffleLeft')
once('victory', '143_25', 60, 330)
once('dejected', '141_27', 200, 556)
g.j['nodes'][0]['extras'] = {}
g.save(f'{OUT}/motions.glb')
json.dump(info, open(f'{OUT}/motions.json', 'w'), indent=1)
