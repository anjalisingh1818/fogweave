/**
 * Thin wrapper around the Web Speech API (SpeechRecognition).
 * Hands-only rule means no keyboard fallback in-session; if the
 * browser has no speech support we fail loudly in the console so it's
 * obvious during on-device testing rather than silently doing nothing.
 */
const SpeechRecognitionCtor =
  window.SpeechRecognition || window.webkitSpeechRecognition;

let recognizer = null;
let listening = false;

function ensureRecognizer() {
  if (recognizer || !SpeechRecognitionCtor) return recognizer;
  recognizer = new SpeechRecognitionCtor();
  recognizer.continuous = false;
  recognizer.interimResults = false;
  recognizer.lang = 'en-US';
  return recognizer;
}

/**
 * Listens once and resolves with the recognized text (trimmed), or
 * '' on error/timeout/no-support. Never throws.
 */
export function listenOnce({ timeoutMs = 6000 } = {}) {
  const rec = ensureRecognizer();
  if (!rec) {
    console.warn('[fogweave] SpeechRecognition not supported in this browser');
    return Promise.resolve('');
  }
  if (listening) return Promise.resolve('');

  return new Promise((resolve) => {
    let done = false;
    const finish = (text) => {
      if (done) return;
      done = true;
      listening = false;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      resolve(text);
    };
    const timer = setTimeout(() => finish(''), timeoutMs);

    rec.onresult = (event) => {
      clearTimeout(timer);
      const text = event.results?.[0]?.[0]?.transcript?.trim() || '';
      finish(text);
    };
    rec.onerror = () => {
      clearTimeout(timer);
      finish('');
    };
    rec.onend = () => {
      clearTimeout(timer);
      finish('');
    };

    try {
      listening = true;
      rec.start();
    } catch (err) {
      clearTimeout(timer);
      finish('');
    }
  });
}
