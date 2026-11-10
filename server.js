'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = __dirname;
const TTL = 5 * 60 * 1000;
const MAX_STALE = 24 * 60 * 60 * 1000;
const cache = new Map();
const pending = new Map();
const names = { latex: 'น้ำยางสด คละ', cup: 'ยางก้อน คละ', rss3: 'ยางแผ่นดิบ ชั้น 3' };
const fallback = {};
for (const key of ['daily', 'latex', 'cup', 'rss3']) {
  fallback[key] = JSON.parse(fs.readFileSync(path.join(ROOT, 'fallback-' + key + '.json'), 'utf8'));
}
const html = fs.readFileSync(path.join(ROOT, 'index.html'));
function validate(json, key) {
  if (json.success !== true || !Array.isArray(json.data) || !json.data.length || json.data.length > 2000) throw Error('invalid upstream data');
  for (const row of json.data) {
    if (key === 'daily') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.data_date) || typeof row.market_name !== 'string' || typeof row.province !== 'string' || !['น้ำยางพาราสด', 'ยางพาราแผ่นดิบ ชั้น 3'].includes(row.product_name) || !Number.isFinite(Number(row.day_price)) || Number(row.day_price) <= 0) throw Error('invalid daily row');
    } else if (!['year_th', 'month', 'week'].every(field => Number.isInteger(Number(row[field]))) || row.product_name !== names[key] || !Number.isFinite(Number(row.value)) || Number(row.value) <= 0 || Number(row.month) < 1 || Number(row.month) > 12 || Number(row.week) < 1 || Number(row.week) > 6 || Number(row.year_th) < 2500) throw Error('invalid weekly row');
  }
  if (key === 'daily' && !['น้ำยางพาราสด', 'ยางพาราแผ่นดิบ ชั้น 3'].every(name => json.data.some(row => row.product_name === name))) throw Error('daily response missing a product');
  return { success: true, data: json.data };
}
function period(json, key) {
  if (key === 'daily') return json.data.map(r => r.data_date).sort().at(-1);
  const last = json.data.slice().sort((a,b) => (Number(a.year_th)*10000+Number(a.month)*100+Number(a.week))-(Number(b.year_th)*10000+Number(b.month)*100+Number(b.week))).at(-1);
  return last.year_th + '/' + last.month + '/' + last.week;
}
function payload(json, key, status, fetchedAt, error) {
  return { ...json, meta: { status, fetchedAt, priceAsOf: period(json,key), source: 'สำนักงานเศรษฐกิจการเกษตร (agriapi.nabc.go.th)', cacheSeconds: TTL/1000, ...(error ? { warning: error } : {}) } };
}
async function pull(key) {
  const url = key === 'daily'
    ? 'https://agriapi.nabc.go.th/api/daily-prices/category?product_category=' + encodeURIComponent('ยางพารา') + '&limit=400'
    : 'https://agriapi.nabc.go.th/api/weekly-prices/product?product_name=' + encodeURIComponent(names[key]) + '&limit=120';
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw Error('upstream HTTP ' + response.status);
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw Error('upstream is not JSON');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > 2 * 1024 * 1024) { await reader.cancel(); throw Error('upstream response too large'); }
    chunks.push(Buffer.from(item.value));
  }
  return validate(JSON.parse(Buffer.concat(chunks).toString('utf8')),key);
}
async function getData(key) {
  const old = cache.get(key);
  if (old && Date.now() - old.time < TTL) return payload(old.json,key,'cache',new Date(old.time).toISOString());
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    try {
      const json = await pull(key); const time = Date.now();
      cache.set(key,{ json,time });
      return payload(json,key,'live',new Date(time).toISOString());
    } catch (error) {
      console.warn('Rubber source unavailable:',key,error.message);
      if (old && Date.now()-old.time < MAX_STALE) return payload(old.json,key,'stale',new Date(old.time).toISOString(),'แหล่งข้อมูลไม่ตอบสนอง ใช้สำเนาล่าสุดบนเซิร์ฟเวอร์');
      return payload(validate(fallback[key],key),key,'snapshot',null,'แหล่งข้อมูลไม่ตอบสนอง ใช้สำเนาที่แนบมากับเว็บ');
    }
  })();
  pending.set(key,job);
  try { return await job; } finally { pending.delete(key); }
}
function send(res, code, body) {
  res.writeHead(code,{ 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff' });
  res.end(JSON.stringify(body));
}
const server = http.createServer(async (req,res) => {
  try {
    if (req.method !== 'GET') return send(res,405,{ error:'Method not allowed' });
    const url = new URL(req.url,'http://localhost');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200,{ 'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff' }); return res.end(html);
    }
    if (url.pathname === '/api/rubber/daily') {
      if ([...url.searchParams.keys()].length) return send(res,400,{ error:'Unexpected parameters' });
      return send(res,200,await getData('daily'));
    }
    if (url.pathname === '/api/rubber/weekly') {
      const keys = [...url.searchParams.keys()];
      const product = url.searchParams.get('product');
      if (keys.length !== 1 || keys[0] !== 'product' || !Object.hasOwn(names,product)) return send(res,400,{ error:'product must be latex, cup or rss3' });
      return send(res,200,await getData(product));
    }
    return send(res,404,{ error:'Not found' });
  } catch (error) { console.error(error.message); send(res,500,{ error:'Internal server error' }); }
});
server.listen(Number(process.env.PORT || 8081),process.env.HOST || '0.0.0.0');
