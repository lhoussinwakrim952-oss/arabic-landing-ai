import crypto from 'crypto';
import { supabase } from './supabase-config.js';

// مهم: نوقف bodyParser باش نقرا الـ raw body الأصلي
export const config = { api: { bodyParser: false } };

// Price ID -> عدد الكريديت
const CREDITS_BY_PRICE = {
  'pri_01m2rr88016xc9sjgc83517qvm': 5,
  'pri_01m2rramtt2v9b051q9bm7edy7': 15,
  'pri_01m2rrd0c2h9zpk9xr9py26fyv': 30,
};

const TOLERANCE_SECONDS = 300; // ضد replay attacks

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function verifyPaddleSignature(signatureHeader, rawBody, secret) {
  if (!signatureHeader || !secret) return false;

  let ts = null;
  const h1List = [];
  for (const part of signatureHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 'ts') ts = value;
    if (key === 'h1') h1List.push(value); // ممكن يكون أكثر من h1 فـ secret rotation
  }
  if (!ts || h1List.length === 0) return false;

  // فحص التاريخ
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}:${rawBody}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expected);

  return h1List.some((h1) => {
    const buf = Buffer.from(h1);
    return buf.length === expectedBuf.length && crypto.timingSafeEqual(buf, expectedBuf);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.PADDLE_WEBHOOK_SECRET || '';
    const signatureHeader = req.headers['paddle-signature'] || '';
    const rawBody = await readRawBody(req);

    // 1. التحقق من التوقيع قبل أي حاجة
    if (!verifyPaddleSignature(signatureHeader, rawBody, secret)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(rawBody);

    // 2. نتجاهل الأحداث الأخرى
    if (event.event_type !== 'transaction.completed') {
      return res.status(200).json({ status: 'ignored' });
    }

    const data = event.data;
    const userId = data.custom_data?.userId;

    // مجموع الكريديت (كل الـ items * quantity)
    let creditsToAdd = 0;
    for (const item of data.items || []) {
      const credits = CREDITS_BY_PRICE[item.price_id] || 0;
      creditsToAdd += credits * (item.quantity || 1);
    }

    if (!userId || creditsToAdd <= 0) {
      console.warn('Webhook skipped: missing userId or unknown price', {
        transactionId: data.id,
        userId,
      });
      return res.status(200).json({ status: 'skipped' });
    }

    // 3. إضافة ذرّية + idempotent (SQL function فـ supabase-setup.sql)
    const { data: result, error } = await supabase.rpc('grant_credits', {
      p_transaction_id: data.id,
      p_user_id: userId,
      p_credits: creditsToAdd,
    });

    if (error) {
      console.error('grant_credits failed:', error);
      return res.status(500).json({ error: 'Database error' }); // Paddle غيعاود
    }

    if (result === 'duplicate') {
      return res.status(200).json({ status: 'duplicate' });
    }
    if (result === 'user_not_found') {
      console.error('User not found for transaction', data.id, userId);
      return res.status(200).json({ status: 'user_not_found' });
    }

    console.log(`Added ${creditsToAdd} credits to user ${userId} (tx ${data.id})`);
    return res.status(200).json({ status: 'success' });
  } catch (err) {
    console.error('Webhook Error:', err);
    return res.status(500).json({ error: 'Webhook Error' });
  }
}
