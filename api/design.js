// Saved layouts for client lighting pages (e.g. devansh.ca/sharon).
// GET  /api/design?key=<page>  -> { data, saved_at } (data is null until the first save)
// PUT  /api/design?key=<page>  body { data, by } -> saves it, keeps every save under history/
// POST /api/design?key=<page>&event=open -> records a page open (device type only)
// GET  /api/design?key=<page>&activity=<ISO time> -> opens and saves since then
// Storage: the private Vercel Blob store connected to this project (client-designs), via OIDC or BLOB_READ_WRITE_TOKEN.
const KEY_RE = /^[a-z0-9-]{3,60}$/;
const MAX_BYTES = 300 * 1024;

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  const key = (req.query && req.query.key) || '';
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'bad key' });
  const env = process.env;
  if (!env.BLOB_READ_WRITE_TOKEN && !env.BLOB_STORE_ID) return res.status(503).json({ error: 'storage not set up' });
  // auth: a read-write token if one is set, otherwise the project's OIDC token with the connected store id
  const auth = env.BLOB_READ_WRITE_TOKEN ? {} : { oidcToken: req.headers['x-vercel-oidc-token'] || env.VERCEL_OIDC_TOKEN, storeId: env.BLOB_STORE_ID };
  const { put, get, list } = await import('@vercel/blob');
  const latest = `designs/${key}/latest.json`;
  try {
    // activity since a time: page opens and saves, for Devansh's notifications
    if (req.method === 'GET' && req.query.activity) {
      const since = new Date(req.query.activity); if (isNaN(since)) return res.status(400).json({ error: 'bad time' });
      const pick = async prefix => { const out = []; let cursor; do { const r = await list({ prefix, cursor, limit: 1000, ...auth }); out.push(...r.blobs); cursor = r.hasMore ? r.cursor : null; } while (cursor); return out.filter(b => new Date(b.uploadedAt) > since).map(b => b.pathname.slice(prefix.length).replace(/\.json$/, '')); };
      const visits = (await pick(`designs/${key}/visits/`)).map(n => { const [at, device] = n.split('__'); return { at: at.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, 'T$1:$2:$3.$4Z'), device }; });
      const saves = (await pick(`designs/${key}/history/`)).map(n => { const [at, by] = n.split('__'); return { at: at.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, 'T$1:$2:$3.$4Z'), by: by || 'unknown' }; });
      return res.status(200).json({ since: since.toISOString(), visits, saves });
    }
    // a visitor opened the page (Devansh's own devices don't report)
    if (req.method === 'POST' && req.query.event === 'open') {
      const ua = String(req.headers['user-agent'] || ''), device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'other';
      const at = new Date().toISOString();
      await put(`designs/${key}/visits/${at.replace(/[:.]/g, '-')}__${device}.json`, JSON.stringify({ at, device }), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', ...auth });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'GET') {
      const r = await get(latest, { access: 'private', useCache: false, ...auth });
      if (!r) return res.status(200).json({ data: null, saved_at: null });
      const text = await new Response(r.stream).text();
      res.setHeader('content-type', 'application/json');
      return res.status(200).send(text);
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || typeof body.data !== 'object' || body.data === null) return res.status(400).json({ error: 'missing data' });
      const saved_at = new Date().toISOString();
      const text = JSON.stringify({ data: body.data, saved_at });
      if (text.length > MAX_BYTES) return res.status(413).json({ error: 'too large' });
      const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', ...auth };
      await put(latest, text, opts);
      const by = body.by === 'devansh' ? 'devansh' : 'client';
      await put(`designs/${key}/history/${saved_at.replace(/[:.]/g, '-')}__${by}.json`, text, opts);
      return res.status(200).json({ ok: true, saved_at });
    }
    res.setHeader('allow', 'GET, PUT');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('design api', key, e);
    return res.status(500).json({ error: 'save failed' });
  }
};
