/* Istiqamah for Windows: renders one alarm or reminder and plays its sound.
   The Windows app opens alert.html#<base64 JSON {event, mode, stale, alarmSound, reminderSound}>
   in an always-on-top window and listens for {type:'action'|'close'|'size'} messages. */
(function () {
  'use strict';
  const TONES = ['chime', 'ishraq', 'duha', 'night', 'dua'];
  const DEFAULT_ADHAN = 'sounds/adhan-makkah.mp4';
  const post = (m) => { try { window.chrome.webview.postMessage(JSON.stringify(m)); } catch (e) { /* preview in a browser */ } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let p = {};
  try {
    const b64 = decodeURIComponent(location.hash.slice(1));
    p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  } catch (e) { p = {}; }
  const e = p.event || { title: 'Istiqamah', kind: 'info' };
  const mode = p.mode || 'overlay';
  const prayer = e.kind === 'prayer' || e.kind === 'nag';
  const audio = new Audio();
  let armed = false;
  setTimeout(() => { armed = true; }, 900);

  function customAdhan() {
    return new Promise((resolve) => {
      try {
        const r = indexedDB.open('istiqamah', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('files');
        r.onerror = () => resolve(null);
        r.onsuccess = () => {
          try {
            const q = r.result.transaction('files').objectStore('files').get('adhan');
            q.onsuccess = () => resolve(q.result && q.result.blob ? URL.createObjectURL(q.result.blob) : null);
            q.onerror = () => resolve(null);
          } catch (err) { resolve(null); }
        };
      } catch (err) { resolve(null); }
    });
  }

  async function playSound() {
    let snd = e.sound || 'soft';
    if (p.stale && snd === 'adhan') snd = 'chime';
    let src = null;
    if (prayer || e.fullscreen) {
      if (p.alarmSound === 'silent' || snd === 'none') return;
      if (snd === 'adhan' && p.alarmSound === 'adhan') {
        const file = e.adhan || DEFAULT_ADHAN;
        src = file === 'custom' ? (await customAdhan()) || DEFAULT_ADHAN : file;
      } else src = `sounds/${TONES.includes(snd) ? snd : 'chime'}.wav`;
    } else {
      if (!p.reminderSound || snd === 'none' || e.kind === 'info' || e.kind === 'after') return;
      src = `sounds/${TONES.includes(snd) ? snd : 'soft'}.wav`;
    }
    audio.src = src;
    audio.play().catch(() => {});
  }

  function act(a) {
    if (!armed && a !== 'stop') return;
    if (a === 'stop') { audio.pause(); return; }
    audio.pause();
    post({ type: 'action', action: a });
  }

  function renderOverlay() {
    document.body.classList.add(mode === 'popup' ? 'popup-mode' : 'overlay-mode');
    const alarm = e.kind === 'prayer';
    const buttons = prayer
      ? `<label class="ov-check"><input type="checkbox" id="ov-jamaah"> Prayed in jama'ah</label>
         <div class="ov-actions">
           <button class="btn secondary" data-a="snooze">Remind me in ${esc(e.snooze || 10)} min</button>
           <button class="btn gold" data-a="prayed">I've prayed</button>
         </div>`
      : `<div class="ov-actions">${(e.actions || []).slice().reverse().map((x) => `<button class="btn ${x.primary ? 'gold' : 'secondary'}" data-a="${esc(x.id)}">${esc(x.label)}</button>`).join('')}</div>`;
    document.getElementById('root').innerHTML = `<div id="overlay"><div class="ov-card" role="alertdialog" aria-modal="true" aria-labelledby="ov-title">
      ${e.arabic ? `<div class="ov-ar" lang="ar" dir="rtl">${esc(e.arabic)}</div>` : ''}
      <h2 id="ov-title">${esc(e.title)}</h2>
      ${e.subtitle ? `<p class="ov-sub">${esc(e.subtitle)}</p>` : ''}
      ${alarm ? '<p class="ov-call"><span lang="ar" dir="rtl">حَيَّ عَلَى الصَّلَاةِ</span> · Come to prayer</p>' : ''}
      ${e.body ? `<p class="ov-body">${esc(e.body)}</p>` : ''}
      ${mode !== 'popup' && e.duaAr ? `<div class="ov-dua"><p lang="ar" dir="rtl">${esc(e.duaAr)}</p><small>${esc(e.duaTr || '')}</small></div>` : ''}
      ${buttons}
      <button class="linkbtn" data-a="stop">Stop sound</button>
      <button class="linkbtn" data-a="open">Open tracker</button>
    </div></div>`;
  }

  function renderToast() {
    document.body.classList.add('toast-mode');
    const acts = e.actions || [];
    const main = acts.filter((a) => a.id !== 'dismiss');
    const dismiss = acts.find((a) => a.id === 'dismiss');
    document.getElementById('root').innerHTML = `<div class="toast" role="status">
      <div class="toast-head"><strong>${esc(e.title)}</strong><button class="x" data-a="dismiss" aria-label="Dismiss">×</button></div>
      ${e.arabic ? `<p class="toast-ar" lang="ar" dir="rtl">${esc(e.arabic)}</p>` : ''}
      ${e.tr ? `<p class="toast-tr">${esc(e.tr)}</p>` : ''}
      ${e.subtitle ? `<p class="toast-body">${esc(e.subtitle)}</p>` : ''}
      ${e.body ? `<p class="toast-body">${esc(e.body)}</p>` : ''}
      ${main.length || dismiss ? `<div class="toast-actions">${main.map((a) => `<button class="btn sm ${a.primary ? 'primary' : 'secondary'}" data-a="${esc(a.id)}">${esc(a.label)}</button>`).join('')}${dismiss ? `<button class="btn sm ghost" data-a="dismiss">${esc(dismiss.label)}</button>` : ''}</div>` : ''}
    </div>`;
    armed = true; // corner cards don't steal clicks, so no need to wait
    const report = () => post({ type: 'size', h: Math.ceil(document.querySelector('.toast').getBoundingClientRect().height) });
    report();
    setTimeout(report, 200);
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    let a = b.dataset.a;
    if (a === 'prayed' && document.getElementById('ov-jamaah') && document.getElementById('ov-jamaah').checked) a = 'prayed-jamaah';
    if (mode === 'toast') {
      if (a === 'dismiss') { post({ type: 'close' }); return; }
      post({ type: 'action', action: a });
      if (e.sticky) {
        b.remove();
        if (!document.querySelector('.toast-actions .btn:not(.ghost)')) post({ type: 'close' });
        else post({ type: 'size', h: Math.ceil(document.querySelector('.toast').getBoundingClientRect().height) });
      } else post({ type: 'close' });
      return;
    }
    act(a);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (mode === 'toast') post({ type: 'close' });
    else act(prayer ? 'snooze' : 'dismiss');
  });
  window.stopSound = () => audio.pause();

  if (mode === 'toast') renderToast(); else renderOverlay();
  playSound();
})();
