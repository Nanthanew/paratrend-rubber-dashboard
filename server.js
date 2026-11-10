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
  weekly: { data: null, timestamp: 0 }
};
const CACHE_DURATION = 30 * 60 * 1000; // 30 นาที

// ฟังก์ชันโหลดข้อมูลสำรอง (Snapshot Fallback)
function loadFallback(type) {
  const filename = type === 'weekly' ? 'fallback-cup.json' : 'fallback-daily.json';
  const filePath = path.join(__dirname, filename);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`[Fallback] ไม่สามารถอ่านไฟล์ ${filename}:`, err.message);
  }
  return [];
}

// ฟังก์ชันบันทึกข้อมูลสดทับลง Snapshot อัตโนมัติ
function updateFallbackFile(type, data) {
  const filename = type === 'weekly' ? 'fallback-cup.json' : 'fallback-daily.json';
  const filePath = path.join(__dirname, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[Snapshot] บันทึกข้อมูลสดลง ${filename} สำเร็จ`);
  } catch (err) {
    console.warn(`[Snapshot Warning] บันทึก ${filename} ไม่สำเร็จ:`, err.message);
  }
}

// ฟังก์ชันดึงข้อมูลจาก API ของ สศก. (agriapi.nabc.go.th)
async function fetchOaeData(type, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cache[type].data && (now - cache[type].timestamp < CACHE_DURATION)) {
    return { status: 'CACHED', data: cache[type].data, updated_at: cache[type].timestamp };
  }

  // URL API ต้นทางของ สศก.
  const targetUrl = type === 'weekly'
    ? 'https://agriapi.nabc.go.th/api/weekly-prices/category/rubber'
    : 'https://agriapi.nabc.go.th/api/daily-prices/category/rubber';

  try {
    const response = await axios.get(targetUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://agriapi.nabc.go.th/',
        'Origin': 'https://agriapi.nabc.go.th'
      }
    });

    if (response.data && (Array.isArray(response.data) ? response.data.length > 0 : Object.keys(response.data).length > 0)) {
      cache[type].data = response.data;
      cache[type].timestamp = now;

      // อัปเดตข้อมูลสำรองลงไฟล์ทันทีเมื่อดึงสำเร็จ
      updateFallbackFile(type, response.data);

      return { status: 'LIVE', data: response.data, updated_at: now };
    }
    throw new Error('โครงสร้างข้อมูลว่างหรือไม่ถูกต้อง');
  } catch (error) {
    console.warn(`[API Proxy Warning] ดึงข้อมูล ${type} ล้มเหลว (${error.message}) สลับไปใช้ข้อมูลสำรอง`);
    const fallbackData = loadFallback(type);
    return {
      status: 'FALLBACK',
      data: fallbackData,
      updated_at: cache[type].timestamp || now,
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

// ฟังก์ชันสร้างเนื้อหาและสั่งยิงแจ้งเตือน
async function triggerPriceBroadcast() {
  try {
    const result = await fetchOaeData('daily', true);
    const records = result.data;
    if (!records || records.length === 0) return false;

    // หาแถวข้อมูลล่าสุด
    const latest = Array.isArray(records) ? records[records.length - 1] : records;
    const dateStr = new Date(result.updated_at).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    const statusLabel = result.status === 'LIVE' ? 'ข้อมูลสดประจำวัน' : 'ข้อมูลสำรองล่าสุด';
    const msg = `📢 สรุปราคายางพารา ParaTrend (${dateStr})\n` +
      `[สถานะ: ${statusLabel}]\n` +
      `--------------------------------\n` +
      `💧 น้ำยางสด: ${latest.latex || latest.price_latex || '72.50'} บาท/กก.\n` +
      `🥣 ยางก้อนถ้วย: ${latest.cup_lump || latest.price_cup || '41.65'} บาท/กก.\n` +
      `📦 ยางแผ่นดิบ (ชั้น 3): ${latest.raw_sheet || latest.price_raw || '81.81'} บาท/กก.\n` +
      `--------------------------------\n` +
      `🌐 ตรวจสอบแดชบอร์ดสด: https://paratrend-rubber.onrender.com`;

    return await sendLineNotification(msg);
  } catch (error) {
    console.error('Trigger broadcast error:', error);
    return false;
  }
}

// ----------------- ตั้งเวลาทำงานอัตโนมัติ (Cron Jobs) -----------------

// 1. ดึงราคายางรอบบ่าย (สศก. มักประกาศช่วง 14:30 - 15:30 น.)
// จันทร์ - ศุกร์ เวลา 15:30 น. เวลาไทย (08:30 UTC)
cron.schedule('30 8 * * 1-5', async () => {
  console.log('[Cron] กำลังตรวจสอบและดึงราคายางรอบปิดตลาดประจำวัน...');
  await fetchOaeData('daily', true);
});

// 2. ส่งสรุปแจ้งเตือนเข้า LINE ทุกวันจันทร์ - ศุกร์ เวลา 09:30 น. เวลาไทย (02:30 UTC)
cron.schedule('30 2 * * 1-5', async () => {
  console.log('[Cron] ส่งสรุปราคายางรอบเช้าเข้า LINE...');
  await triggerPriceBroadcast();
});

// ----------------- API Endpoints สำหรับ Frontend -----------------

app.get('/api/rubber/daily', async (req, res) => {
  const result = await fetchOaeData('daily');
  res.json(result);
});

app.get('/api/rubber/weekly', async (req, res) => {
  const result = await fetchOaeData('weekly');
  res.json(result);
});

// Endpoint สำหรับกดทดสอบส่ง LINE ด้วยตัวเอง
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
