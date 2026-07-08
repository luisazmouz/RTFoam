# Slipstream Foamworks — Design Reference

This is a **required** knowledge file. The app fetches this file (and the
other files in this folder) fresh before every generation and fails
generation if any of them are missing — see `/knowledge/README.md`.

This designs **RC foam-board aircraft** (radio-controlled models built from
flat foam board, equipped with a brushless motor and hobby servos) — NOT
folded paper airplanes. Every dimension below assumes a real, flyable
powered RC model.

## Design equations (implemented in plan-lib.js, explained here for the model)

- Wing area:  S = ((rootChord + tipChord) / 2) × wingspan
- Aspect ratio:  AR = wingspan² / S
- Taper ratio:  λ = tipChord / rootChord
- Mean Aerodynamic Chord:  MAC = rootChord × (2/3) × (1 + λ + λ²) / (1 + λ)
- Wing loading:  WL = weight / S  (g/dm²) — weight is DERIVED from S × target WL, never chosen freely
- Horizontal tail volume coefficient:  Vh = (Sh × Lh) / (S × MAC)
- Vertical tail area:  Sv = verticalFinPercent × S
- CG is expressed as %MAC aft of the wing leading edge

See `equations.json` for the same formulas in structured form,
`aircraft-types.json` for the per-style numeric bands, `design-rules.json`
for control-configuration and structural rules, and `validation.json` for
the hard min/max bounds the app clamps every generated design into.

## Per-style design intent (bands are enforced in aircraft-types.json)

- **Trainer** — flat-bottom or semi-symmetrical section, generous dihedral, forgiving stall. Never sweep the wing meaningfully.
- **Sport** — mid-wing, moderate dihedral, comfortable with loops/rolls.
- **Fighter** — swept, low-aspect-ratio wing; smaller, more effective control surfaces; fast and less forgiving — flag this in build notes.
- **Experimental** — can be a flying wing or unconventional layout; when built with the "Elevons only" control configuration, CG must sit toward the front of its band (no tail to mask a CG error) and root sweep should be substantial for pitch stability without a horizontal tail.
- **Aerobatic** — near-neutral CG for symmetric up/down performance, oversized control surfaces and tail for authority. Wing section should be symmetrical (flat-pattern foam approximates this — note it in build notes).
- **Warbird** — scale-inspired proportions: moderate taper, slightly heavier wing loading than a pure sport model is normal and expected.

## Control configurations

- **Ailerons + Elevator** (conventional tail) — 4 servos. Standard layout, easiest to trim.
- **Elevons only** — 2 servos. No horizontal stabilizer; CG is critical since there is no tail to mask a CG error.
- **Ailerons + Elevator + Rudder** (full tail) — 5 servos. Best low-speed and crosswind handling.
- **V-tail** — 4 servos (2 aileron + 2 ruddervator). The two tail panels are cut flat and mounted at a dihedral angle during assembly.

## Wing panel limit

No single generated part may exceed 800 mm — a common foam-board sheet
dimension. Wingspans over 800 mm are cut as two panels (each ≤ 800 mm)
joined at the centerline with a taped hinge; the cut sheet marks this join
line and the build notes call it out explicitly.

## Structural / build rules

- Foam board thickness: 5 mm (or 3 mm depron, lighter but less rigid) — see `materials.json`.
- Carbon spar at 30% chord — score, do not cut.
- Control surface hinge at 70–75% local chord.
- Minimum control surface width: 25 mm.
- Root chord must always exceed tip chord (taper ratio 0.45–0.85).
- Nose length: 15–22% of fuselage length, long enough to fit the battery ahead of the CG.
