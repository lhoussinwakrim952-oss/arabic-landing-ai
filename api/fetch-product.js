export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { url } = req.body;
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "رابط غير صالح" });
    }

    const pageRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "ar,en;q=0.8",
      },
    });

    if (!pageRes.ok) {
      return res.status(422).json({ error: "تعذّر الوصول للصفحة (قد تكون محمية ضد الاستخراج الآلي)" });
    }

    const html = await pageRes.text();

    const getMeta = (prop) => {
      let m = html.match(new RegExp('<meta[^>]+property=["\']' + prop + '["\'][^>]+content=["\']([^"\']+)["\']', "i"));
      if (m) return m[1];
      m = html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']' + prop + '["\']', "i"));
      return m ? m[1] : null;
    };

    const title = getMeta("og:title") || ((html.match(/<title>([^<]+)<\/title>/i) || [])[1] || "").trim();
    const description = getMeta("og:description") || "";

    // اجمع كل صور og:image الموجودة
    const imageUrls = [];
    const ogImgRegex = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi;
    let m;
    while ((m = ogImgRegex.exec(html)) !== null) {
      if (!imageUrls.includes(m[1])) imageUrls.push(m[1]);
      if (imageUrls.length >= 4) break;
    }

    // حاول تجيب السعر من JSON-LD إذا موجود
    let price = null;
    const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
    let jm;
    while ((jm = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(jm[1]);
        const items = Array.isArray(data) ? data : (data["@graph"] || [data]);
        for (const it of items) {
          const offers = it && it.offers;
          if (offers) {
            const off = Array.isArray(offers) ? offers[0] : offers;
            if (off && off.price) { price = off.price; break; }
          }
        }
      } catch (e) {}
      if (price) break;
    }

    // نزّل الصور وحوّلها base64 باش يقدر الفرونت-إند يستعملها مباشرة
    const images = [];
    for (const imgUrl of imageUrls.slice(0, 4)) {
      try {
        const imgRes = await fetch(imgUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!imgRes.ok) continue;
        const buf = await imgRes.arrayBuffer();
        const contentType = imgRes.headers.get("content-type") || "image/jpeg";
        const b64 = Buffer.from(buf).toString("base64");
        images.push("data:" + contentType + ";base64," + b64);
      } catch (e) {}
    }

    return res.status(200).json({ title, description, price, images });
  } catch (err) {
    return res.status(500).json({ error: err.message || "تعذّر استخراج بيانات المنتج من هاد الرابط" });
  }
}

