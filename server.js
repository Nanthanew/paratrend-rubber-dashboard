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

const TH_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

const TH_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

function formatThaiDateFull(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} ${TH_MONTHS_FULL[m - 1]} ${y + 543}`;
}

function formatThaiDateShort(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} ${TH_MONTHS_SHORT[m - 1]} ${y + 543}`;
}

function getTodayIsoTH() {
  const nowTH = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const y = nowTH.getFullYear();
  const m = String(nowTH.getMonth() + 1).padStart(2, '0');
  const d = String(nowTH.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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

async function syncTlaFromWeb() {
  try {
    const res = await axios.get('https://www.tlalatex.org/th/price', {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const html = String(res.data || '');
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const stripTags = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

    const parsedRows = [];
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
      const cells = [];
      let cMatch;
      while ((cMatch = cellRegex.exec(match[1])) !== null) {
        cells.push(stripTags(cMatch[1]));
      }
      if (cells.length >= 3) {
        const dateText = cells[0];
        const mIdx = TH_MONTHS_FULL.findIndex(m => dateText.includes(m));
        if (mIdx !== -1) {
          const nums = dateText.match(/\d+/g);
          if (nums && nums.length >= 2) {
            const day = String(nums[0]).padStart(2, '0');
            const month = String(mIdx + 1).padStart(2, '0');
            let yr = Number(nums[nums.length - 1]);
            if (yr > 2400) yr -= 543;
            const iso = `${yr}-${month}-${day}`;
            const fresh = parseFloat(cells[1].replace(/,/g, ''));
            const fob = parseFloat(cells[2].replace(/,/g, ''));
            parsedRows.push({
              data_date: iso,
              date_th: formatThaiDateFull(iso),
              fresh_latex: isFinite(fresh) && fresh > 0 ? fresh : null,
              fob_bulk_usd: isFinite(fob) && fob > 0 ? fob : null
            });
          }
        }
      }
    }

    if (parsedRows.length > 0) {
      const map = {};
      (tlaStore.daily_table || []).forEach(r => { if (r.data_date) map[r.data_date] = r; });
      parsedRows.forEach(r => { map[r.data_date] = r; });
      tlaStore.daily_table = Object.values(map).sort((a, b) => b.data_date.localeCompare(a.data_date));
    }
  } catch (err) {}
}

function buildDailyCalendarTla() {
  const map = {};
  (tlaStore.daily_table || []).forEach(r => {
    if (r && r.data_date) map[r.data_date] = r;
  });

  const nowTH = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const curY = nowTH.getFullYear();
  const curM = nowTH.getMonth() + 1;
  const curD = nowTH.getDate();

  for (let d = 1; d <= curD; d++) {
    const iso = `${curY}-${String(curM).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!map[iso]) {
      map[iso] = {
        data_date: iso,
        date_th: formatThaiDateFull(iso),
        fresh_latex: null,
        fob_bulk_usd: null
      };
    } else {
      map[iso].date_th = formatThaiDateFull(iso);
    }
  }

  const fullList = Object.values(map).sort((a, b) => b.data_date.localeCompare(a.data_date));
  const todayIso = `${curY}-${String(curM).padStart(2, '0')}-${String(curD).padStart(2, '0')}`;
  const todayEntry = map[todayIso] || fullList[0];

  const monthPrefix = `${curY}-${String(curM).padStart(2, '0')}-`;
  const monthRows = fullList.filter(r => r.data_date.startsWith(monthPrefix));
  const validFresh = monthRows.map(r => Number(r.fresh_latex)).filter(v => isFinite(v) && v > 0);
  const validFob = monthRows.map(r => Number(r.fob_bulk_usd)).filter(v => isFinite(v) && v > 0);

  const avgFresh = validFresh.length
    ? Number((validFresh.reduce((a, b) => a + b, 0) / validFresh.length).toFixed(2))
    : tlaStore.average?.fresh_latex || null;
  const avgFob = validFob.length
    ? Number((validFob.reduce((a, b) => a + b, 0) / validFob.length).toFixed(2))
    : tlaStore.average?.fob_bulk_usd || null;

  return {
    ...tlaStore,
    latest: {
      date_th: todayEntry ? todayEntry.date_th : formatThaiDateFull(todayIso),
      fresh_latex: todayEntry ? todayEntry.fresh_latex : null,
      fob_bulk_usd: todayEntry ? todayEntry.fob_bulk_usd : null
    },
    average: {
      fresh_latex: avgFresh,
      fob_bulk_usd: avgFob
    },
    daily_table: fullList
  };
}

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
  syncTlaFromWeb();
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

// ----------------- ฟังก์ชันรวบรวมราคาล่าสุด (วันนี้ หรือ วันก่อนหน้า) และส่งเข้า LINE -----------------

async function getLatestPricesSummary() {
  preloadAllData();
  await syncTlaFromWeb();

  const todayIso = getTodayIsoTH();
  const dailyRows = memoryStore.daily?.data || BUILTIN_DAILY_RECORDS;
  const sortedDaily = [...dailyRows].sort((a, b) => String(b.data_date).localeCompare(String(a.data_date)));

  function findLatestOrPrev(matchFn) {
    // 1. ค้นหาราคาของวันปัจจุบันก่อน
    const todayMatches = sortedDaily
      .filter(r => r.data_date === todayIso && matchFn(String(r.product_name || '')))
      .map(r => Number(r.day_price))
      .filter(v => isFinite(v) && v > 0);
    if (todayMatches.length) {
      return {
        price: todayMatches.reduce((a, b) => a + b, 0) / todayMatches.length,
        date: todayIso,
        isToday: true
      };
    }

    // 2. ถ้าวันนี้ไม่มีราคา ให้ดึงราคาของวันก่อนหน้าที่มีข้อมูลล่าสุด
    const prevDates = [...new Set(sortedDaily.filter(r => matchFn(String(r.product_name || ''))).map(r => r.data_date))].sort((a, b) => b.localeCompare(a));
    for (const d of prevDates) {
      const prices = sortedDaily
        .filter(r => r.data_date === d && matchFn(String(r.product_name || '')))
        .map(r => Number(r.day_price))
        .filter(v => isFinite(v) && v > 0);
      if (prices.length) {
        return {
          price: prices.reduce((a, b) => a + b, 0) / prices.length,
          date: d,
          isToday: d === todayIso
        };
      }
    }
    return null;
  }

  // น้ำยางสด: เช็คจากตาราง TLA รายวัน และตาราง สศก. รายวัน
  let latexInfo = findLatestOrPrev(name => name.includes('น้ำยาง'));
  const tlaValid = (tlaStore.daily_table || []).filter(r => isFinite(Number(r.fresh_latex)) && Number(r.fresh_latex) > 0).sort((a, b) => b.data_date.localeCompare(a.data_date));
  if (tlaValid.length) {
    const topTla = tlaValid[0];
    if (!latexInfo || topTla.data_date >= latexInfo.date) {
      latexInfo = { price: Number(topTla.fresh_latex), date: topTla.data_date, isToday: topTla.data_date === todayIso };
    }
  }
  if (!latexInfo) {
    latexInfo = { price: Number(memoryStore.tra?.local?.latex?.price || 77.00), date: todayIso, isToday: false };
  }

  // ยางแผ่นดิบชั้น 3
  let rss3Info = findLatestOrPrev(name => name.includes('แผ่น') || name.includes('RSS') || name.includes('USS'));
  if (!rss3Info) {
    rss3Info = { price: Number(memoryStore.tra?.local?.uss?.price || memoryStore.tra?.local?.rss3?.price || 82.65), date: todayIso, isToday: false };
  }

  // ยางก้อนถ้วย (รองรับทั้ง Array [y,m,w,price] และ Object {value/price})
  let cupInfo = findLatestOrPrev(name => name.includes('ก้อน') || name.includes('ถ้วย'));
  if (!cupInfo || !isFinite(cupInfo.price) || cupInfo.price <= 0) {
    const cupRows = memoryStore.cup?.data || [];
    const validCupPrices = cupRows.map(r => {
      if (Array.isArray(r)) return Number(r[3] ?? r[1]);
      return Number(r.value ?? r.price ?? r.day_price ?? r.week_price);
    }).filter(v => isFinite(v) && v > 0);

    if (validCupPrices.length) {
      cupInfo = { price: validCupPrices[validCupPrices.length - 1], date: rss3Info.date || todayIso, isToday: false };
    } else {
      cupInfo = { price: 41.65, date: todayIso, isToday: false };
    }
  }

  const effectiveDate = [latexInfo.date, rss3Info.date].sort((a, b) => b.localeCompare(a))[0] || todayIso;
  const isFallbackPrev = effectiveDate < todayIso;

  return {
    todayTh: formatThaiDateShort(todayIso),
    effectiveDateTh: formatThaiDateShort(effectiveDate),
    isFallbackPrev,
    latex: latexInfo.price.toFixed(2),
    cup: cupInfo.price.toFixed(2),
    rss3: rss3Info.price.toFixed(2)
  };
}

function buildLineNotificationText(summary) {
  const noteLine = summary.isFallbackPrev
    ? `ℹ️ วันนี้ยังไม่มีประกาศราคาใหม่ (ใช้ราคาล่าสุดของ ${summary.effectiveDateTh})`
    : `✅ อัปเดตราคาประจำวันล่าสุด`;

  return [
    `🌱 ParaTrend สรุปราคายางพารา`,
    `📅 ประจำวันที่ ${summary.todayTh} (16:00 น.)`,
    noteLine,
    `━━━━━━━━━━━━━━`,
    `💧 น้ำยางสด: ${summary.latex} บาท/กก.`,
    `🥣 ยางก้อนถ้วย: ${summary.cup} บาท/กก.`,
    `📜 ยางแผ่นดิบชั้น 3: ${summary.rss3} บาท/กก.`,
    `━━━━━━━━━━━━━━`,
    `📊 ดูกราฟพยากรณ์และคำนวณกำไร:`,
    `https://paratrend-rubber.onrender.com`
  ].join('\n');
}

async function sendDailyLineNotification() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || LINE_ACCESS_TOKEN;
  const targetId = process.env.LINE_TARGET_ID || LINE_TARGET_ID;

  if (!token) {
    throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน Environment Variables บน Render');
  }

  const summary = await getLatestPricesSummary();
  const text = buildLineNotificationText(summary);

  const url = targetId
    ? 'https://api.line.me/v2/bot/message/push'
    : 'https://api.line.me/v2/bot/message/broadcast';

  const payload = targetId
    ? { to: targetId, messages: [{ type: 'text', text }] }
    : { messages: [{ type: 'text', text }] };

  await axios.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    timeout: 15000
  });

  return { ok: true, summary, text };
}

// ตั้งเวลาส่งแจ้งเตือนอัตโนมัติทุกวัน เวลา 16:00 น. (ตามเวลาประเทศไทย)
cron.schedule('0 16 * * *', async () => {
  console.log('[Cron 16:00] กำลังส่งแจ้งเตือนราคายางพาราเข้า LINE...');
  try {
    await sendDailyLineNotification();
    console.log('[Cron 16:00] ส่งแจ้งเตือนเข้า LINE สำเร็จ!');
  } catch (err) {
    console.error('[Cron 16:00] ส่งแจ้งเตือนเข้า LINE ไม่สำเร็จ:', err.message);
  }
}, {
  scheduled: true,
  timezone: 'Asia/Bangkok'
});

// ----------------- API Endpoints -----------------

app.get('/healthz', (req, res) => res.status(200).send('OK'));

app.get('/api/rubber/daily', (req, res) => {
  if (!memoryStore.daily?.data || memoryStore.daily.data.length === 0) {
    memoryStore.daily = loadFallbackFile('daily');
  }
  const normalizedData = (memoryStore.daily.data || []).map(row => {
    const name = String(row.product_name || '');
    let cleanName = name;
    if (name.includes('น้ำยาง')) cleanName = 'น้ำยางพาราสด';
    else if (name.includes('แผ่น')) cleanName = 'ยางพาราแผ่นดิบ ชั้น 3';
    else if (name.includes('ก้อน')) cleanName = 'ยางก้อนถ้วย';
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

app.get('/api/rubber/tla', async (req, res) => {
  await syncTlaFromWeb();
  res.json(buildDailyCalendarTla());
});

// Endpoint สำหรับกดทดสอบส่ง LINE หรือเรียกผ่าน GitHub Actions ตอน 16:00 น.
app.all('/api/line/daily-notify', async (req, res) => {
  try {
    const result = await sendDailyLineNotification();
    res.json({ ok: true, message: 'ส่งแจ้งเตือน LINE สำเร็จ', preview: result.text });
  } catch (err) {
    const apiErr = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    res.status(500).json({ ok: false, error: apiErr });
  }
});

// Webhook สำหรับตอบกลับอัตโนมัติเมื่อผู้ใช้พิมพ์ข้อความในแชท LINE (เช่น "ส่งมาใหม่", "ราคา")
app.post('/api/line/webhook', async (req, res) => {
  res.status(200).send('OK');
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || LINE_ACCESS_TOKEN;
  if (!token || !req.body || !Array.isArray(req.body.events)) return;

  for (const ev of req.body.events) {
    if (ev.type === 'message' && ev.message?.type === 'text' && ev.replyToken) {
      try {
        const summary = await getLatestPricesSummary();
        const replyText = buildLineNotificationText(summary);
        await axios.post('https://api.line.me/v2/bot/message/reply', {
          replyToken: ev.replyToken,
          messages: [{ type: 'text', text: replyText }]
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          timeout: 10000
        });
      } catch (e) {
        console.error('[LINE Webhook Error]:', e.message);
      }
    }
  }
});

app.listen(PORT, () => {
  console.log(`ParaTrend Server กำลังทำงานที่พอร์ต ${PORT}`);
});
