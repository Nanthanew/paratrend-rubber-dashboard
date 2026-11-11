const axios = require('axios');
const fs = require('fs');
const path = require('path');

// เวลาปัจจุบันแบบประเทศไทย (UTC+7)
const now = new Date(Date.now() + 7 * 3600 * 1000);
const todayIso = now.toISOString().slice(0, 10);
const [yyyy, mm, dd] = todayIso.split('-');
const yearTh = String(Number(yyyy) + 543);

// คำนวณสัปดาห์ที่ของเดือน (1-4) สำหรับไฟล์รายสัปดาห์
const weekOfMonth = String(Math.min(4, Math.ceil(Number(dd) / 7)));

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/json,*/*;q=0.8',
  'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8'
};

function readJsonSafe(filename) {
  const filePath = path.join(__dirname, filename);
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (parsed && Array.isArray(parsed.data)) return parsed;
    }
  } catch (e) {
    console.warn(`[Read Warning] อ่านไฟล์ ${filename} ไม่สำเร็จ ใช้โครงสร้างใหม่`);
  }
  return { success: true, data: [], pagination: { limit: 400, offset: 0, page: 1, count: 0, total: 0 } };
}

function writeJsonSafe(filename, obj) {
  const filePath = path.join(__dirname, filename);
  if (obj.pagination) obj.pagination.count = obj.data.length;
  fs.writeFileSync(filePath, JSON.stringify(obj), 'utf-8');
  console.log(`✅ อัปเดตไฟล์ ${filename} สำเร็จ (จำนวน ${obj.data.length} รายการ)`);
}

// 1. ดึงข้อมูลจาก สมาคมยางพาราไทย (TRA) และ กยท. (RAOT)
async function scrapeTraAndRaot() {
  const prices = { rss3: null, latex: null, cup: null };

  // ดึงจาก สมาคมยางพาราไทย (thainr.com)
  const traUrls = [
    'http://www.thainr.com/th/?detail=pr-local',
    'https://www.thainr.com/th/?detail=pr-local'
  ];

  for (const url of traUrls) {
    try {
      const res = await axios.get(url, { timeout: 8000, responseType: 'arraybuffer', headers: HEADERS });
      let html = new TextDecoder('utf-8').decode(res.data);
      if (html.includes('windows-874') || html.includes('tis-620') || html.includes('')) {
        try { html = new TextDecoder('windows-874').decode(res.data); } catch (_) {}
      }
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const extract = (re) => {
        const m = text.match(re);
        const v = m && m[1] ? parseFloat(m[1]) : null;
        return (v && v > 20 && v < 200) ? v : null;
      };

      prices.rss3 = extract(/(?:ยางแผ่นรมควันชั้น\s*3|ยางแผ่นดิบ|RSS\s*3)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i) || prices.rss3;
      prices.latex = extract(/(?:น้ำยางสด|Field\s*Latex)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i) || prices.latex;
      prices.cup = extract(/(?:ยางก้อนถ้วย|Cup\s*Lump)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i) || prices.cup;
      if (prices.rss3 || prices.latex) break;
    } catch (e) {
      console.warn(`[TRA] ดึงจาก ${url} ไม่สำเร็จ: ${e.message}`);
    }
  }

  // ดึงเสริมจาก การยางแห่งประเทศไทย (กยท. - raot.co.th)
  try {
    const raotRes = await axios.get('https://www.raot.co.th/rubber2012/menu5.php', {
      timeout: 8000,
      responseType: 'arraybuffer',
      headers: HEADERS
    });
    let rHtml = new TextDecoder('utf-8').decode(raotRes.data);
    if (rHtml.includes('windows-874') || rHtml.includes('tis-620')) {
      try { rHtml = new TextDecoder('windows-874').decode(raotRes.data); } catch (_) {}
    }
    const rText = rHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const extractR = (re) => {
      const m = rText.match(re);
      const v = m && m[1] ? parseFloat(m[1]) : null;
      return (v && v > 20 && v < 200) ? v : null;
    };
    prices.rss3 = prices.rss3 || extractR(/ยางแผ่นดิบ[^0-9]{1,40}([0-9]{2,3}\.[0-9]{1,2})/i);
    prices.latex = prices.latex || extractR(/น้ำยางสด[^0-9]{1,40}([0-9]{2,3}\.[0-9]{1,2})/i);
  } catch (e) {
    console.warn(`[RAOT] ข้ามการดึงหน้าเว็บ กยท.: ${e.message}`);
  }

  return prices;
}

// 2. ลองดึงจาก สศก. (เผื่อ IP ของ GitHub Actions ไม่โดนบล็อก)
async function tryFetchOae(url) {
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: { ...HEADERS, Referer: 'https://agriapi.nabc.go.th/' }
    });
    if (res.data && Array.isArray(res.data.data) && res.data.data.length > 0) {
      return res.data;
    }
  } catch (e) {
    console.warn(`[OAE API] ไม่สามารถดึงโดยตรง (${e.message}) -> ใช้ข้อมูล TRA/กยท. ผสานแทน`);
  }
  return null;
}

async function runUpdate() {
  console.log(`🚀 เริ่มต้นอัปเดตราคายางพาราประจำวันที่ ${todayIso} (พ.ศ. ${yearTh})...`);

  const scraped = await scrapeTraAndRaot();
  console.log('📊 ราคาที่สกัดได้จาก TRA / กยท.:', scraped);

  // ---------------- 1. อัปเดต fallback-daily.json ----------------
  const oaeDaily = await tryFetchOae(
    'https://agriapi.nabc.go.th/api/daily-prices/category?product_category=' + encodeURIComponent('ยางพารา')
  );

  let dailyJson = oaeDaily || readJsonSafe('fallback-daily.json');

  // ดึงราคาล่าสุดที่มีอยู่ในไฟล์มาเป็นฐาน กรณีเว็บต้นทางไม่อัปเดตในวันหยุด
  const lastRss3 = dailyJson.data.find(r => r.product_name && r.product_name.includes('แผ่นดิบ'))?.day_price || 82.65;
  const lastLatex = dailyJson.data.find(r => r.product_name && r.product_name.includes('น้ำยาง'))?.day_price || 73.50;

  const finalRss3 = scraped.rss3 || Number(lastRss3);
  const finalLatex = scraped.latex || Number(lastLatex);

  const todayRecords = [
    {
      data_date: todayIso,
      day: String(Number(dd)),
      month: String(Number(mm)),
      year_th: yearTh,
      product_category: 'ยางพารา',
      product_name: 'ยางพาราแผ่นดิบ ชั้น 3',
      market_name: 'สมาคมยางพาราไทย (TRA) / กยท.',
      province: 'สงขลา',
      day_price: finalRss3,
      unit: 'บาท/กก.'
    },
    {
      data_date: todayIso,
      day: String(Number(dd)),
      month: String(Number(mm)),
      year_th: yearTh,
      product_category: 'ยางพารา',
      product_name: 'น้ำยางพาราสด',
      market_name: 'สมาคมยางพาราไทย (TRA) / กยท.',
      province: 'สงขลา',
      day_price: finalLatex,
      unit: 'บาท/กก.'
    }
  ];

  // ลบข้อมูลวันนี้ที่อาจซ้ำออกก่อน แล้วแทรกข้อมูลใหม่ไว้บนสุด (เก็บย้อนหลังไม่เกิน 150 แถวเพื่อความเร็ว)
  const filteredDaily = dailyJson.data.filter(
    r => !(r.data_date === todayIso && r.market_name.includes('TRA'))
  );
  dailyJson.data = [...todayRecords, ...filteredDaily].slice(0, 150);
  writeJsonSafe('fallback-daily.json', dailyJson);

  // ---------------- 2. อัปเดตไฟล์รายสัปดาห์ทั้ง 3 ไฟล์ ----------------
  const weeklyConfigs = [
    { file: 'fallback-cup.json', name: 'ยางก้อน คละ', price: scraped.cup || null, fallbackPrice: 41.65 },
    { file: 'fallback-latex.json', name: 'น้ำยางสด คละ', price: finalLatex, fallbackPrice: 73.50 },
    { file: 'fallback-rss3.json', name: 'ยางแผ่นดิบ ชั้น 3', price: finalRss3, fallbackPrice: 82.65 }
  ];

  for (const cfg of weeklyConfigs) {
    const oaeWeekly = await tryFetchOae(
      'https://agriapi.nabc.go.th/api/weekly-prices/product?product_name=' + encodeURIComponent(cfg.name)
    );

    if (oaeWeekly) {
      writeJsonSafe(cfg.file, oaeWeekly);
      continue;
    }

    const wJson = readJsonSafe(cfg.file);
    const prevPrice = Number(wJson.data[0]?.week_price || wJson.data[0]?.day_price || cfg.fallbackPrice);
    const activePrice = cfg.price ? Number(cfg.price) : prevPrice;

    const newWeekRow = {
      data_date: todayIso,
      week: weekOfMonth,
      month: String(Number(mm)),
      year_th: yearTh,
      product_category: 'ยางพารา',
      product_name: cfg.name,
      market_name: 'สมาคมยางพาราไทย (TRA) / กยท.',
      province: 'สงขลา',
      week_price: activePrice,
      day_price: activePrice,
      unit: 'บาท/กก.'
    };

    // ถ้าสัปดาห์เดียวกันของเดือนมีอยู่แล้วให้อัปเดตทับ ถ้ายังไม่มีให้แทรกบนสุด
    const withoutDup = wJson.data.filter(
      r => !(String(r.year_th) === yearTh && String(r.month) === String(Number(mm)) && String(r.week) === weekOfMonth)
    );
    wJson.data = [newWeekRow, ...withoutDup].slice(0, 120);
    writeJsonSafe(cfg.file, wJson);
  }

  console.log('🎉 อัปเดตไฟล์ข้อมูลทั้ง 4 ไฟล์เสร็จสมบูรณ์!');
}

runUpdate().catch(err => {
  console.error('❌ เกิดข้อผิดพลาดในการอัปเดต:', err);
  process.exit(1);
});
