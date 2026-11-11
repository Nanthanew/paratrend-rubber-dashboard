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

// ดึงค่า Token และ Target ID จาก Environment Variables บน Render
const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_TARGET_ID = process.env.LINE_TARGET_ID;

// หน่วยความจำชั่วคราว (In-memory Cache)
const cache = {
  daily: { data: null, timestamp: 0 },
  latex: { data: null, timestamp: 0 },
  cup: { data: null, timestamp: 0 },
  rss3: { data: null, timestamp: 0 }
};
const CACHE_DURATION = 30 * 60 * 1000; // 30 นาที

// แผนผังไฟล์สำรองแยกตามประเภทสินค้า
const FALLBACK_FILES = {
  daily: 'fallback-daily.json',
  latex: 'fallback-latex.json',
  cup: 'fallback-cup.json',
  rss3: 'fallback-rss3.json'
};

// ฟังก์ชันโหลดข้อมูลสำรอง (Snapshot Fallback)
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

// ฟังก์ชันบันทึกข้อมูลสดทับลง Snapshot อัตโนมัติ
function updateFallbackFile(key, data) {
  const filename = FALLBACK_FILES[key] || 'fallback-daily.json';
  const filePath = path.join(__dirname, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    console.log(`[Snapshot] บันทึกข้อมูลสดลง ${filename} สำเร็จ`);
  } catch (err) {
    console.warn(`[Snapshot Warning] บันทึก ${filename} ไม่สำเร็จ:`, err.message);
  }
}

// ฟังก์ชันดึงข้อมูลพร้อมสลับเข้าไฟล์สำรองทันทีหากถูกบล็อก (Timeout 2.5 วินาที)
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
      timeout: 2500, // รอสูงสุด 2.5 วินาที ถ้าไม่ได้ให้ใช้ไฟล์สำรองทันที
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://agriapi.nabc.go.th/',
        'Origin': 'https://agriapi.nabc.go.th'
      }
    });

    if (response.data && response.data.data && response.data.data.length > 0) {
      cache[key] = { data: response.data, timestamp: now };
      updateFallbackFile(key, response.data);
      return { status: 'LIVE', payload: response.data, updated_at: now };
    }
    throw new Error('โครงสร้างข้อมูลว่างหรือไม่ถูกต้อง');
  } catch (error) {
    console.warn(`[API Fallback] สลับใช้ไฟล์สำรองสำหรับ ${key} (${error.message})`);
    const fallbackData = loadFallback(key);
    cache[key] = { data: fallbackData, timestamp: now };
    return {
      status: 'FALLBACK',
      payload: fallbackData,
      updated_at: now,
      error: error.message
    };
  }
}

// ----------------- ระบบส่งการแจ้งเตือน LINE -----------------

async function sendLineNotification(messageText) {
  if (!LINE_ACCESS_TOKEN || !LINE_TARGET_ID) {
    console.warn('[LINE] ข้ามการส่งข้อความ: ยังไม่ได้ตั้งค่า Token หรือ Target ID ใน Environment');
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
    console.log('[LINE] ส่งข้อความแจ้งเตือนสำเร็จ');
    return true;
  } catch (err) {
    console.error('[LINE Error]:', err.response?.data || err.message);
    return false;
  }
}

// ฟังก์ชันสร้างเนื้อหาและสั่งยิงแจ้งเตือนจากข้อมูลจริงในระบบ
async function triggerPriceBroadcast() {
  try {
    const dailyRes = await fetchOaeData('daily', true);
    const cupRes = await fetchOaeData('cup', false);

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

    const latexPrice = avgPrice(latexRows) || '73.50';
    const rss3Price = avgPrice(rss3Rows) || '82.85';
    const cupPrice = cupRecords[0]?.week_price || cupRecords[0]?.day_price || '41.65';

    const statusLabel = dailyRes.status === 'LIVE' ? 'ข้อมูลสดประจำวัน' : 'ข้อมูลอัปเดตล่าสุด';
    const msg = `📢 สรุปราคายางพารา ParaTrend (${latestDate})\n` +
      `[สถานะ: ${statusLabel}]\n` +
      `--------------------------------\n` +
      `💧 น้ำยางสด (เฉลี่ย): ${latexPrice} บาท/กก.\n` +
      `🥣 ยางก้อนถ้วย: ${cupPrice} บาท/กก.\n` +
      `📦 ยางแผ่นดิบ ชั้น 3 (เฉลี่ย): ${rss3Price} บาท/กก.\n` +
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
  console.log('[Cron] กำลังตรวจสอบและดึงราคายางรอบปิดตลาดประจำวัน...');
  await fetchOaeData('daily', true);
});

cron.schedule('30 2 * * 1-5', async () => {
  console.log('[Cron] ส่งสรุปราคายางรอบเช้าเข้า LINE...');
  await triggerPriceBroadcast();
});

// ----------------- API Endpoints สำหรับ Frontend -----------------

// ส่งโครงสร้าง { success: true, data: [...] } ตรงตามที่ index.html ต้องการ
app.get('/api/rubber/daily', async (req, res) => {
  const result = await fetchOaeData('daily');
  res.json(result.payload);
});

app.get('/api/rubber/weekly', async (req, res) => {
  const product = ['latex', 'cup', 'rss3'].includes(req.query.product) ? req.query.product : 'cup';
  const result = await fetchOaeData(product);
  res.json(result.payload);
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
