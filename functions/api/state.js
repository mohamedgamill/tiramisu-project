// تخزين بيانات المخزون في قاعدة بيانات Cloudflare D1 (الربط باسم DB).
// كل البيانات محفوظة في صف واحد، ومعاها رقم نسخة (version)
// علشان لو جهازين عدّلوا في نفس الوقت، محدش يمسح شغل التاني.

const MAX_BYTES = 900_000;
let tableReady = false;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function ensureTable(db) {
  if (tableReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS app_state (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       data TEXT NOT NULL,
       version INTEGER NOT NULL,
       updated_at TEXT NOT NULL
     )`
  ).run();
  tableReady = true;
}

async function readRow(db) {
  const row = await db.prepare('SELECT data, version FROM app_state WHERE id = 1').first();
  return row ? { state: JSON.parse(row.data), version: row.version } : { state: null, version: 0 };
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: 'db_missing' }, 503);
  await ensureTable(env.DB);
  return json(await readRow(env.DB));
}

export async function onRequestPut({ request, env }) {
  if (!env.DB) return json({ error: 'db_missing' }, 503);
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    return json({ error: 'bad_request' }, 400);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const { state, version } = body || {};
  if (!state || !Array.isArray(state.items) || !Array.isArray(state.history) ||
      typeof state.totalProduced !== 'number' || !Number.isInteger(version) || version < 0) {
    return json({ error: 'bad_request' }, 400);
  }

  const data = JSON.stringify(state);
  if (data.length > MAX_BYTES) return json({ error: 'too_large' }, 413);

  await ensureTable(env.DB);
  const now = new Date().toISOString();

  const result = version === 0
    ? await env.DB.prepare(
        'INSERT OR IGNORE INTO app_state (id, data, version, updated_at) VALUES (1, ?, 1, ?)'
      ).bind(data, now).run()
    : await env.DB.prepare(
        'UPDATE app_state SET data = ?, version = version + 1, updated_at = ? WHERE id = 1 AND version = ?'
      ).bind(data, now, version).run();

  if (result.meta.changes !== 1) {
    // جهاز تاني حفظ قبلنا: نرجّع آخر بيانات علشان الجهاز ده يتحدّث.
    return json({ error: 'conflict', ...(await readRow(env.DB)) }, 409);
  }

  return json({ version: version + 1 });
}
