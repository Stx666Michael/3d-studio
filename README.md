# Lilac Studio — Gemini MVP 0.1

A local, runnable 3D model and animation editor. Includes the purple owl with nine animation clips.

## Start
Install Node.js 22 or newer. Unzip, open a terminal in `lilac-studio`, then run:

```sh
npm start
```

Open http://127.0.0.1:3000. No npm dependencies need installing. The editor and starter owl work without an API key.

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
- Supported GLB import/export and local `.lilac.json` save/reopen.
- Responsive light/dark interface. Playback is user-triggered and pauses in hidden tabs.

## Walkthrough
Select `hover-wave`, press Play, then stop. Select `Lilac_rightWing` in Scene, choose Rotation and Keyframe pose, seek to a time, change Z and insert/update a keyframe. Add a Gemini key and try “Make the owl gently tilt and blink while thinking. Loop smoothly over three seconds.” Review the result before applying. Export GLB to move it into another tool.

## MVP scope and limitations
This is a single-user local development app, not a production hosted service. The first vertical slice uses native WebGL2 and Node built-ins to run without dependency installation. A React/Three.js migration remains a next step.

No arbitrary generated JavaScript is executed. Structured recipes and animation tracks are the safe first path; isolated code execution is deferred.

GLB support: self-contained glTF 2.0, solid opaque materials, optional vertex colours, unskinned triangle geometry, one primitive per mesh and LINEAR/STEP translation/rotation/scale clips. Unsupported skins, textures, transparency, morph targets, compression, sparse accessors and cubic tracks are rejected rather than silently stripped. Static matrix nodes render but are read-only. Use a current WebGL2 browser.

No skeletal rigging, texture generation, transform gizmos, curve graph editor, retargeting, interaction-state authoring or cloud persistence yet. Model prompts create a replacement scene after acceptance; targeted AI geometry revision is deferred. New model recipes are limited to 64 primitives.

Keyframes can be inserted/replaced/deleted. To move a key in time, delete its old entry and reinsert its values at the new time. Duration changes do not retime existing keys. Empty clips are omitted from GLB/project export; add a key before saving. Project saves contain embedded GLB plus optional recipe; history is not persisted and canonical IDs are regenerated on import while bindings are preserved.

## Security
Server binds to 127.0.0.1 and restricts Host to localhost/loopback. Mutation routes require same-origin and CSRF token. HttpOnly SameSite=Strict session cookies, output validation, size/concurrency/rate limits and an 85-second provider timeout are included. No credentials are passed into generated scene data. Keys in memory remain accessible to someone who controls the host process.

Do not expose this server directly to the internet. Shared deployment needs authentication, HTTPS, encrypted persistent secrets, tenant isolation, durable projects, queueing, global quotas, stronger import isolation and production monitoring.

## Verify
```sh
npm test
```
Nine checks cover bounded recipes, primitive GLB round-trip, preservation of all nine owl clips, quaternion sampling, rest-pose immutability, animation validation, CSRF/key isolation, mocked Gemini structured-output requests, missing keys and malformed output.

Browser integration also exercised playback, keyframe editing, undo/redo, secret-input clearing, mocked AI preview/reject/apply/undo and GLB export/reimport, with no JavaScript errors in the passing run. Desktop/mobile screens were inspected.

## Files
- `server.mjs`: local server, sessions and Gemini adapter.
- `public/contracts.mjs`: schemas and validation.
- `public/engine.mjs`: renderer, primitives, GLB I/O and animation sampling.
- `public/app.mjs`: editor, history, controls and generation flow.
- `public/index.html`, `public/style.css`: UI.
- `public/assets/lilac-animated.glb`: starter model.
- `checks.mjs`: automated verification.

Gemini adapter uses the generateContent endpoint, x-goog-api-key and JSON-schema structured responses. Reference: https://ai.google.dev/gemini-api/docs/structured-output
