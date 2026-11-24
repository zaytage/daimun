/* Istiqamah: solat reminders and a daily ibadah chart.
   The same file runs in any browser and inside the Mac app (which takes over alarms natively). */
(function () {
  'use strict';

  // ------------------------------------------------------------------ constants
  const PT = window.PrayerTimes;
  // Inside the Mac app (WKWebView), the Windows app (WebView2) or the Linux app (Electron, which speaks
  // the Windows bridge); alarms then fire natively.
  const MAC = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.istiqamah);
  const WIN = !MAC && !!(window.chrome && window.chrome.webview);
  const NATIVE = MAC || WIN;
  const LINUX = WIN && !!window.__DAIMUN_LINUX__;
  const OS_NAME = MAC ? 'Mac' : LINUX ? 'Linux' : 'Windows';
  // Published as a claude.ai page: a locked-down frame (no print, downloads only through the
  // platform, no system notifications), and `confirm()` is unavailable.
  const HOSTED = !NATIVE && !!(window.claude && typeof window.claude.use === 'function');
  const SHARE_URL = 'https://zaytage.github.io/daimun/'; // the Da’imun website
  const MAC_URL = 'https://github.com/zaytage/daimun/releases/latest/download/Daimun-mac.zip'; // always the newest Mac app
  const WIN_URL = 'https://github.com/zaytage/daimun/releases/latest/download/Daimun-windows.zip'; // always the newest Windows app
  const MIN = 60000, HOUR = 60 * MIN;
  const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const TIMES = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const PINFO = {
    fajr: { name: 'Fajr', ar: 'الفجر' },
    sunrise: { name: 'Sunrise', ar: 'الشروق' },
    dhuhr: { name: 'Dhuhr', ar: 'الظهر' },
    asr: { name: 'Asr', ar: 'العصر' },
    maghrib: { name: 'Maghrib', ar: 'المغرب' },
    isha: { name: 'Isha', ar: 'العشاء' },
  };
  const SUNNAH = {
    fajr: [['fajr_b', '2 before']],
    dhuhr: [['dhuhr_b', '4 before'], ['dhuhr_a', '2 after']],
    asr: [['asr_b', '4 before']],
    maghrib: [['maghrib_a', '2 after']],
    isha: [['isha_a', '2 after'], ['witr', 'Witr']],
  };
  const RAWATIB = ['fajr_b', 'dhuhr_b', 'dhuhr_a', 'maghrib_a', 'isha_a'];
  const STATUSES = [['ontime', 'On time'], ['late', 'Late'], ['qada', 'Qada'], ['missed', 'Missed'], ['excused', 'Excused']];
  const STATUS_ICON = { ontime: '✓', late: '◐', qada: '↺', missed: '✕', excused: '–' };
  const COUNTERS = [
    { key: 'salawat', name: 'Salawat', ar: 'اللَّهُمَّ صَلِّ عَلَى مُحَمَّد', tr: 'Allahumma salli ʿala Muhammad' },
    { key: 'istighfar', name: 'Istighfar', ar: 'أَسْتَغْفِرُ اللَّه', tr: 'Astaghfirullah' },
    { key: 'dhikr', name: 'Dhikr', ar: 'سُبْحَانَ اللَّه', tr: 'SubhanAllah · Alhamdulillah · La ilaha illallah · Allahu Akbar' },
  ];
  const ADHAN_DUA = {
    ar: 'اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ، وَالصَّلَاةِ الْقَائِمَةِ، آتِ مُحَمَّدًا الْوَسِيلَةَ وَالْفَضِيلَةَ، وَابْعَثْهُ مَقَامًا مَحْمُودًا الَّذِي وَعَدْتَهُ',
    tr: 'Dua after the adhan (Bukhari)',
  };
  const IQAMAH_NOTE = 'Between the adhan and the iqamah, dua is not turned away. (Abu Dawud, Tirmidhi)';
  const NUDGES = {
    salawat: { counter: 'salawat', count: 10, title: 'Salawat upon the Prophet ﷺ', ar: 'اللَّهُمَّ صَلِّ عَلَى مُحَمَّدٍ', tr: 'Allahumma salli ʿala Muhammad', body: 'Whoever sends salawat upon him once, Allah sends ten upon them. (Muslim)' },
    istighfar: { counter: 'istighfar', count: 10, title: 'A moment of istighfar', ar: 'أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ', tr: 'Astaghfirullaha wa atubu ilayh', body: 'The Prophet ﷺ sought forgiveness more than seventy times a day. (Bukhari)' },
    tasbih: { counter: 'dhikr', count: 10, title: 'SubhanAllahi wa bihamdihi', ar: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ', tr: 'SubhanAllahi wa bihamdihi', body: 'Said 100 times a day, sins are wiped away even if they are like the foam of the sea. (Bukhari, Muslim)' },
    tahlil: { counter: 'dhikr', count: 10, title: 'La ilaha illallah', ar: 'لَا إِلَٰهَ إِلَّا اللَّهُ', tr: 'La ilaha illallah', body: 'The best remembrance is La ilaha illallah. (Tirmidhi)' },
    hawqala: { counter: 'dhikr', count: 10, title: 'A treasure of Paradise', ar: 'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ', tr: 'La hawla wa la quwwata illa billah', body: 'One of the treasures of Paradise. (Bukhari, Muslim)' },
    baqiyat: { counter: 'dhikr', count: 10, title: 'The most beloved words', ar: 'سُبْحَانَ اللَّهِ، وَالْحَمْدُ لِلَّهِ، وَلَا إِلَٰهَ إِلَّا اللَّهُ، وَاللَّهُ أَكْبَرُ', tr: 'SubhanAllah, walhamdulillah, wa la ilaha illallah, wallahu akbar', body: 'The four words most beloved to Allah. (Muslim)' },
    dua: { counter: null, title: 'A moment for dua', ar: 'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ', tr: 'Rabbana atina fid-dunya hasanah, wa fil-akhirati hasanah, wa qina ʿadhaban-nar', body: 'The dua the Prophet ﷺ made most often. (Bukhari) Pause and ask Allah for what you need.' },
  };
  const NUDGE_ORDER = ['salawat', 'istighfar', 'salawat', 'tasbih', 'salawat', 'tahlil', 'salawat', 'dua', 'salawat', 'hawqala', 'salawat', 'baqiyat'];

  // Adhan recordings: openly licensed, trimmed and levelled for the app (credits in Settings).
  const ADHANS = [
    { id: 'makkah', name: 'Makkah', detail: 'Masjid al-Haram', file: 'sounds/adhan-makkah.mp4', credit: 'recorded at the Masjid al-Haram by Seyfula Islam (2013), CC BY 3.0.' },
    { id: 'aaqib', name: 'Aaqib Azeez', detail: 'a clear, close recording', file: 'sounds/adhan-aaqib.mp4', credit: 'Aaqib Azeez, shared by Atcovi, CC BY-SA 4.0.' },
    { id: 'casablanca', name: 'Casablanca', detail: 'Hassan II Mosque, by the sea', file: 'sounds/adhan-casablanca.mp4', credit: 'recorded at the Hassan II Mosque by Fraguando, CC BY-SA 4.0.' },
    { id: 'shalkar', name: 'Kazakhstan', detail: 'Matey Qoqanuly Mosque, Shalkar', file: 'sounds/adhan-shalkar.mp4', credit: 'recorded in Shalkar by Esetok, CC BY-SA 4.0.' },
    { id: 'fajr', name: 'Fajr', detail: 'Malmö Mosque', file: 'sounds/adhan-fajr.mp4', credit: 'recorded at Malmö Mosque by the Islamic Center Malmö (2012), CC BY 3.0.' },
  ];
  const adhanById = (id) => ADHANS.find((a) => a.id === id);
  const TONES = ['chime', 'ishraq', 'duha', 'night', 'dua'];

  const DEFAULTS = {
    place: null,
    method: 'mwl',
    asr: 'shafii',
    offsets: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
    alarm: { enabled: true, style: 'fullscreen', sound: 'adhan', adhan: 'makkah', fajrAdhan: 'fajr', preMinutes: 10, nagMinutes: 10 },
    reminders: {
      adhkar: true, nudges: true, nudgeEvery: 60, nudgeFrom: '08:00', nudgeTo: '22:00',
      friday: true, quran: true, quranTime: '21:00', sleep: true, sleepTime: '22:30', fasting: false, sound: true,
      ishraq: true, ishraqMinutes: 20, duha: true, sunnahStyle: 'fullscreen', lastThird: false, duaTimes: true,
    },
    goals: { quran: 2, salawat: 100, istighfar: 100, dhikr: 100 },
    custom: [],
    pausedUntil: null,
  };

  // ------------------------------------------------------------------ helpers
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const todayKey = () => dateKey(new Date());
  const clockAt = (date, hhmm) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h || 0, m || 0).getTime(); };
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDur = (ms) => { const m = Math.max(0, Math.round(ms / MIN)); const h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; };
  const fmtNum = (n) => Number(n || 0).toLocaleString();
  const fmtShort = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));
  const fmtPages = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  function merge(base, extra) {
    if (!extra || typeof extra !== 'object') return base;
    for (const k in extra) {
      const v = extra[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merge(base[k], v);
      else if (v !== undefined) base[k] = v;
    }
    return base;
  }
  function setPath(obj, path, val) { const ks = path.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = o[ks[i]] || {}; o[ks[ks.length - 1]] = val; }

  let hijriFmt = null;
  try {
    hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' });
    if (!/islamic/.test(hijriFmt.resolvedOptions().calendar)) hijriFmt = null;
  } catch (e) { hijriFmt = null; }
  function hijri(date) {
    if (!hijriFmt) return null;
    const p = {};
    for (const x of hijriFmt.formatToParts(date)) p[x.type] = x.value;
    const year = String(p.year || p.relatedYear || '').replace(/\s*AH$/, '');
    return { day: Number(p.day), month: p.month, year, text: `${p.day} ${p.month} ${year}` };
  }

  // ------------------------------------------------------------------ state
  const STORE_KEY = 'istiqamah.v1';
  const FIRED_KEY = 'istiqamah.fired';
  const TAB_KEY = 'istiqamah.tab';
  const state = loadState();
  let viewKey = todayKey();
  let tab = 'today';
  try { const t = localStorage.getItem(TAB_KEY); tab = ['progress', 'history', 'chart'].includes(t) ? 'progress' : 'today'; } catch (e) { /* private mode */ }
  let returnTab = null; // where 'Back' on a past day goes
  // In Ramadan the chart opens on the whole month, like the paper evaluation chart.
  let period = { type: 'week', anchor: todayKey() };
  let nativeInfo = { adhanName: null, login: false };
  let adhanUrl = null, adhanName = null;
  let installPrompt = null, swReg = null;
  let schedule = [];
  let lastDay = todayKey();
  let audioUnlocked = false;
  let overlayEvent = null;
  let noteKey = null;
  let pendingImport = null;

  function loadState() {
    let raw = null;
    if (window.__ISTIQAMAH_DATA__ && typeof window.__ISTIQAMAH_DATA__ === 'object') raw = window.__ISTIQAMAH_DATA__;
    if (!raw) { try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { raw = null; } }
    const s = raw && typeof raw === 'object' ? raw : {};
    return { settings: merge(clone(DEFAULTS), s.settings || {}), days: s.days && typeof s.days === 'object' ? s.days : {} };
  }
  function save() {
    const data = JSON.stringify({ v: 1, settings: state.settings, days: state.days });
    try { localStorage.setItem(STORE_KEY, data); } catch (e) { /* storage full or blocked */ }
    if (NATIVE) post({ type: 'save', data });
  }
  function post(msg) {
    try {
      if (MAC) window.webkit.messageHandlers.istiqamah.postMessage(JSON.stringify(msg));
      else if (WIN) window.chrome.webview.postMessage(JSON.stringify(msg));
    } catch (e) { /* not native */ }
  }

  function emptyDay() {
    return { p: {}, j: {}, s: {}, t: {}, x: {}, quran: 0, kahf: false, mulk: false, c: { salawat: 0, istighfar: 0, dhikr: 0 }, a: { morning: false, evening: false, sleep: false }, n: { ishraq: false, duha: false, tahajjud: false }, off: {}, note: '' };
  }
  function getDay(key, create) {
    let d = state.days[key];
    if (!d) { d = emptyDay(); if (create) state.days[key] = d; return d; }
    const e = emptyDay();
    for (const k in e) {
      if (d[k] === undefined || d[k] === null) d[k] = e[k];
      else if (typeof e[k] === 'object') for (const kk in e[k]) if (d[k][kk] === undefined) d[k][kk] = e[k][kk];
    }
    return d;
  }

  let commitTimer = null;
  function commit() {
    render();
    clearTimeout(commitTimer);
    commitTimer = setTimeout(flush, 250);
  }
  function flush() { clearTimeout(commitTimer); commitTimer = null; save(); rebuildSchedule(); }

  // ------------------------------------------------------------------ prayer times
  const tcache = new Map();
  function timesFor(date) {
    const S = state.settings;
    if (!S.place) return null;
    const k = dateKey(date) + JSON.stringify([S.place.lat, S.place.lng, S.method, S.asr, S.offsets]);
    let t = tcache.get(k);
    if (!t) {
      const r = PT.compute(date.getFullYear(), date.getMonth() + 1, date.getDate(), { lat: S.place.lat, lng: S.place.lng, method: S.method, asr: S.asr, offsets: S.offsets });
      t = {};
      for (const x in r) t[x] = r[x].getTime();
      tcache.set(k, t);
      if (tcache.size > 120) tcache.delete(tcache.keys().next().value);
    }
    return t;
  }
  const isFriday = (date) => date.getDay() === 5;
  const prayerName = (p, date) => (p === 'dhuhr' && isFriday(date) ? "Jumu'ah" : PINFO[p].name);
  const prayerAr = (p, date) => (p === 'dhuhr' && isFriday(date) ? 'الجمعة' : PINFO[p].ar);
  function realEnd(p, date) {
    const t = timesFor(date);
    if (p === 'fajr') return t.sunrise;
    if (p === 'dhuhr') return t.asr;
    if (p === 'asr') return t.maghrib;
    if (p === 'maghrib') return t.isha;
    return timesFor(addDays(date, 1)).fajr;
  }
  function sleepAt(date) {
    const s = state.settings.reminders.sleepTime || '22:30';
    return clockAt(Number(s.split(':')[0]) < 12 ? addDays(date, 1) : date, s);
  }
  function nagEnd(p, date) {
    if (p !== 'isha') return realEnd(p, date);
    const t = timesFor(date);
    return Math.min(realEnd('isha', date), Math.max(t.isha + 90 * MIN, sleepAt(date) + 30 * MIN));
  }
  function autoStatus(p, date, now) {
    const s = timesFor(date)[p], e = realEnd(p, date);
    if (now <= s + (e - s) * (2 / 3)) return 'ontime';
    if (now <= e) return 'late';
    return 'qada';
  }
  /** Times for the extra prayers and the night's last third. */
  function extraTimes(date) {
    const t = timesFor(date), next = timesFor(addDays(date, 1));
    const ishraq = t.sunrise + (Number(state.settings.reminders.ishraqMinutes) || 20) * MIN;
    return {
      ishraq,
      duha: Math.max(ishraq, t.sunrise + (t.dhuhr - t.sunrise) / 2),
      duhaEnd: t.dhuhr - 10 * MIN,
      lastThird: t.maghrib + ((next.fajr - t.maghrib) * 2) / 3,
    };
  }
  /** Ishraq or Duha alert. Full screen like the prayers (with its own tone) or a corner card, per Settings. */
  function sunnahEvent(kind, key, x) {
    const ish = kind === 'ishraq';
    const at = ish ? x.ishraq : x.duha;
    return {
      id: `${key}:${kind}`, kind: 'sunnah', dateKey: key, at, until: ish ? at + 45 * MIN : x.duhaEnd,
      fullscreen: state.settings.reminders.sunnahStyle !== 'corner',
      title: ish ? 'Time for Ishraq' : 'Time for Duha', arabic: ish ? 'صَلَاةُ الإِشْرَاق' : 'صَلَاةُ الضُّحَى',
      subtitle: `${fmtTime(at)} · ${ish ? 'the sun has risen' : 'its best time, mid-morning'} · two rakʿahs or more`,
      body: ish
        ? 'Whoever prays Fajr in congregation, sits remembering Allah until sunrise, then prays two rakʿahs has the reward of a complete Hajj and Umrah. (Tirmidhi)'
        : 'Every joint of your body owes a charity each morning, and two rakʿahs of Duha are enough for all of it. (Muslim)',
      group: `${key}:${kind}`,
      sound: kind, actions: [{ id: `nafl:${kind}`, label: ish ? 'Prayed Ishraq ✓' : 'Prayed Duha ✓', primary: true },
        { id: 'dismiss', label: `Remind me in ${sunnahEvery()} min` }, { id: `off:${kind}`, label: 'Not today' }],
    };
  }
  function sunnahEvery() { return Math.max(5, state.settings.alarm.nagMinutes || 10); }
  /** The Ishraq or Duha reminder, then a gentle reminder every few minutes until it is prayed, skipped or its time ends. */
  function sunnahEvents(kind, key, x) {
    const first = sunnahEvent(kind, key, x), every = sunnahEvery() * MIN, out = [first];
    const name = kind === 'ishraq' ? 'Ishraq' : 'Duha';
    for (let tt = first.at + every, k = 1; tt < first.until - 2 * MIN; tt += every, k++) {
      out.push(Object.assign({}, first, { id: `${first.id}:again${k}`, at: tt, title: `Have you prayed ${name}?`,
        subtitle: `${name} time ends at ${fmtTime(first.until)} · two rakʿahs or more`, sound: 'chime' }));
    }
    return out;
  }
  function previewSunnah(kind) {
    const now = new Date(), e = sunnahEvent(kind, todayKey(), timesFor(now) ? extraTimes(now) : { ishraq: Date.now(), duha: Date.now(), duhaEnd: Date.now() + HOUR });
    e.id = `test:${kind}:${Date.now()}`; e.test = true; e.at = Date.now(); e.until = Date.now() + 10 * MIN; e.fullscreen = true;
    closeSettings();
    if (NATIVE) post({ type: 'fire', event: e }); else fire(e, false);
  }
  /** The adhan file for a prayer ('custom' = the person's own recording). */
  function adhanFor(p) {
    const A = state.settings.alarm;
    const id = p === 'fajr' && A.fajrAdhan !== 'same' ? A.fajrAdhan : A.adhan;
    if (id === 'custom') return 'custom';
    return (adhanById(id) || ADHANS[0]).file;
  }
  /** What to show for a prayer: what was ticked, or 'missed' once its time has ended without a tick.
      Only shown, never saved, so tapping it later still records it properly. */
  function shownStatus(d, p, key, sk) {
    if (d.p[p]) return d.p[p];
    const tk = todayKey();
    if (key > tk || key < (sk || startKey()) || isPaused(key)) return null;
    const date = fromKey(key), t = timesFor(date);
    if (!t) return key < tk ? 'missed' : null;
    return Date.now() > realEnd(p, date) ? 'missed' : null;
  }
  function isPaused(key) { const u = state.settings.pausedUntil; return !!u && (u === 'forever' || key <= u); }

  // ------------------------------------------------------------------ reminder schedule
  function buildSchedule(nowMs) {
    const S = state.settings, A = S.alarm, R = S.reminders;
    if (!S.place) return [];
    const out = [];
    const today = new Date(nowMs);
    for (let off = -1; off <= 1; off++) {
      const date = addDays(today, off), key = dateKey(date), t = timesFor(date), day = getDay(key), fri = isFriday(date);
      const nag = Math.max(5, A.nagMinutes || 10) * MIN;

      if (A.enabled && !isPaused(key)) {
        for (const p of PRAYERS) {
          if (day.p[p]) continue;
          const start = t[p], end = nagEnd(p, date), name = prayerName(p, date), group = `${key}:${p}`;
          if (A.preMinutes > 0) {
            out.push({ id: `${group}:pre`, kind: 'pre', group: `${group}:pre`, dateKey: key, prayer: p, at: start - A.preMinutes * MIN, until: start,
              title: `${name} in ${A.preMinutes} minutes`, body: `${name} comes in at ${fmtTime(start)}. A good moment to wrap up and renew your wudu.`, arabic: prayerAr(p, date),
              sound: 'soft', autoClose: 90, actions: [{ id: 'dismiss', label: 'OK' }] });
          }
          const base = { kind: 'prayer', prayer: p, dateKey: key, group, until: end, arabic: prayerAr(p, date), snooze: nag / MIN,
            actions: [{ id: 'prayed', label: "I've prayed", primary: true }, { id: 'snooze', label: `In ${nag / MIN} min` }] };
          out.push(Object.assign({}, base, { id: `${group}:alarm`, at: start, title: `It's time for ${name}`, subtitle: `${fmtTime(start)} · ${name} has come in`,
            body: IQAMAH_NOTE, duaAr: ADHAN_DUA.ar, duaTr: ADHAN_DUA.tr, sound: 'adhan', adhan: adhanFor(p) }));
          let k = 1;
          for (let tt = start + nag; tt < end; tt += nag, k++) {
            out.push(Object.assign({}, base, { id: `${group}:nag${k}`, kind: 'nag', at: tt, title: `Have you prayed ${name}?`,
              subtitle: `${name} came in at ${fmtTime(start)} · ${fmtTime(end)} is the end of its time`, body: 'Leave what you are doing for a few minutes. It will still be here when you come back.', sound: 'chime' }));
          }
        }
      }

      if (R.adhkar) {
        if (!day.a.morning) out.push({ id: `${key}:adhkar-am`, kind: 'adhkar', dateKey: key, at: t.fajr + 25 * MIN, until: t.dhuhr - 15 * MIN,
          title: 'Morning adhkar', arabic: 'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ', body: 'Ayat al-Kursi, the three Quls ×3 and Sayyid al-Istighfar to begin the day.',
          sound: 'soft', actions: [{ id: 'adhkar:morning', label: 'Done ✓', primary: true }, { id: 'dismiss', label: 'Later' }] });
        if (!day.a.evening) out.push({ id: `${key}:adhkar-pm`, kind: 'adhkar', dateKey: key, at: t.asr + 30 * MIN, until: t.isha,
          title: 'Evening adhkar', arabic: 'أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ', body: 'Ayat al-Kursi, the three Quls ×3 and Sayyid al-Istighfar before the night.',
          sound: 'soft', actions: [{ id: 'adhkar:evening', label: 'Done ✓', primary: true }, { id: 'dismiss', label: 'Later' }] });
      }

      if (R.nudges) {
        const from = clockAt(date, R.nudgeFrom), to = clockAt(date, R.nudgeTo), every = Math.max(15, R.nudgeEvery || 60) * MIN;
        const busy = PRAYERS.map((p) => t[p]).concat(PRAYERS.map((p) => t[p] - (A.preMinutes || 0) * MIN));
        let i = Math.floor(date.getTime() / 86400000) * 3;
        for (let tt = from; tt <= to; tt += every) {
          if (busy.some((b) => Math.abs(tt - b) < 20 * MIN)) continue;
          const n = NUDGES[NUDGE_ORDER[i++ % NUDGE_ORDER.length]];
          out.push({ id: `${key}:nudge:${tt}`, kind: 'nudge', dateKey: key, at: tt, until: tt + 5 * MIN, title: n.title, arabic: n.ar, tr: n.tr, body: n.body,
            sound: 'soft', autoClose: 75,
            actions: n.counter ? [{ id: `count:${n.counter}:${n.count}`, label: `Said it ×${n.count}`, primary: true }, { id: 'dismiss', label: 'Later' }] : [{ id: 'dismiss', label: 'Ameen' }] });
        }
      }

      if (R.friday && fri) {
        if (!day.kahf) out.push({ id: `${key}:jumuah`, kind: 'friday', dateKey: key, at: Math.max(t.sunrise + 30 * MIN, clockAt(date, '08:00')), until: t.maghrib,
          title: "Jumu'ah Mubarak", arabic: 'سورة الكهف', body: "Read Surah Al-Kahf today, send abundant salawat, and head to Jumu'ah early.",
          sound: 'soft', actions: [{ id: 'kahf', label: 'Read Al-Kahf ✓', primary: true }, { id: 'dismiss', label: 'Later' }] });
      }

      if (R.duaTimes && fri) {
        out.push({ id: `${key}:fri-hour`, kind: 'dua', dateKey: key, at: t.maghrib - 60 * MIN, until: t.maghrib,
          title: 'The last hour of Friday', arabic: 'سَاعَةُ الإِجَابَة', body: 'An hour when dua is answered. Set aside a few minutes before Maghrib to ask Allah. (Abu Dawud)',
          sound: 'dua', actions: [{ id: 'dismiss', label: 'Ameen' }] });
      }

      const x = extraTimes(date);
      if (R.ishraq && !day.n.ishraq && !day.off.ishraq) out.push(...sunnahEvents('ishraq', key, x));
      if (R.duha && !day.n.duha && !day.off.duha) out.push(...sunnahEvents('duha', key, x));
      if (R.lastThird) {
        const nk = dateKey(new Date(x.lastThird));
        if (!getDay(nk).n.tahajjud) out.push({ id: `${key}:last-third`, kind: 'night', dateKey: nk, at: x.lastThird, until: timesFor(addDays(date, 1)).fajr,
          title: 'The last third of the night', arabic: 'ثُلُثُ اللَّيْلِ الآخِر',
          body: 'Our Lord descends every night when the last third remains and says: Who is calling upon Me, that I may answer him? (Bukhari, Muslim) A time for tahajjud and dua.',
          sound: 'night', actions: [{ id: 'nafl:tahajjud', label: 'Prayed tahajjud ✓', primary: true }, { id: 'dismiss', label: 'Ameen' }] });
      }

      if (R.quran && (day.quran || 0) < S.goals.quran) {
        const at = clockAt(date, R.quranTime);
        out.push({ id: `${key}:quran`, kind: 'quran', dateKey: key, at, until: at + 3 * HOUR, title: 'Time for Quran',
          body: `${fmtPages(day.quran || 0)} of ${S.goals.quran} pages today. Even a few verses keep the connection.`,
          sound: 'soft', actions: [{ id: 'open', label: 'Open tracker', primary: true }, { id: 'dismiss', label: 'Later' }] });
      }

      if (R.sleep && !day.a.sleep) {
        const at = sleepAt(date);
        out.push({ id: `${key}:sleep`, kind: 'sleep', dateKey: key, at, until: at + 2 * HOUR, title: 'Before you sleep',
          body: 'Ayat al-Kursi, the three Quls, then SubhanAllah 33 · Alhamdulillah 33 · Allahu Akbar 34. Then fill in today on your chart.',
          sound: 'soft', actions: [{ id: 'adhkar:sleep', label: 'Done ✓', primary: true }, { id: 'open', label: 'Fill in today' }] });
      }

      if (R.fasting) {
        const tomorrow = addDays(date, 1), dow = tomorrow.getDay(), h = hijri(tomorrow);
        let msg = null;
        if (h && h.day >= 13 && h.day <= 15 && !/^Ramadan/.test(h.month)) msg = `Tomorrow is ${h.day} ${h.month}, one of the White Days.`;
        else if (dow === 1) msg = 'Tomorrow is Monday.';
        else if (dow === 4) msg = 'Tomorrow is Thursday.';
        if (msg) out.push({ id: `${key}:fast`, kind: 'fast', dateKey: key, at: t.isha + 30 * MIN, until: t.isha + 4 * HOUR, title: 'Sunnah fast tomorrow?',
          body: `${msg} Make your intention tonight and set an alarm for suhoor.`, sound: 'soft', actions: [{ id: 'dismiss', label: 'OK' }] });
      }
    }
    return out.filter((e) => isFinite(e.at) && isFinite(e.until) && e.until > nowMs).sort((a, b) => a.at - b.at);
  }

  function nativeSummary() {
    const now = new Date(), key = dateKey(now), t = timesFor(now), d = getDay(key);
    if (!t) return { place: null, prayers: [] };
    return {
      place: state.settings.place.name,
      paused: isPaused(key),
      nextFajr: timesFor(addDays(now, 1)).fajr,
      prayers: TIMES.map((p) => ({ key: p, dateKey: key, name: p === 'sunrise' ? 'Sunrise' : prayerName(p, now), at: t[p], end: p === 'sunrise' ? t[p] : realEnd(p, now), status: p === 'sunrise' ? null : d.p[p] || null })),
    };
  }

  function rebuildSchedule() {
    schedule = buildSchedule(Date.now());
    if (NATIVE) {
      const S = state.settings;
      post({ type: 'schedule', style: S.alarm.style, alarmSound: S.alarm.sound, reminderSound: !!S.reminders.sound, events: schedule, today: nativeSummary() });
    }
  }

  // ------------------------------------------------------------------ firing (browser only; the Mac app fires natively)
  function loadFired() { try { return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveFired(f) {
    const cut = Date.now() - 3 * 24 * HOUR;
    for (const k in f) if (f[k] < cut) delete f[k];
    try { localStorage.setItem(FIRED_KEY, JSON.stringify(f)); } catch (e) { /* ignore */ }
  }
  let lastHeroMinute = -1;
  function tick() {
    const now = Date.now();
    if (todayKey() !== lastDay) {
      const yesterday = lastDay;
      lastDay = todayKey();
      if (viewKey === yesterday) viewKey = lastDay;
      if (period.anchor === yesterday) period.anchor = lastDay;
      rebuildSchedule();
      render();
    } else if (Math.floor(now / MIN) !== lastHeroMinute) {
      lastHeroMinute = Math.floor(now / MIN);
      if (tab === 'today') renderHero();
    }
    if (NATIVE) return;
    const fired = loadFired();
    const due = schedule.filter((e) => e.at <= now && now <= e.until && !fired[e.id]);
    if (!due.length) return;
    const latest = new Map();
    for (const e of due) {
      fired[e.id] = now;
      const g = e.group || e.id, c = latest.get(g);
      if (!c || c.at < e.at) latest.set(g, e);
    }
    saveFired(fired);
    [...latest.values()].sort((a, b) => a.at - b.at).forEach((e) => fire(e, now - e.at > 3 * MIN));
  }
  function fire(e, stale) {
    const prayerish = e.kind === 'prayer' || e.kind === 'nag';
    if (prayerish && !e.test && getDay(e.dateKey).p[e.prayer]) return;
    let snd = e.sound || 'soft';
    if (stale && snd === 'adhan') snd = 'chime';
    if (prayerish) { showOverlay(e); playAlarm(snd, e); }
    else if (e.fullscreen) { showOverlay(e); if (state.settings.alarm.sound !== 'silent') playOn(alarmAudio, `sounds/${TONES.includes(snd) ? snd : 'soft'}.wav`); }
    else { showToast(e); playReminder(snd); }
    if (document.hidden || !document.hasFocus()) notify(e);
  }

  // ------------------------------------------------------------------ sound (browser)
  const alarmAudio = new Audio();
  const reminderAudio = new Audio();
  alarmAudio.preload = 'auto';
  reminderAudio.preload = 'auto';
  function playOn(el, src) {
    try { el.pause(); el.src = src; el.currentTime = 0; const p = el.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
  }
  function adhanSrc(file) { return file === 'custom' ? adhanUrl || ADHANS[0].file : file; }
  function playAlarm(kind, e) {
    if (NATIVE) return;
    const mode = state.settings.alarm.sound;
    if (mode === 'silent' || kind === 'none') return;
    if (kind === 'adhan' && mode === 'adhan') return playOn(alarmAudio, adhanSrc((e && e.adhan) || adhanFor((e && e.prayer) || 'dhuhr')));
    playOn(alarmAudio, 'sounds/chime.wav');
  }
  function playReminder(kind) {
    if (NATIVE || !state.settings.reminders.sound || kind === 'none') return;
    playOn(reminderAudio, `sounds/${TONES.includes(kind) ? kind : 'soft'}.wav`);
  }
  function stopSound() {
    try { alarmAudio.pause(); } catch (e) { /* ignore */ }
    if (MAC) post({ type: 'stopSound' });
  }
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    for (const el of [alarmAudio, reminderAudio]) {
      try {
        el.muted = true; el.src = 'sounds/soft.wav';
        const p = el.play();
        const done = () => { el.pause(); el.muted = false; };
        if (p && p.then) p.then(done, () => { el.muted = false; }); else done();
      } catch (e) { el.muted = false; }
    }
    renderBanner();
  }
  const audioReady = () => NATIVE || audioUnlocked || !!(navigator.userActivation && navigator.userActivation.hasBeenActive);

  // ------------------------------------------------------------------ system notifications (browser)
  async function notify(e) {
    if (NATIVE || !('Notification' in window) || Notification.permission !== 'granted') return;
    const prayerish = e.kind === 'prayer' || e.kind === 'nag';
    const opts = {
      body: [e.subtitle, e.tr, e.body].filter(Boolean).join('\n'),
      tag: e.group || e.id, renotify: true, requireInteraction: prayerish, silent: true,
      icon: 'icons/icon-192.png', badge: 'icons/favicon.png', data: { event: e },
    };
    const acts = (e.actions || []).filter((a) => a.id !== 'dismiss').slice(0, 2).map((a) => ({ action: a.id, title: a.label }));
    try {
      const reg = swReg || (navigator.serviceWorker && (await navigator.serviceWorker.getRegistration()));
      if (reg) { opts.actions = acts; await reg.showNotification(e.title, opts); return; }
    } catch (err) { /* fall back */ }
    try { const n = new Notification(e.title, opts); n.onclick = () => { window.focus(); handleEventAction('open', e); n.close(); }; } catch (err) { /* ignore */ }
  }
  async function enableNotifications() {
    try {
      const r = await Notification.requestPermission();
      if (r === 'granted') notify({ id: 'hello', group: 'hello', kind: 'info', title: 'Reminders are on', body: "You'll be reminded at each solat time, insha'Allah." });
    } catch (e) { /* ignore */ }
    renderBanner();
  }

  // ------------------------------------------------------------------ actions from alarms and reminders
  function handleEventAction(action, e) {
    if (!e) return;
    if (action === 'stop') { stopSound(); return; }
    if (action === 'dismiss') return;
    if (action === 'open') {
      if ((e.kind === 'prayer' || e.kind === 'nag') && !NATIVE && !getDay(e.dateKey).p[e.prayer]) showOverlay(e);
      if (e.dateKey) viewKey = e.dateKey;
      setTab('today');
      try { window.focus(); } catch (err) { /* ignore */ }
      return;
    }
    if (action === 'snooze') { if (overlayEvent && overlayEvent.group === e.group) hideOverlay(); stopSound(); return; }
    if (e.test) {
      hideOverlay(); stopSound();
      if (action.indexOf('prayed') === 0) showToast({ id: 'test-ok', kind: 'info', title: 'Test finished', body: 'This is how your solat alarm will look. Nothing was recorded.', actions: [{ id: 'dismiss', label: 'OK' }], autoClose: 8 });
      return;
    }
    const key = e.dateKey || todayKey();
    const d = getDay(key, true);
    if (action === 'prayed' || action === 'prayed-jamaah') {
      if (!d.p[e.prayer]) d.p[e.prayer] = autoStatus(e.prayer, fromKey(key), Date.now());
      if (action === 'prayed-jamaah') d.j[e.prayer] = true;
      if (overlayEvent && overlayEvent.group === e.group) hideOverlay();
      stopSound();
      commit();
      flush();
      afterPrayer(e.prayer, key);
      return;
    }
    const parts = action.split(':');
    if (parts[0] === 'count') d.c[parts[1]] = (d.c[parts[1]] || 0) + (Number(parts[2]) || 0);
    else if (parts[0] === 'adhkar') d.a[parts[1]] = true;
    else if (parts[0] === 'sunnah') d.s[parts[1]] = true;
    else if (parts[0] === 'tasbih') d.t[parts[1]] = true;
    else if (parts[0] === 'kahf') d.kahf = true;
    else if (parts[0] === 'nafl') d.n[parts[1]] = true;
    else if (parts[0] === 'off') d.off[parts[1]] = true; // "Not today": no more reminders for it today
    else return;
    commit();
    flush(); // save now: with the window closed, the system may hold back a delayed save
  }
  function afterPrayer(p, key) {
    const d = getDay(key);
    const acts = SUNNAH[p].filter(([k]) => !d.s[k]).map(([k, label]) => ({ id: `sunnah:${k}`, label: k === 'witr' ? 'Witr ✓' : `Sunnah ${label} ✓` }));
    if (!d.t[p]) acts.push({ id: `tasbih:${p}`, label: 'Tasbih ✓' });
    if (!acts.length) return;
    acts.push({ id: 'dismiss', label: 'Close' });
    showToast({ id: `after:${key}:${p}`, kind: 'after', dateKey: key, prayer: p, title: 'Alhamdulillah, may Allah accept it',
      body: 'Tick what you also did: the sunnah prayer and the tasbih (SubhanAllah 33 · Alhamdulillah 33 · Allahu Akbar 33).', actions: acts, sticky: true, autoClose: 120 });
  }
  function currentPending() {
    const now = Date.now(), date = new Date(), key = dateKey(date), t = timesFor(date);
    if (!t || isPaused(key)) return null;
    const d = getDay(key);
    for (const p of PRAYERS) if (t[p] <= now && now < realEnd(p, date) && !d.p[p]) return { p, key, date };
    return null;
  }

  // ------------------------------------------------------------------ in-app alarm overlay (browser)
  function showOverlay(e) {
    if (NATIVE) return;
    overlayEvent = e;
    const el = $('#overlay');
    const alarm = e.kind === 'prayer';
    const prayerOverlay = e.kind === 'prayer' || e.kind === 'nag';
    el.innerHTML = `<div class="ov-card" role="alertdialog" aria-modal="true" aria-labelledby="ov-title">
      <div class="ov-ar" lang="ar" dir="rtl">${esc(e.arabic || '')}</div>
      <h2 id="ov-title">${esc(e.title)}</h2>
      ${e.subtitle ? `<p class="ov-sub">${esc(e.subtitle)}</p>` : ''}
      ${alarm ? '<p class="ov-call"><span lang="ar" dir="rtl">حَيَّ عَلَى الصَّلَاةِ</span> · Come to prayer</p>' : ''}
      ${e.body ? `<p class="ov-body">${esc(e.body)}</p>` : ''}
      ${e.duaAr ? `<div class="ov-dua"><p lang="ar" dir="rtl">${esc(e.duaAr)}</p><small>${esc(e.duaTr || '')}</small></div>` : ''}
      ${prayerOverlay ? `<label class="ov-check"><input type="checkbox" id="ov-jamaah"> Prayed in jama'ah</label>
      <div class="ov-actions">
        <button class="btn secondary" data-ov="snooze">Remind me in ${esc(e.snooze || 10)} min</button>
        <button class="btn gold" data-ov="prayed">I've prayed</button>
      </div>` : `<div class="ov-actions">${(e.actions || []).slice().reverse().map((a) => `<button class="btn ${a.primary ? 'gold' : 'secondary'}" data-ov="${esc(a.id)}">${esc(a.label)}</button>`).join('')}</div>`}
      <button class="linkbtn" data-ov="stop">Stop sound</button>
    </div>`;
    el.hidden = false;
    el.dataset.armed = '0';
    setTimeout(() => { el.dataset.armed = '1'; }, 900);
  }
  function hideOverlay() { const el = $('#overlay'); el.hidden = true; el.innerHTML = ''; overlayEvent = null; }

  // ------------------------------------------------------------------ toasts
  function showToast(e) {
    if (NATIVE) { post({ type: 'show', event: e }); return; }
    const wrap = $('#toasts');
    const old = wrap.querySelector(`[data-id="${CSS.escape(e.id)}"]`);
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.dataset.id = e.id;
    t.setAttribute('role', 'status');
    const acts = e.actions || [];
    const main = acts.filter((a) => a.id !== 'dismiss');
    const dismiss = acts.find((a) => a.id === 'dismiss');
    t.innerHTML = `<div class="toast-head"><strong>${esc(e.title)}</strong><button class="x" data-tx="dismiss" aria-label="Dismiss">×</button></div>
      ${e.arabic ? `<p class="toast-ar" lang="ar" dir="rtl">${esc(e.arabic)}</p>` : ''}
      ${e.tr ? `<p class="toast-tr">${esc(e.tr)}</p>` : ''}
      ${e.body ? `<p class="toast-body">${esc(e.body)}</p>` : ''}
      ${main.length || dismiss ? `<div class="toast-actions">${main.map((a) => `<button class="btn sm ${a.primary ? 'primary' : 'secondary'}" data-tx="${esc(a.id)}">${esc(a.label)}</button>`).join('')}${dismiss ? `<button class="btn sm ghost" data-tx="dismiss">${esc(dismiss.label)}</button>` : ''}</div>` : ''}`;
    t._event = e;
    wrap.prepend(t);
    while (wrap.children.length > 3) wrap.lastChild.remove();
    if (e.autoClose) setTimeout(() => t.remove(), e.autoClose * 1000);
  }
  const info = (msg) => showToast({ id: 'info-' + Date.now(), kind: 'info', title: msg, autoClose: 6, actions: [] });

  // ------------------------------------------------------------------ rendering
  function render() {
    const active = document.activeElement;
    const fid = active && active.dataset ? active.dataset.fid : null;
    document.body.dataset.tab = tab;
    $('#view-today').hidden = tab !== 'today';
    $('#view-progress').hidden = tab !== 'progress';
    for (const b of document.querySelectorAll('[data-act="tab"]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    $('#btn-share').hidden = !shareUrl();
    if (tab === 'today') {
      renderBanner(); renderHero(); renderDayNav(); renderSolat(); renderQuran(); renderExtras(); renderDhikr(); renderNote();
    } else {
      renderProgress();
    }
    if (fid) { const el = document.querySelector(`[data-fid="${CSS.escape(fid)}"]`); if (el) el.focus({ preventScroll: true }); }
  }
  function setTab(t) { tab = t; try { localStorage.setItem(TAB_KEY, t); } catch (e) { /* ignore */ } render(); window.scrollTo(0, 0); }

  // ---- Country -> State -> City picker. Data: GeoNames, one small script per country.
  window.IstiqamahPlaces = window.IstiqamahPlaces || {
    idx: null, c: {}, wait: {},
    index(d) { this.idx = d; this.done('index'); },
    country(iso, d) { this.c[iso] = d; this.done(iso); },
    done(k) { const w = this.wait[k] || []; delete this.wait[k]; w.forEach((f) => f()); },
  };
  const PL = window.IstiqamahPlaces;
  function loadPlaces(key) {
    return new Promise((resolve) => {
      if (key === 'index' ? PL.idx : PL.c[key]) { resolve(); return; }
      const first = !PL.wait[key];
      (PL.wait[key] = PL.wait[key] || []).push(resolve);
      if (first) {
        const s = document.createElement('script');
        s.src = `places/${key}.js`;
        s.onerror = () => PL.done(key);
        document.head.appendChild(s);
      }
    });
  }
  const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } };
  let pick = null; // { iso, st, city } where city indexes PL.c[iso].c (most populous first)
  let picking = false;
  async function initPick() {
    if (picking) return;
    picking = true;
    await loadPlaces('index');
    const S = state.settings;
    let iso = S.place && S.place.country, name = S.place && S.place.city;
    if (!iso && PL.idx) { const g = PL.idx.tz[deviceTz()]; iso = g ? g[0] : 'SA'; name = g ? g[1] : null; }
    if (iso) await loadPlaces(iso);
    const data = iso && PL.c[iso];
    if (data && data.c.length) {
      let i = name ? data.c.findIndex((c) => c[0] === name && (!S.place || !S.place.state || c[1] === S.place.state)) : -1;
      if (i < 0) i = 0;
      pick = { iso, st: data.c[i][1], city: i };
    }
    picking = false;
    fillPickers();
  }
  function pickerHtml(where) {
    if (!PL.idx || !pick || !PL.c[pick.iso]) return '<p class="hint">Loading places…</p>';
    const data = PL.c[pick.iso];
    const states = Object.keys(data.s).map((k) => [k, data.s[k]]).sort((a, b) => a[1].localeCompare(b[1]));
    const cities = data.c.map((c, i) => [c, i]).filter(([c]) => c[1] === pick.st).sort((a, b) => a[0][0].localeCompare(b[0][0]));
    return `<label class="pick"><span>Country</span><select id="pick-iso-${where}" data-pick="iso">${PL.idx.countries.map(([iso, n]) => `<option value="${iso}" ${iso === pick.iso ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label class="pick"><span>State or region</span><select id="pick-st-${where}" data-pick="st" ${states.length < 2 ? 'disabled' : ''}>${states.map(([k, n]) => `<option value="${esc(k)}" ${k === pick.st ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label class="pick"><span>City or town</span><select id="pick-city-${where}" data-pick="city">${cities.map(([c, i]) => `<option value="${i}" ${i === pick.city ? 'selected' : ''}>${esc(c[0])}</option>`).join('')}</select></label>`;
  }
  function fillPickers() {
    const boxes = document.querySelectorAll('[data-picker]');
    if (!boxes.length) return;
    if (!pick) { initPick(); }
    const a = document.activeElement;
    const focused = a && a.dataset && a.dataset.pick ? a.dataset.pick : null;
    const focusBox = focused ? a.closest('[data-picker]') : null;
    boxes.forEach((el) => {
      el.innerHTML = pickerHtml(el.dataset.picker);
      if (el === focusBox) { const f = el.querySelector(`[data-pick="${focused}"]`); if (f) f.focus({ preventScroll: true }); }
    });
  }
  async function onPickChange(el) {
    const k = el.dataset.pick;
    if (k === 'iso') {
      const iso = el.value;
      await loadPlaces(iso);
      const data = PL.c[iso];
      if (!data || !data.c.length) { info("Couldn't load the places for that country. Please try again."); fillPickers(); return; }
      pick = { iso, st: data.c[0][1], city: 0 };
    } else if (k === 'st' && pick) {
      pick.st = el.value;
      pick.city = PL.c[pick.iso].c.findIndex((c) => c[1] === el.value);
    } else if (k === 'city' && pick) {
      pick.city = Number(el.value);
    }
    fillPickers();
  }
  function savePickedPlace() {
    if (!pick || !PL.c[pick.iso] || !PL.idx) return false;
    const data = PL.c[pick.iso], c = data.c[pick.city];
    const country = PL.idx.countries.find((x) => x[0] === pick.iso);
    const stName = data.s[c[1]] || '';
    const parts = [c[0]];
    if (stName && stName !== c[0] && stName !== 'Other areas') parts.push(stName);
    parts.push(country[1]);
    const S = state.settings, newCountry = !S.place || S.place.country !== pick.iso;
    if (!S.since) S.since = todayKey();
    S.place = { name: parts.join(', '), country: pick.iso, state: c[1], city: c[0], lat: c[2], lng: c[3] };
    if (newCountry) S.method = country[2];
    tcache.clear();
    commit(); flush();
    return true;
  }
  function useMyLocation() {
    if (!navigator.geolocation) { info("This browser can't share your location. Please choose your city."); return; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      await loadPlaces('index');
      const g = PL.idx && PL.idx.tz[deviceTz()];
      const country = g && PL.idx.countries.find((x) => x[0] === g[0]);
      state.settings.place = { name: 'My location', lat: Math.round(pos.coords.latitude * 1e4) / 1e4, lng: Math.round(pos.coords.longitude * 1e4) / 1e4 };
      state.settings.method = country ? country[2] : 'mwl';
      tcache.clear();
      commit(); flush();
      if ($('#settings').open) renderSettings();
    }, () => info("Couldn't get your location. Please choose your city instead."), { timeout: 15000, maximumAge: 3600000 });
  }

  function renderBanner() {
    const S = state.settings, parts = [];
    if (!S.place) {
      parts.push(`<section class="card setup">
        <h2>Assalamu alaikum</h2>
        <p>Da’imun calls you to each solat with the adhan and keeps a daily chart of your solat, sunnah, Quran, salawat and dhikr to tick, just like the paper evaluation chart. Choose where you are so the prayer times are exact.</p>
        <p class="hint">Da’imun (دائمون) is from the Qur’an: <i>“those who are constant in their prayer”</i> (Al-Ma’arij 70:23).</p>
        <div class="picker" data-picker="setup"></div>
        <div class="row"><button class="btn primary" data-act="save-place">Use this place</button>
        ${NATIVE || HOSTED ? '' : '<button class="btn secondary" data-act="use-location">Use my location</button>'}</div>
        <p class="hint">Everything stays on this device. Nothing is uploaded.</p></section>`);
    } else {
      if (isPaused(todayKey())) parts.push(`<div class="notice"><span>Solat alarms are paused${S.pausedUntil === 'forever' ? '' : ` until the end of ${esc(fromKey(S.pausedUntil).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }))}`}.</span><button class="btn sm secondary" data-act="resume">Resume</button></div>`);
      if (HOSTED && !hostedNoteSeen()) parts.push('<div class="notice"><span>Keep this page open in a tab and Da’imun will play the adhan and remind you while it\'s open. For alarms that reach you even when it\'s closed, use the Da’imun Mac app.</span><button class="btn sm secondary" data-act="hosted-ok">Got it</button></div>');
      if (!NATIVE && !HOSTED && 'Notification' in window && Notification.permission === 'default') parts.push('<div class="notice"><span><b>Turn on reminders</b> so the adhan and reminders still reach you when this tab is in the background.</span><button class="btn sm primary" data-act="notif">Turn on</button></div>');
      if (!NATIVE && !HOSTED && 'Notification' in window && Notification.permission === 'denied') parts.push('<div class="notice subtle"><span>Notifications are blocked for this site, so alarms only show while Da’imun is open. You can allow them in your browser\'s site settings.</span></div>');
      if (!audioReady()) parts.push('<div class="notice subtle"><span>Click anywhere once so the adhan is allowed to play.</span></div>');
      if (!NATIVE && installPrompt) parts.push('<div class="notice"><span><b>Install Da’imun</b> so it runs in its own window and keeps reminding you.</span><button class="btn sm secondary" data-act="install">Install</button></div>');
    }
    $('#banner').innerHTML = parts.join('');
    fillPickers();
  }
  function hostedNoteSeen() { try { return localStorage.getItem('istiqamah.hostedNote') === '1'; } catch (e) { return false; } }

  function renderHero() {
    const el = $('#hero'), S = state.settings;
    if (!S.place) { el.hidden = true; return; }
    el.hidden = false;
    const now = Date.now(), today = new Date(), t = timesFor(today), d = getDay(dateKey(today));
    let next = null;
    for (const p of TIMES) if (t[p] > now) { next = { p, at: t[p], name: p === 'sunrise' ? 'Sunrise' : prayerName(p, today), ar: p === 'sunrise' ? PINFO.sunrise.ar : prayerAr(p, today) }; break; }
    if (!next) next = { p: 'fajr', at: timesFor(addDays(today, 1)).fajr, name: 'Fajr', ar: PINFO.fajr.ar, tomorrow: true };
    let cur = null;
    for (const p of PRAYERS) if (t[p] <= now && now < realEnd(p, today)) cur = p;
    const pending = currentPending();
    const method = PT.METHODS[S.method] ? PT.METHODS[S.method].label : S.method;
    el.innerHTML = `<div class="hero-main">
        <div>
          <div class="eyebrow">${next.tomorrow ? 'Next · tomorrow' : 'Next'}</div>
          <div class="hero-name">${esc(next.name)} <span class="ar" lang="ar">${esc(next.ar)}</span></div>
          <div class="hero-when">${fmtTime(next.at)} <span aria-hidden="true">·</span> in ${fmtDur(next.at - now)}</div>
        </div>
        ${pending ? `<div class="hero-cta"><p>${esc(prayerName(pending.p, today))} has come in. Have you prayed?</p><button class="btn gold" data-act="prayed-now" data-fid="prayed-now">I've prayed ${esc(prayerName(pending.p, today))}</button></div>` : ''}
      </div>
      <ol class="times">${TIMES.map((p) => {
        const st = p === 'sunrise' ? null : d.p[p];
        const cls = [p === next.p && !next.tomorrow ? 'is-next' : '', p === cur ? 'is-current' : '', st ? 'is-' + st : ''].join(' ');
        return `<li class="${cls}"><span class="t-name">${esc(p === 'sunrise' ? 'Sunrise' : prayerName(p, today))}</span><span class="t-time">${fmtTime(t[p])}</span>${st ? `<span class="t-mark" title="${esc(statusLabel(st))}">${STATUS_ICON[st]}</span>` : ''}</li>`;
      }).join('')}</ol>
      ${(() => { const x = extraTimes(today); return `<div class="extra-times"><span>Ishraq <b>${fmtTime(x.ishraq)}</b></span><span>Duha <b>${fmtTime(x.duha)}</b></span><span>Last third of the night <b>${fmtTime(x.lastThird)}</b></span></div>`; })()}
      <div class="hero-foot"><span>${esc(S.place.name)} · ${esc(method)}</span><button class="linkbtn" data-act="settings">Change</button></div>`;
  }
  const statusLabel = (v) => (STATUSES.find((s) => s[0] === v) || [, ''])[1];

  function renderDayNav() {
    const date = fromKey(viewKey), isToday = viewKey === todayKey(), h = hijri(date);
    const label = date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    $('#daynav').innerHTML = `<button class="icon-btn" data-act="day" data-n="-1" aria-label="Previous day" data-fid="day-prev">‹</button>
      <div class="daynav-label"><strong>${isToday ? 'Today' : esc(label)}</strong><span>${isToday ? esc(label) + (h ? ' · ' : '') : ''}${h ? esc(h.text) : ''}</span></div>
      <button class="icon-btn" data-act="day" data-n="1" aria-label="Next day" data-fid="day-next" ${isToday ? 'disabled' : ''}>›</button>
      <span class="daynav-actions">${returnTab === 'progress' ? '<button class="btn sm secondary" data-act="tab" data-tab="progress">‹ Back to Progress</button>' : ''}
      ${isToday ? '' : '<button class="btn sm secondary" data-act="day" data-n="0">Go to today</button>'}</span>`;
  }

  function chip(act, data, on, label, fid, extra) {
    const attrs = Object.keys(data).map((k) => `data-${k}="${esc(data[k])}"`).join(' ');
    return `<button class="chip ${on ? 'on' : ''} ${extra || ''}" data-act="${act}" ${attrs} data-fid="${esc(fid)}" aria-pressed="${!!on}"><span class="tick" aria-hidden="true">${on ? '✓' : ''}</span>${esc(label)}</button>`;
  }

  function renderSolat() {
    const date = fromKey(viewKey), t = timesFor(date), d = getDay(viewKey), now = Date.now();
    const excused = PRAYERS.filter((p) => d.p[p] === 'excused').length;
    const done = PRAYERS.filter((p) => ['ontime', 'late', 'qada'].includes(d.p[p])).length;
    const rows = PRAYERS.map((p) => {
      const st = d.p[p], notYet = !st && t && t[p] > now;
      const name = prayerName(p, date);
      const autoMissed = !st && shownStatus(d, p, viewKey) === 'missed';
      const btn = autoMissed
        ? `<button class="pray-btn is-missed" data-act="pray" data-k="${viewKey}" data-p="${p}" data-fid="cp-${viewKey}-${p}" aria-label="${esc(name)}: missed. Tap if you prayed it.">✕ Missed · tap if you prayed it</button>`
        : st
        ? `<button class="pray-btn is-${st}" data-act="pray" data-k="${viewKey}" data-p="${p}" data-fid="cp-${viewKey}-${p}" aria-haspopup="menu" aria-label="${esc(name)}: ${esc(statusLabel(st))}. Tap to change.">${STATUS_ICON[st]} ${esc(statusLabel(st) === 'On time' ? 'Prayed' : statusLabel(st))}</button>`
        : notYet
          ? `<span class="pray-btn wait">Not yet</span>`
          : `<button class="pray-btn" data-act="pray" data-k="${viewKey}" data-p="${p}" data-fid="cp-${viewKey}-${p}">Tap when prayed</button>`;
      const sunnah = SUNNAH[p].map(([k, label]) => chip('sunnah', { k }, d.s[k], k === 'witr' ? 'Witr' : 'Sunnah ' + label, 'sn-' + k)).join('');
      return `<div class="prayer ${st ? 'done' : ''} ${notYet ? 'future' : ''}">
        <div class="prayer-head"><div class="prayer-name"><strong>${esc(name)}</strong><span class="ar" lang="ar">${esc(prayerAr(p, date))}</span></div><span class="prayer-time">${t ? fmtTime(t[p]) : ''}</span></div>
        ${btn}
        ${st && st !== 'missed' && st !== 'excused' ? `<div class="chips">${chip('jamaah', { p }, d.j[p], "In jama'ah", 'jm-' + p)}${sunnah}${chip('tasbih', { p }, d.t[p], 'Tasbih after', 'ts-' + p)}</div>` : ''}
      </div>`;
    }).join('');
    $('#solat').innerHTML = `<div class="card-head"><h2>Solat</h2><span class="pill ${done === 5 - excused && done > 0 ? 'ok' : ''}">${done} of ${5 - excused} prayed</span></div>${rows}
      <p class="hint">Tap a prayer once you've prayed it. Tap it again to change it. If its time ends without a tick, it shows as missed.</p>`;
  }
  function renderQuran() {
    const d = getDay(viewKey), goal = state.settings.goals.quran, n = d.quran || 0, fri = isFriday(fromKey(viewKey));
    $('#quran').innerHTML = `<div class="card-head"><h2>Quran</h2><span class="pill ${n >= goal && goal ? 'ok' : ''}">${fmtPages(n)} / ${goal} pages</span></div>
      <div class="quran-main">
        <button class="icon-btn lg" data-act="quran" data-n="-1" aria-label="One page less" data-fid="q-minus">−</button>
        <div class="quran-num"><span>${fmtPages(n)}</span><small>pages read</small></div>
        <button class="icon-btn lg primary" data-act="quran" data-n="1" aria-label="One page more" data-fid="q-plus">+</button>
      </div>
      <div class="progress" aria-hidden="true"><span style="width:${Math.min(100, goal ? (n / goal) * 100 : 0)}%"></span></div>
      <div class="chips center"><button class="chip" data-act="quran" data-n="0.5">+½ page</button><button class="chip" data-act="quran" data-n="10">+½ juz</button><button class="chip" data-act="quran" data-n="20">+1 juz</button></div>
      <div class="chips">${chip('tick', { k: 'kahf' }, d.kahf, 'Surah Al-Kahf' + (fri ? ' · today is Friday' : ''), 'kahf', fri ? 'friday' : '')}${chip('tick', { k: 'mulk' }, d.mulk, 'Surah Al-Mulk at night', 'mulk')}</div>
      <p class="hint">About 20 pages a day completes the Quran in a month.</p>`;
  }

  function check(k, on, title, sub) {
    return `<button class="check ${on ? 'on' : ''}" data-act="tick" data-k="${esc(k)}" data-fid="ck-${esc(k)}" aria-pressed="${!!on}"><span class="box" aria-hidden="true">${on ? '✓' : ''}</span><span class="check-text"><strong>${esc(title)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`;
  }
  function renderExtras() {
    const d = getDay(viewKey), custom = state.settings.custom || [];
    $('#extras').innerHTML = `<div class="card-head"><h2>Good deeds</h2></div>
      <div class="checks">
        ${check('a.morning', d.a.morning, 'Morning adhkar', 'After Fajr')}
        ${check('a.evening', d.a.evening, 'Evening adhkar', 'After Asr')}
        ${check('a.sleep', d.a.sleep, 'Before sleep', 'Ayat al-Kursi, the Quls, tasbih')}
        ${check('n.ishraq', d.n.ishraq, 'Ishraq', 'About 20 minutes after sunrise')}
        ${check('n.duha', d.n.duha, 'Duha', 'Mid-morning prayer')}
        ${check('n.tahajjud', d.n.tahajjud, 'Tahajjud', 'Night prayer')}
      </div>
      ${custom.length ? `<h3 class="sub-h">My own</h3><div class="checks">${custom.map((c) => check('x.' + c.id, d.x[c.id], c.label, '')).join('')}</div>` : ''}
      <button class="linkbtn" data-act="settings" data-focus="custom">${custom.length ? 'Edit my own items' : '+ Add your own items (sadaqah, calling parents…)'}</button>`;
  }

  function ring(p) {
    const r = 44, c = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${r}" class="ring-bg"/><circle cx="50" cy="50" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"/></svg>`;
  }
  function renderDhikr() {
    const d = getDay(viewKey), G = state.settings.goals;
    $('#dhikr').innerHTML = `<div class="card-head"><h2>Remembrance</h2><span class="sub">Tap the circle to count</span></div>
      <div class="counters">${COUNTERS.map((c) => {
        const n = d.c[c.key] || 0, goal = G[c.key] || 0, p = goal ? Math.min(1, n / goal) : 0;
        return `<div class="counter">
          <button class="count-btn ${goal && n >= goal ? 'met' : ''}" data-act="count" data-c="${c.key}" data-n="1" data-fid="cnt-${c.key}" aria-label="${esc(c.name)}: ${n} of ${goal}. Press to add one.">
            ${ring(p)}<span class="count-num">${fmtNum(n)}</span><span class="count-goal">of ${fmtNum(goal)}</span>
          </button>
          <div class="counter-name"><strong>${esc(c.name)}</strong><span class="ar" lang="ar">${esc(c.ar)}</span></div>
          <div class="counter-tr">${esc(c.tr)}</div>
          <div class="counter-adj">
            <button class="btn sm ghost" data-act="count" data-c="${c.key}" data-n="-1" aria-label="Remove one">−1</button>
            <button class="btn sm secondary" data-act="count" data-c="${c.key}" data-n="10">+10</button>
            <button class="btn sm secondary" data-act="count" data-c="${c.key}" data-n="33">+33</button>
            <button class="btn sm secondary" data-act="count" data-c="${c.key}" data-n="100">+100</button>
          </div>
        </div>`;
      }).join('')}</div>`;
  }

  function renderNote() {
    const el = $('#note-text');
    if (noteKey !== viewKey || document.activeElement !== el) { el.value = getDay(viewKey).note || ''; noteKey = viewKey; }
    $('#note-day').textContent = viewKey === todayKey() ? 'Today' : fromKey(viewKey).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  }

  // ------------------------------------------------------------------ the evaluation chart
  // Works like the paper chart: one row per practice, one column per day, tap a box to tick it.
  // Only days from when you started count towards the results.
  function dayHasData(d) {
    if (!d) return false;
    if (Object.keys(d.p || {}).some((k) => d.p[k])) return true;
    for (const g of ['j', 's', 't', 'x', 'n', 'a']) if (d[g] && Object.keys(d[g]).some((k) => d[g][k])) return true;
    if ((d.quran || 0) > 0 || d.kahf || d.mulk || (d.note || '').trim()) return true;
    return !!(d.c && Object.keys(d.c).some((k) => d.c[k] > 0));
  }
  /** The first day of the chart: when you set Istiqamah up, or the earliest day you ticked anything. */
  function startKey() {
    let k = state.settings.since || todayKey();
    for (const key in state.days) if (key < k && dayHasData(state.days[key])) k = key;
    return k;
  }
  const weekStart = (d) => addDays(d, -((d.getDay() + 6) % 7)); // Monday
  const shortDate = (d) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  function periodDays() {
    const a = fromKey(period.anchor), today = new Date();
    let days = [], title;
    if (period.type === 'week') {
      const s0 = weekStart(a);
      for (let i = 0; i < 7; i++) days.push(addDays(s0, i));
      const back = Math.round((weekStart(today) - s0) / (7 * 86400000));
      title = back === 0 ? 'This week' : back === 1 ? 'Last week' : `Week of ${s0.toLocaleDateString([], { day: 'numeric', month: 'long' })}`;
    } else {
      const first = new Date(a.getFullYear(), a.getMonth(), 1);
      for (let d = first; d.getMonth() === first.getMonth(); d = addDays(d, 1)) days.push(d);
      const same = first.getFullYear() === today.getFullYear() && first.getMonth() === today.getMonth();
      title = same ? 'This month' : first.toLocaleDateString([], { month: 'long', year: 'numeric' });
    }
    const h1 = hijri(days[0]), h2 = hijri(days[days.length - 1]);
    const hijriRange = h1 && h2 ? (h1.month === h2.month ? `${h1.month} ${h1.year}` : `${h1.month} – ${h2.month} ${h2.year}`) : '';
    return { days, title, range: `${shortDate(days[0])} – ${shortDate(days[days.length - 1])}`, hijriRange };
  }
  function movePeriod(dir) {
    const a = fromKey(period.anchor);
    let n = period.type === 'week' ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1);
    if (dateKey(n) > todayKey()) n = new Date();
    period.anchor = dateKey(n);
    renderProgress();
  }
  /** Good deeds ticked on a day: sunnah, extra prayers, adhkar, surahs, jama'ah, tasbih and your own items. */
  function goodDeeds(d) {
    let n = (d.kahf ? 1 : 0) + (d.mulk ? 1 : 0);
    for (const g of ['s', 'n', 'a', 'x', 'j', 't']) for (const k in d[g] || {}) if (d[g][k]) n++;
    return n;
  }
  function periodTotals(days, tk, sk) {
    const t = { days: 0, prayed: 0, possible: 0, onTime: 0, full: 0, deeds: 0, quran: 0, salawat: 0 };
    for (const day of days) {
      const k = dateKey(day);
      if (k > tk || k < sk) continue;
      const d = getDay(k), sm = daySummary(d);
      t.days++; t.prayed += sm.done; t.possible += sm.possible; t.onTime += sm.onTime;
      if (sm.possible && sm.done === sm.possible) t.full++;
      t.deeds += goodDeeds(d); t.quran += d.quran || 0; t.salawat += d.c.salawat || 0;
    }
    return t;
  }

  /** Progress: a short summary that shows improvement, a small glance, then every day like a statement. */
  function renderProgress() {
    const { days, title, range, hijriRange } = periodDays();
    const tk = todayKey(), sk = startKey();
    const stateOf = (k) => (k > tk ? 'future' : k < sk ? 'before' : 'open');
    const longDate = (d) => d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    const now = periodTotals(days, tk, sk);
    // The same stretch one week / one month earlier, to show change.
    const prevDays = period.type === 'week' ? days.map((d) => addDays(d, -7)) : (() => {
      const f = new Date(days[0].getFullYear(), days[0].getMonth() - 1, 1), out = [];
      for (let d = f; d.getMonth() === f.getMonth(); d = addDays(d, 1)) out.push(d);
      return out;
    })();
    // While a week or month is still running, compare with the same number of days last time, so it's fair.
    const elapsed = days.filter((d) => dateKey(d) <= tk).length;
    const running = elapsed < days.length;
    const prev = periodTotals(running ? prevDays.slice(0, elapsed) : prevDays, tk, sk);
    const unit = period.type === 'week' ? 'week' : 'month';
    const than = running ? `this point last ${unit}` : `last ${unit}`;
    const delta = (a, b) => {
      if (!prev.days) return '';
      const diff = Math.round((a - b) * 10) / 10;
      if (diff > 0) return `<small class="delta up">▲ ${fmtShort(diff)} more than ${than}</small>`;
      if (diff < 0) return `<small class="delta down">▼ ${fmtShort(-diff)} fewer than ${than}</small>`;
      return `<small class="delta">Same as ${than}</small>`;
    };
    const segs = [['week', 'Week'], ['month', 'Month']].map(([v, l]) => `<button class="seg ${period.type === v ? 'on' : ''}" data-act="period" data-v="${v}" aria-pressed="${period.type === v}">${l}</button>`).join('');
    const atEnd = dateKey(days[days.length - 1]) >= tk;
    const canBack = dateKey(addDays(days[0], -1)) >= sk;

    $('#progress-head').innerHTML = `<div class="progress-top">
        <h2>Progress</h2>
        <div class="seg-group" role="group" aria-label="Show">${segs}</div>
      </div>
      <div class="period-bar">
        <button class="icon-btn" data-act="period-move" data-n="-1" aria-label="Earlier" ${canBack ? '' : 'disabled'}>‹</button>
        <div class="period-label"><strong>${esc(title)}</strong><span>${esc(range)}${hijriRange ? ' · ' + esc(hijriRange) : ''}</span></div>
        <button class="icon-btn" data-act="period-move" data-n="1" aria-label="Later" ${atEnd ? 'disabled' : ''}>›</button>
      </div>
      ${now.days ? `<div class="results">
        <div class="stat"><b>${now.prayed}<i>/${now.possible}</i></b><span>prayers prayed</span>${delta(now.prayed, prev.prayed)}</div>
        <div class="stat"><b>${now.deeds}</b><span>good deeds</span>${delta(now.deeds, prev.deeds)}</div>
        <div class="stat"><b>${fmtPages(now.quran)}</b><span>Quran pages</span>${delta(now.quran, prev.quran)}</div>
        <div class="stat"><b>${fmtShort(now.salawat)}</b><span>salawat</span>${delta(now.salawat, prev.salawat)}</div>
      </div>` : `<p class="progress-sentence">You started on ${esc(longDate(fromKey(sk)))}. Days from then on will show here.</p>`}`;

    // Small glance: the five prayers, and how many good deeds each day. Tap any day to open it.
    const head = days.map((day) => {
      const k = dateKey(day), st = stateOf(k), hd = hijri(day);
      return `<th scope="col" class="day ${st} ${k === tk ? 'today' : ''}">
        <span class="day-head" title="${esc(longDate(day))}">
          <span class="dow">${esc(k === tk ? 'Today' : day.toLocaleDateString([], { weekday: period.type === 'week' ? 'short' : 'narrow' }))}</span><b>${day.getDate()}</b>${hd ? `<small>${hd.day}</small>` : ''}
        </span></th>`;
    }).join('');
    const cell = (day, inner) => {
      const k = dateKey(day), st = stateOf(k), cls = `${st}${k === tk ? ' today' : ''}`;
      if (st === 'future') return `<td class="${cls}"><span class="cell future" aria-hidden="true"></span></td>`;
      return `<td class="${cls}">${inner(getDay(k), k)}</td>`;
    };
    const prayerRows = PRAYERS.map((p) => `<tr><th scope="row">${esc(PINFO[p].name)}</th>${days.map((day) => cell(day, (d, k) => {
      const v = shownStatus(d, p, k, sk);
      return `<span class="cell mark ${v ? 'is-' + v : ''}" role="img" aria-label="${esc(PINFO[p].name)}, ${esc(longDate(day))}: ${esc(v ? statusLabel(v) : 'not ticked')}">${v ? STATUS_ICON[v] : ''}</span>`;
    })).join('')}</tr>`).join('');
    const deedsRow = `<tr class="deeds"><th scope="row">Good deeds</th>${days.map((day) => cell(day, (d, k) => {
      const n = goodDeeds(d);
      return `<span class="cell num ${n ? 'met' : ''}" role="img" aria-label="${n} good deeds, ${esc(longDate(day))}">${n || '–'}</span>`;
    })).join('')}</tr>`;
    $('#chart').innerHTML = `<div class="chart-scroll" tabindex="0" aria-label="${esc(title)} at a glance">
        <table class="chart"><thead><tr><th scope="col" class="corner">At a glance</th>${head}</tr></thead><tbody>${prayerRows}${deedsRow}</tbody></table>
      </div>
      <div class="legend"><span><i class="cell mark is-ontime">✓</i>on time</span><span><i class="cell mark is-late">◐</i>late</span><span><i class="cell mark is-qada">↺</i>qada</span><span><i class="cell mark is-missed">✕</i>missed</span><span class="muted">A prayer shows as missed once its time ends without a tick. Small number under each date: Hijri day.</span></div>`;
    renderHistory(days, tk, sk);
  }

  /** What a day holds, in words: prayers prayed and the good deeds ticked. */
  function daySummary(d) {
    const done = PRAYERS.filter((p) => ['ontime', 'late', 'qada'].includes(d.p[p])).length;
    const excused = PRAYERS.filter((p) => d.p[p] === 'excused').length;
    const extras = [];
    if (d.s.witr) extras.push('Witr');
    if (d.n.ishraq) extras.push('Ishraq');
    if (d.n.duha) extras.push('Duha');
    if (d.n.tahajjud) extras.push('Tahajjud');
    const raw = RAWATIB.filter((k) => d.s[k]).length;
    if (raw) extras.push(`Rawatib ${raw}/5`);
    if (d.kahf) extras.push('Al-Kahf');
    if (d.mulk) extras.push('Al-Mulk');
    const ad = ['morning', 'evening', 'sleep'].filter((k) => d.a[k]).length;
    if (ad) extras.push(`Adhkar ${ad}/3`);
    for (const c of state.settings.custom || []) if (d.x[c.id]) extras.push(c.label);
    if (d.quran) extras.push(`${fmtPages(d.quran)} ${d.quran === 1 ? 'page' : 'pages'} of Quran`);
    if (d.c.salawat) extras.push(`${fmtNum(d.c.salawat)} salawat`);
    const dz = (d.c.istighfar || 0) + (d.c.dhikr || 0);
    if (dz) extras.push(`${fmtNum(dz)} istighfar & dhikr`);
    return { done, possible: 5 - excused, onTime: PRAYERS.filter((p) => d.p[p] === 'ontime').length, extras, note: (d.note || '').trim() };
  }

  /** Menu on a prayer that's already ticked: on time, late, qada, missed, excused or clear. */
  function openStatusMenu(btn) {
    closeStatusMenu();
    const k = btn.dataset.k, p = btn.dataset.p, cur = getDay(k).p[p];
    const m = document.createElement('div');
    m.id = 'status-menu';
    m.setAttribute('role', 'menu');
    m.setAttribute('aria-label', `${PINFO[p].name}, ${fromKey(k).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}`);
    m.innerHTML = `<div class="sm-head">${esc(PINFO[p].name)} · ${esc(fromKey(k).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}</div>`
      + STATUSES.map(([v, label]) => `<button role="menuitemradio" aria-checked="${cur === v}" class="sm-item ${cur === v ? 'on' : ''}" data-act="setp" data-k="${k}" data-p="${p}" data-v="${v}"><span class="sm-icon is-${v}">${STATUS_ICON[v]}</span>${label}</button>`).join('')
      + `<button role="menuitem" class="sm-item clear" data-act="setp" data-k="${k}" data-p="${p}" data-v="">Not prayed yet (clear)</button>`;
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
    const left = Math.min(window.innerWidth - mw - 8, Math.max(8, r.left + r.width / 2 - mw / 2));
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.left = `${left}px`;
    m.style.top = `${top}px`;
    (m.querySelector('.sm-item.on') || m.querySelector('.sm-item')).focus({ preventScroll: true });
  }
  function closeStatusMenu() { const m = $('#status-menu'); if (m) m.remove(); }

  function renderHistory(periodList, tk, sk) {
    const days = periodList.filter((d) => { const k = dateKey(d); return k <= tk && k >= sk; }).reverse();
    const rows = days.map((day) => {
      const k = dateKey(day), d = getDay(k), sm = daySummary(d), has = dayHasData(d), hd = hijri(day);
      const dots = PRAYERS.map((p) => { const v = shownStatus(d, p, k, sk); return `<i class="dot ${v ? 'is-' + v : ''}" title="${esc(PINFO[p].name)}: ${esc(v ? statusLabel(v) : 'not yet')}"></i>`; }).join('');
      return `<button class="hist-day ${k === tk ? 'today' : ''} ${has ? '' : 'empty'}" data-act="goto" data-k="${k}">
        <span class="hist-date"><small>${esc(k === tk ? 'Today' : day.toLocaleDateString([], { weekday: 'short' }))}</small><b>${day.getDate()}</b></span>
        <span class="hist-main">
          <strong>${has || k < tk ? `${sm.done} of ${sm.possible} prayers` : 'Nothing ticked yet'}</strong>
          <span class="hist-sub">${has ? (sm.extras.length ? esc(sm.extras.join(' · ')) : 'No good deeds ticked') : 'Tap to fill in this day'}</span>
          ${sm.note ? `<span class="hist-note">“${esc(sm.note.length > 90 ? sm.note.slice(0, 90) + '…' : sm.note)}”</span>` : ''}
          ${hd ? `<span class="hist-hijri">${esc(hd.text)}</span>` : ''}
        </span>
        <span class="hist-right"><span class="dots" aria-label="${sm.done} of ${sm.possible} prayers">${dots}</span><span class="hist-open" aria-hidden="true">›</span></span>
      </button>`;
    }).join('');
    $('#history').innerHTML = `<div class="card-head"><h2>Day by day</h2><span class="sub">Newest first</span></div>
      ${days.length ? `<div class="hist-list">${rows}</div>` : '<p class="hist-empty">No days to show yet.</p>'}`;
  }

  // ------------------------------------------------------------------ settings
  function openSettings(focus) {
    renderSettings();
    const dlg = $('#settings');
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    if (focus === 'custom') { const el = $('#custom-new'); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }
  }
  function closeSettings() { const dlg = $('#settings'); if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); } }
  function toggle(path, on, label) {
    return `<label class="toggle"><input type="checkbox" data-set="${path}" data-type="bool" ${on ? 'checked' : ''}><span class="switch" aria-hidden="true"></span><span>${label}</span></label>`;
  }
  function opt(v, label, cur) { return `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label)}</option>`; }
  function adhanControl() {
    if (MAC) {
      return `<span class="filename">${nativeInfo.adhanName ? esc(nativeInfo.adhanName) : 'No file yet. The chime plays instead.'}</span>
        <button type="button" class="btn sm secondary" data-sa="pick-adhan">Choose file…</button>
        ${nativeInfo.adhanName ? '<button type="button" class="btn sm ghost" data-sa="clear-adhan">Remove</button>' : ''}
`;
    }
    return `<span class="filename">${adhanName ? esc(adhanName) : 'No file yet. The chime plays instead.'}</span>
      <label class="btn sm secondary file">Choose file…<input type="file" accept="audio/*" data-sa-file="adhan" hidden></label>
      ${adhanName ? '<button type="button" class="btn sm ghost" data-sa="clear-adhan">Remove</button>' : ''}
`;
  }
  function renderSettings() {
    const S = state.settings, A = S.alarm, R = S.reminders, G = S.goals;
    const dlg = $('#settings');
    const prevScroll = dlg.querySelector('.settings-body') ? dlg.querySelector('.settings-body').scrollTop : 0;
    const timeField = (path, val) => `<input type="time" data-set="${path}" value="${esc(val)}">`;
    dlg.innerHTML = `<div class="settings">
      <header class="settings-head"><h2>Settings</h2><button type="button" class="icon-btn" data-sa="close" aria-label="Close settings">×</button></header>
      <div class="settings-body">
        <section><h3>Location</h3>
          <p class="current">${S.place ? `${esc(S.place.name)} <small>${S.place.lat.toFixed(3)}, ${S.place.lng.toFixed(3)}</small>` : 'Not set yet'}</p>
          <div class="picker" data-picker="settings"></div>
          <div class="row"><button type="button" class="btn sm primary" data-sa="place">Use this place</button>
            ${NATIVE || HOSTED ? '' : '<button type="button" class="btn sm ghost" data-sa="geo">Use my location</button>'}</div>
          <p class="hint">Prayer times shift about 4 minutes for every degree east or west, so choosing your own town keeps them exact. If yours isn't listed, choose the nearest one.</p>
          <details><summary>Enter coordinates instead</summary>
            <div class="row"><input id="set-name" placeholder="Place name" value="${S.place ? esc(S.place.name) : ''}">
            <input id="set-lat" type="number" step="0.0001" placeholder="Latitude" value="${S.place ? S.place.lat : ''}">
            <input id="set-lng" type="number" step="0.0001" placeholder="Longitude" value="${S.place ? S.place.lng : ''}">
            <button type="button" class="btn sm secondary" data-sa="coords">Save</button></div></details>
        </section>
        <section><h3>Prayer times</h3>
          <label class="field"><span>Calculation method</span><select data-set="method">${Object.keys(PT.METHODS).map((k) => opt(k, PT.METHODS[k].label, S.method)).join('')}</select></label>
          <label class="field"><span>Asr</span><select data-set="asr">${opt('shafii', "Standard (Shafi'i, Maliki, Hanbali)", S.asr)}${opt('hanafi', 'Hanafi', S.asr)}</select></label>
          <details><summary>Fine-tune by a few minutes</summary>
            <p class="hint">Compare with your mosque or official timetable, then nudge any time to match.</p>
            <div class="offsets">${TIMES.map((p) => `<label><span>${PINFO[p].name}</span><input type="number" step="1" min="-30" max="30" data-set="offsets.${p}" data-type="int" value="${S.offsets[p] || 0}"></label>`).join('')}</div>
          </details>
        </section>
        <section><h3>Solat alarm</h3>
          ${toggle('alarm.enabled', A.enabled, 'Call me at every solat time')}
          ${HOSTED ? '<p class="hint">On this page the alarm appears while the page is open in a tab. The Mac app can also call you when it\'s closed.</p>' : ''}
          ${HOSTED ? '' : NATIVE ? `<label class="field"><span>How firm</span><select data-set="alarm.style">${opt('fullscreen', 'Full screen until I mark it', A.style)}${opt('popup', 'Floating window', A.style)}${opt('notification', 'Corner notification', A.style)}</select></label>` : '<p class="hint">In the browser the alarm appears inside Da’imun, plus a system notification when it is in the background.</p>'}
          <label class="field"><span>Sound</span><select data-set="alarm.sound">${opt('adhan', 'Adhan', A.sound)}${opt('chime', 'Gentle chime', A.sound)}${opt('silent', 'Silent', A.sound)}</select></label>
          <label class="field"><span>Adhan</span><select data-set="alarm.adhan">${ADHANS.filter((a) => a.id !== 'fajr').map((a) => opt(a.id, `${a.name}, ${a.detail}`, A.adhan)).join('')}${opt('custom', 'My own recording', A.adhan)}</select></label>
          <label class="field"><span>For Fajr</span><select data-set="alarm.fajrAdhan">${opt('fajr', 'Fajr adhan, with "prayer is better than sleep"', A.fajrAdhan)}${opt('same', 'The same adhan as the other prayers', A.fajrAdhan)}</select></label>
          <div class="row end"><button type="button" class="btn sm ghost" data-sa="preview" data-p="dhuhr">▶ Play adhan</button><button type="button" class="btn sm ghost" data-sa="preview" data-p="fajr">▶ Play Fajr</button><button type="button" class="btn sm ghost" data-sa="stop">■ Stop</button></div>
          ${A.adhan === 'custom' ? `<div class="field"><span>My recording</span><div class="row">${adhanControl()}</div></div>` : ''}
          <label class="field"><span>Heads-up before</span><select data-set="alarm.preMinutes" data-type="int">${[0, 5, 10, 15, 20].map((m) => opt(m, m ? m + ' minutes' : 'Off', A.preMinutes)).join('')}</select></label>
          <label class="field"><span>Ask again every</span><select data-set="alarm.nagMinutes" data-type="int">${[5, 10, 15, 20, 30].map((m) => opt(m, m + ' minutes', A.nagMinutes)).join('')}</select></label>
          <label class="field"><span>Pause solat alarms</span><select data-sa-change="pause">
            ${S.pausedUntil ? opt('', S.pausedUntil === 'forever' ? 'Paused until I resume' : 'Paused until ' + S.pausedUntil, '') + opt('0', 'Resume now', 'x') : opt('', 'Not paused', '')}
            ${opt('1', 'For today', 'x')}${opt('3', 'For 3 days', 'x')}${opt('7', 'For 7 days', 'x')}${opt('forever', 'Until I resume', 'x')}</select></label>
          <p class="hint">For when you're excused or travelling. Reminders for dhikr and Quran keep going.</p>
          <div class="row"><button type="button" class="btn sm primary" data-sa="test">Test the alarm now</button></div>
        </section>
        <section><h3>Sunnah &amp; dua times</h3>
          <p class="hint">Each has its own tone, so you know which one it is before you look.</p>
          ${toggle('reminders.ishraq', R.ishraq, 'Ishraq, once the sun has risen')}
          <div class="indent row"><label class="field inline"><span>Minutes after sunrise</span><select data-set="reminders.ishraqMinutes" data-type="int">${[15, 20, 25, 30].map((m) => opt(m, m + ' min', R.ishraqMinutes)).join('')}</select></label><button type="button" class="btn sm ghost" data-sa="preview-sunnah" data-kind="ishraq">▶ Preview</button></div>
          ${toggle('reminders.duha', R.duha, 'Duha, at its best time in the mid-morning')}
          <div class="indent row"><button type="button" class="btn sm ghost" data-sa="preview-sunnah" data-kind="duha">▶ Preview</button></div>
          <label class="field"><span>How Ishraq and Duha appear</span><select data-set="reminders.sunnahStyle">${opt('fullscreen', 'Full screen, like the prayers', R.sunnahStyle)}${opt('corner', 'A card in the corner', R.sunnahStyle)}</select></label>
          ${toggle('reminders.lastThird', R.lastThird, 'The last third of the night, for tahajjud and dua')}
          <div class="indent row"><span class="hint">Reaches you only if your computer or this page is awake then.</span><button type="button" class="btn sm ghost" data-sa="tone" data-tone="night">▶ Tone</button></div>
          ${toggle('reminders.duaTimes', R.duaTimes, "Friday's last hour before Maghrib, for dua")}
          <div class="indent row"><button type="button" class="btn sm ghost" data-sa="tone" data-tone="dua">▶ Tone</button></div>
        </section>
        <section><h3>Reminders</h3>
          ${toggle('reminders.adhkar', R.adhkar, 'Morning &amp; evening adhkar')}
          ${toggle('reminders.nudges', R.nudges, 'Salawat &amp; dhikr nudges through the day')}
          <div class="indent row"><label class="field inline"><span>Every</span><select data-set="reminders.nudgeEvery" data-type="int">${[30, 45, 60, 90, 120].map((m) => opt(m, m < 60 ? m + ' min' : m / 60 + ' h', R.nudgeEvery)).join('')}</select></label>
            <label class="field inline"><span>from</span>${timeField('reminders.nudgeFrom', R.nudgeFrom)}</label><label class="field inline"><span>to</span>${timeField('reminders.nudgeTo', R.nudgeTo)}</label></div>
          ${toggle('reminders.friday', R.friday, 'Friday: Al-Kahf and extra salawat')}
          ${toggle('reminders.quran', R.quran, "Quran, if today's pages aren't done yet")}
          <div class="indent row"><label class="field inline"><span>at</span>${timeField('reminders.quranTime', R.quranTime)}</label></div>
          ${toggle('reminders.sleep', R.sleep, 'Before-sleep adhkar and filling in the chart')}
          <div class="indent row"><label class="field inline"><span>at</span>${timeField('reminders.sleepTime', R.sleepTime)}</label></div>
          ${toggle('reminders.fasting', R.fasting, 'Sunnah fasts the night before (Monday, Thursday, White Days)')}
          ${toggle('reminders.sound', R.sound, 'Play sounds with reminders')}
        </section>
        <section><h3>Daily goals</h3>
          <div class="goals">
            <label><span>Quran pages</span><input type="number" min="0" step="1" data-set="goals.quran" data-type="int" value="${G.quran}"></label>
            <label><span>Salawat</span><input type="number" min="0" step="10" data-set="goals.salawat" data-type="int" value="${G.salawat}"></label>
            <label><span>Istighfar</span><input type="number" min="0" step="10" data-set="goals.istighfar" data-type="int" value="${G.istighfar}"></label>
            <label><span>Dhikr</span><input type="number" min="0" step="10" data-set="goals.dhikr" data-type="int" value="${G.dhikr}"></label>
          </div>
          <p class="hint">Start where you are and raise it once it feels easy. Consistency matters more than size.</p>
        </section>
        <section><h3>My own items</h3>
          <p class="hint">Extra rows for your chart and daily ticks, like sadaqah, calling your parents or reading tafsir.</p>
          <ul class="custom-list">${(S.custom || []).map((c) => `<li><span>${esc(c.label)}</span><button type="button" class="btn sm ghost" data-sa="custom-del" data-id="${esc(c.id)}" aria-label="Remove ${esc(c.label)}">Remove</button></li>`).join('')}</ul>
          <div class="row"><input id="custom-new" maxlength="40" placeholder="e.g. Sadaqah"><button type="button" class="btn sm secondary" data-sa="custom-add">Add</button></div>
        </section>
        ${NATIVE ? `<section><h3>${OS_NAME}</h3><label class="toggle"><input type="checkbox" data-native="login" ${nativeInfo.login ? 'checked' : ''}><span class="switch" aria-hidden="true"></span><span>${MAC || LINUX ? 'Open Da’imun when I log in' : 'Start Da’imun with Windows'}</span></label>${nativeInfo.version ? `<p class="hint">Version ${esc(nativeInfo.version)}. Da’imun updates itself.</p>` : ''}</section>` : ''}
        <section><h3>Your data</h3>
          <p class="hint">Everything is stored on this device only${HOSTED ? ', in this browser' : ''}. Save a backup now and then, and to move your chart to another device.</p>
          <div class="row"><button type="button" class="btn sm secondary" data-sa="export">Save backup</button>
            <label class="btn sm secondary file">Import backup<input type="file" accept="application/json,.json" data-sa-file="import" hidden></label>
            <button type="button" class="btn sm danger" data-sa="reset">Erase everything</button></div>
          ${pendingImport ? `<div class="confirm-row"><span>Backup with ${Object.keys(pendingImport.days).length} days. Days in it replace the same days here.</span><button type="button" class="btn sm primary" data-sa="import-confirm">Import it</button><button type="button" class="btn sm ghost" data-sa="import-cancel">Cancel</button></div>` : ''}
        </section>
        <section><h3>About the name</h3><p class="hint">Da’imun (دائمون) comes from <i>“alladhina hum ‘ala salatihim da’imun”</i>: “those who are constant in their prayer” (Al-Ma’arij 70:23).</p></section>
        <section><h3>Credits</h3>
          <ul class="credits">${ADHANS.map((a) => `<li>${esc(a.name)} adhan: ${esc(a.credit)}</li>`).join('')}
            <li>The adhan recordings come from Wikimedia Commons. They were trimmed and levelled for Da’imun and are shared under the same licences.</li>
            <li>Place names and coordinates: GeoNames (geonames.org), CC BY 4.0.</li>
            <li>Prayer times use the astronomical method published by PrayTimes.org.</li></ul>
        </section>
        ${shareUrl() ? '<section><h3>Share</h3><p class="hint">Send Da’imun to family and friends. Each person keeps their own private chart.</p><button type="button" class="btn sm primary" data-sa="share">Share link</button>' + (NATIVE ? '' : '<p class="hint">For the full-screen adhan even when this page is closed, get the app: <a href="' + MAC_URL + '" target="_blank" rel="noopener">Mac</a> · <a href="' + WIN_URL + '" target="_blank" rel="noopener">Windows</a>. It keeps itself up to date.</p>') + '</section>' : ''}
      </div></div>`;
    const body = dlg.querySelector('.settings-body');
    if (body) body.scrollTop = prevScroll;
    fillPickers();
  }
  function onSettingsChange(ev) {
    const el = ev.target, S = state.settings;
    if (el.dataset.set) {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.type === 'int') v = Math.max(el.min !== '' ? Number(el.min) : -Infinity, parseInt(v, 10) || 0);
      if (el.type === 'time' && !v) return;
      setPath(S, el.dataset.set, v);
      if (/^(method|asr|offsets)/.test(el.dataset.set)) tcache.clear();
      commit(); flush();
      return;
    }
    if (el.dataset.saChange === 'pause') {
      const v = el.value, today = new Date();
      if (v === '0') S.pausedUntil = null;
      else if (v === 'forever') S.pausedUntil = 'forever';
      else if (v) S.pausedUntil = dateKey(addDays(today, Number(v) - 1));
      commit(); flush(); renderSettings();
      return;
    }
    if (el.dataset.saFile === 'adhan' && el.files[0]) { saveAdhanFile(el.files[0]); return; }
    if (el.dataset.saFile === 'import' && el.files[0]) { importFile(el.files[0]); el.value = ''; return; }
    if (el.dataset.native === 'login') post({ type: 'setLogin', on: el.checked });
  }
  function onSettingsClick(ev) {
    const b = ev.target.closest('[data-sa]');
    if (!b) { if (ev.target === $('#settings')) closeSettings(); return; }
    const S = state.settings;
    switch (b.dataset.sa) {
      case 'close': closeSettings(); break;
      case 'place': if (savePickedPlace()) { renderSettings(); info('Location saved.'); } break;
      case 'geo': useMyLocation(); break;
      case 'coords': {
        const lat = parseFloat($('#set-lat').value), lng = parseFloat($('#set-lng').value);
        if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 66 || Math.abs(lng) > 180) { info('Please enter a latitude between -66 and 66 and a longitude between -180 and 180.'); break; }
        S.place = { name: $('#set-name').value.trim() || 'My place', lat, lng };
        tcache.clear(); commit(); flush(); renderSettings(); break;
      }
      case 'test': testAlarm(); break;
      case 'pick-adhan': post({ type: 'chooseAdhan' }); break;
      case 'clear-adhan': if (MAC) post({ type: 'clearAdhan' }); else clearAdhanFile(); break;
      case 'preview': {
        const file = S.alarm.sound === 'chime' ? 'sounds/chime.wav' : adhanFor(b.dataset.p || 'dhuhr');
        if (MAC) post({ type: 'preview', text: file }); else playOn(alarmAudio, adhanSrc(file));
        break;
      }
      case 'preview-sunnah': previewSunnah(b.dataset.kind); break;
      case 'tone': if (MAC) post({ type: 'preview', text: `sounds/${b.dataset.tone}.wav` }); else playOn(reminderAudio, `sounds/${b.dataset.tone}.wav`); break;
      case 'stop': stopSound(); break;
      case 'custom-add': {
        const inp = $('#custom-new'), label = inp.value.trim();
        if (!label) { inp.focus(); break; }
        S.custom = (S.custom || []).concat([{ id: 'c' + Date.now().toString(36), label }]);
        commit(); flush(); renderSettings(); const again = $('#custom-new'); if (again) again.focus(); break;
      }
      case 'custom-del': S.custom = (S.custom || []).filter((c) => c.id !== b.dataset.id); commit(); flush(); renderSettings(); break;
      case 'export': exportData(); break;
      case 'import-confirm': applyImport(); break;
      case 'import-cancel': pendingImport = null; renderSettings(); break;
      case 'reset':
        // Two taps instead of confirm(), which is unavailable on hosted pages.
        if (b.dataset.armed !== '1') {
          b.dataset.armed = '1'; b.classList.add('armed'); b.textContent = 'Tap again to erase everything';
          setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.classList.remove('armed'); b.textContent = 'Erase everything'; } }, 5000);
          break;
        }
        state.settings = clone(DEFAULTS); state.days = {};
        try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(FIRED_KEY); } catch (e) { /* ignore */ }
        tcache.clear(); flush(); closeSettings(); viewKey = todayKey(); render(); info('Everything was erased.');
        break;
      case 'share': share(); break;
      default: break;
    }
  }

  function testAlarm() {
    const now = new Date(), t = timesFor(now);
    let p = 'asr';
    if (t) { p = 'fajr'; for (const x of PRAYERS) if (t[x] > Date.now()) { p = x; break; } }
    const name = prayerName(p, now);
    const e = { id: 'test:' + Date.now(), test: true, kind: 'prayer', prayer: p, dateKey: todayKey(), group: 'test', at: Date.now(), until: Date.now() + 10 * MIN,
      title: `It's time for ${name}`, subtitle: 'This is a test. Nothing will be recorded.', arabic: prayerAr(p, now), body: IQAMAH_NOTE,
      duaAr: ADHAN_DUA.ar, duaTr: ADHAN_DUA.tr, sound: 'adhan', adhan: adhanFor(p), snooze: state.settings.alarm.nagMinutes,
      actions: [{ id: 'prayed', label: "I've prayed", primary: true }, { id: 'snooze', label: 'Later' }] };
    closeSettings();
    if (NATIVE) post({ type: 'fire', event: e });
    else { showOverlay(e); playAlarm('adhan', e); }
  }

  // ------------------------------------------------------------------ adhan file (browser, IndexedDB)
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('istiqamah', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbDo(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('files', mode), req = fn(tx.objectStore('files'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function loadAdhan() {
    try {
      const rec = await idbDo('readonly', (s) => s.get('adhan'));
      if (rec && rec.blob) { adhanUrl = URL.createObjectURL(rec.blob); adhanName = rec.name; }
    } catch (e) { /* no IndexedDB */ }
  }
  async function saveAdhanFile(f) {
    if (f.size > 30 * 1024 * 1024) { info('That file is over 30 MB. Please choose a shorter recording.'); return; }
    try {
      await idbDo('readwrite', (s) => s.put({ blob: f, name: f.name }, 'adhan'));
      if (adhanUrl) URL.revokeObjectURL(adhanUrl);
      adhanUrl = URL.createObjectURL(f); adhanName = f.name;
      state.settings.alarm.sound = 'adhan';
      state.settings.alarm.adhan = 'custom';
      commit(); flush(); renderSettings();
    } catch (e) { info("Couldn't save that file in this browser."); }
  }
  async function clearAdhanFile() {
    try { await idbDo('readwrite', (s) => s.delete('adhan')); } catch (e) { /* ignore */ }
    if (adhanUrl) URL.revokeObjectURL(adhanUrl);
    adhanUrl = null; adhanName = null; renderSettings();
  }

  // ------------------------------------------------------------------ backup and sharing
  function exportData() {
    const data = JSON.stringify({ app: 'daimun', v: 1, exported: new Date().toISOString(), settings: state.settings, days: state.days }, null, 2);
    const filename = `daimun-backup-${todayKey()}.json`;
    if (MAC) { post({ type: 'export', data, filename }); return; }
    if (HOSTED) {
      window.claude.use('downloads').then((dl) => {
        if (!dl) { info("Saving files isn't available here. Open Da’imun in a browser to save a backup."); return; }
        return dl.save({ filename, data }).then(() => info('Backup saved.'), (err) => {
          if (err && err.code !== 'declined') info("The backup couldn't be saved. Please try again.");
        });
      });
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function importFile(f) {
    f.text().then((txt) => {
      const o = JSON.parse(txt);
      if (!o || typeof o !== 'object' || !o.days || typeof o.days !== 'object') throw new Error('not a backup');
      pendingImport = o; // confirmed in the settings panel (confirm() is unavailable on hosted pages)
      renderSettings();
    }).catch(() => info("That file doesn't look like a Da’imun backup."));
  }
  function applyImport() {
    const o = pendingImport;
    pendingImport = null;
    if (!o) return;
    state.settings = merge(clone(DEFAULTS), o.settings || {});
    for (const k in o.days) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) state.days[k] = o.days[k];
    tcache.clear(); commit(); flush(); renderSettings(); info('Backup imported.');
  }
  function shareUrl() {
    if (SHARE_URL) return SHARE_URL;
    if (!NATIVE && /^https:$/.test(location.protocol)) return location.origin + location.pathname.replace(/index\.html$/, '');
    return '';
  }
  async function share() {
    const url = shareUrl();
    if (!url) return;
    const text = 'Da’imun: the adhan on your laptop plus a daily evaluation chart for solat, Quran, salawat and dhikr.';
    if (HOSTED) {
      // Called straight from the click so the clipboard write is allowed.
      if (navigator.clipboard) navigator.clipboard.writeText(`${text} ${url}`).then(() => info('Link copied. Paste it to share.'), () => info(`Copy this link to share: ${url}`));
      else info(`Copy this link to share: ${url}`);
      return;
    }
    if (!NATIVE && navigator.share) { try { await navigator.share({ title: 'Da’imun', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    copyText(`${text} ${url}`);
    info('Link copied. Paste it to share.');
  }
  function copyText(s) {
    if (MAC) { post({ type: 'copy', text: s }); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(s).catch(() => {});
  }

  // ------------------------------------------------------------------ events
  function onClick(ev) {
    const ov = ev.target.closest('[data-ov]');
    if (ov) {
      if ($('#overlay').dataset.armed !== '1') return;
      const e = overlayEvent;
      let a = ov.dataset.ov;
      if (a === 'prayed' && $('#ov-jamaah') && $('#ov-jamaah').checked) a = 'prayed-jamaah';
      handleEventAction(a, e);
      // Ishraq and Duha screens close on any choice.
      if (e && !(e.kind === 'prayer' || e.kind === 'nag') && a !== 'stop' && overlayEvent === e) { hideOverlay(); stopSound(); }
      return;
    }
    const tx = ev.target.closest('[data-tx]');
    if (tx) {
      const card = tx.closest('.toast'), e = card && card._event, a = tx.dataset.tx;
      if (a !== 'dismiss') handleEventAction(a, e);
      if (e && e.sticky && a !== 'dismiss') {
        tx.remove();
        if (!card.querySelector('.toast-actions .btn:not(.ghost)')) card.remove();
      } else if (card) card.remove();
      return;
    }
    if ($('#status-menu') && !ev.target.closest('#status-menu')) {
      closeStatusMenu();
      if (ev.target.closest('[data-act="pray"]')) return; // a tap outside only closes the menu
    }
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const a = el.dataset.act;
    switch (a) {
      case 'tab': if (el.closest('.tabs')) returnTab = null; setTab(el.dataset.tab); break;
      case 'status': { const d = getDay(viewKey, true), p = el.dataset.p, v = el.dataset.v; if (d.p[p] === v) delete d.p[p]; else d.p[p] = v; commit(); break; }
      case 'jamaah': { const d = getDay(viewKey, true); d.j[el.dataset.p] = !d.j[el.dataset.p]; commit(); break; }
      case 'sunnah': { const d = getDay(viewKey, true); d.s[el.dataset.k] = !d.s[el.dataset.k]; commit(); break; }
      case 'tasbih': { const d = getDay(viewKey, true); d.t[el.dataset.p] = !d.t[el.dataset.p]; commit(); break; }
      case 'count': { const d = getDay(viewKey, true), c = el.dataset.c; d.c[c] = Math.max(0, (d.c[c] || 0) + Number(el.dataset.n)); commit(); break; }
      case 'quran': { const d = getDay(viewKey, true); d.quran = Math.max(0, Math.round(((d.quran || 0) + Number(el.dataset.n)) * 2) / 2); commit(); break; }
      case 'tick': { const d = getDay(viewKey, true), [g, k] = el.dataset.k.split('.'); if (k) d[g][k] = !d[g][k]; else d[g] = !d[g]; commit(); break; }
      case 'day': {
        const n = Number(el.dataset.n);
        viewKey = n === 0 ? todayKey() : dateKey(addDays(fromKey(viewKey), n));
        if (viewKey > todayKey()) viewKey = todayKey();
        render(); break;
      }
      case 'goto': returnTab = tab; viewKey = el.dataset.k; setTab('today'); break;
      case 'pray': {
        const d = getDay(el.dataset.k, true), p = el.dataset.p;
        if (d.p[p]) { openStatusMenu(el); break; }
        const t = timesFor(fromKey(el.dataset.k));
        d.p[p] = t ? autoStatus(p, fromKey(el.dataset.k), Date.now()) : 'ontime';
        commit(); break;
      }
      case 'setp': {
        const d = getDay(el.dataset.k, true), p = el.dataset.p, v = el.dataset.v, fid = `cp-${el.dataset.k}-${p}`;
        if (v) d.p[p] = v; else delete d.p[p];
        closeStatusMenu();
        commit();
        const back = document.querySelector(`[data-fid="${CSS.escape(fid)}"]`);
        if (back) back.focus({ preventScroll: true });
        break;
      }
      case 'cell': {
        const d = getDay(el.dataset.k, true), [g, k] = el.dataset.key.split('.');
        if (k) { d[g] = d[g] || {}; d[g][k] = !d[g][k]; } else d[g] = !d[g];
        commit(); break;
      }
      case 'period': period.type = el.dataset.v; period.anchor = todayKey(); renderProgress(); break;
      case 'period-move': movePeriod(Number(el.dataset.n)); break;
      case 'print': if (MAC) post({ type: 'print' }); else window.print(); break;
      case 'settings': openSettings(el.dataset.focus); break;
      case 'share': share(); break;
      case 'notif': enableNotifications(); break;
      case 'install': if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.finally(() => { installPrompt = null; renderBanner(); }); } break;
      case 'resume': state.settings.pausedUntil = null; commit(); flush(); break;
      case 'hosted-ok': try { localStorage.setItem('istiqamah.hostedNote', '1'); } catch (e) { /* ignore */ } renderBanner(); break;
      case 'save-place': savePickedPlace(); break;
      case 'use-location': useMyLocation(); break;
      case 'prayed-now': {
        const c = currentPending();
        if (c) handleEventAction('prayed', { kind: 'prayer', prayer: c.p, dateKey: c.key, group: `${c.key}:${c.p}` });
        break;
      }
      default: break;
    }
  }

  function bind() {
    document.addEventListener('click', onClick);
    document.addEventListener('change', (ev) => { if (ev.target.dataset && ev.target.dataset.pick) onPickChange(ev.target); });
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    const dlg = $('#settings');
    dlg.addEventListener('change', onSettingsChange);
    dlg.addEventListener('click', onSettingsClick);
    dlg.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.id === 'custom-new') { ev.preventDefault(); $('[data-sa="custom-add"]').click(); } });
    let noteTimer = null;
    $('#note-text').addEventListener('input', (ev) => {
      getDay(viewKey, true).note = ev.target.value;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(save, 400);
    });
    window.addEventListener('scroll', (ev) => { if (!(ev.target.closest && ev.target.closest('#status-menu'))) closeStatusMenu(); }, true);
    window.addEventListener('resize', closeStatusMenu);
    document.addEventListener('keydown', (ev) => {
      const menu = $('#status-menu');
      if (menu && ev.key === 'Escape') { closeStatusMenu(); return; }
      if (menu && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        const items = [...menu.querySelectorAll('.sm-item')], i = items.indexOf(document.activeElement);
        items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
        ev.preventDefault();
        return;
      }
      if (ev.key === 'Escape' && overlayEvent && $('#overlay').dataset.armed === '1') handleEventAction('snooze', overlayEvent);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); if (tab === 'today') renderHero(); } });
    window.addEventListener('pagehide', () => { if (commitTimer) flush(); });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; renderBanner(); });
    window.addEventListener('appinstalled', () => { installPrompt = null; renderBanner(); });
    if (!NATIVE && !HOSTED && 'serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
      navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; }).catch(() => {});
      navigator.serviceWorker.addEventListener('message', (m) => {
        const d = m.data || {};
        if (d.type === 'notification-action') handleEventAction(d.action, d.event);
      });
    }
  }

  // ------------------------------------------------------------------ bridge for the Mac app
  window.Istiqamah = {
    nativeAction(action, event) { handleEventAction(action, event); },
    pushSchedule() { tick(); rebuildSchedule(); if (tab === 'today') renderHero(); },
    useCustomAdhan() { state.settings.alarm.adhan = 'custom'; state.settings.alarm.sound = 'adhan'; commit(); flush(); if ($('#settings').open) renderSettings(); },
    setNativeInfo(i) { nativeInfo = Object.assign(nativeInfo, i || {}); if ($('#settings').open) renderSettings(); },
    testAlarm() { testAlarm(); },
    openSettings() { openSettings(); },
    showToday() { viewKey = todayKey(); setTab('today'); },
  };

  // ------------------------------------------------------------------ start
  bind();
  if (NATIVE) document.documentElement.classList.add('native');
  render();
  rebuildSchedule();
  if (!MAC) loadAdhan();
  setInterval(tick, 15000);
  setTimeout(tick, 1200);
  if (NATIVE) post({ type: 'ready' });
})();
