# Slipstream Foamworks — GPT-5.6 engineering build v7

This build uses an OpenAI Responses API proxy, structured JSON output, engineering validation, flight-report calibration, and deterministic hangar duplicate detection.

## Publish

Upload these together:

- `index.html`
- `styles.css`
- `app.js`
- `plan-lib.js`
- the complete `knowledge/` folder

Deploy `worker.js` separately as a Cloudflare Worker.

## Cloudflare Worker variables

Required secret:

- `OPENAI_API_KEY`

Optional variables:

- `OPENAI_MODEL` — defaults to `gpt-5.6`
- `OPENAI_REASONING_EFFORT` — defaults to `high`
- `ALLOWED_ORIGIN` — set this to the production website origin instead of `*`

## Knowledge files

The v7 application requires all of these before generation:

- `report.md`
- `equations.json`
- `aircraft-types.json`
- `design-rules.json`
- `validation.json`
- `materials.json`
- `motors.json`
- `novelty.json`

The browser fetches them with `cache: no-store`. Missing or malformed knowledge disables generation rather than using hidden fallback rules.

## What changed in v7

- Style-specific preferred and hard aerodynamic bands
- Flying-wing overrides
- Motor weight, wingspan, battery, propeller, thrust, and thrust-to-weight constraints
- Material span, chord, mass, and reinforcement constraints
- Control-configuration/style compatibility
- Explicit cross-validation rules
- Knowledge-driven novelty metrics and retry thresholds
- Parser enforcement of motor/material/style compatibility
