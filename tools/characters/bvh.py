"""Reads motion-capture BVH files (CMU set, MotionBuilder-friendly release)."""
import numpy as np

# CMU units to meters.
SCALE = 2.54 / (0.45 * 100)


def rot(axis, deg):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    z, o = np.zeros_like(c), np.ones_like(c)
    if axis == 'X':
        m = [[o, z, z], [z, c, -s], [z, s, c]]
    elif axis == 'Y':
        m = [[c, z, s], [z, o, z], [-s, z, c]]
    else:
        m = [[c, -s, z], [s, c, z], [z, z, o]]
    return np.moveaxis(np.array(m), -1, 0)  # frames x 3 x 3


class Bvh:
    """World rotations (frames x joints x 3 x 3) and positions (meters) of every joint."""

    def __init__(self, path):
        lines = open(path).read().split('\n')
        self.names, self.parent, offsets, channels = [], [], [], []
        stack, i, end_site = [], 0, False
        self.ends = {}
        while not lines[i].startswith('MOTION'):
            t = lines[i].split()
            if t and t[0] in ('ROOT', 'JOINT'):
                self.names.append(t[1])
                self.parent.append(stack[-1] if stack else -1)
                offsets.append([0, 0, 0])
                channels.append([])
                current = len(self.names) - 1
            elif t and t[0] == 'End':
                end_site = True
            elif t and t[0] == '{':
                stack.append(-2 if end_site else current)
            elif t and t[0] == '}':
                if stack.pop() == -2:
                    end_site = False
            elif t and t[0] == 'OFFSET':
                v = [float(x) for x in t[1:4]]
                if end_site:
                    self.ends[self.names[current]] = np.array(v) * SCALE
                else:
                    offsets[current] = v
            elif t and t[0] == 'CHANNELS':
                channels[current] = t[2:]
            i += 1
        frames = int(lines[i + 1].split()[1])
        self.dt = float(lines[i + 2].split()[2])
        data = np.array([[float(x) for x in l.split()] for l in lines[i + 3:i + 3 + frames]])
        self.offsets = np.array(offsets) * SCALE
        n = len(self.names)
        self.R = np.zeros((frames, n, 3, 3))
        self.P = np.zeros((frames, n, 3))
        c = 0
        for j in range(n):
            local = np.repeat(np.eye(3)[None], frames, 0)
            pos = np.repeat(self.offsets[j][None], frames, 0)
            for ch in channels[j]:
                v = data[:, c]
                c += 1
                if ch.endswith('position'):
                    if j == 0:
                        pos = pos.copy()
                        pos[:, 'XYZ'.index(ch[0])] = v * SCALE
                else:
                    local = local @ rot(ch[0], v)
            p = self.parent[j]
            if p < 0:
                self.R[:, j], self.P[:, j] = local, pos
            else:
                self.R[:, j] = self.R[:, p] @ local
                self.P[:, j] = self.P[:, p] + np.einsum('fij,fj->fi', self.R[:, p], pos)
        self.frames = frames

    def index(self, name):
        return self.names.index(name)

    def facing(self):
        """Heading of the pelvis over time (radians; 0 = +z, positive toward +x)."""
        l, r = self.P[:, self.index('LeftUpLeg')], self.P[:, self.index('RightUpLeg')]
        across = l - r
        fwd = np.cross(across, np.array([0, 1.0, 0]))
        return np.arctan2(fwd[:, 0], fwd[:, 2])
