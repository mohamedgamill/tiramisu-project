// بوابة تسجيل الدخول: بتشتغل قبل أي صفحة أو ملف في الموقع.
// لو مفيش تسجيل دخول صحيح، بتعرض صفحة كلمة السر بدل المحتوى.
// كلمة السر بتتحط في إعدادات Cloudflare باسم APP_PASSWORD (مش موجودة في الكود).

const COOKIE_NAME = 'tiramisu_session';
const SESSION_DAYS = 30;
const MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

const encoder = new TextEncoder();

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function makeToken(secret) {
  const expires = Date.now() + MAX_AGE * 1000;
  return `${expires}.${await hmac(secret, 'session:' + expires)}`;
}

async function isValidToken(secret, token) {
  if (!token) return false;
  const [expires, sig] = token.split('.');
  if (!expires || !sig || !(Number(expires) > Date.now())) return false;
  return safeEqual(sig, await hmac(secret, 'session:' + expires));
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function page(body, status = 200, extraHeaders = {}) {
  return new Response(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>تسجيل الدخول - مدير مخزون التيراميسو</title>
  <style>
    * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           background: #fdfaf6; color: #1f2937; padding: 16px; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 28px 24px;
            width: 100%; max-width: 360px; box-shadow: 0 4px 12px rgba(92,58,33,0.12); text-align: center; }
    h1 { margin: 0 0 6px; font-size: 1.4rem; color: #5c3a21; }
    p { margin: 0 0 18px; color: #6b7280; font-size: 0.92rem; }
    input { width: 100%; padding: 12px 14px; border: 1px solid #d1d5db; border-radius: 10px;
            font-size: 1rem; margin-bottom: 12px; }
    button { width: 100%; padding: 12px; border: none; border-radius: 10px; font-size: 1rem;
             font-weight: 600; cursor: pointer; background: #5c3a21; color: #fff; }
    button:hover { background: #8c5a3c; }
    .error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; border-radius: 10px;
             padding: 10px; margin-bottom: 12px; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">${body}</div>
</body>
</html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function loginPage(error = '', status = 200) {
  return page(`
    <h1>🍰 مدير مخزون التيراميسو</h1>
    <p>اكتب كلمة السر علشان تدخل</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST" action="/api/login">
      <input type="password" name="password" placeholder="كلمة السر" autocomplete="current-password" required autofocus />
      <button type="submit">دخول</button>
    </form>`, status);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const secret = env.APP_PASSWORD;

  // لو كلمة السر لسه متحطتش في Cloudflare، الموقع يفضل مقفول.
  if (!secret) {
    return page(`<h1>⚙️ الموقع لسه بيتجهز</h1><p>كلمة السر (APP_PASSWORD) لسه متضافتش في إعدادات Cloudflare.</p>`, 503);
  }

  if (url.pathname === '/api/login' && request.method === 'POST') {
    const form = await request.formData();
    const password = String(form.get('password') || '');
    const ok = safeEqual(await hmac('pw-check', password), await hmac('pw-check', secret));
    if (!ok) {
      await new Promise(r => setTimeout(r, 1000)); // تأخير بسيط ضد التخمين
      return loginPage('كلمة السر غلط، جرّب تاني', 401);
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: '/',
        'Set-Cookie': `${COOKIE_NAME}=${await makeToken(secret)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }

  if (url.pathname === '/api/logout' && request.method === 'POST') {
    return new Response(null, {
      status: 303,
      headers: {
        Location: '/',
        'Set-Cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }

  // دخول Claude: مفتاح منفصل (API_TOKEN في Cloudflare) لـ /api/state بس.
  // لو اتمسح من Cloudflare، الدخول ده يتقفل فورًا.
  const auth = request.headers.get('Authorization') || '';
  if (env.API_TOKEN && url.pathname === '/api/state' && auth.startsWith('Bearer ')) {
    const given = auth.slice(7).trim();
    if (safeEqual(await hmac('api-check', given), await hmac('api-check', env.API_TOKEN))) {
      return next();
    }
    return json({ error: 'unauthorized' }, 401);
  }

  if (!(await isValidToken(secret, getCookie(request, COOKIE_NAME)))) {
    if (url.pathname.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
    return loginPage();
  }

  // الصفحات (HTML) ما تتخزنش في المتصفح، علشان أي تحديث يظهر على طول.
  const response = await next();
  if ((response.headers.get('Content-Type') || '').includes('text/html')) {
    const fresh = new Response(response.body, response);
    fresh.headers.set('Cache-Control', 'no-cache, must-revalidate');
    return fresh;
  }
  return response;
}
