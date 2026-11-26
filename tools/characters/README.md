# Player models and motions

The game's players (`apps/client/public/models/*.glb`) are built here from free data:

| What                           | Source                                                                                                                                                | License             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Bodies, skeleton, skin weights | [MakeHuman](https://github.com/makehumancommunity/makehuman) and [MPFB2](https://github.com/makehumancommunity/mpfb2)                                 | CC0 (public domain) |
| Skins, hair, clothes, eyes     | [MakeHuman system assets](https://static.makehumancommunity.org/assets/assetpacks.html)                                                               | CC0                 |
| Movement                       | [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu), BVH conversion by B. Hahne ([copy](https://github.com/una-dinosauria/cmu-mocap)) | Free for any use    |

The CMU database asks for this credit: _The data used in this project was obtained from
mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217._

The photographed shoes carried brand marks; `build_characters.py` removes the marks and
recolors the shoes.

## Rebuilding

Needs Python 3 with `numpy` and `pillow`, and three folders of downloaded data:

- `core/`: `base.obj` (MakeHuman), `rig.game_engine.json` and `weights.game_engine.json`
  (MPFB2), and the `.target` files named in `mh.py` in `core/t/`
- `system/`: the unpacked MakeHuman system assets
- `cmu/`: the `.bvh` files named in `build_motions.py`

```bash
python build_characters.py core system ../../apps/client/public/models
python build_motions.py core cmu ../../apps/client/public/models
```

- `mh.py` shapes a body, places its joints and fits clothes; `glb.py` writes glTF.
- `bvh.py` reads captures; `motions.py` puts them on the skeleton, finds loops, takes out
  the travel (its speed goes to `motions.json`) and levels the feet.
