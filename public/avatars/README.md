# Supplied avatar characters

ModVerse can show its garments on two rigged character models:

| File               | Used for           | Avatar |
| ------------------ | ------------------ | ------ |
| `man.fbx`          | the Men's range    | Atlas  |
| `woman.fbx`        | the Women's range  | Aura   |

The `.fbx` files are committed here (added with the owner's confirmation that they may be redistributed).
To use different characters, replace `man.fbx` / `woman.fbx`; the 3D viewer, the trial room
and the account avatar preview pick them up automatically. Without them ModVerse falls back to its built-in
procedural Atlas / Aura bodies; nothing else changes.

Expected model: Mixamo / Ready-Player-Me style skeleton (Hips, Spine…, LeftArm…), one skinned mesh with the
materials `Skin`, `Eyes`, `Outfit`, `Shoes`, `Hair` …, ARKit face morphs and `Idle` / `Walk` / `Run` clips.
See `docs/3D_SYSTEM.md` for how the characters are prepared and how garments are bound to them.
