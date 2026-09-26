import crypto from 'crypto';
import { supabase } from './supabase-config.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.PADDLE_WEBHOOK_SECRET || '';
    const signatureHeader = req.headers['paddle-signature'] || '';
    const rawBody = JSON.stringify(req.body);

    // 1. التحقق من التوقيع الأمني الخاص بـ Paddle
    if (!verifyPaddleSignature(signatureHeader, rawBody, secret)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const eventType = req.body.event_type;

    // 2. عند نجاح الشراء
    if (eventType === 'transaction.completed') {
      const data = req.body.data;
      const customData = data.custom_data;
      const userId = customData?.userId;
      const priceId = data.items?.[0]?.price_id;

      // تحديد عدد الكريديت حسب Price ID ديال الباقة فـ Paddle
      let creditsToAdd = 0;
      if (priceId === 'pri_01m2rr88016xc9sjgc83517qvm') creditsToAdd = 5;
      if (priceId === 'pri_01m2rramtt2v9b051q9bm7edy7') creditsToAdd = 15;
      if (priceId === 'pri_01m2rrd0c2h9zpk9xr9py26fyv') creditsToAdd = 30;

      if (userId && creditsToAdd > 0) {
        const { data: user } = await supabase
          .from('users')
          .select('credits, id')
          .eq('id', userId)
          .single();

        if (user) {
          const updatedCredits = (user.credits || 0) + creditsToAdd;

          await supabase
            .from('users')
            .update({ credits: updatedCredits })
            .eq('id', user.id);

          console.log(`تم إضافة ${creditsToAdd} كريديت للمستخدم: ${userId}`);
        }
      }
    }

    return res.status(200).json({ status: 'success' });
  } catch (err) {
    console.error('Webhook Error:', err);
    return res.status(500).json({ error: 'Webhook Error' });
  }
}

// دالة التحقق من توقيع Paddle
function verifyPaddleSignature(signatureHeader, rawBody, secret) {
  if (!signatureHeader || !secret) return false;
  try {
    const parts = signatureHeader.split(';');
    let ts, h1;
    parts.forEach(part => {
      const [key, value] = part.split('=');
      if (key === 'ts') ts = value;
      if (key === 'h1') h1 = value;
    });

    if (!ts || !h1) return false;

    const payload = `${ts}:${rawBody}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return expectedSignature === h1;
  } catch (err) {
    return false;
  }
}
