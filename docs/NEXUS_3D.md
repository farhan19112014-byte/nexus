# NEXUS in 3D

The 3D NEXUS is the same character as the classic 2D robot, rebuilt with real volume: a rounded "squircle" helmet with
a face display that hugs its curved front, side ear-discs with light rings, an antenna with a glowing ball, a compact
torso with a recessed chest core, capsule limbs with glowing joints, and boots with a blue light strip. Its proportions
come straight from the 2D rig (`src/character/geometry.ts`: 1 unit = 100 px of the 400×480 drawing, ground at y = 0,
facing +z), and it uses the 2D palette — graphite, dark blue, cyan and electric blue — with a white and light-blue
version for the light theme.

| File | What it is |
|---|---|
| `public/models/nexus.glb` | the model (≈1.6 MB, 73 meshes, ≈63k triangles, no textures) — three.js / any glTF 2.0 viewer |
| `tools/nexus3d/build-model.mjs` | **editable source**: builds the GLB with three.js. Change a size or colour, run `node tools/nexus3d/build-model.mjs` |
| `tools/nexus3d/preview.html` | turntable preview (serve the repo root, open `/tools/nexus3d/preview.html?az=35`) |
| `public/models/nexus-3d-example.html` | minimal three.js example: head follows the pointer, blinking, talking mouth, happy eyes, wave, nod |
| `src/character3d/Robot3D.tsx` | the in-app renderer (lazy-loaded three.js) |
| `src/character3d/rig3d.ts` | maps the app's animation channels to the model's joints |
| `src/character3d/skins3d.ts` | dark and light colours per material |

No textures are needed: every material is a plain PBR colour (`MeshStandardMaterial` / `MeshPhysicalMaterial` with
clearcoat for the shell and screen; emissive for the lights).

## Hierarchy and pivots

Every moving part is its own node; each joint node's origin **is** its pivot. Character's left = +x (viewer's right).

```
NEXUS                       root, on the ground
└ Body_Root                 stage offset, squash/stretch (about the ground)
  └ Body                    pivot at the hips (y 1.34): lean (rot z), three-quarter turn (rot y)
    ├ Torso                 Torso_Shell, Torso_Waist, Neck, Chest_Panel, Chest_Ring, Chest_Light, Chest_Bar,
    │                       Torso_Trim, Torso_Inset, Torso_Vent_L1..3 / R1..3, Back_Panel, Back_Vent_1..3
    ├ Head                  pivot at the neck (y 2.38): nod (rot x), turn (rot y), tilt (rot z)
    │ ├ Head_Shell, Face_Bezel, Face_Trim, Face_Screen, Forehead_LED
    │ ├ Antenna             pivot at its base: sway (rot z) — Antenna_Stalk, Antenna_Ball
    │ ├ Ear_L / Ear_R       Ear_*_Disc, Ear_*_Cap, Ear_*_Ring
    │ └ Face                on the screen surface
    │   ├ Eye_L / Eye_R     scale y = blink, scale = eye size — Eye_*_LED, Pupil_*, EyeSpark_*, EyeLid_* (happy eyes)
    │   ├ Brow_L / Brow_R   raise (pos y), tilt (rot z)
    │   ├ Cheek_L / Cheek_R material opacity = blush
    │   └ Mouth             skew — Mouth_Line (morph targets "smile", "frown"), Mouth_Open (scale y = open), Mouth_O
    ├ Arm_L / Arm_R         pivot at the shoulder (x ±0.58, y 2.12): raise (rot z)
    │ └ Forearm_*           pivot at the elbow: bend (rot z) — Elbow_*, Elbow_*_LED, LowerArm_*
    │   └ Hand_*            pivot at the wrist: spin (rot z) — Hand_*_Palm, Hand_*_Thumb
    └ Leg_L / Leg_R         pivot at the hip (x ±0.30): spread (rot z), knee lift (rot x)
      └ Shin_*              pivot at the knee: bend (rot x) — Knee_*, Knee_*_LED, Shin_*_Mesh
        └ Foot_*            pivot at the ankle: Boot_*, Boot_*_Strip
```

Materials (named, so they can be recoloured): `NX_Shell`, `NX_Limb`, `NX_Joint`, `NX_Bezel`, `NX_Screen`, `NX_Eye`,
`NX_Pupil`, `NX_Spark`, `NX_Lid`, `NX_Brow`, `NX_Mouth`, `NX_Cheek`, `NX_LED_Blue`, `NX_Trim`, `NX_Core`, `NX_Accent`,
`NX_ChestPanel`, `NX_Boot`.

## In the NEXUS app and website

NEXUS is 3D wherever the browser has WebGL — on the home page and the robot page. three.js and the model load on demand.
The classic 2D robot is kept only as a fallback: no WebGL at all (decided before three.js is downloaded), or the model fails
to load (with a notice). Without graphics hardware (software WebGL) the 3D view draws fewer pixels so the page stays usable.
While the model downloads, the stage says "Loading the 3D NEXUS…".

## Motion engine (`src/character3d/motion3d.ts`)

The model is made of rigid parts on pivoted nodes (no skeleton, no animation clips). Two layers drive it:

1. **Shared animation channels** (`rig3d.ts`) — the same engine as the 2D robot: expressions (eyes, brows, mouth, blinks),
   gaze, speech mouth (audio loudness + approximate lip shape from the spectrum), and the gestures the AI or the user asks for (wave, nod…).
2. **3D Motion Engine** — the robot's own body language, which replaces the old 2D-style idle bob/arm sway and ambient
   motions when 3D is shown:
   - per-state base pose: idle, listening (leans in), thinking (looks up, tilts), speaking, curious, confused, resting,
     interrupted, error, acting (an engine gesture is running — the motion engine stays out of its way);
   - primitives: head tilt, head turn, gaze shift, posture shift, nod, small arm gesture, return-to-neutral — combined into
     short sequences chosen per state with a seeded RNG (varied, never the same twice in a row, reproducible for debugging);
   - critically-damped springs per joint (no snapping), an under-damped antenna that lags the head (follow-through), legs
     counter-rotated against body lean so the boots stay planted;
   - limits: `MOTION_LIMITS` (this engine's offsets) and `JOINT_LIMITS` (total head angle) — all tuning is in one place
     at the top of the file;
   - priority: interruption > speech > engine gestures (the motion engine fades its arm offsets out while the arms are
     gesturing) > thinking/listening > idle/resting. A state change cancels the running sequence; an interrupt settles
     everything to neutral in ~0.3 s.

The state comes from the companion's real state machine (`companion.ts → runtime.setMotion`): "thinking" only while a
request is pending, "speaking" only while speech audio plays, "curious" while you type a question, "confused" when a reply
came back empty or unreadable. No AI call drives any of it. Reduced motion turns the procedural layer off.

Limits (honest): the mouth follows the playing audio's loudness, with an approximate rounded/wide lip shape from its spectrum (no phoneme visemes); there are no fingers or torso-vs-hips joint, so
"lean" bends at the hips; a skinned rig with a spine and fingers would be the next asset step for richer gestures.

## Using the model in another website

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const gltf = await new GLTFLoader().loadAsync('/models/nexus.glb');
scene.add(gltf.scene);
const head = gltf.scene.getObjectByName('Head');
head.rotation.y = 0.3;                                  // look to the side
gltf.scene.getObjectByName('Eye_L').scale.y = 0.1;      // blink
const mouth = gltf.scene.getObjectByName('Mouth_Line');
mouth.morphTargetInfluences[mouth.morphTargetDictionary.smile] = 1;
gltf.scene.getObjectByName('Mouth_Open').scale.y = 0.7; // talking
```

See `public/models/nexus-3d-example.html` for a complete page (served at `/models/nexus-3d-example.html`).

## Limits (honest)

- The model is generated procedurally (code), not sculpted in Blender — there is no `.blend` file; the editable source
  is `build-model.mjs`. It imports cleanly into Blender (File → Import → glTF) for further sculpting.
- No skinned mesh / bones: parts are rigid and move at their joints, which suits this robot.
- The "happy eyes" lid is clipped to each eye by the app's renderer; in other viewers it may show slightly past the eye.
- Seat/stool for sitting poses exists only in 2D.
