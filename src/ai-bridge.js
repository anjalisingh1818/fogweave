/**
 * Talks to the small backend in /server (see server/main.py), which
 * holds the Groq API key. Set VITE_FOGWEAVE_API_BASE in a .env file
 * to point at it (defaults to localhost for dev).
 */
const API_BASE = import.meta.env.VITE_FOGWEAVE_API_BASE || 'http://localhost:8787';

/**
 * Given a brand-new node's topic and the existing node list, ask the
 * backend for a short summary, which existing nodes it likely relates
 * to, and a reliability/risk read (used by the coin divination).
 * Never throws — on any failure it returns a neutral fallback so the
 * UI never gets stuck on "researching".
 */
export async function summarizeAndLink(topic, existingNodes) {
  try {
    const res = await fetch(`${API_BASE}/summarize-and-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        existingNodes: existingNodes.map((n) => ({ id: n.id, topic: n.topic })),
      }),
    });
    if (!res.ok) throw new Error(`backend ${res.status}`);
    const data = await res.json();
    return {
      summary: data.summary || '',
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
      reliability: typeof data.reliability === 'number' ? data.reliability : 0.5,
      riskNote: data.riskNote || '',
    };
  } catch (err) {
    console.warn('[fogweave] summarizeAndLink failed, using fallback:', err);
    return { summary: '', suggestions: [], reliability: 0.5, riskNote: 'AI unreachable — unverified' };
  }
}
