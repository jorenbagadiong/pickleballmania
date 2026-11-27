"""Saves every image of a VRM as PNG (run headless with -- <file.vrm> <out dir>)."""
import sys
from pathlib import Path

import bpy

src, out = sys.argv[sys.argv.index("--") + 1 :][:2]
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.vrm(filepath=src)
Path(out).mkdir(parents=True, exist_ok=True)
for img in bpy.data.images:
    if img.size[0] < 16:
        continue
    img.filepath_raw = str(Path(out) / f"{img.name}.png")
    img.file_format = "PNG"
    img.save()
    print("SAVED", img.name, img.size[0], img.size[1])
