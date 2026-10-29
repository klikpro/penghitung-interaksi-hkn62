'use strict';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// Dengan UA perayap mesin pencari, Instagram & Facebook mengirim versi halaman
// yang memuat metadata/JSON berisi angka interaksi (terbukti pada uji 29 Okt 2026).
const GB_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const TIMEOUT_MS = 8000;
const KEYS = ['views', 'likes', 'comments', 'shares'];
const DOMAINS = {
  TikTok: ['tiktok.com'],
  Instagram: ['instagram.com'],
  Facebook: ['facebook.com', 'fb.watch', 'fb.com']
};

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function detectPlatform(u) {
  const h = u.hostname.toLowerCase();
  for (const p of Object.keys(DOMAINS)) {
    if (DOMAINS[p].some(d => h === d || h.endsWith('.' + d))) return p;
  }
  return null;
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function cp(n) { try { return String.fromCodePoint(n); } catch (e) { return ''; } }
function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(+d))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
// "1.2K" -> 1200, "1,234" -> 1234, "1.234" -> 1234, "18" -> 18
function parseCount(raw) {
  const m = String(raw || '').trim().match(/^(\d[\d.,]*)\s*(k|m|b|rb|jt)?$/i);
  if (!m) return null;
  let s = m[1].replace(/[., ]+$/, '');
  const suf = (m[2] || '').toLowerCase();
  if (suf) {
    const mult = { k: 1e3, rb: 1e3, m: 1e6, jt: 1e6, b: 1e9 }[suf];
    const n = parseFloat(s.replace(/,/g, '.'));
    return Number.isFinite(n) ? Math.round(n * mult) : null;
  }
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return parseInt(s.replace(/[.,]/g, ''), 10);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}
async function fetchHtml(url, ua) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': ua || UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow',
      signal: ctrl.signal
    });
    const html = await r.text();
    return { ok: r.ok, status: r.status, html: html.slice(0, 3000000), finalUrl: r.url };
  } catch (e) {
    return { ok: false, status: 0, html: '', error: e.name === 'AbortError' ? 'waktu habis' : e.message };
  } finally { clearTimeout(t); }
}
function metaMap(html) {
  const map = {};
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const t of tags) {
    const k = t.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i);
    const c = t.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (k && c) {
      const key = k[1].toLowerCase();
      if (!(key in map)) map[key] = decode(c[1] !== undefined ? c[1] : c[2]);
    }
  }
  const ti = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (ti) map.__title = decode(ti[1]);
  return map;
}
const NUM = '(\\d[\\d.,]*\\s?(?:[KkMmBb]|rb|jt)?)';
function fromText(text) {
  const g = words => {
    const m = text.match(new RegExp(NUM + '\\s+(?:' + words + ')\\b', 'i'));
    return m ? parseCount(m[1]) : null;
  };
  return {
    views: g('views?|plays?'),
    likes: g('reactions?|likes?'),
    comments: g('comments?'),
    shares: g('shares?')
  };
}
function textFromMeta(map, platform) {
  const parts = [];
  if (platform === 'Facebook') {
    const t = map['og:title'] || map['twitter:title'] || map.__title || '';
    parts.push(t.split('|')[0]);
  }
  ['og:image:alt', 'og:description', 'description'].forEach(k => {
    if (map[k]) parts.push(platform === 'Instagram' ? map[k].split(' - ')[0] : map[k].slice(0, 200));
  });
  return parts.join(' || ');
}
// Dipakai hanya untuk halaman embed Instagram (berisi satu postingan saja)
function fromJsonish(html) {
  const h = html.replace(/\\"/g, '"');
  const first = res => {
    for (const re of res) {
      const m = h.match(re);
      if (m) {
        const n = num(m[1]);
        if (n !== null) return n;
      }
    }
    return null;
  };
  return {
    views: first([/"video_view_count":\s*(\d+)/, /"video_play_count":\s*(\d+)/]),
    likes: first([/"edge_media_preview_like":\s*\{\s*"count":\s*(\d+)/, /"edge_liked_by":\s*\{\s*"count":\s*(\d+)/, /"like_count":\s*(\d+)/]),
    comments: first([/"edge_media_to_(?:parent_)?comment":\s*\{\s*"count":\s*(\d+)/, /"comment_count":\s*(\d+)/]),
    shares: null
  };
}
function merge(...objs) {
  const out = { views: null, likes: null, comments: null, shares: null };
  for (const k of KEYS) {
    for (const o of objs) {
      if (o && o[k] !== null && o[k] !== undefined) { out[k] = o[k]; break; }
    }
  }
  return out;
}
function findKey(o, key, depth) {
  depth = depth || 0;
  if (!o || typeof o !== 'object' || depth > 8) return null;
  if (o[key] && typeof o[key] === 'object') return o[key];
  for (const k of Object.keys(o)) {
    const r = findKey(o[k], key, depth + 1);
    if (r) return r;
  }
  return null;
}

/* ---------- parser per platform ---------- */
function parseTikTok(html) {
  const m = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch (e) { return null; }
  const scope = data.__DEFAULT_SCOPE__ || data;
  const detail = scope && scope['webapp.video-detail'];
  const item = (detail && detail.itemInfo && detail.itemInfo.itemStruct) || findKey(data, 'itemStruct');
  if (!item) return null;
  const s = item.stats || item.statsV2;
  if (!s) return null;
  return { views: num(s.playCount), likes: num(s.diggCount), comments: num(s.commentCount), shares: num(s.shareCount) };
}
async function doTikTok(u) {
  const clean = u.href.replace(/\?.*$/, '');
  let r = await fetchHtml(clean);
  let stats = r.html ? parseTikTok(r.html) : null;
  if (!stats && clean !== u.href) {
    r = await fetchHtml(u.href);
    stats = r.html ? parseTikTok(r.html) : null;
  }
  if (!stats) {
    return { stats: null, hint: 'Data TikTok tidak ditemukan (video privat/dihapus, atau permintaan diblokir TikTok' + (r.error ? '; ' + r.error : r.status ? '; HTTP ' + r.status : '') + ').' };
  }
  return { stats };
}
// Baca angka dari JSON terstruktur di HTML Facebook (versi perayap).
// Hanya mengambil objek yang terikat ke ID video yang diminta, agar tidak
// tertukar dengan angka video lain yang ikut termuat di halaman.
function parseFacebookJson(html, videoId) {
  const out = { views: null, likes: null, comments: null, shares: null };
  if (!html) return out;
  // Views: "associated_video":{...,"id":"<id>"},"video_view_count":216
  const vre = /"associated_video":\{[^}]*"id":"(\d+)"[^}]*\},"video_view_count":(\d+)/g;
  let m;
  while ((m = vre.exec(html)) !== null) {
    if (!videoId || m[1] === videoId) { out.views = num(m[2]); break; }
  }
  // Likes & comments: objek feedback pada data hero video itu sendiri:
  // "data":{"id":"<id>",...,"feedback":{... "reaction_count":{"count":18} ... "total_comment_count":4 ...}}
  // ID yang sama bisa muncul di beberapa objek lain (mis. konfigurasi iklan),
  // jadi semua kemunculan diperiksa sampai ada segmen yang memuat feedback-nya.
  const segs = [];
  if (videoId) {
    const marker = '"data":{"id":"' + videoId + '"';
    let i = html.indexOf(marker);
    while (i >= 0 && segs.length < 8) {
      segs.push(html.slice(i, i + 6000));
      i = html.indexOf(marker, i + marker.length);
    }
  }
  if (!segs.length) {
    const j = html.indexOf('"feedback":{');
    if (j >= 0) segs.push(html.slice(j, j + 6000));
  }
  for (const seg of segs) {
    if (out.likes === null) {
      const rm = seg.match(/"reaction_count":\{"count":(\d+)/) || seg.match(/"i18n_reaction_count":"(\d+)"/);
      if (rm) out.likes = num(rm[1]);
    }
    if (out.comments === null) {
      const cm = seg.match(/"total_comment_count":(\d+)/) || seg.match(/"comments":\{"total_count":(\d+)/);
      if (cm) out.comments = num(cm[1]);
    }
    if (out.likes !== null && out.comments !== null) break;
  }
  return out;
}
async function doFacebook(u) {
  const href = u.href;
  const idm = href.match(/\/reel\/(\d+)/) || href.match(/[?&]v=(\d+)/) || href.match(/\/videos\/(?:[^/]+\/)?(\d+)/);
  const videoId = idm ? idm[1] : null;
  const watchUrl = videoId ? 'https://www.facebook.com/watch/?v=' + videoId : null;
  const targets = [];
  if (watchUrl) targets.push(watchUrl); // bentuk /watch/ diterima server
  if (!targets.includes(href)) targets.push(href);
  const results = await Promise.all(targets.map(t => fetchHtml(t)));
  const parts = [];
  let lastErr = '';
  for (const r of results) {
    if (r.html && r.status < 400) {
      const map = metaMap(r.html);
      parts.push(fromText(textFromMeta(map, 'Facebook')));
    } else {
      lastErr = r.error || (r.status ? 'HTTP ' + r.status : '');
    }
  }
  // Versi perayap (Googlebot) memuat JSON terstruktur berisi views/likes/comments
  // untuk video yang diminta — dipakai lebih dulu, meta menjadi pelengkap (shares).
  if (watchUrl) {
    const gb = await fetchHtml(watchUrl, GB_UA);
    if (gb.html && gb.status < 400) {
      parts.unshift(parseFacebookJson(gb.html, videoId));
      const map = metaMap(gb.html);
      parts.push(fromText(textFromMeta(map, 'Facebook')));
    }
  }
  const stats = merge(...parts);
  if (KEYS.every(k => stats[k] === null)) {
    return { stats: null, hint: 'Metadata Facebook tidak memuat angka interaksi' + (lastErr ? ' (' + lastErr + ')' : '') + '.' };
  }
  return { stats };
}
async function doInstagram(u) {
  const m = u.pathname.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  const targets = [u.href];
  if (m) targets.push('https://www.instagram.com/p/' + m[1] + '/embed/captioned/');
  const results = await Promise.all(targets.map(fetchHtml));
  const parts = [];
  results.forEach((r, i) => {
    if (r.html && r.status < 400) {
      const map = metaMap(r.html);
      parts.push(fromText(textFromMeta(map, 'Instagram')));
      if (i === 1) {
        // Halaman embed: hanya likes/comments yang dipakai. Angka views dari
        // JSON embed muncul tidak konsisten antarpermintaan dan tidak dapat
        // dipastikan milik postingan ini, jadi sengaja tidak dipakai.
        const ej = fromJsonish(r.html);
        parts.push({ views: null, likes: ej.likes, comments: ej.comments, shares: null });
      }
    }
  });
  // Versi perayap (Googlebot): meta description memuat "49 likes, 0 comments"
  // dan JSON media memuat like_count/comment_count — dengan UA browser biasa
  // halaman yang dikirim hanya kerangka aplikasi tanpa angka.
  const gb = await fetchHtml(u.href, GB_UA);
  if (gb.html && gb.status < 400) {
    const map = metaMap(gb.html);
    parts.unshift(fromText(textFromMeta(map, 'Instagram')));
    // Dari JSON halaman utama hanya likes/comments yang diambil: halaman ini
    // juga memuat media lain, jadi angka views dari JSON generik tidak dipercaya.
    const gj = fromJsonish(gb.html);
    parts.push({ views: null, likes: gj.likes, comments: gj.comments, shares: null });
  }
  const stats = merge(...parts);
  if (KEYS.every(k => stats[k] === null)) {
    return { stats: null, hint: 'Instagram tidak menampilkan angka interaksi pada HTML publik (umumnya butuh login atau permintaan diblokir). Angka sengaja dikosongkan, tidak dikarang.' };
  }
  return { stats };
}

/* ---------- hasil ---------- */
function build(platform, url, stats, hint) {
  const vals = {};
  KEYS.forEach(k => { vals[k] = stats && stats[k] !== undefined ? stats[k] : null; });
  const found = KEYS.filter(k => vals[k] !== null);
  const missing = KEYS.filter(k => vals[k] === null);
  const status = found.length === 4 ? 'lengkap' : found.length === 0 ? 'gagal' : 'parsial';
  let message;
  if (status === 'lengkap') message = 'Semua angka terbaca dari halaman publik.';
  else if (status === 'parsial') message = 'Terbaca: ' + found.join(', ') + '. Tidak ditemukan di halaman publik: ' + missing.join(', ') + '.';
  else message = hint || 'Tidak ada angka yang dapat dibaca.';
  return Object.assign({ platform, url }, vals, { status, message, fetchedAt: new Date().toISOString() });
}

module.exports = async function handler(req, res) {
  let platform = null;
  let raw = '';
  try {
    raw = (req.query && req.query.url) || new URL(req.url, 'http://localhost').searchParams.get('url') || '';
    if (Array.isArray(raw)) raw = raw[0];
    raw = String(raw).trim();
    let u;
    try { u = new URL(raw); } catch (e) { u = null; }
    if (!u || !/^https?:$/.test(u.protocol)) {
      return send(res, 400, build(null, raw, null, 'Parameter url tidak valid. Gunakan link http(s) lengkap.'));
    }
    platform = detectPlatform(u);
    if (!platform) {
      return send(res, 400, build(null, raw, null, 'Platform tidak didukung. Gunakan link TikTok, Instagram, atau Facebook.'));
    }
    let out;
    if (platform === 'TikTok') out = await doTikTok(u);
    else if (platform === 'Facebook') out = await doFacebook(u);
    else out = await doInstagram(u);
    return send(res, 200, build(platform, raw, out.stats, out.hint));
  } catch (e) {
    return send(res, 200, build(platform, raw, null, 'Terjadi kesalahan di server: ' + (e && e.message ? e.message : 'tidak diketahui')));
  }
};
