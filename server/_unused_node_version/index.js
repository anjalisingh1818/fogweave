/**
 * FogWeave backend — the only place that holds the Groq API key.
 * One endpoint: given a brand-new node's topic + the existing graph's
 * node list, ask the model for:
 *   - a short summary
 *   - which existing nodes it's likely related to (as suggested edges)
 *   - a reliability score (coin-divination readout) + a one-line risk note
 *
 * Run: npm install (in this folder), then copy .env.example to .env
 * and fill in GROQ_API_KEY, then `npm start`.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const PORT = process.env.PORT || 8787;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/summarize-and-link', async (req, res) => {
  const { topic, existingNodes = [] } = req.body || {};
  if (!topic || typeof topic !== 'string') {
    return res.status(400).json({ error: 'topic (string) is required' });
  }
  if (!GROQ_API_KEY) {
    console.error('[fogweave-server] GROQ_API_KEY is not set — see .env.example');
    return res.status(500).json({ error: 'server not configured' });
  }

  const nodeList = existingNodes
    .map((n) => `- id="${n.id}" topic="${n.topic}"`)
    .join('\n') || '(graph is empty so far)';

  const prompt = `You are the research engine behind a VR knowledge-graph app.
A user just created a new node with this topic: "${topic}"

Existing nodes already in the graph:
${nodeList}

Respond with STRICT JSON only, no prose, no markdown fences, matching exactly:
{
  "summary": "2-3 sentence factual summary of the topic",
  "suggestions": [{"nodeId": "<id from the existing list, or omit if none>", "confidence": 0.0-1.0, "reason": "short phrase"}],
  "reliability": 0.0-1.0,
  "riskNote": "one short sentence on how trustworthy/verifiable this summary is (e.g. 'well-established, low risk' or 'single interpretation, verify independently')"
}
Only include a suggestion if you are reasonably confident the two topics are actually related. It is fine to return an empty suggestions array.`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('[fogweave-server] Groq error:', groqRes.status, errText);
      return res.status(502).json({ error: 'upstream LLM error' });
    }

    const data = await groqRes.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Model occasionally wraps JSON in fences despite instructions — strip and retry once.
      const stripped = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(stripped);
    }

    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s) => s && typeof s.nodeId === 'string')
      : [];

    res.json({
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      suggestions,
      reliability:
        typeof parsed.reliability === 'number'
          ? Math.max(0, Math.min(1, parsed.reliability))
          : 0.5,
      riskNote: typeof parsed.riskNote === 'string' ? parsed.riskNote : '',
    });
  } catch (err) {
    console.error('[fogweave-server] request failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

app.listen(PORT, () => {
  console.log(`[fogweave-server] listening on http://localhost:${PORT}`);
});
