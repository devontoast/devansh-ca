// Saved layouts for client lighting pages (e.g. devansh.ca/sharon).
// GET  /api/design?key=<page>  -> { data, saved_at } (data is null until the first save)
// PUT  /api/design?key=<page>  body { data } -> saves it, keeps every save under history/
// Storage: a private Vercel Blob store connected to this project (BLOB_READ_WRITE_TOKEN).
const KEY_RE = /^[a-z0-9-]{3,60}$/;
const MAX_BYTES = 300 * 1024;

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  const key = (req.query && req.query.key) || '';
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'bad key' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'storage not set up' });
  const { put, get } = await import('@vercel/blob');
  const latest = `designs/${key}/latest.json`;
  try {
    if (req.method === 'GET') {
      const r = await get(latest, { access: 'private', useCache: false });
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
      const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' };
      await put(latest, text, opts);
      await put(`designs/${key}/history/${saved_at.replace(/[:.]/g, '-')}.json`, text, opts);
      return res.status(200).json({ ok: true, saved_at });
    }
    res.setHeader('allow', 'GET, PUT');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('design api', key, e);
    return res.status(500).json({ error: 'save failed' });
  }
};
