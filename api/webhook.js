import crypto from 'crypto';

export default async function handler(req, res) {
  // استقبال طلبات POST فقط الخاصة بـ Webhooks
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || '';
    const signature = req.headers['x-signature'] || '';

    // Vercel كيقرى الـ Body تلقائياً
    const rawBody = JSON.stringify(req.body);

    // التحقق من التوقيع الأمني
    const hmac = crypto.createHmac('sha256', secret);
    const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8');
    const signatureBuffer = Buffer.from(signature, 'utf8');

    if (digest.length !== signatureBuffer.length || !crypto.timingSafeEqual(digest, signatureBuffer)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const eventName = req.body.meta.event_name;

    // معالجة حدث شراء جديد
    if (eventName === 'order_created' || eventName === 'subscription_created') {
      const customerEmail = req.body.data.attributes.user_email;

      // TODO: قم بربط الدالة الخاصة بـ Supabase لتفعيل حساب الزبون
      console.log('مبيعة جديدة للمستخدم:', customerEmail);
    }

    return res.status(200).json({ status: 'success' });
  } catch (err) {
    return res.status(500).json({ error: 'Webhook Error' });
  }
}
