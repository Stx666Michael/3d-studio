# Multi-scene projects and selective GLB export

## Objective

Allow one 3D Studio project to contain multiple editable scenes and let users choose both the scene and animation clip when exporting a GLB.

## Interface

- In-memory project state:
  - `scenes: [{id, document}]`
  - `activeSceneId`
  - `document` remains the active-scene alias used by the existing editor controller.
- Project JSON:
  - Saves use `format: "3d-studio-project", version: 1` with:
    - `activeSceneId`
    - `scenes: [{id, name, glb, recipe}]`
  - Files from the retired project format are rejected.
- GLB export:
  - `exportGLB(document)` continues exporting all animations for existing callers.
  - `exportGLB(document, {animationId: "__all__"})` exports all animations.
  - `exportGLB(document, {animationId: ""})` exports the selected scene in its base pose without animations.
  - `exportGLB(document, {animationId: "<clip id>"})` exports only that clip.
- UI:
  - Scene selector with new, duplicate, and delete actions.
  - Export dialog with scene and animation selectors.
  - GLB imports become new scenes; generated models continue replacing the active scene.

## Project Structure

- Modify `public/editor-controller.mjs` for scene lifecycle, project serialization, scene UI, and export dialog behavior.
- Modify `public/engine.mjs` for selective animation export.
- Modify `public/editor-shell.html` for scene controls and export dialog markup.
- Add scene-control styles and import them from `public/app.jsx`.
- Modify `public/contracts.mjs` for the project scene-count limit.
- Extend `checks.mjs` for multi-scene saves, retired-format rejection, scene switching, and selective animation export.
- Update `README.md` with the new project and export behavior.

## Code Style

- Preserve the existing active-document editor APIs and use small controller helpers rather than duplicating scene operations.
- Keep GLB parsing/export independent from DOM state.
- Use existing validation and error/status patterns; do not silently discard malformed scenes.
- Use only current 3D Studio project identifiers and generated node IDs.

## Testing Strategy

- Unit-test GLB export with all animations, no animations, and one selected clip.
- Round-trip a version 2 project containing at least two scenes and verify names, meshes, and clips.
- Verify retired project formats are rejected.
- Verify scene limits and malformed scene entries are rejected.
- Run the existing regression suite, production build, and a browser smoke test for scene selection and export dialog initialization.

## Boundaries

- This change does not add cross-scene animation blending, shared assets, scene graph instancing, or timeline editing across scenes.
- A GLB export contains exactly one selected scene; GLB multi-scene import remains outside this change.
- Scene names are derived from document names; a separate scene-renaming workflow is not added.
- Existing files from the retired format are not migrated or rewritten.
