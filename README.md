# 3D Studio — Gemini MVP 0.1

A local, runnable 3D model and animation editor. It opens with an empty workspace; use **Starter owl** to load the bundled purple owl with nine animation clips.

## Start
Install Node.js 22 or newer. Open a terminal in `3d-studio`, then run:

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3000. Vite watches the React frontend and applies HMR when source files change. The local Gemini API server runs behind the Vite proxy on port 3001.

For a production-style local run, use `npm start`. It builds the frontend into `dist/` first, then starts the local server on port 3000.

## Connect Gemini
Open **Gemini connection** in the app. Enter a Gemini Developer API key and a structured-output-capable model available to your account. The default model ID is `gemini-3.8-flash`; it is editable. Obtain a key from https://aistudio.google.com/apikey.

The key is sent to the local backend and held in server memory for the browser session. It is not saved in project files, localStorage, or logs. Use **Forget session key** to clear it. Restarting the server also clears session keys. An eight-hour inactivity timeout applies. Saving a connection configures it but does not verify Google access until generation.

Alternatively copy `.env.example` to `.env` and set GEMINI_API_KEY. This deliberately stores a key in a local file; keep it private. Removing a session key does not remove a server environment key.

Gemini requests are real and may incur charges. Prompts, scene names/transforms and relevant animation tracks are sent to Google; mesh buffers are not. No real user API key was supplied during this build, so the provider request path was tested using mocks, not a live billable generation.

## Implemented
- Gemini text-to-model via validated sphere/box/cylinder/cone recipes.
- Gemini animation generation and active-clip revision via validated editable tracks.
- AI preview, accept/discard, cancellation and scene-revision conflict detection.
- Orbit/zoom/frame, scene selection and numeric local-transform editing.
- Nine owl clips; play/pause/stop, speed, loop and scrubbing controls.
- New/duplicate clips; keyframe insertion, replacement and deletion; LINEAR/STEP interpolation.
- Separate base-pose and keyframe-pose editing; undo/redo (20 transactions).
- Supported GLB import/export and local `.3ds` project save/reopen with up to 32 independent scenes.
- New, duplicate, delete and switch project scenes; GLB imports are added as new scenes.
- Export one selected scene as GLB with the base pose, one animation, or all animations.
- Responsive light/dark interface. Playback is user-triggered and pauses in hidden tabs.
- React frontend bootstrapped with Vite HMR and a production build.
- Three.js renderer with scene hierarchy, standard materials, lighting, selection highlighting and damped orbit controls.

## Walkthrough
Select `hover-wave`, press Play, then stop. Select the right wing in Scene, choose Rotation and Keyframe pose, seek to a time, change Z and insert/update a keyframe. Use **New scene** or **Duplicate** to create another project scene. Add a Gemini key and try “Make the owl gently tilt and blink while thinking. Loop smoothly over three seconds.” Review the result before applying. Use **Export GLB** to choose a scene and whether to include the base pose, one animation, or all animations.

## MVP scope and limitations
This is a single-user local development app, not a production hosted service. React and Vite provide the frontend runtime and build workflow; Three.js provides the WebGL renderer. The Node backend remains local-first and does not require a separate database.

No arbitrary generated JavaScript is executed. Structured recipes and animation tracks are the safe first path; isolated code execution is deferred.

GLB support: self-contained glTF 2.0, solid opaque materials, optional vertex colours, unskinned triangle geometry, one primitive per mesh and LINEAR/STEP translation/rotation/scale clips. Imports are limited to 50 MB, 1,000,000 vertices and 1,000,000 triangles. Unsupported skins, textures, transparency, morph targets, compression, sparse accessors and cubic tracks are rejected rather than silently stripped. Static matrix nodes render but are read-only. Use a current WebGL2 browser.

No skeletal rigging, texture generation, transform gizmos, curve graph editor, retargeting, interaction-state authoring or cloud persistence yet. Model prompts create a replacement scene after acceptance; targeted AI geometry revision is deferred. New model recipes are limited to 64 primitives.

Keyframes can be inserted/replaced/deleted. To move a key in time, delete its old entry and reinsert its values at the new time. Duration changes do not retime existing keys. Empty clips are omitted from GLB/project export; add a key before saving. Project saves use the current `3d-studio-project` format and contain one embedded GLB plus optional recipe per scene. Retired project formats are rejected rather than migrated. History is not persisted and canonical IDs are regenerated on import while bindings are preserved.

## Security
Server binds to 127.0.0.1 and restricts Host to localhost/loopback. Mutation routes require same-origin and CSRF token. HttpOnly SameSite=Strict session cookies, output validation, size/concurrency/rate limits and an 85-second provider timeout are included. No credentials are passed into generated scene data. Keys in memory remain accessible to someone who controls the host process.

Do not expose this server directly to the internet. Shared deployment needs authentication, HTTPS, encrypted persistent secrets, tenant isolation, durable projects, queueing, global quotas, stronger import isolation and production monitoring.

## Verify
```sh
npm test
npm run build
```
Fourteen checks cover bounded recipes, primitive GLB round-trip, import limits, preservation of all nine owl clips, selective animation and empty-scene export, multi-scene project round-trips and retired-format rejection, quaternion sampling, rest-pose immutability, animation validation, CSRF/key isolation, retired-cookie rejection, mocked Gemini structured-output requests, missing keys and malformed output, plus the React/Vite configuration.

Browser integration also exercised playback, keyframe editing, undo/redo, secret-input clearing, mocked AI preview/reject/apply/undo and GLB export/reimport, with no JavaScript errors in the passing run. Desktop/mobile screens were inspected.

## Files
- `server.mjs`: local server, sessions, Gemini adapter and safe Three.js module delivery.
- `dev.mjs`: Vite HMR server plus the local API server.
- `start.mjs`: production bundle server entry point.
- `vite.config.mjs`: React/Vite development proxy and build configuration.
- `public/contracts.mjs`: schemas and validation.
- `public/engine.mjs`: primitives, GLB I/O and animation sampling.
- `public/project.mjs`: current multi-scene project serialization and validation.
- `public/app.jsx`: React application entry point.
- `public/editor-shell.html`: editor markup mounted by React.
- `public/editor-controller.mjs`: editor history, controls and generation flow.
- `public/scenes.css`: responsive scene and project controls.
- `public/renderer.mjs`: Three.js scene renderer.
- `public/index.html`, `public/style.css`: Vite HTML entry and UI styles.
- `public/assets/starter-owl.glb`: bundled starter owl asset.
- `checks.mjs`: automated verification.

Gemini adapter uses the generateContent endpoint, x-goog-api-key and JSON-schema structured responses. Reference: https://ai.google.dev/gemini-api/docs/structured-output
