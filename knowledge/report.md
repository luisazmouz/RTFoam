# Slipstream Foamworks — Engineering Reasoning Reference

This folder is mandatory. The application must refuse generation when any listed knowledge file is missing, empty, malformed, or internally inconsistent.

## Required reasoning sequence

1. Validate that the selected control configuration is allowed for the selected style.
2. Validate the requested wingspan against the selected material and motor guidance.
3. Read the complete hangar inventory and identify the closest existing aircraft before proposing geometry.
4. Select a target wing loading inside the style band and compatible with the selected motor's absolute all-up-weight range.
5. Select aspect ratio, taper, and sweep as a coherent planform rather than independent cosmetic values.
6. Derive root and tip chords from wingspan, target aspect ratio, and taper.
7. Select fuselage length from the style fuselage-to-span band, then enforce the tail-arm-to-MAC range.
8. Size the horizontal tail from a selected tail-volume coefficient. Size the fin from wing area and configuration.
9. Place CG conservatively inside the style band; flying wings must use their override band.
10. Compare the validated candidate against every hangar design using novelty.json. A different name does not make duplicate geometry novel.

## Coupled engineering rules

- Higher wing loading increases stall speed and landing energy. Do not compensate for an undersized motor by merely increasing loading.
- Greater sweep and lower aspect ratio generally increase speed-oriented character and CG sensitivity. Swept aircraft require conservative CG placement and adequate fin area.
- A shorter tail moment arm requires a larger horizontal stabilizer to maintain the same tail volume.
- Flying wings have no horizontal tail to mask CG errors. They require forward CG, substantial sweep, suitable reflex/elevons, and adequate winglets or fins.
- A motor is acceptable only when calculated all-up weight falls within its absolute range. Recommended ranges are preferred; absolute ranges are hard limits.
- Material limits are structural constraints. Designs above a material's spar threshold require reinforcement notes; designs above its absolute span are invalid.
- Large foam-board aircraft need center-join reinforcement, spar continuity, and a reinforced firewall.

## Style identity

Each style in aircraft-types.json contains mission, preferred bands, hard style bands, proportions, priorities, and prohibited tendencies. Use preferred bands by default, but move elsewhere within hard bands when needed for novelty, flight-report calibration, motor compatibility, or an explicit pilot mission.

## Flight-report learning

- Nose-heavy: consider a slightly aft but still safe CG, a longer battery bay, or less unnecessary nose structure.
- Tail-heavy: move CG forward, shorten/lighten the tail, or reserve battery travel ahead of CG.
- Stalled or crashed: reduce wing loading, increase tail volume, reduce sweep, or choose a more conservative CG depending on the report.
- Too fast: lower target wing loading and reduce sweep; do not merely weaken the motor.
- Flew great: preserve the successful stability relationships, not the exact geometry.

## Output discipline

Return one complete internally consistent aircraft. Notes must state required reinforcement, motor/material caveats, CG sensitivity, and maiden-flight precautions specific to the proposed geometry.

## RTFOAM V8 output and power-system rules

- The pilot does not select a motor. First solve the airframe geometry and all-up weight, then recommend the safest compatible motor from `motors.json`.
- The recommendation must include motor label, battery cell count, and a conservative propeller from that motor's catalog entry.
- Control configuration must be compatible with the selected style. Never force a conventional style into a tailless layout merely to create novelty.
- A flying wing must read as one coherent aircraft: mirrored wing panels, a center pod or battery bay integrated into the root region, two vertical fins or winglets, elevons, continuous spar paths, and an accessible motor/firewall arrangement.
- Avoid disconnected decorative geometry. Every rendered component must have a clear assembly relationship and structural purpose.
- The final presentation should support an exploded assembly view, a ready/assembled view, specifications, CG, motor recommendation, spar locations, servo locations, and concise assembly priorities.


## Supported architecture set in version 9
Only four aircraft families are supported: Trainer, Fighter, Experimental, and Warbird. Do not answer with Sport or Aerobatic as a style. Each result must use a geometrically distinct architecture appropriate to its selected family.
