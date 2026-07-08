# /knowledge/ — required design source-of-truth

The app fetches ALL of these files fresh (`cache: 'no-store'`) before every
generation. If any file is missing or empty, generation stops with a
visible error instead of silently falling back to hardcoded rules.

- **report.md** — prose design reference, injected into the AI system prompt.
- **equations.json** — the formulas plan-lib.js implements, documented for the model.
- **aircraft-types.json** — per-style numeric bands (wing loading, aspect ratio, CG, tail volume, sweep). This is the source of truth the app clamps every generated design into — edit these numbers to change how aircraft are designed.
- **design-rules.json** — control-configuration definitions (servo count, tail type) and structural rules (taper ratio, spar/hinge position, wing panel limit).
- **validation.json** — hard min/max bounds used as a last-resort safety clamp.
- **materials.json** — foam options shown in the UI.
- **motors.json** — motor options shown in the UI.

Delete or rename any file here and Generate will refuse to run — this is
intentional, so the generator can never silently drift back to
hardcoded-in-JS defaults.
