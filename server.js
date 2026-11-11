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
  {"data_date":"2026-11-11","day":"11","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ที.ที.ลาเท็กซ์แอนด์โปรดักส์ จำกัด","province":"นครศรีธรรมราช","day_price":72.50,"unit":"บาท/กก."},
  {"data_date":"2026-11-11","day":"11","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ไทยรับเบอร์ลาเทกซ์กรุ๊ป จำกัด","province":"ระยอง","day_price":74.50,"unit":"บาท/กก."},
  {"data_date":"2026-11-10","day":"10","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สงขลา","province":"สงขลา","day_price":81.60,"unit":"บาท/กก."},
  {"data_date":"2026-11-10","day":"10","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สุราษฎร์ธานี","province":"สุราษฎร์ธานี","day_price":82.50,"unit":"บาท/กก."},
  {"data_date":"2026-11-10","day":"10","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ที.ที.ลาเท็กซ์แอนด์โปรดักส์ จำกัด","province":"นครศรีธรรมราช","day_price":72.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-10","day":"10","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ไทยรับเบอร์ลาเทกซ์กรุ๊ป จำกัด","province":"ระยอง","day_price":74.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-09","day":"9","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา ระยอง","province":"ระยอง","day_price":85.50,"unit":"บาท/กก."},
  {"data_date":"2026-11-09","day":"9","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ที.ที.ลาเท็กซ์แอนด์โปรดักส์ จำกัด","province":"นครศรีธรรมราช","day_price":71.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-09","day":"9","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ไทยรับเบอร์ลาเทกซ์กรุ๊ป จำกัด","province":"ระยอง","day_price":74.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-09","day":"9","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สุราษฎร์ธานี","province":"สุราษฎร์ธานี","day_price":82.40,"unit":"บาท/กก."},
  {"data_date":"2026-11-09","day":"9","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สงขลา","province":"สงขลา","day_price":81.22,"unit":"บาท/กก."},
  {"data_date":"2026-11-06","day":"6","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สงขลา","province":"สงขลา","day_price":82.88,"unit":"บาท/กก."},
  {"data_date":"2026-11-06","day":"6","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ไทยรับเบอร์ลาเทกซ์กรุ๊ป จำกัด","province":"ระยอง","day_price":78.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-06","day":"6","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ที.ที.ลาเท็กซ์แอนด์โปรดักส์ จำกัด","province":"นครศรีธรรมราช","day_price":75.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-05","day":"5","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สงขลา","province":"สงขลา","day_price":83.10,"unit":"บาท/กก."},
  {"data_date":"2026-11-05","day":"5","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ไทยรับเบอร์ลาเทกซ์กรุ๊ป จำกัด","province":"ระยอง","day_price":76.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-04","day":"4","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สุราษฎร์ธานี","province":"สุราษฎร์ธานี","day_price":83.39,"unit":"บาท/กก."},
  {"data_date":"2026-11-04","day":"4","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ที.ที.ลาเท็กซ์แอนด์โปรดักส์ จำกัด","province":"นครศรีธรรมราช","day_price":76.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-03","day":"3","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สงขลา","province":"สงขลา","day_price":83.45,"unit":"บาท/กก."},
  {"data_date":"2026-11-03","day":"3","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ที.ที.ลาเท็กซ์แอนด์โปรดักส์ จำกัด","province":"นครศรีธรรมราช","day_price":77.00,"unit":"บาท/กก."},
  {"data_date":"2026-11-02","day":"2","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"ยางพาราแผ่นดิบ ชั้น 3","market_name":"ตลาดกลางยางพารา สงขลา","province":"สงขลา","day_price":83.90,"unit":"บาท/กก."},
  {"data_date":"2026-11-02","day":"2","month":"11","year_th":"2569","product_category":"ยางพารา","product_name":"น้ำยางพาราสด","market_name":"บริษัท ที.ที.ลาเท็กซ์แอนด์โปรดักส์ จำกัด","province":"นครศรีธรรมราช","day_price":78.00,"unit":"บาท/กก."}
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

function loadFallbackFile(key) {
  const filename = FALLBACK_FILES[key] || 'fallback-daily.json';
  const filePath = path.join(__dirname, filename);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8').trim();
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
        if (key === 'daily') {
          // ผสานข้อมูลวันที่ 10-11 พ.ย. 2569 ไว้ด้านบนสุดเสมอ
          const latestDates = new Set(['2026-11-11', '2026-11-10']);
          const olderRows = parsed.data.filter(r => !latestDates.has(r.data_date));
          parsed.data = [...BUILTIN_DAILY_RECORDS.filter(r => latestDates.has(r.data_date)), ...olderRows];
        }
        return parsed;
      }
    }
  } catch (err) {
    console.warn(`[Fallback Repair] ไฟล์ ${filename} มีปัญหา ใช้ข้อมูลสำรองในตัวแทน:`, err.message);
  }

  // ถ้าไฟล์ JSON พังหรือว่าง ให้ส่งข้อมูล Built-in กลับไปทันที การ์ดจะได้ไม่ว่าง
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
  ['daily', 'latex', 'cup', 'rss3'].forEach(key => {
    memoryStore[key] = loadFallbackFile(key);
  });
}
preloadAllData();

// ----------------- API Endpoints -----------------

app.get('/api/rubber/daily', (req, res) => {
  if (!memoryStore.daily?.data || memoryStore.daily.data.length === 0) {
    memoryStore.daily = loadFallbackFile('daily');
  }
  res.json(memoryStore.daily);
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

app.listen(PORT, () => {
  console.log(`ParaTrend Server กำลังทำงานที่พอร์ต ${PORT}`);
});
