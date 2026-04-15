const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');

const app = express();
app.use(cors());

// Ensure child processes can find node and yt-dlp
const EXEC_OPTS = {
  encoding: 'utf8',
  timeout: 30000,
  env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || '') },
};

// Cache extracted URLs (they expire after ~4 hours)
const cache = new Map();
const CACHE_TTL = 4 * 60 * 60 * 1000;

/* ──────────────────────────────────────────────
   Strategy Layer 1 — yt-dlp (multiple clients)
   ────────────────────────────────────────────── */
const YT_DLP_CLIENTS = ['default', 'android', 'ios', 'mweb', 'tv_embedded', 'mediaconnect'];

function tryYtDlp(videoId) {
  for (const client of YT_DLP_CLIENTS) {
    try {
      const clientArg = client === 'default'
        ? ''
        : ` --extractor-args "youtube:player_client=${client}"`;
      const cmd = `yt-dlp -f "best[height<=720][ext=mp4]/best[height<=720]/best"${clientArg} --no-check-certificates --geo-bypass -g "https://www.youtube.com/watch?v=${videoId}" 2>/dev/null`;
      console.log(`  [yt-dlp:${client}] trying...`);
      const raw = execSync(cmd, EXEC_OPTS).trim();
      const url = raw.split('\n').filter(l => l.startsWith('http')).pop();
      if (url) {
        console.log(`  [yt-dlp:${client}] ✓ success`);
        return url;
      }
    } catch {
      console.log(`  [yt-dlp:${client}] ✗ failed`);
    }
  }
  return null;
}

/* ──────────────────────────────────────────────
   Strategy Layer 2 — Invidious API
   ────────────────────────────────────────────── */
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.com',
  'https://vid.puffyan.us',
  'https://invidious.fdn.fr',
  'https://yt.artemislena.eu',
  'https://invidious.perennialte.ch',
  'https://invidious.privacyredirect.com',
  'https://iv.melmac.space',
];

async function tryInvidious(videoId) {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      console.log(`  [Invidious] trying ${instance}...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(
        `${instance}/api/v1/videos/${videoId}?fields=formatStreams`,
        { signal: controller.signal, headers: { 'Accept': 'application/json' } }
      );
      clearTimeout(timeout);
      if (!res.ok) { console.log(`  [Invidious] ✗ ${instance} HTTP ${res.status}`); continue; }

      const data = await res.json();
      const streams = (data.formatStreams || []).filter(
        s => s.url && s.type && s.type.includes('video/mp4')
      );

      // Prefer 720p → 360p → any
      const pick =
        streams.find(s => s.qualityLabel === '720p' || s.quality === 'hd720') ||
        streams.find(s => s.qualityLabel === '360p' || s.quality === 'medium') ||
        streams[0];

      if (pick?.url) {
        console.log(`  [Invidious] ✓ ${pick.qualityLabel || pick.quality} from ${instance}`);
        return pick.url;
      }
      console.log(`  [Invidious] ✗ ${instance} no usable streams`);
    } catch (e) {
      console.log(`  [Invidious] ✗ ${instance}: ${(e.message || '').substring(0, 80)}`);
    }
  }
  return null;
}

/* ──────────────────────────────────────────────
   Strategy Layer 3 — Piped API
   ────────────────────────────────────────────── */
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.yt',
  'https://piped-api.lunar.icu',
  'https://pa.il.ax',
  'https://api.piped.privacydev.net',
];

async function tryPiped(videoId) {
  for (const instance of PIPED_INSTANCES) {
    try {
      console.log(`  [Piped] trying ${instance}...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(
        `${instance}/streams/${videoId}`,
        { signal: controller.signal, headers: { 'Accept': 'application/json' } }
      );
      clearTimeout(timeout);
      if (!res.ok) { console.log(`  [Piped] ✗ ${instance} HTTP ${res.status}`); continue; }

      const data = await res.json();
      // Piped returns videoStreams — filter for muxed MP4 (videoOnly === false)
      const streams = (data.videoStreams || [])
        .filter(s => s.url && s.mimeType && s.mimeType.includes('video/mp4') && !s.videoOnly);

      // Sort: prefer ≤720p, highest resolution first
      streams.sort((a, b) => {
        const aH = parseInt(a.quality) || 0;
        const bH = parseInt(b.quality) || 0;
        if (aH <= 720 && bH <= 720) return bH - aH;
        if (aH <= 720) return -1;
        if (bH <= 720) return 1;
        return aH - bH;
      });

      if (streams[0]?.url) {
        console.log(`  [Piped] ✓ ${streams[0].quality} from ${instance}`);
        return streams[0].url;
      }
      console.log(`  [Piped] ✗ ${instance} no usable streams`);
    } catch (e) {
      console.log(`  [Piped] ✗ ${instance}: ${(e.message || '').substring(0, 80)}`);
    }
  }
  return null;
}

/* ──────────────────────────────────────────────
   Main extraction — cascade through all layers
   ────────────────────────────────────────────── */
async function extractUrl(videoId) {
  // Layer 1: yt-dlp (unlikely to work on datacenter IPs but worth trying)
  const ytUrl = tryYtDlp(videoId);
  if (ytUrl) return { url: ytUrl, source: 'yt-dlp' };

  // Layer 2: Invidious API
  const invUrl = await tryInvidious(videoId);
  if (invUrl) return { url: invUrl, source: 'invidious' };

  // Layer 3: Piped API
  const pipedUrl = await tryPiped(videoId);
  if (pipedUrl) return { url: pipedUrl, source: 'piped' };

  return null;
}

/* ──────────────────────────────────────────────
   Routes
   ────────────────────────────────────────────── */

// Single video extraction
app.get('/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;

  // Check cache
  const cached = cache.get(videoId);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[CACHE HIT] ${videoId} (${cached.source})`);
    return res.json({ url: cached.url, source: cached.source });
  }

  try {
    console.log(`[EXTRACTING] ${videoId}...`);
    const result = await extractUrl(videoId);

    if (!result) {
      console.error(`[FAILED] ${videoId}: No URL from any strategy`);
      return res.status(500).json({ error: 'Failed to extract stream URL' });
    }

    cache.set(videoId, { url: result.url, source: result.source, expiresAt: Date.now() + CACHE_TTL });
    console.log(`[OK] ${videoId} via ${result.source}`);
    res.json({ url: result.url, source: result.source });
  } catch (e) {
    console.error(`[ERROR] ${videoId}:`, e.message?.substring(0, 200));
    res.status(500).json({ error: 'Failed to extract stream URL' });
  }
});

// Batch endpoint: extract multiple videos at once
app.get('/batch', async (req, res) => {
  const ids = (req.query.ids || '').split(',').filter(Boolean);
  const results = {};

  for (const id of ids.slice(0, 10)) {
    const cached = cache.get(id);
    if (cached && Date.now() < cached.expiresAt) {
      results[id] = cached.url;
      continue;
    }
    try {
      console.log(`[BATCH] ${id}...`);
      const result = await extractUrl(id);
      if (result) {
        cache.set(id, { url: result.url, source: result.source, expiresAt: Date.now() + CACHE_TTL });
        results[id] = result.url;
      } else {
        results[id] = null;
      }
    } catch {
      results[id] = null;
    }
  }

  res.json(results);
});

// Health check
app.get('/health', (_, res) => res.json({
  status: 'ok',
  cached: cache.size,
  version: 'v3-multi-fallback',
}));

// Debug endpoint
app.get('/debug', async (_, res) => {
  let ytdlpVersion = 'unknown';
  let nodeCheck = 'unknown';
  let ytdlpTest = 'not tested';
  let invidiousTest = 'not tested';
  let pipedTest = 'not tested';

  // yt-dlp version
  try {
    ytdlpVersion = execSync('yt-dlp --version', { ...EXEC_OPTS, timeout: 5000 }).trim();
  } catch (e) { ytdlpVersion = 'error: ' + e.message; }

  // Node check
  try {
    nodeCheck = execSync(
      'which node && node --version && ls /root/bgutil-ytdlp-pot-provider/server/build/ 2>&1 || echo "no bgutil build"',
      EXEC_OPTS
    ).trim();
  } catch (e) { nodeCheck = e.message; }

  // Quick test: try a known public video via Invidious
  try {
    const testId = 'jNQXAC9IVRw'; // "Me at the zoo" — first YouTube video
    const invUrl = await tryInvidious(testId);
    invidiousTest = invUrl ? `✓ Got URL (${invUrl.substring(0, 80)}...)` : '✗ No URL from any instance';
  } catch (e) {
    invidiousTest = '✗ Error: ' + (e.message || '').substring(0, 200);
  }

  // Quick test: Piped
  try {
    const testId = 'jNQXAC9IVRw';
    const pipedUrl = await tryPiped(testId);
    pipedTest = pipedUrl ? `✓ Got URL (${pipedUrl.substring(0, 80)}...)` : '✗ No URL from any instance';
  } catch (e) {
    pipedTest = '✗ Error: ' + (e.message || '').substring(0, 200);
  }

  res.json({ ytdlpVersion, nodeCheck, invidiousTest, pipedTest });
});

/* ──────────────────────────────────────────────
   Start server
   ────────────────────────────────────────────── */
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 Cinemati Stream Server v3 (multi-fallback) on port ${PORT}`);
  console.log(`   http://localhost:${PORT}/health`);

  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   http://${net.address}:${PORT}/health  (use this in app)`);
      }
    }
  }
  console.log('');
});
