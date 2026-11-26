"""Motion capture onto the game skeleton: short loops and one-shots, in place, with their speed."""
import numpy as np

from bvh import Bvh

MAP = {
    'pelvis': 'Hips', 'spine_01': 'LowerBack', 'spine_02': 'Spine', 'spine_03': 'Spine1',
    'neck_01': 'Neck', 'head': 'Head',
    **{f'{a}_{s}': f'{"Left" if s == "l" else "Right"}{b}' for s in 'lr' for a, b in (
        ('clavicle', 'Shoulder'), ('upperarm', 'Arm'), ('lowerarm', 'ForeArm'), ('hand', 'Hand'),
        ('thigh', 'UpLeg'), ('calf', 'Leg'), ('foot', 'Foot'), ('ball', 'ToeBase'))},
}
CHILD = {'upperarm': 'lowerarm', 'lowerarm': 'hand', 'thigh': 'calf', 'calf': 'foot'}
BONES = list(MAP)
FPS = 30


def q_from_m(m):
    """Rotation matrices (n x 3 x 3) to quaternions (x, y, z, w)."""
    q = np.zeros((len(m), 4))
    for i, a in enumerate(m):
        t = np.trace(a)
        if t > 0:
            s = np.sqrt(t + 1) * 2
            q[i] = [(a[2, 1] - a[1, 2]) / s, (a[0, 2] - a[2, 0]) / s, (a[1, 0] - a[0, 1]) / s, s / 4]
        else:
            k = int(np.argmax(np.diag(a)))
            u, w = (k + 1) % 3, (k + 2) % 3
            s = np.sqrt(max(1e-12, 1 + a[k, k] - a[u, u] - a[w, w])) * 2
            q[i, k] = s / 4
            q[i, u] = (a[u, k] + a[k, u]) / s
            q[i, w] = (a[w, k] + a[k, w]) / s
            q[i, 3] = (a[w, u] - a[u, w]) / s
    for i in range(1, len(q)):
        if q[i] @ q[i - 1] < 0:
            q[i] *= -1
    return q


def between(a, b):
    """Shortest rotation taking direction a to direction b."""
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    v, c = np.cross(a, b), a @ b
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k / (1 + c)


class Retarget:
    def __init__(self, heads):
        """heads: joint positions (by name) of the character the motions are fitted to."""
        self.h = heads
        self.leg = np.linalg.norm(heads['calf_l'] - heads['thigh_l']) + np.linalg.norm(
            heads['foot_l'] - heads['calf_l'])

    def world(self, b, start, end):
        """World rotations per bone and pelvis positions for frames of a capture, 30 fps."""
        step = max(1, round(1 / FPS / b.dt))
        frames = np.arange(start, end, step)
        fix = {}
        for bone in BONES:
            base, side = bone[:-2], bone[-1]
            if base in CHILD:
                child = f'{CHILD[base]}_{side}'
                fix[bone] = between(self.h[child] - self.h[bone],
                                    b.P[0, b.index(MAP[child])] - b.P[0, b.index(MAP[bone])])
            else:
                fix[bone] = np.eye(3)
        for s in 'lr':
            fix[f'hand_{s}'] = fix[f'lowerarm_{s}']
        rot = {}
        for bone in BONES:
            j = b.index(MAP[bone])
            rot[bone] = b.R[frames, j] @ b.R[0, j].T @ fix[bone]
        src = np.linalg.norm(b.P[0, b.index('LeftLeg')] - b.P[0, b.index('LeftUpLeg')]) + np.linalg.norm(
            b.P[0, b.index('LeftFoot')] - b.P[0, b.index('LeftLeg')])
        k = self.leg / src
        return rot, b.P[frames, 0] * k

    def feet(self, rot, pelvis):
        """Ankle positions."""
        out = []
        for s in 'lr':
            p = pelvis + np.einsum('fij,j->fi', rot['pelvis'], self.h[f'thigh_{s}'] - self.h['pelvis'])
            p = p + np.einsum('fij,j->fi', rot[f'thigh_{s}'], self.h[f'calf_{s}'] - self.h[f'thigh_{s}'])
            p = p + np.einsum('fij,j->fi', rot[f'calf_{s}'], self.h[f'foot_{s}'] - self.h[f'calf_{s}'])
            out.append(p)
        return out


# ---------------------------------------------------------------------- clips

def qmul(a, b):
    ax, ay, az, aw = np.moveaxis(a, -1, 0)
    bx, by, bz, bw = np.moveaxis(b, -1, 0)
    return np.stack([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], -1)


def slerp(a, b, t):
    """Blend of quaternions (normalized lerp, good for the small steps used here)."""
    s = np.sign((a * b).sum(-1, keepdims=True))
    s[s == 0] = 1
    q = a * (1 - t) + b * s * t
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


PARENT = {'spine_01': 'pelvis', 'spine_02': 'spine_01', 'spine_03': 'spine_02', 'neck_01': 'spine_03', 'head': 'neck_01'}
for _s in 'lr':
    PARENT.update({f'clavicle_{_s}': 'spine_03', f'upperarm_{_s}': f'clavicle_{_s}', f'lowerarm_{_s}': f'upperarm_{_s}',
                   f'hand_{_s}': f'lowerarm_{_s}', f'thigh_{_s}': 'pelvis', f'calf_{_s}': f'thigh_{_s}',
                   f'foot_{_s}': f'calf_{_s}', f'ball_{_s}': f'foot_{_s}'})


def yaw_matrix(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def level_foot(rot, side, ankle):
    """Captured feet are tilted by a constant (marker placement): flat when standing on them."""
    speed = np.linalg.norm(np.gradient(ankle, axis=0), axis=1) if len(ankle) > 2 else np.zeros(len(ankle))
    score = ankle[:, 1] - ankle[:, 1].min() + speed * 2
    planted = score <= np.percentile(score, 20)
    f = rot[f'foot_{side}'][:, :, 2]
    pitch = np.median(np.arcsin(np.clip(f[planted, 1], -1, 1)))
    c, s = np.cos(pitch), np.sin(pitch)
    # Around the foot's own sideways axis, so that its forward axis loses the pitch.
    fix = np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    for bone in (f'foot_{side}', f'ball_{side}'):
        rot[bone] = rot[bone] @ fix


class Clip:
    """Local rotations per bone (frames x 4), pelvis positions, and how fast the motion travels."""

    def __init__(self, rt, b, start, end, heading=None):
        rot, pel = rt.world(b, start, end)
        step = max(1, round(1 / FPS / b.dt))
        # Turned so that the body faces +z (its average heading, or a given one).
        face = np.unwrap(b.facing())[np.arange(start, end, step)]
        turn = yaw_matrix(-(np.mean(face) if heading is None else heading))
        rot = {k: turn @ m for k, m in rot.items()}
        pel = pel @ turn.T
        self.rt = rt
        seconds = (len(pel) - 1) / FPS
        self.velocity = (pel[-1] - pel[0])[[0, 2]] / seconds
        left, right = rt.feet(rot, pel)
        # The lower ankle, at its lowest, is on the ground.
        ground = np.percentile(np.minimum(left[:, 1], right[:, 1]), 8) - rt.h['foot_l'][1]
        self.pelvis = pel.copy()
        self.pelvis[:, 1] -= ground + rt.h['pelvis'][1] - 0
        self.pelvis[:, 1] += 0
        for s, ankle in (('l', left), ('r', right)):
            level_foot(rot, s, ankle)
        self.q = {}
        for bone in BONES:
            p = PARENT.get(bone)
            local = rot[bone] if p is None else np.swapaxes(rot[p], 1, 2) @ rot[bone]
            self.q[bone] = q_from_m(local)

    def __len__(self):
        return len(self.pelvis)

    def in_place(self):
        """Takes the travel out, leaving sway and bounce. Positions become offsets from the rest pose."""
        n = len(self)
        t = np.linspace(0, 1, n)[:, None]
        d = self.pelvis[-1] - self.pelvis[0]
        self.pelvis = self.pelvis - t * np.array([d[0], 0, d[2]])
        m = self.pelvis.mean(0)
        self.pelvis[:, 0] -= m[0]
        self.pelvis[:, 2] -= m[2]
        return self

    def loop(self):
        """Makes the last frame lead smoothly into the first (and drops it)."""
        n = len(self)
        t = np.linspace(0, 1, n)[:, None]
        for k, q in self.q.items():
            # Spread the gap between the ends over the whole cycle.
            inv = q[-1] * np.array([-1, -1, -1, 1])
            gap = qmul(q[0], inv)
            if gap[3] < 0:
                gap = -gap
            self.q[k] = qmul(slerp(np.repeat([[0, 0, 0, 1.0]], n, 0), np.repeat([gap], n, 0), t), q)[:-1]
        self.pelvis = (self.pelvis + t * (self.pelvis[0] - self.pelvis[-1]))[:-1]
        return self

    def roll(self, k):
        self.q = {b: np.roll(q, -k, 0) for b, q in self.q.items()}
        self.pelvis = np.roll(self.pelvis, -k, 0)
        return self

    def mirror(self):
        swap = lambda b: b[:-1] + ('r' if b.endswith('_l') else 'l') if b[-2:] in ('_l', '_r') else b
        out = object.__new__(Clip)
        out.rt = self.rt
        out.q = {swap(b): q * np.array([1, -1, -1, 1]) for b, q in self.q.items()}
        out.pelvis = self.pelvis * np.array([-1, 1, 1])
        out.velocity = self.velocity * np.array([-1, 1])
        return out

    def smooth(self, k=1):
        for _ in range(k):
            for b, q in self.q.items():
                p = q.copy()
                p[1:-1] = slerp(slerp(q[:-2], q[2:], 0.5), q[1:-1], 0.5)
                self.q[b] = p
        return self


def best_loop(b, lo, hi, shortest, longest):
    """Frames (start, end) of a capture between lo and hi that join best."""
    names = [n for n in ('LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftArm',
                         'RightArm', 'LeftForeArm', 'RightForeArm', 'Spine1')]
    j = [b.index(n) for n in names]
    face = np.unwrap(b.facing())
    local = b.P[:, j] - b.P[:, :1]
    c, s = np.cos(-face)[:, None], np.sin(-face)[:, None]
    flat = np.stack([c * local[..., 0] + s * local[..., 2], local[..., 1], -s * local[..., 0] + c * local[..., 2]], -1)
    vel = np.gradient(flat, axis=0) / b.dt
    hi = min(hi, b.frames - 1)
    best = None
    for i in range(lo, hi - shortest, 2):
        for e in range(i + shortest, min(i + longest, hi), 2):
            d = np.linalg.norm(flat[i] - flat[e], axis=1).mean() + 0.04 * np.linalg.norm(vel[i] - vel[e], axis=1).mean()
            d += 0.1 * abs(face[i] - face[e])
            if best is None or d < best[0]:
                best = (d, i, e)
    return best
