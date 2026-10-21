/**
 * The welcome screen (index.html #welcome): it covers the page from the first
 * frame, says what is happening while today's news loads, and fades out once
 * the stars are in. After a while it offers the Demo scene instead of waiting.
 */
const el = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

let offerTimer = null;

export function welcomeStep(text, { offerDemo = null, after = 12000 } = {}) {
  const step = el('welcome-step');
  if (!step || el('welcome')?.classList.contains('gone')) return;
  step.textContent = text;
  clearTimeout(offerTimer);
  if (offerDemo) {
    offerTimer = setTimeout(() => {
      const alt = el('welcome-alt');
      if (!alt || alt.firstChild) return;
      const b = document.createElement('button');
      b.textContent = 'Taking a while? Open the Demo scene';
      b.onclick = () => offerDemo();
      alt.appendChild(b);
    }, after);
  }
}

export function welcomeDone() {
  clearTimeout(offerTimer);
  const w = el('welcome');
  if (!w || w.classList.contains('gone')) return;
  w.classList.add('gone');
  setTimeout(() => w.remove(), 1000);
}
