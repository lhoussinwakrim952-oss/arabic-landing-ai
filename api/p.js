// api/p.js — كيعرض الصفحة المنشورة فـ /p/<slug>
// الصفحة كتتعرض بهيدر sandbox (بلا allow-same-origin) باش الكود ديالها ما يقدرش يقرا
// جلسة المنصة (localStorage / cookies) حتى وهي على نفس الدومين.

function notFound(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).send(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>الصفحة غير موجودة</title><body style="font-family:Tahoma,sans-serif;background:#0B0F19;color:#E2E8F0;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center">' +
    '<div><div style="font-size:48px">🔍</div><h1 style="font-size:20px">هذه الصفحة غير متاحة</h1></div></body></html>'
  );
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();

  const slug = String((req.query && req.query.slug) || '').toLowerCase();
  if (!/^[a-z0-9]{6,32}$/.test(slug)) return notFound(res);

  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return res.status(500).send('Server not configured');

  const headers = { apikey: key };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

  try {
    const r = await fetch(
      `${url}/rest/v1/published_pages?slug=eq.${slug}&active=eq.true&select=html&limit=1`,
      { headers }
    );
    if (!r.ok) return res.status(502).send('Upstream error');
    const rows = await r.json();
    if (!rows.length) return notFound(res);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Security-Policy',
      'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation'
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(rows[0].html);
  } catch (e) {
    console.error('p.js error', e);
    return res.status(500).send('Server error');
  }
}
