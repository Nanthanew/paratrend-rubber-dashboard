const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_TARGET_ID = process.env.LINE_TARGET_ID;

const FALLBACK_FILES = {
  daily: 'fallback-daily.json',
  latex: 'fallback-latex.json',
  cup: 'fallback-cup.json',
  rss3: 'fallback-rss3.json'
};

// โหลดข้อมูลจากไฟล์ใส่ Memory ทันทีที่เปิดเซิร์ฟเวอร์ (ไม่ต้องรอโหลดใหม่ทุกครั้ง)
const memoryStore = {
  daily: null,
  latex: null,
  cup: null,
  rss3: null,
  tra: {
    success: true,
    source: 'สมาคมยางพาราไทย (THE THAI RUBBER ASSOCIATION)',
    summary: { rss3: 85.80, latex: 73.50, str20: 76.20 },
    records: []
  }
};

function loadFallbackFile(key) {
  const filename = FALLBACK_FILES[key] || 'fallback-daily.json';
  const filePath = path.join(__dirname, filename);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`[Fallback Error] อ่านไฟล์ ${filename} ไม่สำเร็จ:`, err.message);
  }
  return { success: true, data: [] };
}

// โหลดทุกไฟล์เตรียมไว้ตั้งแต่เริ่มรันเซิร์ฟเวอร์
function preloadAllData() {
  ['daily', 'latex', 'cup', 'rss3'].forEach(key => {
    memoryStore[key] = loadFallbackFile(key);
  });
  console.log('[Preload] โหลดข้อมูลสำรองทั้งหมดเข้าหน่วยความจำสำเร็จ พร้อมส่งข้อมูลทันที');
}
preloadAllData();

// ฟังก์ชันอัปเดตข้อมูลจาก สมาคมยางพาราไทย (ทำงานเบื้องหลัง ไม่บล็อกหน้าเว็บ)
async function refreshBackgroundData() {
  try {
    const response = await axios.get('http://www.thainr.com/th/?detail=pr-local', {
      timeout: 3500,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    let html = new TextDecoder('utf-8').decode(response.data);
    if (html.includes('windows-874') || html.includes('tis-620') || html.includes('')) {
      try { html = new TextDecoder('windows-874').decode(response.data); } catch (_) {}
    }

    const cleanText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const extractNum = (regex) => {
      const m = cleanText.match(regex);
      const v = m && m[1] ? parseFloat(m[1]) : null;
      return (v && v > 20 && v < 200) ? v : null;
    };

    const rss3 = extractNum(/(?:ยางแผ่นรมควันชั้น\s*3|ยางแผ่นดิบ|RSS\s*3)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i);
    const latex = extractNum(/(?:น้ำยางสด|Field\s*Latex)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i);
    const str20 = extractNum(/(?:STR\s*20|ยางแท่ง)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i);

    if (rss3 || latex) {
      const todayIso = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
      const [yyyy, mm, dd] = todayIso.split('-');
      const yearTh = String(Number(yyyy) + 543);
      const newRecords = [];

      if (rss3) {
        newRecords.push({
          data_date: todayIso, day: String(Number(dd)), month: String(Number(mm)), year_th: yearTh,
          product_category: 'ยางพารา', product_name: 'ยางพาราแผ่นดิบ ชั้น 3',
          market_name: 'สมาคมยางพาราไทย (TRA)', province: 'สงขลา', day_price: rss3, unit: 'บาท/กก.'
        });
      }
      if (latex) {
        newRecords.push({
          data_date: todayIso, day: String(Number(dd)), month: String(Number(mm)), year_th: yearTh,
          product_category: 'ยางพารา', product_name: 'น้ำยางพาราสด',
          market_name: 'สมาคมยางพาราไทย (TRA)', province: 'สงขลา', day_price: latex, unit: 'บาท/กก.'
        });
      }

      memoryStore.tra = {
        success: true,
        source: 'สมาคมยางพาราไทย (THE THAI RUBBER ASSOCIATION)',
        summary: { rss3: rss3 || 85.80, latex: latex || 73.50, str20: str20 || 76.20 },
        records: newRecords
      };

      if (memoryStore.daily && Array.isArray(memoryStore.daily.data)) {
        const filtered = memoryStore.daily.data.filter(
          r => !(r.market_name === 'สมาคมยางพาราไทย (TRA)' && r.data_date === todayIso)
        );
        memoryStore.daily.data = [...newRecords, ...filtered];
      }
      console.log('[Background] อัปเดตข้อมูลสมาคมยางพาราไทยสำเร็จ');
    }
  } catch (err) {
    // ข้ามอย่างเงียบๆ ไม่ให้กระทบความเร็วหน้าเว็บ
  }
}

// สั่งอัปเดตเบื้องหลัง 1 ครั้งตอนเริ่มเซิร์ฟเวอร์ (โดยไม่บล็อก API)
setTimeout(refreshBackgroundData, 1000);

// ----------------- API Endpoints (ตอบกลับทันที 0.01 วินาที) -----------------

app.get('/api/rubber/daily', (req, res) => {
  if (!memoryStore.daily || !memoryStore.daily.data) {
    memoryStore.daily = loadFallbackFile('daily');
  }
  res.json(memoryStore.daily);
});

app.get('/api/rubber/weekly', (req, res) => {
  const product = ['latex', 'cup', 'rss3'].includes(req.query.product) ? req.query.product : 'cup';
  if (!memoryStore[product] || !memoryStore[product].data) {
    memoryStore[product] = loadFallbackFile(product);
  }
  res.json(memoryStore[product]);
});

app.get('/api/rubber/tra', (req, res) => {
  res.json(memoryStore.tra);
});

// ----------------- ระบบส่งการแจ้งเตือน LINE -----------------

async function sendLineNotification(messageText) {
  if (!LINE_ACCESS_TOKEN || !LINE_TARGET_ID) return false;
  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: LINE_TARGET_ID, messages: [{ type: 'text', text: messageText }] },
      { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_ACCESS_TOKEN}` } }
    );
    return true;
  } catch (err) {
    console.error('[LINE Error]:', err.response?.data || err.message);
    return false;
  }
}

async function triggerPriceBroadcast() {
  try {
    const dailyRecords = memoryStore.daily?.data || [];
    const cupRecords = memoryStore.cup?.data || [];
    if (dailyRecords.length === 0) return false;

    const latestDate = dailyRecords[0]?.data_date || '2026-11-11';
    const todayRows = dailyRecords.filter(r => r.data_date === latestDate);
    const latexRows = todayRows.filter(r => r.product_name && r.product_name.includes('น้ำยาง'));
    const rss3Rows = todayRows.filter(r => r.product_name && r.product_name.includes('แผ่นดิบ'));

    const avg = rows => rows.length
      ? (rows.reduce((s, r) => s + Number(r.day_price || 0), 0) / rows.length).toFixed(2)
      : null;

    const latexPrice = avg(latexRows) || '73.50';
    const rss3Price = avg(rss3Rows) || '82.85';
    const cupPrice = cupRecords[0]?.week_price || cupRecords[0]?.day_price || '41.65';

    const msg = `📢 สรุปราคายางพารา ParaTrend (${latestDate})\n` +
      `[แหล่งข้อมูล: สศก. & สมาคมยางพาราไทย]\n` +
      `--------------------------------\n` +
      `💧 น้ำยางสด (เฉลี่ย): ${latexPrice} บาท/กก.\n` +
      `🥣 ยางก้อนถ้วย: ${cupPrice} บาท/กก.\n` +
      `📦 ยางแผ่นดิบ ชั้น 3: ${rss3Price} บาท/กก.\n` +
      `--------------------------------\n` +
      `🌐 ดูกราฟและพยากรณ์: https://paratrend-rubber.onrender.com`;

    return await sendLineNotification(msg);
  } catch (e) {
    return false;
  }
}

app.get('/api/test-line', async (req, res) => {
  const ok = await triggerPriceBroadcast();
  res.status(ok ? 200 : 500).json({ success: ok });
});

cron.schedule('30 8 * * 1-5', () => refreshBackgroundData());
cron.schedule('30 2 * * 1-5', () => triggerPriceBroadcast());

app.listen(PORT, () => {
  console.log(`ParaTrend Server กำลังทำงานที่พอร์ต ${PORT}`);
});
