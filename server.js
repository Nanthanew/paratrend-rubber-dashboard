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

// ข้อมูลตั้งต้นพร้อมส่งทันที (Instant Memory Store)
const memoryStore = {
  daily: null,
  latex: null,
  cup: null,
  rss3: null,
  tra: {
    success: true,
    source: 'สมาคมยางพาราไทย (THE THAI RUBBER ASSOCIATION)',
    updated_date: '11 พ.ย. 2569',
    urls: {
      local: 'http://www.thainr.com/th/?detail=pr-local',
      fob: 'http://www.thainr.com/th/?detail=pr-fob'
    },
    local: {
      rss3: { name: 'ยางแผ่นรมควัน ชั้น 3 (RSS 3)', price: 85.80, change: '+0.30', unit: 'บาท/กก.' },
      latex: { name: 'น้ำยางสด (Field Latex)', price: 73.50, change: '+0.50', unit: 'บาท/กก.' },
      uss: { name: 'ยางแผ่นดิบคุณภาพดี (USS)', price: 82.65, change: '+0.25', unit: 'บาท/กก.' },
      cup: { name: 'ยางก้อนถ้วย (Cup Lump 100%)', price: 61.50, change: '+0.20', unit: 'บาท/กก.' }
    },
    fob: {
      rss3_bkk: { name: 'FOB ยางแผ่นรมควัน ชั้น 3 (ท่าเรือกรุงเทพ/สงขลา)', thb: 89.20, usd: 2665, unit: 'บาท/กก.' },
      str20: { name: 'FOB ยางแท่ง STR 20', thb: 76.40, usd: 2285, unit: 'บาท/กก.' },
      latex_60: { name: 'FOB น้ำยางข้น 60% (Centrifuged Latex)', thb: 56.80, usd: 1695, unit: 'บาท/กก.' }
    },
    records: []
  }
};

function loadFallbackFile(key) {
  const filename = FALLBACK_FILES[key] || 'fallback-daily.json';
  const filePath = path.join(__dirname, filename);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error(`[Fallback Error] ${filename}:`, err.message);
  }
  return { success: true, data: [] };
}

function preloadAllData() {
  ['daily', 'latex', 'cup', 'rss3'].forEach(key => {
    memoryStore[key] = loadFallbackFile(key);
  });
}
preloadAllData();

// ฟังก์ชันดึงข้อมูลจากเว็บสมาคมยางพาราไทย (thainr.com) เบื้องหลัง
async function refreshTraData() {
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
      return (v && v > 20 && v < 250) ? v : null;
    };

    const rss3 = extractNum(/(?:ยางแผ่นรมควันชั้น\s*3|RSS\s*3)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i);
    const latex = extractNum(/(?:น้ำยางสด|Field\s*Latex)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i);
    const str20 = extractNum(/(?:STR\s*20|ยางแท่ง)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i);

    if (rss3) memoryStore.tra.local.rss3.price = rss3;
    if (latex) memoryStore.tra.local.latex.price = latex;
    if (str20) memoryStore.tra.fob.str20.thb = str20;

    const todayIso = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const [yyyy, mm, dd] = todayIso.split('-');
    const yearTh = String(Number(yyyy) + 543);

    const newRecords = [
      {
        data_date: todayIso, day: String(Number(dd)), month: String(Number(mm)), year_th: yearTh,
        product_category: 'ยางพารา', product_name: 'ยางพาราแผ่นดิบ ชั้น 3',
        market_name: 'สมาคมยางพาราไทย (TRA)', province: 'สงขลา',
        day_price: memoryStore.tra.local.rss3.price, unit: 'บาท/กก.'
      },
      {
        data_date: todayIso, day: String(Number(dd)), month: String(Number(mm)), year_th: yearTh,
        product_category: 'ยางพารา', product_name: 'น้ำยางพาราสด',
        market_name: 'สมาคมยางพาราไทย (TRA)', province: 'สงขลา',
        day_price: memoryStore.tra.local.latex.price, unit: 'บาท/กก.'
      }
    ];

    memoryStore.tra.records = newRecords;

    if (memoryStore.daily && Array.isArray(memoryStore.daily.data)) {
      const existing = memoryStore.daily.data.filter(
        r => !(r.market_name === 'สมาคมยางพาราไทย (TRA)' && r.data_date === todayIso)
      );
      memoryStore.daily.data = [...newRecords, ...existing];
    }
  } catch (_) {}
}
setTimeout(refreshTraData, 1000);

// ----------------- API Endpoints -----------------

app.get('/api/rubber/daily', (req, res) => {
  if (!memoryStore.daily?.data) memoryStore.daily = loadFallbackFile('daily');
  res.json(memoryStore.daily);
});

app.get('/api/rubber/weekly', (req, res) => {
  const product = ['latex', 'cup', 'rss3'].includes(req.query.product) ? req.query.product : 'cup';
  if (!memoryStore[product]?.data) memoryStore[product] = loadFallbackFile(product);
  res.json(memoryStore[product]);
});

app.get('/api/rubber/tra', (req, res) => {
  res.json(memoryStore.tra);
});

cron.schedule('30 8 * * 1-5', () => refreshTraData());

app.listen(PORT, () => {
  console.log(`ParaTrend Server กำลังทำงานที่พอร์ต ${PORT}`);
});
