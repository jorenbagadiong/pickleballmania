"""Checks that Blender has the VRM add-on (run: blender -b --python probe.py)."""
import addon_utils
import bpy

print("VRM modules:", [m.__name__ for m in addon_utils.modules() if "vrm" in m.__name__.lower()])
print("import op:", hasattr(bpy.ops.import_scene, "vrm"), "export op:", hasattr(bpy.ops.export_scene, "vrm"))
