/* Istiqamah: prayer time calculation.
   Pure astronomical calculation that runs offline on the device; nothing is sent anywhere.
   Follows the widely used method published by PrayTimes.org (sun position, equation of time,
   twilight angles), with angle-based adjustment for high latitudes. */
(function (root) {
  'use strict';

  const DEG = Math.PI / 180;
  const dsin = (d) => Math.sin(d * DEG);
  const dcos = (d) => Math.cos(d * DEG);
  const dtan = (d) => Math.tan(d * DEG);
  const darcsin = (x) => Math.asin(x) / DEG;
  const darccos = (x) => Math.acos(x) / DEG;
  const darctan2 = (y, x) => Math.atan2(y, x) / DEG;
  const darccot = (x) => Math.atan(1 / x) / DEG;
  const fix = (a, b) => { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; };
  const fixAngle = (a) => fix(a, 360);
  const fixHour = (a) => fix(a, 24);

  const METHODS = {
    jakim:   { label: 'JAKIM (Malaysia)', fajr: 20, isha: 18 },
    muis:    { label: 'MUIS (Singapore)', fajr: 20, isha: 18 },
    kemenag: { label: 'Kemenag (Indonesia)', fajr: 20, isha: 18 },
    mwl:     { label: 'Muslim World League', fajr: 18, isha: 17 },
    isna:    { label: 'ISNA (North America)', fajr: 15, isha: 15 },
    egypt:   { label: 'Egyptian General Authority', fajr: 19.5, isha: 17.5 },
    makkah:  { label: 'Umm al-Qura (Makkah)', fajr: 18.5, ishaMinutes: 90 },
    karachi: { label: 'University of Karachi', fajr: 18, isha: 18 },
    dubai:   { label: 'Dubai', fajr: 18.2, isha: 18.2 },
    qatar:   { label: 'Qatar', fajr: 18, ishaMinutes: 90 },
    kuwait:  { label: 'Kuwait', fajr: 18, isha: 17.5 },
    turkey:  { label: 'Diyanet (Turkey)', fajr: 18, isha: 17 },
  };

  const KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const GUESS = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, isha: 18 };

  function julian(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    const A = Math.floor(y / 100);
    const B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
  }

  function sunPosition(jd) {
    const D = jd - 2451545.0;
    const g = fixAngle(357.529 + 0.98560028 * D);
    const q = fixAngle(280.459 + 0.98564736 * D);
    const L = fixAngle(q + 1.915 * dsin(g) + 0.020 * dsin(2 * g));
    const e = 23.439 - 0.00000036 * D;
    const RA = darctan2(dcos(e) * dsin(L), dcos(L)) / 15;
    return { decl: darcsin(dsin(e) * dsin(L)), eqt: q / 15 - fixHour(RA) };
  }

  /**
   * Prayer times for a calendar date at a location.
   * @param {number} y full year  @param {number} m month 1-12  @param {number} d day of month
   * @param {{lat:number,lng:number,method?:string,asr?:'shafii'|'hanafi',offsets?:Object}} cfg
   * @returns {{fajr:Date,sunrise:Date,dhuhr:Date,asr:Date,maghrib:Date,isha:Date}}
   */
  function compute(y, m, d, cfg) {
    const lat = cfg.lat, lng = cfg.lng;
    const method = METHODS[cfg.method] || METHODS.mwl;
    const asrFactor = cfg.asr === 'hanafi' ? 2 : 1;
    const jDate = julian(y, m, d) - lng / (15 * 24);

    const midDay = (t) => fixHour(12 - sunPosition(jDate + t).eqt);
    const sunAngleTime = (angle, t, ccw) => {
      const decl = sunPosition(jDate + t).decl;
      const T = darccos((-dsin(angle) - dsin(decl) * dsin(lat)) / (dcos(decl) * dcos(lat))) / 15;
      return midDay(t) + (ccw ? -T : T);
    };
    const asrTime = (factor, t) => {
      const decl = sunPosition(jDate + t).decl;
      return sunAngleTime(-darccot(factor + dtan(Math.abs(lat - decl))), t);
    };

    let t = Object.assign({}, GUESS);
    for (let i = 0; i < 2; i++) {
      const p = {};
      for (const k in t) p[k] = (isFinite(t[k]) ? t[k] : GUESS[k]) / 24;
      t = {
        fajr: sunAngleTime(method.fajr, p.fajr, true),
        sunrise: sunAngleTime(0.833, p.sunrise, true),
        dhuhr: midDay(p.dhuhr),
        asr: asrTime(asrFactor, p.asr),
        sunset: sunAngleTime(0.833, p.sunset),
        isha: method.ishaMinutes ? NaN : sunAngleTime(method.isha, p.isha),
      };
    }

    // Local solar hours -> UTC hours
    for (const k in t) t[k] += -lng / 15;

    // High latitudes: keep Fajr/Isha within a portion of the night
    const night = fixHour(t.sunrise - t.sunset);
    const adjust = (time, base, angle, ccw) => {
      const portion = (angle / 60) * night;
      const diff = ccw ? fixHour(base - time) : fixHour(time - base);
      return !isFinite(time) || diff > portion ? base + (ccw ? -portion : portion) : time;
    };
    t.fajr = adjust(t.fajr, t.sunrise, method.fajr, true);
    t.maghrib = t.sunset;
    t.isha = method.ishaMinutes ? t.maghrib + method.ishaMinutes / 60 : adjust(t.isha, t.sunset, method.isha, false);

    const off = cfg.offsets || {};
    const base = Date.UTC(y, m - 1, d);
    const out = {};
    for (const k of KEYS) {
      const ms = base + (t[k] + (Number(off[k]) || 0) / 60) * 3600000;
      // Round prayer starts up to the minute (never early); round sunrise down (never late).
      out[k] = new Date(k === 'sunrise' ? Math.floor(ms / 60000) * 60000 : Math.ceil(ms / 60000) * 60000);
    }
    return out;
  }

  root.PrayerTimes = { compute, METHODS, KEYS };
})(typeof window !== 'undefined' ? window : globalThis);
