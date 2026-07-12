# /knowledge/ — mandatory engineering source of truth

The app fetches every file below with `cache: no-store` before each generation. Missing, empty, malformed, or incompatible knowledge disables generation.

- `report.md`: reasoning sequence and coupled aerodynamic guidance.
- `equations.json`: equations and derived comparison quantities.
- `aircraft-types.json`: style missions, safe/preferred bands, proportions, and flying-wing overrides.
- `design-rules.json`: structural rules, reasoning order, and control-configuration compatibility.
- `validation.json`: global hard limits and required cross-checks.
- `materials.json`: mass, span, chord, and reinforcement constraints.
- `motors.json`: weight, span, propeller, battery, thrust, and thrust-to-weight guidance.
- `novelty.json`: hangar comparison metrics, thresholds, retry policy, and minimum material differences.

Engineering bands live here; JavaScript implements equations and enforcement. Duplicate thresholds must not be hardcoded separately in the UI.
