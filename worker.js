// ============================================================
// SLIPSTREAM FOAMWORKS — AI PROXY (Cloudflare Worker)
// ============================================================
// This tiny server hides your AI API key from visitors. It does NOT
// contain any aircraft design rules — it only forwards the already-
// built system prompt (which the site assembles from /knowledge/) to
// your chosen AI provider. All design knowledge lives in the site's
// knowledge/ folder, not here.
//
// DEPLOY (free):
//   1. https://dash.cloudflare.com → Workers & Pages → Create Worker
//   2. Paste this whole file, click Deploy.
//   3. Settings → Variables → add ONE secret:
//        ANTHROPIC_API_KEY   (an Anthropic key)     — or —
//        OPENAI_API_KEY      (an OpenAI/OpenRouter/Groq key)
//      Optional (for OpenAI-compatible providers):
//        OPENAI_BASE_URL  e.g. https://openrouter.ai/api/v1
//        OPENAI_MODEL     e.g. gpt-4o-mini
//   4. Copy the worker URL (https://your-worker.your-name.workers.dev)
//      into CONFIG.API_PROXY_URL at the top of index.html.
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*', // optionally lock to your domain
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST')
      return json({ error: 'POST only' }, 405);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
    const { system, messages } = body || {};
    if (!system || !Array.isArray(messages)) return json({ error: 'Expected {system, messages}' }, 400);

    try {
      if (env.ANTHROPIC_API_KEY) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-haiku-4-5', max_tokens: 2000, system, messages }),
        });
        if (!r.ok) return json({ error: 'Upstream ' + r.status + ': ' + (await r.text()).slice(0, 200) }, 502);
        const j = await r.json();
        return json({ text: (j.content || []).map(c => c.text || '').join('') });
      }

      if (env.OPENAI_API_KEY) {
        const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const r = await fetch(base + '/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.OPENAI_API_KEY },
          body: JSON.stringify({
            model: env.OPENAI_MODEL || 'gpt-4o-mini',
            max_tokens: 2000,
            messages: [{ role: 'system', content: system }, ...messages],
          }),
        });
        if (!r.ok) return json({ error: 'Upstream ' + r.status + ': ' + (await r.text()).slice(0, 200) }, 502);
        const j = await r.json();
        return json({ text: j.choices?.[0]?.message?.content || '' });
      }

      return json({ error: 'No API key configured on the worker. Add ANTHROPIC_API_KEY or OPENAI_API_KEY as a secret.' }, 500);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS } });
}
