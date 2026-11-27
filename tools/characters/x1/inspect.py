"""Lists a VRM's materials, their MToon textures and colours (run headless with -- <file>)."""
import sys

import bpy

path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.vrm(filepath=path)
for mat in bpy.data.materials:
    ext = getattr(mat, "vrm_addon_extension", None)
    if ext is None:
        continue
    m = ext.mtoon1
    gltf = m.pbr_metallic_roughness
    tex = []
    def img(prop, name):
        try:
            i = prop.index.source
            if i:
                tex.append(f"{name}={i.name}({i.size[0]}x{i.size[1]})")
        except AttributeError:
            pass
    img(gltf.base_color_texture, "base")
    x = m.extensions.vrmc_materials_mtoon
    img(x.shade_multiply_texture, "shade")
    img(x.shading_shift_texture, "shift")
    img(x.matcap_texture, "matcap")
    img(x.rim_multiply_texture, "rim")
    img(x.outline_width_multiply_texture, "outlineW")
    img(m.normal_texture, "normal")
    img(m.emissive_texture, "emissive")
    print(
        "MAT", mat.name, "| enabled", m.enabled,
        "| base", tuple(round(c, 2) for c in gltf.base_color_factor),
        "| shade", tuple(round(c, 2) for c in x.shade_color_factor),
        "| outline", x.outline_width_mode, round(x.outline_width_factor, 4),
        "| alpha", m.alpha_mode, "|", " ".join(tex),
    )
for o in bpy.data.objects:
    if o.type == "MESH":
        print("MESH", o.name, "verts", len(o.data.vertices), "keys", len(o.data.shape_keys.key_blocks) if o.data.shape_keys else 0, "mats", [s.material.name for s in o.material_slots if s.material])
