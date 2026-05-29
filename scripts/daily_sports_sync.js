import { chromium } from 'playwright';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in GitHub Secrets');
}

const BASE_URL = 'https://www.playsport.cc/predict/games?allianceid=1&from=header';
const TARGETS = [
  { label: 'MLB', sport: 'baseball', league: 'MLB' },
  { label: '日本職棒', sport: 'baseball', league: 'NPB' },
  { label: '中華職棒', sport: 'baseball', league: 'CPBL' },
  { label: '韓國職棒', sport: 'baseball', league: 'KBO' },
  { label: 'NBA', sport: 'basketball', league: 'NBA' },
  { label: 'WNBA', sport: 'basketball', league: 'WNBA' },
  { label: '中國職籃', sport: 'basketball', league: 'CBA' },
  { label: '足球', sport: 'football', league: '足球' }
];

function dateTW(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

function nowISO() { return new Date().toISOString(); }

function normalizeSpaces(s = '') {
  return String(s).replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').replace(/\n\s*/g, '\n').trim();
}
function oneLine(s = '') { return normalizeSpaces(s).replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
function onlyText(s = '') { return oneLine(s).replace(/[○◎●◯]/g, '').trim(); }

function cleanTeamName(name = '') {
  return onlyText(name)
    .replace(/^(\d{2,5}|AM|PM|對戰資訊|客隊|主隊|客|主|和)\s*/i, '')
    .replace(/^(MLB|NBA|WNBA|CPBL|NPB|KBO|CBA|足球|棒球|籃球|日本職棒|中華職棒|韓國職棒|中國職籃)\s*/i, '')
    .replace(/\b(Grant|Lucas|Taj|Chris|Paxton|Jared|Trevor|Holmes|Giolito|Bradley|Paddack|Schultz|Jones|Rogers)\b.*$/i, '')
    .replace(/[,，|｜:：]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTeamCell(text = '', sport = 'baseball') {
  const lines = normalizeSpaces(text).split('\n').map(x => onlyText(x)).filter(Boolean);
  let team = lines[0] || onlyText(text);
  let detail = '';
  if (sport === 'baseball') {
    detail = lines.slice(1).join(' ') || '';
  } else {
    detail = lines.slice(1).join(' ') || '';
  }
  team = cleanTeamName(team);
  return { team, detail };
}

function extractTime(text = '') {
  const m = oneLine(text).match(/\b(?:AM|PM)\s*\d{1,2}:\d{2}\b|\b\d{1,2}:\d{2}\b/i);
  return m ? m[0].replace(/\s+/, ' ').toUpperCase() : '';
}

function isBadTeamName(s = '') {
  const t = cleanTeamName(s);
  if (!t || t.length < 2 || t.length > 18) return true;
  if (/^[\d\s.\-+]+$/.test(t)) return true;
  if (/^[SV]\.?\s*\d/i.test(t)) return true;
  if (/賽事資訊|球隊資訊|運彩盤|國際盤|預測賽事|請先登入|日期/.test(t)) return true;
  if (/讓分|大小|不讓分|獨贏|客\d|主\d|和\d/.test(t)) return true;
  return false;
}

function parseNumber(s = '') {
  const m = String(s).replace(/,/g, ' ').match(/[+-]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function parseOddsLine(text = '') {
  const raw = oneLine(text);
  const side = raw.includes('客') ? '客' : raw.includes('主') ? '主' : raw.includes('和') ? '和' : raw.includes('大') ? '大' : raw.includes('小') ? '小' : '';
  const lineMatch = raw.match(/(?:客|主|大|小)\s*([+-]?\d+(?:\.\d+)?)/);
  const allNums = [...raw.matchAll(/[+-]?\d+(?:\.\d+)?/g)].map(m => Number(m[0]));
  let line = lineMatch ? Number(lineMatch[1]) : null;
  let odds = null;
  if (allNums.length >= 2) odds = allNums[allNums.length - 1];
  else if (allNums.length === 1 && !lineMatch) odds = allNums[0];
  return { raw, side, line, odds };
}

function chooseLowerOdd(a, b) {
  if (a?.odds && b?.odds) return a.odds <= b.odds ? a : b;
  return a || b;
}

function buildMarkets({ sport, awayTeam, homeTeam, spreadAway, spreadHome, moneyAway, moneyHome, moneyDraw, totalOver, totalUnder }) {
  // awayTeam = 玩運彩客隊；homeTeam = 玩運彩主隊。
  const favMoney = chooseLowerOdd(moneyAway, moneyHome);
  const moneyTeam = favMoney?.side === '客' ? awayTeam : homeTeam;
  const money = sport === 'football' && moneyDraw?.odds && moneyDraw.odds < Math.min(moneyAway?.odds || 99, moneyHome?.odds || 99)
    ? '和局'
    : `${moneyTeam || homeTeam || awayTeam}勝${favMoney?.odds ? ` ${favMoney.odds}` : ''}`;

  const favSpread = chooseLowerOdd(spreadAway, spreadHome);
  const spreadTeam = favSpread?.side === '客' ? awayTeam : homeTeam;
  const spreadLine = favSpread?.line;
  const spread = (spreadTeam && spreadLine !== null && spreadLine !== undefined)
    ? `${spreadTeam} ${spreadLine > 0 ? '+' : ''}${spreadLine}${favSpread?.odds ? ` ${favSpread.odds}` : ''}`
    : '盤口待確認';

  const favTotal = chooseLowerOdd(totalOver, totalUnder);
  const totalLine = totalOver?.line ?? totalUnder?.line;
  const totalSide = favTotal?.side === '小' ? '小' : '大';
  const total = totalLine !== null && totalLine !== undefined
    ? `${totalSide} ${Math.abs(totalLine)}${favTotal?.odds ? ` ${favTotal.odds}` : ''}`
    : (sport === 'football' ? '大小 2.5' : sport === 'basketball' ? '大小待確認' : '大小待確認');

  const c0 = favMoney?.odds ? Math.max(52, Math.min(76, Math.round(100 / favMoney.odds))) : 60;
  const c1 = favSpread?.odds ? Math.max(52, Math.min(72, Math.round(100 / favSpread.odds))) : 58;
  const c2 = favTotal?.odds ? Math.max(52, Math.min(70, Math.round(100 / favTotal.odds))) : 56;

  return { money, spread, total, confidence: [c0, c1, c2] };
}

function parseDateFromPage(text = '') {
  const m = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const y = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(new Date());
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function convertGroupToGame(group, target, sourceUrl, selectedDate) {
  const rows = group.rows;
  if (!rows.length) return null;
  const time = extractTime(rows.map(r => r.cells.map(c => c.text).join(' ')).join(' '));
  if (!time) return null;

  const r0 = rows[0].cells;
  const r1 = rows[1]?.cells || [];
  const r2 = rows[2]?.cells || [];
  if (r0.length < 2 || r1.length < 1) return null;

  const awayInfo = parseTeamCell(r0[1]?.text || '', target.sport);
  const homeInfo = parseTeamCell(r1[0]?.text || '', target.sport);
  const awayTeam = awayInfo.team;
  const homeTeam = homeInfo.team;
  if (isBadTeamName(awayTeam) || isBadTeamName(homeTeam) || awayTeam === homeTeam) return null;

  // 運彩盤在表格右側，通常是每列最後三格：讓分 / 不讓分 / 大小。
  const last3Top = r0.slice(-3).map(c => c.text);
  const last3Bottom = r1.slice(-3).map(c => c.text);
  const last3Third = r2.slice(-3).map(c => c.text);

  let spreadAway = parseOddsLine(last3Top[0] || '');
  let moneyAway = parseOddsLine(last3Top[1] || '');
  let totalOver = parseOddsLine(last3Top[2] || '');
  let spreadHome = parseOddsLine(last3Bottom[0] || '');
  let moneyHome = parseOddsLine(last3Bottom[1] || '');
  let totalUnder = parseOddsLine(last3Bottom[2] || '');
  let moneyDraw = parseOddsLine(last3Third[1] || last3Third[0] || '');

  // 足球只有不讓分與大小，沒有讓分欄時，讓分盤以獨贏方向保守呈現。
  if (target.sport === 'football' && (!spreadAway.raw || !spreadHome.raw)) {
    spreadAway = { side: '客', line: 0, odds: moneyAway.odds, raw: moneyAway.raw };
    spreadHome = { side: '主', line: 0, odds: moneyHome.odds, raw: moneyHome.raw };
  }

  const markets = buildMarkets({
    sport: target.sport,
    awayTeam,
    homeTeam,
    spreadAway,
    spreadHome,
    moneyAway,
    moneyHome,
    moneyDraw,
    totalOver,
    totalUnder
  });

  const competition = target.sport === 'football'
    ? onlyText((r0[0]?.text || '').replace(/\b\d{2,5}\b/g, '').replace(/AM\s*\d{1,2}:\d{2}/i, '')).replace('對戰資訊', '').trim()
    : target.league;

  const starters = target.sport === 'baseball'
    ? [
        { team: homeTeam, name: homeInfo.detail || '先發待公布', role: '主隊先發', stats: [['來源', '玩運彩'], ['狀態', homeInfo.detail ? '已公布' : '待公布']] },
        { team: awayTeam, name: awayInfo.detail || '先發待公布', role: '客隊先發', stats: [['來源', '玩運彩'], ['狀態', awayInfo.detail ? '已公布' : '待公布']] }
      ]
    : [];

  const corePlayers = target.sport !== 'baseball'
    ? [
        { team: homeTeam, name: '核心隊員待同步', role: '主隊', award: '資料來源：玩運彩賽事表；詳細球員數據由 Yahoo / SofaScore 後續補強。' },
        { team: awayTeam, name: '核心隊員待同步', role: '客隊', award: '若賽前尚未公布名單，前台會先顯示隊伍盤口與近期數據。' }
      ]
    : [];

  return {
    game_date: dateTW(0),
    sport: target.sport,
    league: target.league,
    game_time: time,
    // 前台目前用 away vs home 顯示；依需求改成主隊放第一個，所以這裡把主隊放在 away 欄。
    away: homeTeam,
    home: awayTeam,
    money: markets.money,
    spread: markets.spread,
    total: markets.total,
    confidence: markets.confidence,
    source_url: sourceUrl,
    source_name: '玩運彩',
    active: true,
    updated_at: nowISO(),
    analysis_json: {
      parser_version: 'v56-table-parser',
      play_date: selectedDate || null,
      true_home: homeTeam,
      true_away: awayTeam,
      display_order: 'home_first',
      competition: competition || target.league,
      sport_label: target.label,
      starters,
      core_players: corePlayers,
      odds: {
        spread_away: spreadAway,
        spread_home: spreadHome,
        money_away: moneyAway,
        money_home: moneyHome,
        money_draw: moneyDraw,
        total_over: totalOver,
        total_under: totalUnder
      },
      source_note: '盤口只取玩運彩預測賽事右側「運彩盤」欄位；棒球顯示先發投手，籃球/足球保留核心隊員補強欄位。',
      data_sources: target.sport === 'football'
        ? ['玩運彩預測賽事', 'SofaScore 隊伍資料']
        : ['玩運彩預測賽事', 'Yahoo 奇摩運動隊伍資料']
    }
  };
}

async function scrapeCurrentTable(page, target) {
  return await page.evaluate((target) => {
    const norm = (s = '') => String(s).replace(/\u00a0/g, ' ').trim();
    const cellObj = (td) => ({
      text: norm(td.innerText || td.textContent || ''),
      rowspan: Number(td.getAttribute('rowspan') || '1'),
      colspan: Number(td.getAttribute('colspan') || '1')
    });
    const allTables = [...document.querySelectorAll('table')];
    let best = null;
    for (const table of allTables) {
      const t = table.innerText || table.textContent || '';
      let score = 0;
      if (t.includes('賽事資訊')) score += 3;
      if (t.includes('球隊資訊')) score += 3;
      if (t.includes('運彩盤')) score += 4;
      if (t.includes('國際盤')) score += 2;
      if ((t.match(/AM\s*\d{1,2}:\d{2}/g) || []).length) score += 2;
      if (!best || score > best.score) best = { table, score };
    }
    const table = best?.score > 0 ? best.table : allTables.sort((a,b)=>(b.innerText||'').length-(a.innerText||'').length)[0];
    if (!table) return { selectedDate: null, groups: [] };

    const bodyText = document.body?.innerText || '';
    const dateButtons = [...document.querySelectorAll('a,button,td,div,span')]
      .map(el => ({ text: norm(el.innerText || el.textContent || ''), bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
      .filter(x => /\d{1,2}\/\d{1,2}/.test(x.text));
    const selected = dateButtons.find(x => /255|yellow|rgb\(255, 255, 0\)|rgb\(255, 235/.test(`${x.bg} ${x.color}`)) || dateButtons.at(-1);

    const trs = [...table.querySelectorAll('tr')].map(tr => ({
      text: norm(tr.innerText || tr.textContent || ''),
      cells: [...tr.children].filter(el => /^(TD|TH)$/.test(el.tagName)).map(cellObj)
    })).filter(r => r.cells.length && r.text);

    const groups = [];
    let cur = null;
    for (const row of trs) {
      const rowText = row.text.replace(/\s+/g, ' ');
      const hasTime = /\b(?:AM|PM)\s*\d{1,2}:\d{2}\b|\b\d{1,2}:\d{2}\b/i.test(rowText);
      const isHeader = /賽事資訊|球隊資訊|運彩盤|國際盤|日期/.test(rowText);
      if (isHeader) continue;
      if (hasTime) {
        if (cur) groups.push(cur);
        cur = { rows: [row] };
      } else if (cur) {
        cur.rows.push(row);
      }
    }
    if (cur) groups.push(cur);
    return { selectedDate: selected?.text || bodyText.match(/\d{1,2}\/\d{1,2}/)?.[0] || null, groups };
  }, target);
}

async function clickTargetTab(page, label) {
  const exact = page.getByText(label, { exact: true }).first();
  try {
    await exact.click({ timeout: 5000 });
    await page.waitForTimeout(2500);
    return true;
  } catch {}
  try {
    const partial = page.locator(`text=${label}`).first();
    await partial.click({ timeout: 5000 });
    await page.waitForTimeout(2500);
    return true;
  } catch {}
  return false;
}

async function scrapePlaySportWithBrowser() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    locale: 'zh-TW', timezoneId: 'Asia/Taipei',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
  });

  const games = [];
  try {
    for (const target of TARGETS) {
      const page = await context.newPage();
      try {
        console.log(`Opening PlaySport target: ${target.label}`);
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(3000);
        await clickTargetTab(page, target.label);
        try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
        await page.waitForTimeout(3000);

        const extracted = await scrapeCurrentTable(page, target);
        const selectedDate = parseDateFromPage(extracted.selectedDate || '') || null;
        let parsed = 0;
        for (const group of extracted.groups) {
          const game = convertGroupToGame(group, target, page.url(), selectedDate);
          if (game) { games.push(game); parsed++; }
        }
        console.log(`${target.label}: table groups=${extracted.groups.length}, parsed=${parsed}, selectedDate=${selectedDate || 'n/a'}`);
      } catch (e) {
        console.warn(`${target.label} scrape failed: ${e.message}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const unique = new Map();
  for (const g of games) {
    const key = `${g.game_date}|${g.league}|${g.away}|${g.home}|${g.game_time}`;
    if (!unique.has(key)) unique.set(key, g);
  }
  return [...unique.values()].sort((a,b)=>`${a.league}${a.game_time}`.localeCompare(`${b.league}${b.game_time}`));
}

async function supabaseRequest(path, options = {}) {
  const base = SUPABASE_URL.replace(/\/$/, '');
  const url = `${base}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt || `${res.status} ${res.statusText}`);
  try { return txt ? JSON.parse(txt) : null; } catch { return txt; }
}

async function writeSyncStatus(status, message, count = 0) {
  try {
    await supabaseRequest('daily_sync_status?on_conflict=sync_date,source_name', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{
        sync_date: dateTW(0), source_name: 'playsport-v56-table-parser', status, message,
        games_count: count, updated_at: nowISO()
      }])
    });
  } catch (e) {
    console.warn('daily_sync_status not written:', e.message);
  }
}

async function archiveTodayToYesterday(reason = 'PlaySport parsed 0 valid games') {
  const today = dateTW(0);
  const yesterday = dateTW(-1);
  let rows = [];
  try { rows = await supabaseRequest(`daily_games?game_date=eq.${today}&active=eq.true&select=*`) || []; } catch (e) { console.warn(e.message); }
  if (!rows.length) {
    console.log('No active today rows to archive.');
    await writeSyncStatus('empty', `${reason}; no active today rows`, 0);
    return;
  }
  const archived = rows.map(r => ({ ...r, id: undefined, game_date: yesterday, active: true, updated_at: nowISO(), analysis_json: { ...(r.analysis_json || {}), archived_from_today: today, archive_reason: reason } }));
  await supabaseRequest('daily_games?on_conflict=game_date,league,away,home', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(archived)
  });
  await supabaseRequest(`daily_games?game_date=eq.${today}&active=eq.true`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false, updated_at: nowISO() })
  });
  console.log(`Moved ${archived.length} active today rows to yesterday (${yesterday}).`);
  await writeSyncStatus('empty_archived', reason, archived.length);
}

async function upsertDailyGames(rows) {
  const today = dateTW(0);
  if (!rows.length) {
    await archiveTodayToYesterday('v56 table parser parsed 0 valid games');
    return;
  }

  // 清掉今天舊資料，避免上一版錯誤格式殘留在前台。
  await supabaseRequest(`daily_games?game_date=eq.${today}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false, updated_at: nowISO() })
  });

  await supabaseRequest('daily_games?on_conflict=game_date,league,away,home', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });
  await writeSyncStatus('success', `v56 synced ${rows.length} valid games`, rows.length);
}

async function main() {
  const games = await scrapePlaySportWithBrowser();
  console.log(`Parsed valid games: ${games.length}`);
  if (games.length) {
    console.log(games.slice(0, 30).map(g => `${g.league} ${g.game_time} ${g.away} vs ${g.home} | ${g.spread} | ${g.total}`).join('\n'));
  }
  await upsertDailyGames(games);
  console.log(games.length ? `Synced ${games.length} valid games to Supabase daily_games.` : 'No valid games parsed; archived today if needed.');
}

main().catch(err => { console.error(err); process.exit(1); });
