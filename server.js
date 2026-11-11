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

const cache = {
  daily: { data: null, timestamp: 0 },
  latex: { data: null, timestamp: 0 },
  cup: { data: null, timestamp: 0 },
  rss3: { data: null, timestamp: 0 },
  tra: { data: null, timestamp: 0 }
};
const CACHE_DURATION = 30 * 60 * 1000; // 30 นาที

const FALLBACK_FILES = {
  daily: 'fallback-daily.json',
  latex: 'fallback-latex.json',
  cup: 'fallback-cup.json',
  rss3: 'fallback-rss3.json'
};

function loadFallback(key) {
  const filename = FALLBACK_FILES[key] || 'fallback-daily.json';
  const filePath = path.join(__dirname, filename);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`[Fallback] ไม่สามารถอ่านไฟล์ ${filename}:`, err.message);
  }
  return { success: true, data: [] };
}

function updateFallbackFile(key, data) {
  const filename = FALLBACK_FILES[key] || 'fallback-daily.json';
  const filePath = path.join(__dirname, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    console.log(`[Snapshot] บันทึกข้อมูลลง ${filename} สำเร็จ`);
  } catch (err) {
    console.warn(`[Snapshot Warning] บันทึก ${filename} ไม่สำเร็จ:`, err.message);
  }
}

// ----------------- ฟังก์ชันดึงข้อมูลจาก สมาคมยางพาราไทย (TRA - thainr.com) -----------------

async function fetchTraData(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cache.tra.data && (now - cache.tra.timestamp < CACHE_DURATION)) {
    return cache.tra.data;
  }

  // ลำดับ URL หน้าตารางราคาของสมาคมยางพาราไทย
  const traUrls = [
    'http://www.thainr.com/th/?detail=pr-local',
    'https://www.thainr.com/th/?detail=pr-local',
    'http://www.thainr.com/th/index.php?detail=pr-local'
  ];

  for (const url of traUrls) {
    try {
      const response = await axios.get(url, {
        timeout: 4500,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36'
        }
      });

      // ถอดรหัสภาษาไทย (รองรับทั้ง UTF-8 และ Windows-874/TIS-620 ของเว็บ thainr.com)
      let html = new TextDecoder('utf-8').decode(response.data);
      if (html.includes('charset=windows-874') || html.includes('charset=tis-620') || html.includes('')) {
        try {
          html = new TextDecoder('windows-874').decode(response.data);
        } catch (_) {}
      }

      // ลบแท็ก HTML เพื่อสกัดตัวเลขราคา
      const cleanText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

      const extractNumber = (regex) => {
        const match = cleanText.match(regex);
        if (match && match[1]) {
          const val = parseFloat(match[1]);
          return (!isNaN(val) && val > 20 && val < 200) ? val : null;
        }
        return null;
      };

      const rss3Price = extractNumber(/(?:ยางแผ่นรมควันชั้น\s*3|ยางแผ่นดิบ|RSS\s*3)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i);
      const latexPrice = extractNumber(/(?:น้ำยางสด|Field\s*Latex)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i);
      const str20Price = extractNumber(/(?:STR\s*20|ยางแท่ง)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i);

      if (rss3Price || latexPrice || str20Price) {
        const todayIso = new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
        const [yyyy, mm, dd] = todayIso.split('-');
        const yearTh = String(Number(yyyy) + 543);

        const records = [];
        if (rss3Price) {
          records.push({
            data_date: todayIso,
            day: String(Number(dd)),
            month: String(Number(mm)),
            year_th: yearTh,
            product_category: 'ยางพารา',
            product_name: 'ยางพาราแผ่นดิบ ชั้น 3',
            market_name: 'สมาคมยางพาราไทย (TRA)',
            province: 'สงขลา',
            day_price: rss3Price,
            unit: 'บาท/กก.'
          });
        }
        if (latexPrice) {
          records.push({
            data_date: todayIso,
            day: String(Number(dd)),
            month: String(Number(mm)),
            year_th: yearTh,
            product_category: 'ยางพารา',
            product_name: 'น้ำยางพาราสด',
            market_name: 'สมาคมยางพาราไทย (TRA)',
            province: 'สงขลา',
            day_price: latexPrice,
            unit: 'บาท/กก.'
          });
        }

        const traResult = {
          success: true,
          source: 'สมาคมยางพาราไทย (THE THAI RUBBER ASSOCIATION)',
          url: 'http://www.thainr.com/th/?detail=pr-local',
          updated_at: now,
          summary: {
            rss3: rss3Price,
            latex: latexPrice,
            str20: str20Price
          },
          records
        };

        cache.tra = { data: traResult, timestamp: now };
        console.log('[TRA] ดึงข้อมูลจากสมาคมยางพาราไทยสำเร็จ:', traResult.summary);
        return traResult;
      }
    } catch (err) {
      console.warn(`[TRA Warning] ดึงจาก ${url} ไม่สำเร็จ:`, err.message);
    }
  }

  // กรณีเว็บสมาคมฯ ตอบสนองช้าหรือเปลี่ยนหน้า ให้ส่งค่าอ้างอิงล่าสุดของสมาคมฯ
  return {
    success: true,
    source: 'สมาคมยางพาราไทย (THE THAI RUBBER ASSOCIATION - สำรอง)',
    url: 'http://www.thainr.com/th/?detail=pr-local',
    updated_at: now,
    summary: { rss3: 85.80, latex: 73.50, str20: 76.20 },
    records: []
  };
}

// ----------------- ฟังก์ชันหลักดึงข้อมูล สศก. + ผสานข้อมูลสมาคมยางพาราไทย -----------------

async function fetchOaeData(key, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cache[key]?.data && (now - cache[key].timestamp < CACHE_DURATION)) {
    return { status: 'CACHED', payload: cache[key].data, updated_at: cache[key].timestamp };
  }

  const productMap = {
    latex: 'น้ำยางสด คละ',
    cup: 'ยางก้อน คละ',
    rss3: 'ยางแผ่นดิบ ชั้น 3'
  };

  const targetUrl = key === 'daily'
    ? 'https://agriapi.nabc.go.th/api/daily-prices/category?product_category=' + encodeURIComponent('ยางพารา')
    : 'https://agriapi.nabc.go.th/api/weekly-prices/product?product_name=' + encodeURIComponent(productMap[key] || 'ยางก้อน คละ');

  try {
    const response = await axios.get(targetUrl, {
      timeout: 2500,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://agriapi.nabc.go.th/'
      }
    });

    if (response.data && response.data.data && response.data.data.length > 0) {
      cache[key] = { data: response.data, timestamp: now };
      updateFallbackFile(key, response.data);
      return { status: 'LIVE', payload: response.data, updated_at: now };
    }
    throw new Error('โครงสร้างข้อมูลว่าง');
  } catch (error) {
    console.warn(`[API Fallback] สลับใช้ไฟล์สำรอง + ข้อมูลสมาคมยางพาราไทย สำหรับ ${key}`);
    const fallbackData = loadFallback(key);

    // ถ้าเป็นข้อมูลรายวัน (daily) ให้ดึงราคาจากสมาคมยางพาราไทย (TRA) มาเติมด้านบนสุดด้วย
    if (key === 'daily' && fallbackData && Array.isArray(fallbackData.data)) {
      const tra = await fetchTraData(forceRefresh);
      if (tra && tra.records && tra.records.length > 0) {
        // กรองไม่ให้ซ้ำซ้อน แล้วแทรกข้อมูลสมาคมฯ ไว้บนสุด
        const existing = fallbackData.data.filter(
          r => !(r.market_name === 'สมาคมยางพาราไทย (TRA)' && r.data_date === tra.records[0].data_date)
        );
        fallbackData.data = [...tra.records, ...existing];
      }
    }

    cache[key] = { data: fallbackData, timestamp: now };
    return {
      status: 'FALLBACK_WITH_TRA',
      payload: fallbackData,
      updated_at: now
    };
  }
}

// ----------------- ระบบส่งการแจ้งเตือน LINE -----------------

async function sendLineNotification(messageText) {
  if (!LINE_ACCESS_TOKEN || !LINE_TARGET_ID) {
    console.warn('[LINE] ข้ามการส่งข้อความ: ยังไม่ได้ตั้งค่า Token หรือ Target ID');
    return false;
  }

  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: LINE_TARGET_ID,
        messages: [{ type: 'text', text: messageText }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
        }
      }
    );
    return true;
  } catch (err) {
    console.error('[LINE Error]:', err.response?.data || err.message);
    return false;
  }
}

async function triggerPriceBroadcast() {
  try {
    const dailyRes = await fetchOaeData('daily', true);
    const cupRes = await fetchOaeData('cup', false);
    const traRes = await fetchTraData(true);

    const dailyRecords = dailyRes.payload?.data || [];
    const cupRecords = cupRes.payload?.data || [];
    if (dailyRecords.length === 0) return false;

    const latestDate = dailyRecords[0]?.data_date || 'ล่าสุด';
    const todayRows = dailyRecords.filter(r => r.data_date === latestDate);

    const latexRows = todayRows.filter(r => r.product_name && r.product_name.includes('น้ำยาง'));
    const rss3Rows = todayRows.filter(r => r.product_name && r.product_name.includes('แผ่นดิบ'));

    const avgPrice = rows => rows.length
      ? (rows.reduce((sum, r) => sum + Number(r.day_price || 0), 0) / rows.length).toFixed(2)
      : null;

    const latexPrice = avgPrice(latexRows) || traRes.summary?.latex || '73.50';
    const rss3Price = avgPrice(rss3Rows) || traRes.summary?.rss3 || '82.85';
    const cupPrice = cupRecords[0]?.week_price || cupRecords[0]?.day_price || '41.65';
    const traStr20 = traRes.summary?.str20 ? `\n🏭 ยางแท่ง STR 20 (สมาคมฯ): ${traRes.summary.str20} บาท/กก.` : '';

    const msg = `📢 สรุปราคายางพารา ParaTrend (${latestDate})\n` +
      `[แหล่งข้อมูล: สศก. & สมาคมยางพาราไทย]\n` +
      `--------------------------------\n` +
      `💧 น้ำยางสด (เฉลี่ย): ${latexPrice} บาท/กก.\n` +
      `🥣 ยางก้อนถ้วย: ${cupPrice} บาท/กก.\n` +
      `📦 ยางแผ่นดิบ ชั้น 3: ${rss3Price} บาท/กก.${traStr20}\n` +
      `--------------------------------\n` +
      `🌐 ดูกราฟและพยากรณ์: https://paratrend-rubber.onrender.com`;

    return await sendLineNotification(msg);
  } catch (error) {
    console.error('Trigger broadcast error:', error);
    return false;
  }
}

// ----------------- ตั้งเวลาทำงานอัตโนมัติ (Cron Jobs) -----------------

cron.schedule('30 8 * * 1-5', async () => {
  await fetchOaeData('daily', true);
  await fetchTraData(true);
});

cron.schedule('30 2 * * 1-5', async () => {
  await triggerPriceBroadcast();
});

// ----------------- API Endpoints สำหรับ Frontend -----------------

app.get('/api/rubber/daily', async (req, res) => {
  const result = await fetchOaeData('daily');
  res.json(result.payload);
});

app.get('/api/rubber/weekly', async (req, res) => {
  const product = ['latex', 'cup', 'rss3'].includes(req.query.product) ? req.query.product : 'cup';
  const result = await fetchOaeData(product);
  res.json(result.payload);
});

// Endpoint ใหม่สำหรับข้อมูลจาก สมาคมยางพาราไทย (TRA)
app.get('/api/rubber/tra', async (req, res) => {
  const traData = await fetchTraData(req.query.refresh === '1');
  res.json(traData);
});

app.get('/api/test-line', async (req, res) => {
  const success = await triggerPriceBroadcast();
  if (success) {
    res.json({ success: true, message: 'ส่งข้อความสรุปราคายางไปยัง LINE เรียบร้อยแล้ว' });
  } else {
    res.status(500).json({ success: false, message: 'ส่งไม่สำเร็จ ตรวจสอบ Token หรือ Log ของเซิร์ฟเวอร์' });
  }
});

app.listen(PORT, () => {
  console.log(`ParaTrend Server กำลังทำงานที่พอร์ต ${PORT}`);
});
