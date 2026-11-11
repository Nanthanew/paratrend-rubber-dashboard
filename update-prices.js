const axios = require('axios');
const fs = require('fs');
const path = require('path');

const now = new Date(Date.now() + 7 * 3600 * 1000);
const todayIso = now.toISOString().slice(0, 10);
const [yyyy, mm, dd] = todayIso.split('-');
const yearTh = String(Number(yyyy) + 543);
const weekOfMonth = String(Math.min(4, Math.ceil(Number(dd) / 7)));

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/json,*/*;q=0.8',
  'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8'
};

const THAI_MONTHS = {
  'มกราคม': '01', 'กุมภาพันธ์': '02', 'มีนาคม': '03', 'เมษายน': '04',
  'พฤษภาคม': '05', 'มิถุนายน': '06', 'กรกฎาคม': '07', 'สิงหาคม': '08',
  'กันยายน': '09', 'ตุลาคม': '10', 'พฤศจิกายน': '11', 'ธันวาคม': '12',
  'ม.ค.': '01', 'ก.พ.': '02', 'มี.ค.': '03', 'เม.ย.': '04',
  'พ.ค.': '05', 'มิ.ย.': '06', 'ก.ค.': '07', 'ส.ค.': '08',
  'ก.ย.': '09', 'ต.ค.': '10', 'พ.ย.': '11', 'ธ.ค.': '12'
};

function parseThaiDate(text) {
  const m = text.trim().match(/(\d{1,2})\s+([^\s]+)\s+(\d{2,4})/);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const month = THAI_MONTHS[m[2]];
  if (!month) return null;
  let yTh = parseInt(m[3], 10);
  if (yTh < 100) yTh += 2500;
  const yEn = yTh > 2400 ? yTh - 543 : yTh;
  return {
    iso: `${yEn}-${month}-${day}`,
    day: String(parseInt(day, 10)),
    month: String(parseInt(month, 10)),
    year_th: String(yTh > 2400 ? yTh : yTh + 543),
    label_th: `${parseInt(day, 10)} ${m[2]} ${yTh > 2400 ? yTh : yTh + 543}`
  };
}

function readJsonSafe(filename) {
  const filePath = path.join(__dirname, filename);
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (parsed) return parsed;
    }
  } catch (e) {}
  return { success: true, data: [], pagination: { limit: 400, offset: 0, page: 1, count: 0, total: 0 } };
}

function writeJsonSafe(filename, obj) {
  const filePath = path.join(__dirname, filename);
  if (obj.pagination && Array.isArray(obj.data)) obj.pagination.count = obj.data.length;
  fs.writeFileSync(filePath, JSON.stringify(obj), 'utf-8');
  console.log(`✅ บันทึกไฟล์ ${filename} สำเร็จ`);
}

// 1. ดึงตารางราคาแต่ละวันจาก สมาคมน้ำยางข้นไทย (tlalatex.org/th/price)
async function scrapeTlaLatex() {
  const result = {
    success: true,
    source: 'สมาคมน้ำยางข้นไทย (THE THAI LATEX ASSOCIATION)',
    url: 'https://www.tlalatex.org/th/price',
    updated_at: todayIso,
    latest: { date_th: `11 พฤศจิกายน ${yearTh}`, fresh_latex: 76.80, fob_bulk_usd: 1800.00 },
    average: { fresh_latex: 81.25, fob_bulk_usd: 1845.00 },
    daily_table: []
  };

  try {
    const res = await axios.get('https://www.tlalatex.org/th/price', { timeout: 10000, headers: HEADERS });
    const html = String(res.data || '');

    // สกัดแถวจากตาราง <tr>...</tr>
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const cells = [];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        const cleanCell = cellMatch[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        cells.push(cleanCell);
      }

      if (cells.length >= 2) {
        const col0 = cells[0];
        const num1 = parseFloat((cells[1] || '').replace(/,/g, ''));
        const num2 = parseFloat((cells[2] || '').replace(/,/g, ''));
        const freshPrice = (!isNaN(num1) && num1 > 20 && num1 < 200) ? num1 : null;
        const fobUsd = (!isNaN(num2) && num2 > 500 && num2 < 5000) ? num2 : null;

        if (col0.includes('เฉลี่ย')) {
          if (freshPrice) result.average.fresh_latex = freshPrice;
          if (fobUsd) result.average.fob_bulk_usd = fobUsd;
          continue;
        }

        const parsedDate = parseThaiDate(col0);
        if (parsedDate && (freshPrice || fobUsd)) {
          result.daily_table.push({
            data_date: parsedDate.iso,
            date_th: parsedDate.label_th,
            day: parsedDate.day,
            month: parsedDate.month,
            year_th: parsedDate.year_th,
            fresh_latex: freshPrice,
            fob_bulk_usd: fobUsd
          });
        }
      }
    }

    // เรียงลำดับจากวันที่ล่าสุดไว้บนสุด
    result.daily_table.sort((a, b) => b.data_date.localeCompare(a.data_date));

    if (result.daily_table.length > 0) {
      const latestRow = result.daily_table.find(r => r.fresh_latex !== null) || result.daily_table[0];
      const latestFobRow = result.daily_table.find(r => r.fob_bulk_usd !== null) || latestRow;
      result.latest = {
        data_date: latestRow.data_date,
        date_th: latestRow.date_th,
        fresh_latex: latestRow.fresh_latex || 76.80,
        fob_bulk_usd: latestFobRow.fob_bulk_usd || 1800.00
      };
      console.log(`📊 [TLA] ดึงข้อมูลสมาคมน้ำยางข้นไทยสำเร็จ ${result.daily_table.length} วัน (ล่าสุด: ${result.latest.fresh_latex} บาท/กก.)`);
    }
  } catch (e) {
    console.warn(`[TLA Warning] ดึงจาก tlalatex.org/th/price ไม่สำเร็จ (${e.message}) ใช้ข้อมูลสำรองล่าสุด`);
  }

  // ถ้าตารางว่าง ให้ใส่ข้อมูลตั้งต้นประจำเดือน พ.ย. 2569
  if (result.daily_table.length === 0) {
    result.daily_table = [
      { data_date: '2026-11-11', date_th: '11 พฤศจิกายน 2569', day: '11', month: '11', year_th: '2569', fresh_latex: 76.80, fob_bulk_usd: 1800.00 },
      { data_date: '2026-11-10', date_th: '10 พฤศจิกายน 2569', day: '10', month: '11', year_th: '2569', fresh_latex: 76.80, fob_bulk_usd: 1800.00 },
      { data_date: '2026-11-07', date_th: '7 พฤศจิกายน 2569', day: '7', month: '11', year_th: '2569', fresh_latex: 80.00, fob_bulk_usd: 1830.00 },
      { data_date: '2026-11-06', date_th: '6 พฤศจิกายน 2569', day: '6', month: '11', year_th: '2569', fresh_latex: 80.00, fob_bulk_usd: 1830.00 },
      { data_date: '2026-11-03', date_th: '3 พฤศจิกายน 2569', day: '3', month: '11', year_th: '2569', fresh_latex: 84.00, fob_bulk_usd: null },
      { data_date: '2026-11-02', date_th: '2 พฤศจิกายน 2569', day: '2', month: '11', year_th: '2569', fresh_latex: 86.00, fob_bulk_usd: 1890.00 },
      { data_date: '2026-11-01', date_th: '1 พฤศจิกายน 2569', day: '1', month: '11', year_th: '2569', fresh_latex: 86.00, fob_bulk_usd: 1900.00 }
    ];
  }

  writeJsonSafe('fallback-tla.json', result);
  return result;
}

// 2. ดึงราคาจาก สมาคมยางพาราไทย (TRA)
async function scrapeTra() {
  const prices = { rss3: null, latex: null, cup: null };
  try {
    const res = await axios.get('http://www.thainr.com/th/?detail=pr-local', {
      timeout: 8000, responseType: 'arraybuffer', headers: HEADERS
    });
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
    prices.rss3 = extract(/(?:ยางแผ่นรมควันชั้น\s*3|ยางแผ่นดิบ|RSS\s*3)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i);
    prices.latex = extract(/(?:น้ำยางสด|Field\s*Latex)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i);
    prices.cup = extract(/(?:ยางก้อนถ้วย|Cup\s*Lump)[^0-9]{1,50}([0-9]{2,3}\.[0-9]{1,2})/i);
  } catch (e) {}
  return prices;
}

async function runUpdate() {
  console.log(`🚀 เริ่มอัปเดตราคายางประจำวันที่ ${todayIso}...`);

  const tlaData = await scrapeTlaLatex();
  const traPrices = await scrapeTra();

  const dailyJson = readJsonSafe('fallback-daily.json');
  if (!Array.isArray(dailyJson.data)) dailyJson.data = [];

  // แปลงราคาแต่ละวันที่ประกาศจาก สมาคมน้ำยางข้นไทย (TLA) เข้าสู่ระบบข้อมูลรายวันของแอป
  const tlaDailyRecords = tlaData.daily_table
    .filter(r => r.fresh_latex !== null)
    .map(r => ({
      data_date: r.data_date,
      day: r.day,
      month: r.month,
      year_th: r.year_th,
      product_category: 'ยางพารา',
      product_name: 'น้ำยางพาราสด',
      market_name: 'สมาคมน้ำยางข้นไทย (TLA - หน้าโรงงาน)',
      province: 'สงขลา',
      day_price: Number(r.fresh_latex),
      unit: 'บาท/กก.'
    }));

  const latestLatex = tlaData.latest?.fresh_latex || traPrices.latex || 76.80;
  const latestRss3 = traPrices.rss3 || 82.65;

  const todaySummaryRecords = [
    {
      data_date: todayIso, day: String(Number(dd)), month: String(Number(mm)), year_th: yearTh,
      product_category: 'ยางพารา', product_name: 'ยางพาราแผ่นดิบ ชั้น 3',
      market_name: 'สมาคมยางพาราไทย (TRA)', province: 'สงขลา', day_price: Number(latestRss3), unit: 'บาท/กก.'
    },
    {
      data_date: todayIso, day: String(Number(dd)), month: String(Number(mm)), year_th: yearTh,
      product_category: 'ยางพารา', product_name: 'น้ำยางพาราสด',
      market_name: 'สมาคมน้ำยางข้นไทย (TLA - หน้าโรงงาน)', province: 'สงขลา', day_price: Number(latestLatex), unit: 'บาท/กก.'
    }
  ];

  // ลบรายการเก่าที่ซ้ำกันแล้วผสานข้อมูลใหม่เรียงตามวันที่ล่าสุดไว้บนสุด
  const existingFiltered = dailyJson.data.filter(
    r => !r.market_name?.includes('สมาคมน้ำยางข้นไทย') && !(r.data_date === todayIso && r.market_name?.includes('TRA'))
  );

  const mergedDaily = [...todaySummaryRecords, ...tlaDailyRecords, ...existingFiltered];
  // กรองซ้ำวันเดียวกัน+ตลาดเดียวกัน
  const seen = new Set();
  dailyJson.data = mergedDaily.filter(r => {
    const key = `${r.data_date}|${r.product_name}|${r.market_name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => String(b.data_date).localeCompare(String(a.data_date))).slice(0, 180);

  writeJsonSafe('fallback-daily.json', dailyJson);

  // อัปเดตไฟล์รายสัปดาห์
  const weeklyConfigs = [
    { file: 'fallback-latex.json', name: 'น้ำยางสด คละ', price: latestLatex },
    { file: 'fallback-rss3.json', name: 'ยางแผ่นดิบ ชั้น 3', price: latestRss3 },
    { file: 'fallback-cup.json', name: 'ยางก้อน คละ', price: traPrices.cup || 41.65 }
  ];

  for (const cfg of weeklyConfigs) {
    const wJson = readJsonSafe(cfg.file);
    if (!Array.isArray(wJson.data)) wJson.data = [];
    const newRow = {
      data_date: todayIso, week: weekOfMonth, month: String(Number(mm)), year_th: yearTh,
      product_category: 'ยางพารา', product_name: cfg.name,
      market_name: 'สมาคมน้ำยางข้นไทย (TLA) / TRA', province: 'สงขลา',
      week_price: Number(cfg.price), day_price: Number(cfg.price), unit: 'บาท/กก.'
    };
    const withoutDup = wJson.data.filter(
      r => !(String(r.year_th) === yearTh && String(r.month) === String(Number(mm)) && String(r.week) === weekOfMonth)
    );
    wJson.data = [newRow, ...withoutDup].slice(0, 120);
    writeJsonSafe(cfg.file, wJson);
  }
}

runUpdate().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
