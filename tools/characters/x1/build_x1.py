"""
Builds the secret athlete's model, x1.vrm, from a CC0 VRoid sample, headless:

    blender -b --python-exit-code 1 --python tools/characters/x1/build_x1.py -- \
        --base <05-sakurada-fumiriya.vrm> --out apps/client/public/models/private/x1.vrm

Needs Blender 4.2 LTS with the VRM add-on (extensions.blender.org "vrm", MIT / GPL-3.0).
See README.md in this folder for the sources, licences and what each step does.

Coordinates here are Blender's after the VRM import: +x is the character's left, -y is
the way he faces, +z is up, metres, standing at the origin in the T-pose.
"""

import argparse
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector

# ---------------------------------------------------------------- palette (sRGB)

ROYAL = "#2456B8"
WHITE = "#F4F6FA"
NAVY = "#142747"
SILVER = "#A9B4C2"
HAIR = "#52382B"
GUNMETAL = "#444B55"
GUM = "#C9A27A"
LENS = "#CFE3F0"


def srgb(hex_: str) -> np.ndarray:
    return np.array([int(hex_[i : i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)


def to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear(hex_: str) -> tuple[float, float, float]:
    return tuple(float(v) for v in to_linear(srgb(hex_)))


# ---------------------------------------------------------------- setup


def args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--base", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--stage", default="full", choices=["convert", "full"])
    p.add_argument("--textures", default="private-assets/tezuka/textures")
    p.add_argument("--debug-dir", default="")
    p.add_argument("--textures-out", default="private-assets/tezuka/textures/generated")
    return p.parse_args(argv)


def fail(msg: str) -> None:
    raise SystemExit(f"build_x1: {msg}")


def log(msg: str) -> None:
    print(f"build_x1: {msg}", flush=True)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_base(path: str) -> bpy.types.Object:
    if bpy.ops.import_scene.vrm(filepath=path) != {"FINISHED"}:
        fail(f"could not import {path}")
    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if len(armatures) != 1:
        fail(f"expected one armature, found {len(armatures)}")
    return armatures[0]


def material(name_part: str) -> bpy.types.Material:
    for m in bpy.data.materials:
        if name_part in m.name and not m.name.startswith("MToon Outline"):
            return m
    fail(f"no material like {name_part}")


def slot_indices(obj: bpy.types.Object, name_part: str) -> list[int]:
    return [i for i, s in enumerate(obj.material_slots) if s.material and name_part in s.material.name]


def mtoon(mat: bpy.types.Material):
    return mat.vrm_addon_extension.mtoon1


def image_of(mat: bpy.types.Material) -> bpy.types.Image:
    img = mtoon(mat).pbr_metallic_roughness.base_color_texture.index.source
    if img is None:
        fail(f"{mat.name} has no base texture")
    return img


def pixels(img: bpy.types.Image) -> np.ndarray:
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def set_pixels(img: bpy.types.Image, a: np.ndarray) -> None:
    img.pixels.foreach_set(a.astype(np.float32).ravel())
    img.update()
    img.pack()


# ---------------------------------------------------------------- VRM 1.0


def to_vrm1(arm: bpy.types.Object) -> None:
    """Carries the VRM 0.x spring bones and expressions over to VRM 1.0 and sets the metadata."""
    ext = arm.data.vrm_addon_extension
    for op in (bpy.ops.vrm.assign_spring_bone1_from_vrm0, bpy.ops.vrm.assign_vrm1_expressions_from_vrm0):
        if op(armature_object_name=arm.name) != {"FINISHED"}:
            fail(f"{op.idname()} failed")
    meta = ext.vrm1.meta
    meta.vrm_name = "Captain (private)"
    while len(meta.authors) > 0:
        meta.authors.remove(0)
    meta.authors.add().value = "PickleballMania (private build)"
    meta.copyright_information = (
        "Derived from VRoid's CC0 sample 'Sakurada Fumiriya' (pixiv); changes by PickleballMania"
    )
    meta.license_url = "https://vrm.dev/licenses/1.0/"
    meta.avatar_permission = "onlyAuthor"
    meta.commercial_usage = "personalNonProfit"
    meta.credit_notation = "unnecessary"
    meta.allow_redistribution = False
    meta.modification = "prohibited"
    ext.spec_version = ext.SPEC_VERSION_VRM1


# ---------------------------------------------------------------- geometry


def edit_body(body: bpy.types.Object, hem_z: float) -> None:
    """No tie; the trousers cut into shorts at `hem_z` (his legs are modelled underneath)."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    tie = set(slot_indices(body, "AccessoryNeck"))
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in tie], context="FACES")
    bottoms = set(slot_indices(body, "Bottoms"))
    faces = [f for f in bm.faces if f.material_index in bottoms]
    geom = list({e for f in faces for e in f.edges}) + list({v for f in faces for v in f.verts}) + faces
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, hem_z), plane_no=(0, 0, 1), clear_inner=True)
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    log(f"tie removed; trousers cut at {hem_z} m")


def remove_cowlick(hair: bpy.types.Object, above: float) -> None:
    """The strand standing up off the crown reads as boyish: pieces wholly above `above` go."""
    bm = bmesh.new()
    bm.from_mesh(hair.data)
    bm.verts.ensure_lookup_table()
    seen: set[int] = set()
    drop = []
    for v in bm.verts:
        if v.index in seen:
            continue
        piece, stack = [], [v]
        seen.add(v.index)
        while stack:
            x = stack.pop()
            piece.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        if min(p.co.z for p in piece) > above:
            drop.extend(piece)
    bmesh.ops.delete(bm, geom=drop, context="VERTS")
    bm.to_mesh(hair.data)
    bm.free()
    log(f"cowlick: removed {len(drop)} hair vertices above {above} m")


def bake_face(face: bpy.types.Object, mix: dict[str, float]) -> None:
    """Makes a calm, serious look the resting face: the mix is added to the basis and to
    every expression shape, so all expressions keep working on top of it."""
    keys = face.data.shape_keys.key_blocks
    basis = keys[0]
    n = len(basis.data)
    base = np.empty(n * 3, dtype=np.float32)
    basis.data.foreach_get("co", base)
    delta = np.zeros_like(base)
    for suffix, w in mix.items():
        key = next((k for k in keys if k.name.endswith(suffix)), None)
        if key is None:
            fail(f"no shape key ending {suffix}")
        co = np.empty_like(base)
        key.data.foreach_get("co", co)
        delta += w * (co - base)
    for k in keys:
        co = np.empty_like(base)
        k.data.foreach_get("co", co)
        k.data.foreach_set("co", co + delta)
    face.data.vertices.foreach_set("co", base + delta)
    face.data.update()
    log(f"resting face baked: {mix}")


def rounded_rect(cx: float, cz: float, w: float, h: float, r: float, steps: int = 6) -> list[tuple[float, float]]:
    pts = []
    for qx, qz, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oz = cx + qx * (w / 2 - r), cz + qz * (h / 2 - r)
        for i in range(steps + 1):
            a = math.radians(a0 + 90 * i / steps)
            pts.append((ox + r * math.cos(a), oz + r * math.sin(a)))
    return pts


def make_glasses(arm: bpy.types.Object, head_bone: str) -> bpy.types.Object:
    """Thin rectangular full-rim glasses, built from curves, skinned wholly to the head."""
    EYE_Z, EYE_X, FRONT_Y = 1.739, 0.041, -0.111
    W, H, R, WRAP = 0.052, 0.030, 0.007, math.radians(9)
    RIM = 0.00125

    def lens_points(side: int) -> list[Vector]:
        out = []
        for x, z in rounded_rect(side * EYE_X, EYE_Z, W, H, R):
            dx = x - side * EYE_X
            # The outer edge curves back with the face.
            y = FRONT_Y + max(0.0, dx * side) * math.tan(WRAP)
            out.append(Vector((x, y, z)))
        return out

    curves = []

    def curve(name: str, points: list[Vector], closed: bool) -> bpy.types.Object:
        cu = bpy.data.curves.new(name, "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = RIM
        cu.bevel_resolution = 2
        sp = cu.splines.new("POLY")
        sp.points.add(len(points) - 1)
        for p, co in zip(sp.points, points):
            p.co = (co.x, co.y, co.z, 1)
        sp.use_cyclic_u = closed
        ob = bpy.data.objects.new(name, cu)
        bpy.context.scene.collection.objects.link(ob)
        curves.append(ob)
        return ob

    left, right = lens_points(1), lens_points(-1)
    curve("RimL", left, True)
    curve("RimR", right, True)
    # A low arched bridge between the inner top corners.
    inner_l = Vector((EYE_X - W / 2 + 0.002, FRONT_Y, EYE_Z + H / 2 - 0.006))
    inner_r = Vector((-inner_l.x, FRONT_Y, inner_l.z))
    curve("Bridge", [inner_r, Vector((0, FRONT_Y - 0.002, inner_l.z + 0.002)), inner_l], False)
    # Temples from the outer top corners back over the ears.
    for side in (1, -1):
        hinge = Vector((side * (EYE_X + W / 2), FRONT_Y + (W / 2) * math.tan(WRAP), EYE_Z + H / 2 - 0.006))
        ear = Vector((side * 0.104, 0.010, EYE_Z - 0.004))
        tip = Vector((side * 0.100, 0.032, EYE_Z - 0.024))
        mid = hinge.lerp(ear, 0.5) + Vector((side * 0.006, 0, 0))
        curve(f"Temple{'L' if side > 0 else 'R'}", [hinge, mid, ear, tip], False)

    bpy.ops.object.select_all(action="DESELECT")
    for ob in curves:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = curves[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    frame = bpy.context.view_layer.objects.active
    frame.name = "Glasses"
    frame.data.name = "Glasses"

    # Lenses: the rim outlines filled, a little behind the rims.
    bm = bmesh.new()
    bm.from_mesh(frame.data)
    lens_faces = []
    for pts in (left, right):
        verts = [bm.verts.new((p.x, p.y + 0.0006, p.z)) for p in pts]
        lens_faces.append(bm.faces.new(verts))
    bm.to_mesh(frame.data)
    bm.free()

    frame_mat = new_mtoon("Glasses_Frame", GUNMETAL, "#23272D", alpha="OPAQUE", rim=False)
    lens_mat = new_mtoon("Glasses_Lens", LENS, LENS, alpha="BLEND", alpha_value=0.16, rim=False)
    frame.data.materials.append(frame_mat)
    frame.data.materials.append(lens_mat)
    n = len(frame.data.polygons)
    for i, p in enumerate(frame.data.polygons):
        p.material_index = 1 if i >= n - 2 else 0
        p.use_smooth = i < n - 2

    group = frame.vertex_groups.new(name=head_bone)
    group.add(list(range(len(frame.data.vertices))), 1.0, "REPLACE")
    frame.parent = arm
    mod = frame.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    log(f"glasses: {len(frame.data.vertices)} vertices on {head_bone}")
    return frame


def new_mtoon(
    name: str, base: str, shade: str, alpha: str = "OPAQUE", alpha_value: float = 1.0, rim: bool = True
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    m = mtoon(mat)
    m.enabled = True
    m.alpha_mode = alpha
    m.double_sided = True
    m.pbr_metallic_roughness.base_color_factor = (*linear(base), alpha_value)
    x = m.extensions.vrmc_materials_mtoon
    x.shade_color_factor = linear(shade)
    x.shading_toony_factor = 0.95
    x.parametric_rim_color_factor = (0.35, 0.4, 0.5) if rim else (0.0, 0.0, 0.0)
    x.parametric_rim_fresnel_power_factor = 4.0
    x.rim_lighting_mix_factor = 1.0
    return mat


# ---------------------------------------------------------------- textures


def bake_positions(obj: bpy.types.Object, targets: dict[str, bpy.types.Image]) -> dict[str, np.ndarray]:
    """For each material named in `targets`, where on the body (rest pose) each texel is,
    baked into a float image the size of that material's texture. Alpha marks covered texels."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.render.bake.margin = 3
    originals = [s.material for s in obj.material_slots]
    maps: dict[str, bpy.types.Image] = {}
    for i, slot in enumerate(obj.material_slots):
        name = next((k for k in targets if slot.material and k in slot.material.name), None)
        bake_mat = bpy.data.materials.new(f"bake_{i}")
        bake_mat.use_nodes = True
        nt = bake_mat.node_tree
        nt.nodes.clear()
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        emit = nt.nodes.new("ShaderNodeEmission")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(geo.outputs["Position"], emit.inputs["Color"])
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
        if name:
            w, h = targets[name].size
            img = bpy.data.images.new(f"pos_{name}", w, h, alpha=True, float_buffer=True)
            img.generated_color = (0, 0, 0, 0)
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = img
            nt.nodes.active = node
            maps[name] = img
        else:
            # Something must be active, or Cycles refuses: a throwaway 1x1.
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = bpy.data.images.new(f"skip_{i}", 1, 1, float_buffer=True)
            nt.nodes.active = node
        slot.material = bake_mat
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    hidden = obj.hide_render
    obj.hide_render = False
    bpy.ops.object.bake(type="EMIT", use_clear=False)
    obj.hide_render = hidden
    for slot, mat in zip(obj.material_slots, originals):
        slot.material = mat
    out = {}
    for name, img in maps.items():
        a = pixels(img)
        # Covered texels get the emission; the rest stay (0,0,0,0) apart from the margin.
        out[name] = a
    log(f"positions baked for {', '.join(maps)}")
    return out


def detail(rgb: np.ndarray, mask: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """The original painting's light and shade (folds, seams, knit), around 1. `strength`
    scales it down for light fabrics, where a dark original's folds would look dirty."""
    lum = rgb[..., 0] * 0.3 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11
    ref = np.median(lum[mask]) if mask.any() else 1.0
    d = np.clip(lum / max(ref, 1e-3), 0.7, 1.12)
    return 1 + (d - 1) * strength


def paint(img: bpy.types.Image, pos: np.ndarray, rule, emblem: np.ndarray | None = None) -> None:
    src = pixels(img)
    covered = pos[..., 3] > 0.5
    p = pos[..., :3]
    colour, region = rule(p, src)
    out = src.copy()
    for r in np.unique(region[covered]):
        m = covered & (region == r)
        light = colour[m].mean() > 0.8
        d = detail(src[..., :3], m, 0.3 if light else 0.9)
        out[..., :3][m] = colour[m] * d[m, None]
    if emblem is not None:
        e, inside = emblem
        a = e[..., 3:4]
        out[..., :3][inside] = out[..., :3][inside] * (1 - a[inside]) + e[..., :3][inside] * a[inside]
    out[..., :3] = np.clip(out[..., :3], 0, 1)
    set_pixels(img, out)


def fill(shape: tuple[int, int], hex_: str) -> np.ndarray:
    # Blender image pixels are linear for float math on non-colour data, but these textures
    # are sRGB: work in sRGB values directly.
    c = srgb(hex_)
    return np.broadcast_to(c, (*shape, 3)).copy()


def shirt_rule(p: np.ndarray, src: np.ndarray):
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    shape = x.shape
    lum = src[..., 0] * 0.3 + src[..., 1] * 0.59 + src[..., 2] * 0.11
    colour = fill(shape, ROYAL)
    region = np.zeros(shape, dtype=np.int8)
    sleeve = np.abs(x) > 0.168
    collar = (z > 1.585) & ~sleeve
    torso = ~sleeve & ~collar
    # The painted shirt inside the old vest's V-neck: a white V insert.
    v_insert = torso & (lum > 0.55) & (z > 1.40) & (y < 0)
    colour[sleeve | collar | v_insert] = srgb(WHITE)
    region[sleeve] = 1
    region[collar | v_insert] = 2
    # Sleeve cuffs: navy band and a thin royal stripe above it.
    cuff = sleeve & (np.abs(x) > 0.257)
    stripe = sleeve & (np.abs(x) > 0.246) & (np.abs(x) <= 0.251)
    colour[cuff] = srgb(NAVY)
    colour[stripe] = srgb(ROYAL)
    region[cuff | stripe] = 3
    # A navy diagonal panel across the front, his right shoulder down to his left hip, with
    # a fine silver edge on its upper side.
    ax, az, bx, bz = -0.16, 1.57, 0.16, 1.16
    nx, nz = -(bz - az), bx - ax
    norm = math.hypot(nx, nz)
    dist = ((x - ax) * nx + (z - az) * nz) / norm
    front = torso & (y < 0.02) & ~v_insert
    panel = front & (np.abs(dist) < 0.026)
    edge = front & (dist >= 0.026) & (dist < 0.031)
    colour[panel] = srgb(NAVY)
    colour[edge] = srgb(SILVER)
    region[panel] = 4
    region[edge] = 5
    # The knitted hem: a navy band.
    hem = torso & (z < 1.175)
    colour[hem] = srgb(NAVY)
    region[hem] = 6
    return colour, region


def shorts_rule(p: np.ndarray, src: np.ndarray):
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    colour = fill(x.shape, WHITE)
    region = np.zeros(x.shape, dtype=np.int8)
    # A navy stripe down the outside of each leg, and up the hips to the waist.
    centre = np.sign(x) * 0.075
    legs = z < 1.0
    out_leg = np.arctan2(np.abs(y + 0.005), np.maximum((x - centre) * np.sign(x), 1e-4))
    out_hip = np.arctan2(np.abs(y + 0.005), np.maximum(np.abs(x), 1e-4))
    side = np.where(legs, out_leg < 0.26, out_hip < 0.2)
    colour[side] = srgb(NAVY)
    region[side] = 1
    waist = z > 1.205
    hem = z < 0.822
    colour[waist | hem] = srgb(NAVY)
    region[waist | hem] = 2
    return colour, region


def shoe_rule(p: np.ndarray, src: np.ndarray):
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    colour = fill(x.shape, WHITE)
    region = np.zeros(x.shape, dtype=np.int8)
    toe = (y < -0.118) & (z < 0.062)
    heel = (y > 0.055) & (z < 0.085)
    colour[toe | heel] = srgb(NAVY)
    region[toe | heel] = 1
    sole = z < 0.021
    colour[sole] = srgb(GUM)
    region[sole] = 2
    return colour, region


def sock_rule(p: np.ndarray, src: np.ndarray):
    """Only below the ankle is changed (white crew socks with a royal ring); the rest of the
    body texture is left as it was."""
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    keep = np.ones(x.shape, dtype=bool)
    colour = src[..., :3].copy()
    region = np.full(x.shape, 9, dtype=np.int8)
    # The original's painted socks reach 0.25 m (measured): cover them all.
    lum = src[..., 0] * 0.3 + src[..., 1] * 0.59 + src[..., 2] * 0.11
    sock = (z > 0.02) & ((z < 0.245) | ((z < 0.285) & (lum < 0.6)))
    ring = sock & (z > 0.212) & (z < 0.224)
    colour[sock] = srgb(WHITE)
    colour[ring] = srgb(ROYAL)
    region[sock] = 1
    region[ring] = 2
    del keep
    return colour, region


def sock_mask(pos: np.ndarray) -> np.ndarray:
    """Where the white socks are on the body texture (same rule as sock_rule)."""
    z = pos[..., 2]
    return (pos[..., 3] > 0.5) & (z > 0.02) & (z < 0.25)


def resize_mask(mask: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    h, w = mask.shape
    ys = (np.arange(size[1]) * h // size[1]).astype(int)
    xs = (np.arange(size[0]) * w // size[0]).astype(int)
    return mask[np.ix_(ys, xs)]


def paint_body_selectively(img: bpy.types.Image, pos: np.ndarray) -> None:
    src = pixels(img)
    covered = pos[..., 3] > 0.5
    colour, region = sock_rule(pos[..., :3], src)
    out = src.copy()
    for r in (1, 2):
        m = covered & (region == r)
        if m.any():
            d = detail(src[..., :3], m, 0.4)
            out[..., :3][m] = colour[m] * d[m, None]
    set_pixels(img, out)


def emblem_on_chest(pos: np.ndarray, emblem_path: str):
    """The team crest on his left chest: sampled by body position (front, x > 0)."""
    img = bpy.data.images.load(emblem_path)
    e = pixels(img)  # bottom-to-top rows, like every Blender image
    eh, ew = e.shape[:2]
    cx, cz, size = 0.078, 1.475, 0.058
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    u = (x - (cx - size / 2)) / size
    v = (z - (cz - size / 2)) / size
    inside = (pos[..., 3] > 0.5) & (y < -0.02) & (u >= 0) & (u < 1) & (v >= 0) & (v < 1)
    out = np.zeros((*x.shape, 4), dtype=np.float32)
    # Seen from the front, his left (+x) is the viewer's right: u runs left to right as seen.
    ui = np.clip((u * ew).astype(int), 0, ew - 1)
    vi = np.clip((v * eh).astype(int), 0, eh - 1)
    out[inside] = e[vi[inside], ui[inside]]
    bpy.data.images.remove(img)
    return out, inside


def tint_iris(mat: bpy.types.Material, hue_deg: float = 26) -> None:
    """Blue irises to a warm hazel brown, keeping their painted light and dark."""
    img = image_of(mat)
    a = pixels(img)
    rgb = a[..., :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-4), 0)
    coloured = (sat > 0.12) & (a[..., 3] > 0.05)
    h = hue_deg / 360
    s = np.clip(sat * 0.75, 0, 0.7)
    v = mx * 0.78
    i = np.floor(h * 6)
    f = h * 6 - i
    pp, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    # hue 26 deg lies in the first sextant: (v, t, p)
    new = np.stack([v, t, pp], -1)
    rgb[coloured] = new[coloured]
    a[..., :3] = rgb
    set_pixels(img, a)
    log("irises: hazel brown")


def recolour_hair() -> None:
    for part, base, shade in (
        ("Hair_00_HAIR_01", "#6A4835", "#2E1E16"),
        ("Hair_00_HAIR_02", "#3E2A20", "#1E140F"),
        ("HairBack_00_HAIR", "#4A3326", "#22160F"),
    ):
        m = mtoon(material(part))
        m.pbr_metallic_roughness.base_color_factor = (*linear(base), 1.0)
        m.extensions.vrmc_materials_mtoon.shade_color_factor = linear(shade)
    log(f"hair: brown ({HAIR})")


def tune_materials() -> None:
    """Crisper anime look: thin outlines on clothes and hair, a soft cool rim light."""
    for m in bpy.data.materials:
        if m.name.startswith(("MToon Outline", "bake_", "Glasses")):
            continue
        t = mtoon(m)
        if not t.enabled:
            continue
        x = t.extensions.vrmc_materials_mtoon
        if any(k in m.name for k in ("Tops", "Bottoms", "Shoes")):
            # Fabric shades cool grey-blue, not the skin's pink.
            x.shade_color_factor = linear("#C4CCDC")
        if "HAIR" in m.name:
            # A softer, browner sheen than the base's orange.
            t.emissive_factor = tuple(c * 0.35 for c in linear("#8A6A55"))
        if any(k in m.name for k in ("Tops", "Bottoms", "Shoes", "HAIR")):
            x.outline_width_mode = "worldCoordinates"
            x.outline_width_factor = 0.0011 if "HAIR" not in m.name else 0.0008
            x.outline_color_factor = linear("#1A2236") if "HAIR" not in m.name else linear("#24170F")
            x.outline_lighting_mix_factor = 1.0
            x.parametric_rim_color_factor = (0.18, 0.22, 0.3)
            x.parametric_rim_fresnel_power_factor = 5.0
            x.parametric_rim_lift_factor = 0.05
    log("materials tuned (outlines, rim light)")


def trim_textures() -> None:
    """Texture memory: unused and oversized images go, normal maps the toon look doesn't
    need are dropped (the outlines and shading carry the form)."""
    scale = {
        "M00_001_Body_00": (1024, 1024),
        "M00_001_Tops_01": (1024, 1024),
        "M00_001_Bottoms_01": (512, 512),
        "M00_000_HairBack_00": (512, 512),
        "F00_000_Hair_00_spe": (256, 512),
        "M00_000_EyeWhite_00": (512, 256),
        "M00_000_EyeHighlight_00": (512, 256),
        "M00_000_00_EyeExtra_01": (512, 256),
        "Matcap_Rim": (256, 256),
        "M00_000_EyeIris_00": (512, 256),
        "M00_000_FaceMouth_00": (256, 256),
        "Matcap_RimHair": (256, 256),
    }
    for img in list(bpy.data.images):
        size = scale.get(img.name)
        if size and img.size[0] > size[0]:
            img.scale(*size)
            img.pack()
    for m in bpy.data.materials:
        t = getattr(m, "vrm_addon_extension", None)
        if t is None or not t.mtoon1.enabled:
            continue
        nt = t.mtoon1.normal_texture.index
        if nt.source is not None and nt.source.name in ("M00_001_00_Body_00_nml", "M00_000_00_Face_00_nml", "M00_000_HairBack_00_nml"):
            nt.source = None
    for img in list(bpy.data.images):
        if img.users == 0 or img.name.startswith(("pos_", "skip_", "Thumbnail")):
            bpy.data.images.remove(img)
    log("textures trimmed")


def merge_atlas(obj: bpy.types.Object, name: str, size: tuple[int, int], parts: list[tuple[str, tuple[int, int, int, int]]]) -> None:
    """Draws several materials as one: their textures packed into one atlas (rectangles in
    pixels, origin bottom-left), their faces' UVs moved into place, and all of them given
    the first part's material. Fewer materials, fewer draw calls; same texels."""
    W, H = size
    atlas = np.zeros((H, W, 4), dtype=np.float32)
    keep = material(parts[0][0])
    keep_slot = slot_indices(obj, keep.name)[0]
    uv = obj.data.uv_layers.active.data
    for part, (x0, y0, w, h) in parts:
        mat = material(part)
        src = image_of(mat)
        if tuple(src.size) != (w, h):
            src = src.copy()
            src.scale(w, h)
        atlas[y0 : y0 + h, x0 : x0 + w] = pixels(src)
        slots = set(slot_indices(obj, mat.name))
        for poly in obj.data.polygons:
            if poly.material_index not in slots:
                continue
            for li in poly.loop_indices:
                u, v = uv[li].uv
                uv[li].uv = ((x0 + u * w) / W, (y0 + v * h) / H)
            poly.material_index = keep_slot
    img = bpy.data.images.new(name, W, H, alpha=True)
    set_pixels(img, atlas)
    t = mtoon(keep)
    t.pbr_metallic_roughness.base_color_texture.index.source = img
    t.extensions.vrmc_materials_mtoon.shade_multiply_texture.index.source = img
    keep.name = name
    log(f"atlas {name}: {', '.join(p for p, _ in parts)} -> one material ({W}x{H})")


def save_textures(folder: str, names: list[str]) -> None:
    """The painted textures, as PNG files beside the other source art."""
    Path(folder).mkdir(parents=True, exist_ok=True)
    for name in names:
        img = bpy.data.images.get(name)
        if img is None:
            fail(f"no image {name} to save")
        img.save_render(str(Path(folder) / f"{name}.png"))
    log(f"textures saved to {folder}")


def tune_hair(arm: bpy.types.Object, stiffness: float, drag: float, center_bone: str) -> None:
    """Calmer hair (measured in tools/characters/x1/README.md): simulated relative to the neck,
    so crouching, jumping and landing don't fling it; stiffer, with more drag, so a thin
    strand doesn't flip over on a landing. It still sways when the head turns."""
    sb = arm.data.vrm_addon_extension.spring_bone1
    n = 0
    for spring in sb.springs:
        spring.center.bone_name = center_bone
        for j in spring.joints:
            j.stiffness = min(4.0, j.stiffness * stiffness)
            j.drag_force = min(1.0, max(j.drag_force, drag))
            n += 1
    log(f"hair springs: {n} joints, stiffness x{stiffness}, drag {drag}, centred on {center_bone}")


def lin_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def shade_texture(mat: bpy.types.Material, size: tuple[int, int], light_factor, dark_factor, light_mask=None) -> None:
    """A shade texture of its own, so whites shade to a light cool tone while colours shade
    deeper: one shade colour for everything would grey the white fabric. MToon multiplies
    in linear light, so the factors are linear; the result is written back as sRGB."""
    base = image_of(mat)
    src = pixels(base)
    rgb = src[..., :3]
    lum = rgb[..., 0] * 0.3 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11
    sat = rgb.max(-1) - rgb.min(-1)
    light = (lum > 0.7) & (sat < 0.2) if light_mask is None else light_mask
    lin = to_linear(rgb)
    shade = np.where(light[..., None], lin * np.array(light_factor), lin * np.array(dark_factor))
    out = src.copy()
    out[..., :3] = lin_to_srgb(shade)
    img = bpy.data.images.new(f"{mat.name}_shade", base.size[0], base.size[1], alpha=True)
    set_pixels(img, out)
    img.scale(*size)
    img.pack()
    x = mtoon(mat).extensions.vrmc_materials_mtoon
    x.shade_multiply_texture.index.source = img
    x.shade_color_factor = (1.0, 1.0, 1.0)
    log(f"shade texture for {mat.name} ({size[0]}x{size[1]})")


def export(out: str) -> None:
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    if bpy.ops.export_scene.vrm(filepath=str(Path(out).resolve())) != {"FINISHED"}:
        fail("export failed")
    log(f"wrote {out} ({Path(out).stat().st_size / 1e6:.1f} MB)")


def main() -> None:
    a = args()
    clear_scene()
    arm = import_base(a.base)
    to_vrm1(arm)
    if a.stage == "full":
        body = bpy.data.objects["Body"]
        face = bpy.data.objects["Face"]
        hair = bpy.data.objects["Hair001"]
        head_bone = arm.data.vrm_addon_extension.vrm1.humanoid.human_bones.head.node.bone_name

        edit_body(body, hem_z=0.80)
        remove_cowlick(hair, above=1.885)
        bake_face(face, {"Fcl_BRW_Angry": 0.45, "Fcl_EYE_Angry": 0.28, "Fcl_MTH_Close": 0.35})

        tops, bottoms, shoes, skin = (material(n) for n in ("Tops_01", "Bottoms_01", "Shoes_01", "Body_00_SKIN"))
        targets = {"Tops_01": image_of(tops), "Bottoms_01": image_of(bottoms), "Shoes_01": image_of(shoes), "Body_00_SKIN": image_of(skin)}
        pos = bake_positions(body, targets)
        emblem = emblem_on_chest(pos["Tops_01"], str(Path(a.textures) / "emblem-1024.png"))
        paint(image_of(tops), pos["Tops_01"], shirt_rule, emblem)
        paint(image_of(bottoms), pos["Bottoms_01"], shorts_rule)
        paint(image_of(shoes), pos["Shoes_01"], shoe_rule)
        paint_body_selectively(image_of(skin), pos["Body_00_SKIN"])
        if a.debug_dir:
            for img in (image_of(tops), image_of(bottoms), image_of(shoes), image_of(skin)):
                img.save_render(str(Path(a.debug_dir) / f"{img.name}.png"))

        tint_iris(material("EyeIris"))
        recolour_hair()
        make_glasses(arm, head_bone)
        tune_materials()
        tune_hair(arm, stiffness=4.0, drag=0.7, center_bone=arm.data.vrm_addon_extension.vrm1.humanoid.human_bones.neck.node.bone_name)
        trim_textures()
        merge_atlas(body, "Kit", (1536, 1024), [
            ("Tops_01", (0, 0, 1024, 1024)),
            ("Bottoms_01", (1024, 512, 512, 512)),
            ("Shoes_01", (1024, 0, 512, 512)),
        ])
        merge_atlas(face, "FaceLines", (1024, 768), [
            ("FaceBrow", (0, 512, 1024, 256)),
            ("FaceEyelash", (0, 256, 1024, 256)),
            ("FaceEyeline", (0, 0, 1024, 256)),
        ])
        merge_atlas(face, "EyeLight", (512, 512), [
            ("EyeHighlight", (0, 256, 512, 256)),
            ("EyeExtra", (0, 0, 512, 256)),
        ])
        # Iris and eye white: both alpha-tested, no tint; the iris sits in front.
        merge_atlas(face, "Eyes", (512, 512), [
            ("EyeIris", (0, 256, 512, 256)),
            ("EyeWhite", (0, 0, 512, 256)),
        ])
        for img in list(bpy.data.images):
            if img.users == 0:
                bpy.data.images.remove(img)
        # White fabric stays white in shade (linear factors: whites to about #D9DFEA).
        shade_texture(material("Kit"), (768, 512), light_factor=(0.69, 0.73, 0.83), dark_factor=(0.55, 0.6, 0.72))
        sock = sock_mask(pos["Body_00_SKIN"])
        skin_shade = tuple(mtoon(skin).extensions.vrmc_materials_mtoon.shade_color_factor)
        skin_img = image_of(skin)
        shade_texture(
            skin,
            (512, 512),
            light_factor=(0.69, 0.73, 0.83),
            dark_factor=skin_shade,
            light_mask=resize_mask(sock, skin_img.size),
        )
        save_textures(a.textures_out, ["Kit", "Kit_shade", "FaceLines", "Eyes", "M00_001_Body_00", skin.name + "_shade"])
    export(a.out)


main()
