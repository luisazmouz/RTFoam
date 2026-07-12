// ============================================================
// RTFOAM — OPENAI GPT-5.6 PROXY
// ============================================================
// Cloudflare Worker that keeps the OpenAI key server-side.
// Required secret: OPENAI_API_KEY
// Optional variables:
//   OPENAI_MODEL             default: gpt-5.6
//   OPENAI_REASONING_EFFORT  default: high
//   ALLOWED_ORIGIN           default: *
// ============================================================

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'name', 'description', 'rootChordMM', 'tipChordMM', 'sweepMM',
    'targetWingLoadingGPerDM2', 'tailVolumeCoefficient',
    'fuselageLengthMM', 'noseLengthMM', 'fuselageHeightMM',
    'hStabSpanMM', 'hStabChordMM', 'vStabHeightMM', 'vStabChordMM',
    'cgPercentMAC', 'weightG', 'notes'
  ],
  properties: {
    name: { type: 'string', minLength: 3, maxLength: 40 },
    description: { type: 'string', minLength: 10, maxLength: 220 },
    rootChordMM: { type: 'integer' },
    tipChordMM: { type: 'integer' },
    sweepMM: { type: 'integer' },
    targetWingLoadingGPerDM2: { type: 'integer' },
    tailVolumeCoefficient: {
      type: 'integer',
      description: 'Horizontal tail volume coefficient multiplied by 100. Example: 50 means 0.50.'
    },
    fuselageLengthMM: { type: 'integer' },
    noseLengthMM: { type: 'integer' },
    fuselageHeightMM: { type: 'integer' },
    hStabSpanMM: { type: 'integer' },
    hStabChordMM: { type: 'integer' },
    vStabHeightMM: { type: 'integer' },
    vStabChordMM: { type: 'integer' },
    cgPercentMAC: { type: 'integer' },
    weightG: { type: 'integer' },
    notes: {
      type: 'array',
      minItems: 4,
      maxItems: 6,
      items: { type: 'string', minLength: 4, maxLength: 180 }
    }
  }
};

export default {
  async fetch(request, env) {
    const cors = makeCors(env.ALLOWED_ORIGIN || '*');
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
    if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY is not configured on the worker.' }, 500, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Bad JSON' }, 400, cors);
    }

    const { system, messages } = body || {};
    if (!system || !Array.isArray(messages) || !messages.length) {
      return json({ error: 'Expected {system, messages}' }, 400, cors);
    }

    const input = messages.map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'input_text', text: String(message.content || '') }]
    }));

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + env.OPENAI_API_KEY
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || 'gpt-5.6',
          instructions: system,
          input,
          reasoning: { effort: env.OPENAI_REASONING_EFFORT || 'high' },
          max_output_tokens: 3000,
          text: {
            format: {
              type: 'json_schema',
              name: 'foam_aircraft_design',
              strict: true,
              schema: DESIGN_SCHEMA
            }
          }
        })
      });

      if (!response.ok) {
        const upstream = await response.text();
        return json({ error: 'OpenAI ' + response.status + ': ' + upstream.slice(0, 500) }, 502, cors);
      }

      const result = await response.json();
      const text = extractOutputText(result);
      if (!text) {
        const refusal = extractRefusal(result);
        return json({ error: refusal || 'OpenAI returned no design output.' }, 502, cors);
      }

      return json({
        text,
        model: result.model || env.OPENAI_MODEL || 'gpt-5.6',
        requestId: result.id || null
      }, 200, cors);
    } catch (error) {
      return json({ error: String(error && error.message ? error.message : error) }, 500, cors);
    }
  }
};

function extractOutputText(result) {
  if (typeof result.output_text === 'string' && result.output_text.trim()) return result.output_text;
  const chunks = [];
  for (const item of result.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('');
}

function extractRefusal(result) {
  for (const item of result.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'refusal' && part.refusal) return part.refusal;
    }
  }
  return '';
}

function makeCors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin'
  };
}

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors }
  });
}
