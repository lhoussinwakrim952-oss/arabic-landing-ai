// api/order.js — كيستقبل طلب من صفحة منشورة وكيحفظو فجدول orders (service role).

const hits = new Map(); // rate limit بسيط فالذاكرة (لكل instance)

const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '37', '38', '39', '40', '41', '42', '43', '44'];

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function rateLimited(key) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (arr.length >= 6) { hits.set(key, arr); return true; }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

// رقم محدود (بدون NaN) مع تقريب لخانتين
function num(v, min, max) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

// تنظيف اختيارات العميل (المقاس، اللون، الكمية، العرض، الإجمالي)
function cleanOptions(o) {
  if (!o || typeof o !== 'object') return null;
  const out = {};
  const size = clean(o.size, 6).toUpperCase();
  if (SIZES.includes(size)) out.size = size;
  const color = clean(o.color, 40);
  if (color) out.color = color;
  let qty = Math.round(Number(o.qty));
  if (!isFinite(qty) || qty < 1) qty = 1;
  if (qty > 99) qty = 99;
  out.qty = qty;
  if (o.offer && typeof o.offer === 'object') {
    const oq = Math.round(Number(o.offer.qty));
    const op = num(o.offer.price, 0, 1e9);
    if (oq >= 1 && oq <= 99 && op != null) out.offer = { qty: oq, price: op };
  }
  const up = num(o.unit_price, 0, 1e9); if (up != null) out.unit_price = up;
  const ot = num(o.original_total, 0, 1e9); if (ot != null) out.original_total = ot;
  const tot = num(o.total, 0, 1e9); if (tot != null) out.total = tot;
  const sv = num(o.savings, 0, 1e9); if (sv != null) out.savings = sv;
  const cur = clean(o.currency, 20); if (cur) out.currency = cur;
  const meaningful = out.size || out.color || out.offer || out.qty > 1 || out.total != null;
  return meaningful ? out : null;
}

// ملخص نصي (يُستعمل فقط كخطة احتياطية إذا عمود options ما زال غير موجود)
function optionsSummary(o) {
  const p = [];
  if (o.size) p.push('المقاس: ' + o.size);
  if (o.color) p.push('اللون: ' + o.color);
  p.push('الكمية: ' + (o.qty || 1));
  if (o.offer) p.push('العرض: ' + o.offer.qty + ' بـ ' + o.offer.price);
  if (o.total != null) p.push('الإجمالي: ' + o.total + (o.currency ? ' ' + o.currency : ''));
  return '[' + p.join(' | ') + ']';
}

// رقم دولي تقريبي للواتساب: 0612.. + كود البلد => 212612..
function toIntl(phone, code) {
  const c = String(code || '').replace(/\D/g, '');
  let d = String(phone).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.replace(/\D/g, '');
  d = d.replace(/\D/g, '');
  if (d.startsWith('00')) return d.slice(2);
  if (c && d.startsWith(c) && d.length > 10) return d;
  d = d.replace(/^0+/, '');
  return (c || '') + d;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const slug = clean(body.slug, 40).toLowerCase();
    const name = clean(body.name, 80);
    const phone = clean(body.phone, 25);
    const city = clean(body.city, 80);
    const address = clean(body.address, 250);
    const options = cleanOptions(body.options);

    if (clean(body.hp, 10)) return res.status(200).json({ ok: true }); // honeypot
    if (!/^[a-z0-9]{6,32}$/.test(slug)) return res.status(400).json({ error: 'bad_slug' });
    if (name.length < 2) return res.status(400).json({ error: 'bad_name' });
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) return res.status(400).json({ error: 'bad_phone' });

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (rateLimited(ip + '|' + slug)) return res.status(429).json({ error: 'too_many' });

    const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !key) return res.status(500).json({ error: 'not_configured' });
    const headers = { 'Content-Type': 'application/json', apikey: key };
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

    const pr = await fetch(
      `${url}/rest/v1/published_pages?slug=eq.${slug}&active=eq.true&select=id,user_id,name,phone_code&limit=1`,
      { headers }
    );
    if (!pr.ok) return res.status(502).json({ error: 'upstream' });
    const pages = await pr.json();
    if (!pages.length) return res.status(404).json({ error: 'page_not_found' });
    const page = pages[0];

    // منع تكرار نفس الطلب (نفس الهاتف + نفس الصفحة فآخر 10 دقائق)
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const dr = await fetch(
      `${url}/rest/v1/orders?page_id=eq.${page.id}&phone=eq.${encodeURIComponent(phone)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
      { headers }
    );
    if (dr.ok && (await dr.json()).length) return res.status(200).json({ ok: true, duplicate: true });

    const row = {
      page_id: page.id,
      user_id: page.user_id,
      page_name: page.name,
      name, phone, city, address,
      phone_intl: toIntl(phone, page.phone_code),
    };
    if (options) row.options = options;

    const post = (payload) => fetch(`${url}/rest/v1/orders`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });

    let ir = await post(row);
    if (!ir.ok && options) {
      // احتياط: إلا عمود options ما تزادش فالجدول، كنحفظو الطلب بلا عمود وكنزيدو الملخص فالعنوان باش ما يضيعش
      console.error('order insert with options failed', ir.status, await ir.text());
      const fb = { ...row };
      delete fb.options;
      fb.address = clean((address ? address + ' ' : '') + optionsSummary(options), 250);
      ir = await post(fb);
    }
    if (!ir.ok) {
      console.error('order insert failed', ir.status, await ir.text());
      return res.status(500).json({ error: 'db' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('order.js error', e);
    return res.status(500).json({ error: 'server' });
  }
}
