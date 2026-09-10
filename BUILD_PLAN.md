# AI 3D Model & Animation Studio — Build Plan

<aside>
🎯

Build an AI-assisted 3D editor that generates models and animations from text prompts, supports imported models, and lets users refine everything through direct manipulation and a keyframe timeline.

**Core principle:** AI-generated animations and manually edited animations must share the same underlying data format. Generated code is an authoring mechanism—not the only source of truth.

</aside>

**Status:** Proposed architecture and implementation plan
**Prepared:** 10 September 2026
**Reference use case:** A cute purple owl avatar with typing, thinking, and hover animations.

## 1. Product scope and user journeys

### A. Generate a new model

1. Create a project.
2. Enter a prompt such as: “Create a cute purple owl with large eyes, small wings, and a rounded body.”
3. Choose a style and detail level.
4. Generate a model and inspect it in the viewport.
5. Request a revision: “Make the eyes larger and the wings shorter.”
6. Preview the proposed revision and accept or reject it.

### B. Generate and refine animations

1. Select a model or specific components.
2. Enter: “Make the owl wave its right wing when hovered.”
3. Generate an animation clip.
4. Play, scrub, and adjust the clip.
5. Request: “Make the wave slower and less exaggerated.”
6. Update the existing clip without replacing unrelated work.

### C. Edit animations manually

Users can move and rotate components; insert, move, duplicate, and delete keyframes; change duration and playback speed; adjust interpolation; edit curves; create clips without AI; and undo or redo both AI and manual changes.

### D. Import and animate an existing model

1. Import a GLB file.
2. Inspect its objects, bones, morph targets, and animation clips.
3. Play existing animations.
4. Edit a clip manually or request AI modifications.
5. Receive a clear explanation when a requested animation needs a rig or independently movable components that the model does not have.

### Initial product boundaries

Focus on stylized characters, mascots, low-to-medium complexity props, procedural objects, named-part transform animation, and playback of existing skeletal and morph-target animation.

Do not promise arbitrary photorealistic characters, production-quality topology, or automatic rigging from procedural LLM-generated code. Specialized 3D-generation and rigging services can be integrated later.

## 2. Recommended technology stack

| Area | Recommendation | Purpose |
| --- | --- | --- |
| Application | React + TypeScript, optionally Next.js | Main interface and application routing |
| 3D engine | Three.js | Rendering, model loading, animation playback, export |
| React integration | React Three Fiber | Integrate the viewport with React |
| Viewport utilities | Drei | Camera controls, helpers, transform controls |
| Editor state | Zustand with an explicit command/history layer | Selection, timeline state, undo/redo |
| Validation | Zod or JSON Schema | Validate AI responses and project documents |
| Code editor | Monaco, after the core editor | Inspect or edit generated code |
| Backend | Node.js/TypeScript API | Projects, provider connections, generation jobs |
| Database | PostgreSQL | Project metadata, revisions, job records |
| Asset storage | S3-compatible object storage | GLBs, textures, thumbnails, project archives |
| Job processing | Background workers and queue | Generation, validation, baking, conversion |
| Generated-code execution | Restricted interpreter or isolated execution service | Safely execute generated procedural code |

**Rendering rule:** Use React for interface state and controls, but keep per-frame animation updates inside Three.js. Avoid updating React state on every rendered frame.

## 3. High-level architecture

```
Web application
├── Project browser
├── Prompt panel
├── 3D viewport
├── Scene hierarchy
├── Property inspector
├── Animation timeline
└── Revision history
        │
        ▼
Backend API
├── Authentication and project permissions
├── LLM provider connections
├── Generation orchestration
├── Job status / streaming updates
└── Asset and revision management
        │
        ▼
Generation workers
├── Prompt/context preparation
├── LLM response validation
├── Sandboxed procedural execution
├── Model / animation validation
├── Animation baking
└── Preview and export generation
        │
        ▼
PostgreSQL + asset storage
```

Separate interactive editing from background generation. The editor should remain usable during an AI job, and the last valid model should remain visible if generation fails.

## 4. Editor interface and controls

```
┌──────────────────────────────────────────────────────────────┐
│ Project   Import   Export   Undo   Redo   Save   AI connection │
├──────────────┬──────────────────────────────┬──────────────────┤
│ Scene tree   │                              │ Inspector        │
│              │         3D viewport          │                  │
│ Owl          │                              │ Transform        │
│ ├ Body       │                              │ Material         │
│ ├ Left wing  │                              │ Animation target │
│ ├ Right wing │                              │                  │
│ └ Eyes       │                              │                  │
├──────────────┴──────────────────────────────┴──────────────────┤
│ Clip selector   Play   Pause   Loop   Speed   Current time     │
│ Animation tracks and keyframes                                │
├──────────────────────────────────────────────────────────────┤
│ AI prompt: “Make the selected wing wave twice…”               │
│ Scope: Selected part · Active clip              Generate      │
└──────────────────────────────────────────────────────────────┘
```

### Viewport controls

- Orbit, pan, and zoom.
- Frame selected object and reset camera.
- Front, side, top, and perspective views.
- Grid and axis toggles.
- Solid, wireframe, and material preview modes.
- Bone visibility toggle and selection outline.
- Move, rotate, and scale gizmos.

### Prompt scope controls

Every request should explicitly target one of: entire model, selected objects, active animation clip, selected tracks, or selected time range. This reduces ambiguity in requests such as “make it smaller.”

## 5. Canonical project document

Do not make generated JavaScript the only source of truth. Maintain structured project data containing scene nodes, stable IDs, geometry/material references, rig and morph-target metadata, animation clips/tracks, procedural recipes, parameters, interaction mappings, and version references.

```tsx
// Conceptual schema; referenced types require full definitions.
type ProjectDocument = {
  schemaVersion: number;
  assetReferences: AssetReference[];
  nodes: SceneNode[];
  materials: MaterialDefinition[];
  clips: AnimationClipDocument[];
  generators: GeneratorDefinition[];
  interactions: InteractionDefinition[];
};

type AnimationTrack = {
  id: string;
  targetNodeId: string;
  property:
    | "translation"
    | "rotation"
    | "scale"
    | "morphWeights";
  interpolation: "step" | "linear" | "cubic";
  keys: Keyframe[];
};
```

The production schema must define cubic tangents, quaternion rotation values, morph-target dimensions, and skeletal bindings.

### Stable IDs

Bind tracks to immutable node IDs, not names such as `RightWing`. Names may be duplicated or renamed. Preserve IDs for components that survive model revisions. When replacing a component, provide an explicit remapping or flag affected animation tracks.

### Asset separation

Keep large vertex buffers, textures, and imported source files in asset storage rather than duplicating them inside every JSON revision.

## 6. Two AI authoring modes

### Mode A — Structured generation, preferred

Return a model recipe or animation specification that the application compiles into editable data.

```json
{
  "operation": "createAnimation",
  "name": "Little wave",
  "duration": 1.35,
  "loop": false,
  "targetNodeId": "node-right-wing",
  "motion": {
    "type": "wave",
    "axis": "z",
    "amplitudeDegrees": 85,
    "repetitions": 2
  }
}
```

Benefits: predictable validation, smaller prompts, reliable manual editing, fewer execution risks, and clearer export behaviour.

### Mode B — Procedural code generation, advanced

Generate code against a constrained SDK rather than arbitrary application APIs.

```tsx
export function build(api, params) {
  const body = api.ellipsoid({
    id: "body",
    dimensions: params.bodyDimensions,
    material: "lavender"
  });

  const wing = api.ellipsoid({
    id: "right-wing",
    dimensions: params.wingDimensions,
    material: "dark-lavender"
  });

  api.attach(wing, body);
  api.setPivot(wing, params.wingPivot);
  return api.scene();
}
```

The SDK should expose primitive creation, mesh construction, material assignment, parenting, pivots, named components, curve generation, keyframe creation, and animation sampling.

It must not expose networking, API keys, browser DOM access, arbitrary filesystem access, package installation, or unrestricted imports.

**Recommendation:** Use structured output for routine edits and animation generation. Use procedural code where templates are insufficient. Both paths must produce the same canonical project data.

## 7. Staged AI generation pipeline

### Step 1 — Interpret the request

Classify it as model creation, geometry modification, appearance change, animation creation, clip modification, or interaction configuration.

### Step 2 — Inspect relevant capabilities

Build a compact manifest containing selected nodes, movable components, skeleton, morph targets, current clip, bounds/orientation, and allowed edit scope.

```
Model: Purple owl
Selected node: Right wing
Movable components: body, left wing, right wing, eyes
Skeleton: none
Morph targets: none
Current clip: Little wave, 1.35 seconds
Editable scope: selected wing, active clip only
```

For imports, include bone hierarchy, animation bindings, morph-target names, and available components. Send metadata and relevant tracks rather than entire vertex arrays by default.

### Step 3 — Generate a targeted patch

Prefer “Modify the right-wing rotation track in clip X; preserve all other nodes, materials, and tracks” over regenerating the entire project.

### Step 4 — Validate

Check schema validity, target IDs, finite values, keyframe ordering, quaternion validity, durations, geometry/texture budgets, prohibited operations, and changes outside the approved scope.

### Step 5 — Execute and bake

Run procedural code in the sandbox and convert its output into geometry or sampled animation tracks.

### Step 6 — Preview

Show before/after, changed objects or tracks, warnings, a generated explanation, and accept/reject controls.

### Step 7 — Commit a revision

Commit after validation and acceptance, or according to an explicit auto-apply preference. If the project changed while the job ran, detect the revision conflict; safely rebase or request regeneration instead of overwriting intervening work.

## 8. Manual animation editing

### First usable timeline

- Clip selection and renaming.
- Play, pause, stop, scrub, and loop.
- Playback speed and duration controls.
- Expandable tracks.
- Insert/delete/drag keyframes.
- Copy and paste.
- Undo and redo.
- Numeric value editing.
- Step and linear interpolation for newly authored tracks.

### Subsequent timeline capabilities

- Curve editor and cubic interpolation editing.
- Multi-keyframe selection and time scaling.
- Track locking and muting.
- Animation layers and additive clips.
- Retargeting tools.

### Manual keyframing workflow

1. Select an object or bone.
2. Move the playhead.
3. Change its transform.
4. Insert a keyframe, or use explicit auto-key mode.
5. Play the animation.

Clearly distinguish **base-pose editing** from **keyframed-pose editing** so users do not accidentally modify the whole model.

### AI/manual round-trip

```
AI motion specification or code
              ↓
Editable animation tracks
              ↓
Manual timeline adjustments
              ↓
AI receives the latest edited tracks
              ↓
AI proposes a targeted patch
```

For procedural animations, expose editable parameters such as speed and amplitude, plus **Bake to keyframes**. Once baked and manually edited, do not silently regenerate from stale procedural source. Make regeneration an explicit action.

## 9. Imported-model capabilities and limitations

Start with GLB. Add glTF packages and other formats through a dedicated import/conversion pipeline later.

| Imported asset | Supported approach |
| --- | --- |
| Separate objects, no skeleton | Animate object transforms and pivots |
| Skeletal model | Play and edit bone animation as timeline capabilities mature |
| Model with morph targets | Animate expressions and shape changes |
| Model with existing clips | Play, duplicate, trim, and modify clips |
| Single static mesh without a rig | Whole-object motion; articulation needs preparation |

If a fused owl mesh has no rig or separate wings, a request to “make the wings flap” cannot be treated as ordinary component animation. Offer whole-object motion, an existing rig, rig creation, component separation/remodelling, or a new animation-ready model.

Automatic rigging is a later feature, not an assumed LLM capability.

### Preserve source assets

Keep uploads immutable. Store edits as revisions or derived assets. Preserve existing clips and unsupported metadata where feasible, and warn about export limitations instead of silently dropping content.

## 10. Interaction and state layer

Separate motion clips from application behaviour. A clip rotates a wing over time; an interaction decides when and how to play it.

| Event/state | Example clip |
| --- | --- |
| Idle | Neutral pose |
| User typing | Listening lean |
| Request pending | Ponder tilt |
| Pointer hover | Little wave |
| Keyboard focus | Little wave |

Each mapping defines trigger, clip, priority, loop behaviour, transition duration, cooldown, interruptibility, and reduced-motion fallback.

**Chat-avatar default priority:** Request pending → user typing → hover → idle.

Store interaction rules in project metadata and an exported runtime configuration. GLB animation clips alone do not implement chat events, hover policy, or accessibility behaviour.

## 11. LLM provider connections and API keys

Use a provider adapter layer with capability flags for structured output, vision, streaming, and supported parameters.

```tsx
// Conceptual provider contract.
interface LLMProvider {
  generateStructured(request: StructuredRequest): Promise<Result>;
  generateCode(request: CodeRequest): Promise<Result>;
}
```

### Credential handling

1. User adds a provider connection.
2. Browser sends the key over HTTPS to the backend.
3. Backend encrypts the key if persistence is requested.
4. Interface receives only a masked connection record.
5. Generation jobs reference the connection ID.
6. Provider calls happen server-side.

For session-only connections, retain credentials ephemerally and define expiration behaviour.

Never place keys in generated code, exports, prompt history, client bundles, application logs, or browser local storage as the default persistence mechanism.

### Request controls

- Per-job cost and token limits.
- Timeouts and cancellation.
- Bounded retries and rate limiting.
- Provider/model selection.
- Usage reporting and redacted errors.
- Server-side request forgery protection for custom endpoints; user-configured URLs must not provide access to internal services.

## 12. Generated-code isolation and asset security

<aside>
🔒

Never execute generated code with `eval()` inside the main application. A Web Worker improves responsiveness but is not automatically a complete security boundary. A basic Node.js VM context is not sufficient isolation for hostile code.

</aside>

### Option A — Restricted interpreter

Run constrained JavaScript in an interpreter such as a WebAssembly-based runtime, with no host network/filesystem bindings, explicit SDK functions only, memory limits, execution interruption, and output-size limits.

### Option B — Isolated execution service

Use a separate environment per job, no outbound network by default, no credentials, minimal filesystem access, strict CPU/memory/wall-time limits, and validated output artifacts only.

### Validate resulting assets too

Even sandboxed code can produce an asset that stalls the renderer. Enforce limits on vertices/triangles, objects, texture dimensions and decoded size, animation tracks/keyframes, morph targets, and total asset size.

Apply equivalent limits to imports. Protect packaged imports against archive traversal and decompression bombs. Treat imported object names, metadata, and embedded text as untrusted data in LLM prompts.

## 13. Persistence, versioning, and export

### Persistence entities

- Projects and project revisions.
- Immutable asset versions.
- Animation clip versions.
- Provider connections.
- Generation jobs.
- Generation inputs/outputs, subject to retention settings.

For each AI edit, record the source revision, requested scope, proposed patch, validation results, accepted revision, provider/model metadata, and usage.

### Shared undo/redo command system

AI and manual edits should use the same command layer, with operations such as `SetNodeTransform`, `InsertKeyframe`, `ReplaceTrack`, `CreateClip`, and `ApplyModelPatch`.

Prefer small commands or patches over opaque full-state replacements.

### Export formats

| Format | Contents and purpose |
| --- | --- |
| GLB | Portable geometry, materials, and supported animation tracks |
| Native project archive | Full-fidelity project document, sources, procedural recipes, animation metadata, interaction mappings |
| Web runtime package | GLB, animation-state configuration, playback integration, reduced-motion rules |
| Later optional exports | Video, animated GIF/WebP, transparent image sequences |

Not every procedural behaviour maps directly to standard glTF animation. Bake supported transforms or morph targets and explicitly identify behaviour that must remain in the web runtime.

## 14. Phased implementation roadmap

### Phase 1 — Non-AI editor foundation

- [ ]  Project creation.
- [ ]  GLB import.
- [ ]  Viewport navigation.
- [ ]  Scene hierarchy and selection.
- [ ]  Transform controls.
- [ ]  Existing animation playback.
- [ ]  Basic save/load.

**Acceptance test:** Import a skeletal character and an object-animated model, inspect their parts, and play every included clip.

### Phase 2 — Manual animation editing

- [ ]  Timeline and editable transform tracks.
- [ ]  Keyframe creation and manipulation.
- [ ]  Clip duplication.
- [ ]  Undo/redo.
- [ ]  GLB animation export.

**Acceptance test:** Create a waving animation manually, export it, re-import it, and verify that its motion is preserved.

### Phase 3 — AI animation generation

- [ ]  Provider connections.
- [ ]  Model capability manifests.
- [ ]  Structured animation requests.
- [ ]  Validation and preview/accept/reject.
- [ ]  Targeted clip modifications.

**Acceptance test:** Generate a wave, manually slow it down, then ask AI to reduce its amplitude without losing the manual timing change.

### Phase 4 — Procedural model generation

- [ ]  Restricted model-building SDK.
- [ ]  Sandboxed execution and geometry budgets.
- [ ]  Parametric model recipes.
- [ ]  Stable component IDs.
- [ ]  Targeted model revisions.

**Acceptance test:** Generate the purple owl and its animations, then change body colour and wing proportions without breaking unrelated clips.

### Phase 5 — Interaction authoring

- [ ]  Event-to-animation mappings.
- [ ]  Priorities, cooldowns, and crossfades.
- [ ]  Reduced-motion behaviour.
- [ ]  Embeddable runtime export.

**Acceptance test:** Export an owl avatar that correctly responds to typing, pending requests, hover, keyboard focus, and reduced-motion settings.

### Phase 6 — Production hardening

- [ ]  Multi-user permissions.
- [ ]  Job cancellation and revision-conflict handling.
- [ ]  Quotas and cost controls.
- [ ]  Import security testing.
- [ ]  Asset optimisation.
- [ ]  Browser/device performance testing.
- [ ]  Backup and retention policies.

Add automatic rigging, advanced retargeting, and external generative-3D services only after the editor and generation foundations are dependable.

## 15. Testing strategy and launch scope

### Fixture library

Maintain examples of static GLBs, multi-part mascots, skinned characters, morph-target faces, multiple clips, duplicate object names, cubic animation tracks, large textures, and malformed assets.

### Four testing areas

| Area | Required coverage |
| --- | --- |
| Editing correctness | Undo/redo, keyframes, timing, save/load, concurrent revisions |
| Import/export fidelity | Compare sampled poses before export and after re-import—not merely whether a file opens |
| AI reliability | Invalid IDs, missing rigs, impossible requests, malformed responses, out-of-scope changes, bounded repair attempts |
| Security and performance | Infinite loops, oversized output, forbidden networking, malicious imports, large assets, mobile playback, hidden tabs |

### Recommended MVP

- GLB import/export.
- Procedural stylized model generation.
- Named-part transform animation.
- Playback of existing skeletal and morph animations.
- Usable keyframe timeline.
- AI animation creation and targeted revision.
- Secure bring-your-own API keys.
- Typing, thinking, and hover state mappings.
- Undo/redo and project versioning.

<aside>
🚀

**First milestone:** A manually editable owl animation that survives save, export, and re-import. Then connect the LLM to the same editing commands. The goal is a dependable editor with AI assistance—not a generator whose output users cannot reliably control.

</aside>