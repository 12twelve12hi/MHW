// review.html (LAB-PLAN F10, Review): the item the background keeps for review (lab/review), shown with JavaScript off
// (an iframe sandboxed with no permissions) and in greys (CSS filter grayscale(1)), with its word count and the size of
// what goes (formatMB of the deflated page), and its title to edit. Send sends it with that title; Cancel drops it.

import { api } from './api.js';
import { formatMB } from './daylight-share.js';
import { LAB_TEXT, fillText } from './daylight-lab.js';
import { rowMessage } from './logic.js';

const $ = (id) => document.getElementById(id);
const token = location.hash.replace(/^#/, '');
const S = LAB_TEXT.sendAs;

document.documentElement.classList.add('wide');

async function call(type, extra = {}) {
  let res;
  try { res = await api.runtime.sendMessage({ type, ...extra }); } catch { res = null; }
  if (!res) throw new Error('Send to Daylight isn’t responding. Close this and try again.');
  if (!res.ok) throw new Error(res.error || 'Something went wrong.');
  return res.result;
}

const ready = () => { $('app').setAttribute('aria-busy', 'false'); document.body.dataset.ready = '1'; };

async function init() {
  try { document.body.classList.toggle('comfort', !!(await api.storage.local.get('settings'))?.settings?.comfort); } catch { /* plain */ }
  $('review-h').textContent = S.reviewTitle;
  $('review-title-label').textContent = LAB_TEXT.shareInPlace.title;
  $('review-send').textContent = LAB_TEXT.shareInPlace.send;
  $('review-cancel').textContent = LAB_TEXT.automation.cancel;
  $('review-frame').title = S.reviewTitle;
  let r = null;
  try { r = await call('labReviewGet', { token }); } catch (e) { $('review-said').textContent = e.message; }
  if (!r || r.gone) {
    // Sent or cancelled already (from another tab), or the browser restarted: nothing to review.
    for (const id of ['review-send', 'review-title', 'review-cancel']) $(id).disabled = true;
    ready();
    return;
  }
  $('review-title').value = r.title ?? '';
  const words = Number.isFinite(r.words) ? r.words : 0;
  $('review-stats').textContent = fillText(S.reviewStats, { n: words, mb: formatMB(r.size ?? 0) });
  const shown = performance.now();
  $('review-frame').addEventListener('load', () => {
    document.body.dataset.rendered = String(Math.round(performance.now() - shown));
  }, { once: true });
  $('review-frame').srcdoc = r.html ?? '';
  $('review-send').addEventListener('click', async () => {
    for (const id of ['review-send', 'review-cancel', 'review-title']) $(id).disabled = true;
    try {
      const sent = await call('labReviewSend', { token, title: $('review-title').value });
      $('review-said').textContent = sent?.row ? [sent.note, rowMessage(sent.row)].filter(Boolean).join(' ') : '';
      document.body.dataset.sent = '1';
    } catch (e) {
      $('review-said').textContent = e.message;
      for (const id of ['review-send', 'review-cancel', 'review-title']) $(id).disabled = false;
    }
  });
  $('review-cancel').addEventListener('click', async () => {
    try { await call('labReviewCancel', { token }); } catch { /* it is dropped with the next review anyway */ }
    window.close();
  });
  ready();
  $('review-title').focus();
}

init();
