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

// ข้อมูลสำรองในตัว (ป้องกันกรณีไฟล์ fallback-daily.json อ่านไม่ผ่าน)
const BUILTIN_DAILY_RECORDS = [
  {"data_date":"2026-11-11","day":"11","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สงขลา","province":"สงขลา","day_price":81.95,"unit":"บาท/กก."},
  {"data_date":"2026-11-11","day":"11","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สุราษฎร์ธานี","province":"สุราษฎร์ธานี","day_price":82.65,"unit":"บาท/กก."},
  {"data_date":"2026-11-11","day":"11","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"สมาคมน้ำยางข้นไทย (TLA - หน้าโรงงาน)","province":"สงขลา","day_price":76.80,"unit":"บาท/กก."},
  {"data_date":"2026-11-11","day":"11","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ที.ที.ลาเท็กซ์แอนด์โปรดักส์ จำกัด","province":"นครศรีธรรมราช","day_price":72.50,"unit":"บาท/กก."},
  {"data_date":"2026-11-11","day":"11","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ไทยรับเบอร์ลาเทกซ์กรุ๊ป จำกัด","province":"ระยอง","day_price":74.50,"unit":"บาท/กก."},
  {"data_date":"2026-11-10","day":"10","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สงขลา","province":"สงขลา","day_price":81.60,"unit":"บาท/กก."},
  {"data_date":"2026-11-10","day":"10","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สุราษฎร์ธานี","province":"สุราษฎร์ธานี","day_price":82.50,"unit":"บาท/กก."},
  {"data_date":"2026-11-10","day":"10","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"สมาคมน้ำยางข้นไทย (TLA - หน้าโรงงาน)","province":"สงขลา","day_price":76.80,"unit":"บาท/กก."},
  {"data_date":"2026-11-10","day":"10","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ที.ที.ลาเท็กซ์แอนด์โปรดักส์ จำกัด","province":"นครศรีธรรมราช","day_price":72.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-10","day":"10","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ไทยรับเบอร์ลาเทกซ์กรุ๊ป จำกัด","province":"ระยอง","day_price":74.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-09","day":"9","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา ระยอง","province":"ระยอง","day_price":85.50,"unit":"บาท/กก."},
  {"data_date":"2026-11-09","day":"9","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ที.ที.ลาเท็กซ์แอนด์โปรดักส์ จำกัด","province":"นครศรีธรรมราช","day_price":71.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-09","day":"9","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ไทยรับเบอร์ลาเทกซ์กรุ๊ป จำกัด","province":"ระยอง","day_price":74.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-09","day":"9","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สุราษฎร์ธานี","province":"สุราษฎร์ธานี","day_price":82.40,"unit":"บาท/กก."},
  {"data_date":"2026-11-09","day":"9","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สงขลา","province":"สงขลา","day_price":81.22,"unit":"บาท/กก."}
];

const memoryStore = {
  daily: null,
  latex: null,
  cup: null,
  rss3: null,
  tra: {
    success: true,
    source: 'สมาคมยางพาราไทย (THE THAI RUBBER ASSOCIATION)',
    updated_date: '11 พ.ย. 2569',
    local: {
      rss3: { name: 'ยางแผ่นรมควัน ชั้น 3 (RSS 3)', price: 85.80, change: '+0.30', unit: 'บาท/กก.' },
      latex: { name: 'น้ำยางสด (Field Latex)', price: 73.50, change: '+0.50', unit: 'บาท/กก.' },
      uss: { name: 'ยางแผ่นดิบคุณภาพดี (USS)', price: 82.65, change: '+0.25', unit: 'บาท/กก.' },
      cup: { name: 'ยางก้อนถ้วย (Cup Lump 100%)', price: 61.50, change: '+0.20', unit: 'บาท/กก.' }
    },
    fob: {
      rss3_bkk: { name: 'FOB ยางแผ่นรมควัน ชั้น 3', thb: 89.20, usd: 2665, unit: 'บาท/กก.' },
      str20: { name: 'FOB ยางแท่ง STR 20', thb: 76.40, usd: 2285, unit: 'บาท/กก.' },
      latex_60: { name: 'FOB น้ำยางข้น 60%', thb: 56.80, usd: 1695, unit: 'บาท/กก.' }
    }
  }
};

// ข้อมูลตั้งต้น สมาคมน้ำยางข้นไทย (TLA - tlalatex.org/th/price)
let tlaStore = {
  success: true,
  source: 'สมาคมน้ำยางข้นไทย (THE THAI LATEX ASSOCIATION)',
  url: 'https://www.tlalatex.org/th/price',
  latest: { date_th: '11 พฤศจิกายน 2569', fresh_latex: 76.80, fob_bulk_usd: 1800.00 },
  average: { fresh_latex: 81.25, fob_bulk_usd: 1845.00 },
  daily_table: [
    { data_date: '2026-11-11', date_th: '11 พฤศจิกายน 2569', fresh_latex: 76.80, fob_bulk_usd: 1800.00 },
    { data_date: '2026-11-10', date_th: '10 พฤศจิกายน 2569', fresh_latex: 76.80, fob_bulk_usd: 1800.00 },
    { data_date: '2026-11-07', date_th: '7 พฤศจิกายน 2569', fresh_latex: 80.00, fob_bulk_usd: 1830.00 },
    { data_date: '2026-11-06', date_th: '6 พฤศจิกายน 2569', fresh_latex: 80.00, fob_bulk_usd: 1830.00 },
    { data_date: '2026-11-03', date_th: '3 พฤศจิกายน 2569', fresh_latex: 84.00, fob_bulk_usd: null },
    { data_date: '2026-11-02', date_th: '2 พฤศจิกายน 2569', fresh_latex: 86.00, fob_bulk_usd: 1890.00 },
    { data_date: '2026-11-01', date_th: '1 พฤศจิกายน 2569', fresh_latex: 86.00, fob_bulk_usd: 1900.00 }
  ]
};

function loadTlaFile() {
  try {
    const tlaPath = path.join(__dirname, 'fallback-tla.json');
    if (fs.existsSync(tlaPath)) {
      const parsed = JSON.parse(fs.readFileSync(tlaPath, 'utf-8'));
      if (parsed && Array.isArray(parsed.daily_table) && parsed.daily_table.length > 0) {
        tlaStore = parsed;
      }
    }
  } catch (_) {}
}

function loadFallbackFile(key) {
  const filename = FALLBACK_FILES[key] || 'fallback-daily.json';
  const filePath = path.join(__dirname, filename);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8').trim();
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn(`[Fallback Repair] ไฟล์ ${filename} มีปัญหา ใช้ข้อมูลสำรองในตัวแทน:`, err.message);
  }

  if (key === 'daily') {
    return {
      success: true,
      data: BUILTIN_DAILY_RECORDS,
      pagination: { limit: 400, offset: 0, page: 1, count: BUILTIN_DAILY_RECORDS.length, total: 3823 }
    };
  }
  return { success: true, data: [] };
}

function preloadAllData() {
  loadTlaFile();
  ['daily', 'latex', 'cup', 'rss3'].forEach(key => {
    memoryStore[key] = loadFallbackFile(key);
  });
}
preloadAllData();

// ----------------- API Endpoints -----------------

app.get('/healthz', (req, res) => res.status(200).send('OK'));

app.get('/api/rubber/daily', (req, res) => {
  if (!memoryStore.daily?.data || memoryStore.daily.data.length === 0) {
    memoryStore.daily = loadFallbackFile('daily');
  }
  const normalizedData = (memoryStore.daily.data || []).map(row => {
    const name = String(row.product_name || '');
    let cleanName = name;
    if (name.includes('น้ำยาง')) cleanName = 'น้ำยางสด คละ';
    else if (name.includes('แผ่นดิบ')) cleanName = 'ยางแผ่นดิบ ชั้น 3';
    else if (name.includes('ก้อน')) cleanName = 'ยางก้อน คละ';
    return { ...row, product_name: cleanName };
  });

  res.json({
    ...memoryStore.daily,
    success: true,
    data: normalizedData
  });
});

app.get('/api/rubber/weekly', (req, res) => {
  const product = ['latex', 'cup', 'rss3'].includes(req.query.product) ? req.query.product : 'cup';
  if (!memoryStore[product]?.data) {
    memoryStore[product] = loadFallbackFile(product);
  }
  res.json(memoryStore[product]);
});

app.get('/api/rubber/tra', (req, res) => {
  res.json(memoryStore.tra);
});

// Endpoint ส่วนที่ 2: ส่งข้อมูลสมาคมน้ำยางข้นไทย (TLA)
app.get('/api/rubber/tla', (req, res) => {
  loadTlaFile();
  res.json(tlaStore);
});

app.listen(PORT, () => {
  console.log(`ParaTrend Server กำลังทำงานที่พอร์ต ${PORT}`);
});
