import { chromium } from 'playwright';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in GitHub Secrets');

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
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function mdTW(offsetDays = 0) {
  const d = dateTW(offsetDays).split('-');
  return `${d[1]}/${d[2]}`;
}
function nowISO() { return new Date().toISOString(); }
function normalize(s = '') { return String(s).replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').replace(/\n\s*/g, '\n').trim(); }
function lines(s = '') { return normalize(s).split('\n').map(x => x.replace(/[○◎●◯]/g, '').trim()).filter(Boolean); }
function oneLine(s = '') { return normalize(s).replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
function cleanTeamName(s = '') {
  return oneLine(s)
    .replace(/^(客隊|主隊|客|主|和|V\.S\.|VS|對戰資訊|AM|PM)\s*/i, '')
    .replace(/^\d{1,5}\s*$/, '')
    .replace(/^[\d.\-+]+\s*/, '')
    .replace(/[,，|｜:：]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function isBadTeamName(s = '') {
  const t = cleanTeamName(s);
  if (!t || t.length < 2 || t.length > 24) return true;
  if (/^[\d\s.\-+]+$/.test(t)) return true;
  // 玩運彩足球或比分區塊常會出現 0 vs S. 0、1 vs S. 4 這種字串，不能當隊名。
  if (/(^|\s)(vs|v\.s\.?)(\s|$)/i.test(t)) return true;
  if (/\bS\.\s*\d/i.test(t)) return true;
  if (/^\d+\s*(vs|v\.s\.?|對)/i.test(t)) return true;
  if (/賽事資訊|球隊資訊|運彩盤|國際盤|預測賽事|請先登入|日期|讓分|大小|不讓分|獨贏|對戰資訊/.test(t)) return true;
  return false;
}
function extractTime(s = '') {
  const m = oneLine(s).match(/\b(?:AM|PM)\s*\d{1,2}:\d{2}\b|\b\d{1,2}:\d{2}\b/i);
  return m ? m[0].replace(/\s+/, ' ').toUpperCase() : '';
}
function pickByClass(row, cls) { return row.cells.find(c => c.cls.includes(cls)); }
function clsHas(cell, cls) { return cell?.cls?.includes(cls); }
function parseNumberList(s = '') { return [...String(s).matchAll(/[+-]?\d+(?:\.\d+)?/g)].map(m => Number(m[0])); }
function parseMarket(text = '') {
  const raw = oneLine(text).replace(/\s*,\s*/g, ', ');
  const side = raw.includes('客') ? '客' : raw.includes('主') ? '主' : raw.includes('和') ? '和' : raw.includes('大') ? '大' : raw.includes('小') ? '小' : '';
  const nums = parseNumberList(raw);
  let line = null, odds = null;
  if (side === '大' || side === '小') {
    line = nums[0] ?? null;
    odds = nums.length > 1 ? nums[nums.length - 1] : null;
  } else if (side === '客' || side === '主') {
    // 讓分盤有 +1.5/-1.5；不讓分只有賠率。由 class 決定用途。
    line = nums[0] ?? null;
    odds = nums.length > 1 ? nums[nums.length - 1] : nums[0] ?? null;
  } else if (side === '和') {
    odds = nums[0] ?? null;
  }
  return { raw, side, line, odds };
}
function chooseLowerOdd(a, b, c = null) {
  return [a,b,c].filter(x => x && typeof x.odds === 'number' && x.odds > 0).sort((x,y)=>x.odds-y.odds)[0] || a || b || c || null;
}
function displayLine(n) { return n == null ? '' : `${n > 0 ? '+' : ''}${n}`; }
function buildMarkets({ sport, awayTeam, homeTeam, spreadAway, spreadHome, moneyAway, moneyHome, moneyDraw, totalOver, totalUnder }) {
  const moneyPick = sport === 'football' ? chooseLowerOdd(moneyAway, moneyHome, moneyDraw) : chooseLowerOdd(moneyAway, moneyHome);
  const moneyTeam = moneyPick?.side === '客' ? awayTeam : moneyPick?.side === '主' ? homeTeam : '和局';
  const money = moneyPick?.side === '和' ? '和局' : `${moneyTeam || homeTeam || awayTeam}勝`;

  let spread = '盤口待確認';
  const spreadPick = chooseLowerOdd(spreadAway, spreadHome);
  if (sport === 'football') {
    // 玩運彩足球表格的「不讓分」就是獨贏；真正讓分盤保留給台灣運彩後續補強。
    spread = `獨贏 ${money}`;
  } else if (spreadPick && spreadPick.line != null) {
    const team = spreadPick.side === '客' ? awayTeam : homeTeam;
    spread = `${team} ${displayLine(spreadPick.line)}`;
  }

  const totalPick = chooseLowerOdd(totalOver, totalUnder);
  const totalLine = totalOver?.line ?? totalUnder?.line;
  const total = totalLine != null ? `${totalPick?.side === '小' ? '小' : '大'} ${Math.abs(totalLine)}` : '大小待確認';

  const c0 = moneyPick?.odds ? Math.max(52, Math.min(76, Math.round(100 / moneyPick.odds))) : 60;
  const c1 = spreadPick?.odds ? Math.max(52, Math.min(72, Math.round(100 / spreadPick.odds))) : 58;
  const c2 = totalPick?.odds ? Math.max(52, Math.min(70, Math.round(100 / totalPick.odds))) : 56;
  return { money, spread, total, confidence: [c0, c1, c2] };
}
function parseTeamPairFromInfo(text, sport) {
  const ls = lines(text)
    .map(x => x.replace(/^對戰資訊\s*/,'').trim())
    .filter(x => !/^\d+$/.test(x) && !/^V\.S\.?$/i.test(x) && !/^VS$/i.test(x))
    .filter(x => !/(^|\s)(vs|v\.s\.?)(\s|$)/i.test(x) && !/\bS\.\s*\d/i.test(x));
  if (sport === 'baseball') {
    const team = cleanTeamName(ls[0] || '');
    const detail = ls.slice(1).filter(x => !isBadTeamName(x) || /[A-Za-z]/.test(x)).join(' ');
    return { team, detail };
  }
  const teams = ls.filter(x => !/^\d+$/.test(x) && !/^[\d]+\s*[:：]?\s*$/.test(x));
  return { teams: teams.map(cleanTeamName).filter(x => !isBadTeamName(x)) };
}
function getTeamsFromGroup(group, sport) {
  const rows = group.rows;
  const first = rows[0];
  if (sport === 'baseball') {
    const awayCell = pickByClass(first, 'td-teaminfo');
    const homeRow = rows.find((r,idx)=>idx>0 && pickByClass(r, 'td-teaminfo'));
    const homeCell = homeRow ? pickByClass(homeRow, 'td-teaminfo') : null;
    const away = parseTeamPairFromInfo(awayCell?.text || '', sport);
    const home = parseTeamPairFromInfo(homeCell?.text || '', sport);
    return { awayTeam: away.team, homeTeam: home.team, awayDetail: away.detail, homeDetail: home.detail };
  }
  // 籃球/足球若 td-teaminfo rowspan 內含比分表，文字順序通常是 客隊、主隊。
  const mainTeamCell = rows.flatMap(r=>r.cells).find(c => c.cls.includes('td-teaminfo'));
  let teams = parseTeamPairFromInfo(mainTeamCell?.text || '', sport).teams || [];
  if (teams.length < 2) {
    teams = rows.flatMap(r=>r.cells).filter(c => /(team|secondteam|winnerteam|loserteam|td-teaminfo)/.test(c.cls)).flatMap(c => lines(c.text)).map(cleanTeamName).filter(x => !isBadTeamName(x));
  }
  return { awayTeam: teams[0], homeTeam: teams[1], awayDetail: '', homeDetail: '' };
}
function findMarketCell(group, cls, side) {
  for (const r of group.rows) for (const c of r.cells) {
    if (!c.cls.includes(cls)) continue;
    const t = oneLine(c.text);
    if (!t) continue;
    if (side === '大' || side === '小') { if (t.includes(side)) return c; }
    else if (side === '和') { if (t.includes('和')) return c; }
    else if (new RegExp(`(^|\\s|\\|)${side}`).test(t)) return c;
  }
  return null;
}

function statRows(labels){ return labels.map(k => [k, '待更新']); }
function defaultPitcherStats(){ return statRows(['ERA','WHIP','勝投','敗投','近況']); }
function defaultCoreStats(sport){
  if(sport === 'basketball') return statRows(['場均得分','場均失分','命中率','籃板','近況']);
  if(sport === 'football') return statRows(['近5場進球','近5場失球','控球率','主客場','近況']);
  return statRows(['近況']);
}
function defaultMetrics(away, home, sport){
  if(sport === 'baseball') return [
    ['打擊率','待更新','待更新',50,50,'',''],['場均得分','待更新','待更新',50,50,'',''],['團隊防禦率','待更新','待更新',50,50,'',''],['牛棚WHIP','待更新','待更新',50,50,'',''],['近五場','待更新','待更新',50,50,'','']
  ];
  if(sport === 'basketball') return [
    ['場均得分','待更新','待更新',50,50,'',''],['場均失分','待更新','待更新',50,50,'',''],['近五場','待更新','待更新',50,50,'',''],['主客場表現','待更新','待更新',50,50,'',''],['大小分趨勢','待更新','待更新',50,50,'','']
  ];
  return [
    ['近五場進球','待更新','待更新',50,50,'',''],['近五場失球','待更新','待更新',50,50,'',''],['主客場表現','待更新','待更新',50,50,'',''],['歷史對戰','待更新','待更新',50,50,'',''],['盤口適配','待更新','待更新',50,50,'','']
  ];
}
function defaultInjuries(away, home, sport){
  if(sport === 'baseball') return [[away,'傷兵名單','待更新',''],[home,'傷兵名單','待更新','']];
  return [[away,'傷停狀況','待更新',''],[home,'傷停狀況','待更新','']];
}
function defaultH2H(away, home){ return [['待更新',[away,'-'],[home,'-'],'待更新']]; }
function defaultRecent(away, home){ return [
  {team:away,side:'客隊',items:[['近況',away,'待更新','-']]},
  {team:home,side:'主隊',items:[['近況',home,'待更新','-']]}
]; }
function cleanAnalysisText(s=''){
  return String(s||'').replace(/Yahoo奇摩運動|SofaScore|玩運彩|台灣運彩|資料來源|數據來源/g,'').replace(/\s+/g,' ').trim();
}

function convertGroupToGame(group, target, sourceUrl) {
  const allText = group.rows.map(r => r.text).join(' ');
  const time = extractTime(allText);
  if (!time) return null;
  const { awayTeam, homeTeam, awayDetail, homeDetail } = getTeamsFromGroup(group, target.sport);
  if (isBadTeamName(awayTeam) || isBadTeamName(homeTeam) || awayTeam === homeTeam) return null;
  // MLB/Japanese/KBO/CPBL 賽事不得含足球比分格式，例如「0 vs S. 0 馬卡拉」。
  if (target.sport === 'baseball' && /(vs|v\.s\.?|\bS\.\s*\d)/i.test(`${awayTeam} ${homeTeam}`)) return null;

  let spreadAway = parseMarket(findMarketCell(group, 'td-bank-bet01', '客')?.text || '');
  let spreadHome = parseMarket(findMarketCell(group, 'td-bank-bet01', '主')?.text || '');
  let moneyAway = parseMarket(findMarketCell(group, 'td-bank-bet03', '客')?.text || '');
  let moneyHome = parseMarket(findMarketCell(group, 'td-bank-bet03', '主')?.text || '');
  let moneyDraw = parseMarket(findMarketCell(group, target.sport === 'football' ? 'td-bank-bet01' : 'td-bank-bet03', '和')?.text || '');
  const totalOver = parseMarket(findMarketCell(group, 'td-bank-bet02', '大')?.text || '');
  const totalUnder = parseMarket(findMarketCell(group, 'td-bank-bet02', '小')?.text || '');

  // 非足球才用 td-bank-bet01 當讓分；足球 bet01 是和局，不可當讓分。
  if (target.sport === 'football') { spreadAway = null; spreadHome = null; }

  const markets = buildMarkets({ sport: target.sport, awayTeam, homeTeam, spreadAway, spreadHome, moneyAway, moneyHome, moneyDraw, totalOver, totalUnder });
  const gameInfoCell = group.rows[0].cells.find(c => c.cls.includes('td-gameinfo'));
  const competition = target.sport === 'football'
    ? lines(gameInfoCell?.text || '').filter(x => !/^\d{3,5}$/.test(x) && !/^(AM|PM)/i.test(x) && !/\d{1,2}:\d{2}/.test(x))[0] || '足球'
    : target.league;

  const starters = target.sport === 'baseball' ? [
    { team: homeTeam, name: homeDetail || '先發待公布', role: '主隊先發', stats: [...defaultPitcherStats()] },
    { team: awayTeam, name: awayDetail || '先發待公布', role: '客隊先發', stats: [...defaultPitcherStats()] }
  ] : [];
  const corePlayers = target.sport !== 'baseball' ? [
    { team: homeTeam, name: '核心球員待更新', role: '主隊', award: '近期狀態、傷兵與主客場數據待更新', stats: defaultCoreStats(target.sport) },
    { team: awayTeam, name: '核心球員待更新', role: '客隊', award: '近期狀態、傷兵與主客場數據待更新', stats: defaultCoreStats(target.sport) }
  ] : [];

  return {
    game_date: dateTW(0), sport: target.sport, league: target.league, game_time: time,
    // 前台用 away vs home 顯示；依需求主隊放第一個，故欄位反向存放。
    away: homeTeam, home: awayTeam,
    money: markets.money, spread: markets.spread, total: markets.total, confidence: markets.confidence,
    source_url: sourceUrl, source_name: '資料中心', active: true, updated_at: nowISO(),
    analysis_json: {
      parser_version: 'v61-data-center', true_away: awayTeam, true_home: homeTeam,
      display_order: 'home_first', competition, sport_label: target.label,
      starters, core_players: corePlayers,
      metrics: defaultMetrics(awayTeam, homeTeam, target.sport),
      injuries: defaultInjuries(awayTeam, homeTeam, target.sport),
      h2h: defaultH2H(awayTeam, homeTeam),
      recent: defaultRecent(awayTeam, homeTeam),
      detail_status: 'pending',
      odds_hidden: true,
      odds: { spread_away: spreadAway, spread_home: spreadHome, money_away: moneyAway, money_home: moneyHome, money_draw: moneyDraw, total_over: totalOver, total_under: totalUnder },
      source_note: '',
      data_sources: []
    }
  };
}
async function clickByText(page, label) {
  try { await page.getByText(label, { exact: true }).first().click({ timeout: 5000 }); await page.waitForTimeout(1500); return true; } catch {}
  try { await page.locator(`text=${label}`).first().click({ timeout: 5000 }); await page.waitForTimeout(1500); return true; } catch {}
  return false;
}
async function clickTodayDate(page) {
  const today = mdTW(0);
  const clicked = await page.evaluate((today) => {
    const [mm, dd] = today.split('/');
    const els = [...document.querySelectorAll('a,button,td,div,span')];
    const hit = els.find(el => {
      const txt = (el.innerText || el.textContent || '').replace(/\s+/g, '');
      return txt.includes(`${mm}/${dd}`) || txt.includes(`${Number(mm)}/${Number(dd)}`) || txt.includes(`${mm}${dd}`);
    });
    if (hit) { hit.click(); return true; }
    return false;
  }, today);
  if (clicked) await page.waitForTimeout(2500);
  return clicked;
}
async function extractGroups(page) {
  return await page.evaluate(() => {
    const norm = s => String(s || '').replace(/\u00a0/g, ' ').trim();
    const cellObj = td => ({ text: norm(td.innerText || td.textContent || ''), cls: [...td.classList].join(' '), rowspan: Number(td.getAttribute('rowspan') || '1'), colspan: Number(td.getAttribute('colspan') || '1') });
    const tables = [...document.querySelectorAll('table.predictgame-table')];
    const table = tables[0] || [...document.querySelectorAll('table')].sort((a,b)=>(b.innerText||'').length-(a.innerText||'').length)[0];
    if (!table) return [];
    const trs = [...table.querySelectorAll('tr')].map(tr => ({ text: norm(tr.innerText || tr.textContent || ''), cells: [...tr.children].filter(el => /^(TD|TH)$/.test(el.tagName)).map(cellObj) })).filter(r => r.cells.length && r.text);
    const groups = [];
    let cur = null;
    for (const row of trs) {
      const rowText = row.text.replace(/\s+/g, ' ');
      if (/賽事資訊|球隊資訊|運彩盤|國際盤|日期/.test(rowText)) continue;
      const starts = row.cells.some(c => c.cls.includes('td-gameinfo')) && /(?:AM|PM)\s*\d{1,2}:\d{2}|\d{1,2}:\d{2}/i.test(rowText);
      const spacer = row.cells.length === 1 && !row.text.trim();
      if (starts) { if (cur) groups.push(cur); cur = { rows: [row] }; }
      else if (cur && !spacer) cur.rows.push(row);
      else if (cur && spacer) { groups.push(cur); cur = null; }
    }
    if (cur) groups.push(cur);
    return groups;
  });
}
async function scrapePlaySportWithBrowser() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const context = await browser.newContext({ locale: 'zh-TW', timezoneId: 'Asia/Taipei', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' });
  const games = [];
  try {
    for (const target of TARGETS) {
      const page = await context.newPage();
      try {
        console.log(`Opening PlaySport target: ${target.label}`);
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(2500);
        await clickByText(page, target.label);
        await clickTodayDate(page);
        try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
        await page.waitForTimeout(2000);
        const groups = await extractGroups(page);
        let parsed = 0;
        for (const group of groups) { const g = convertGroupToGame(group, target, page.url()); if (g) { games.push(g); parsed++; } }
        console.log(`${target.label}: groups=${groups.length}, parsed=${parsed}, date=${dateTW(0)}`);
      } catch(e) { console.warn(`${target.label} scrape failed: ${e.message}`); }
      finally { await page.close().catch(()=>{}); }
    }
  } finally { await context.close().catch(()=>{}); await browser.close().catch(()=>{}); }
  const map = new Map();
  for (const g of games) { const key = `${g.game_date}|${g.league}|${g.away}|${g.home}|${g.game_time}`; if (!map.has(key)) map.set(key, g); }
  return [...map.values()].sort((a,b)=>`${a.league}${a.game_time}`.localeCompare(`${b.league}${b.game_time}`));
}
async function supabaseRequest(path, options = {}) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
  const res = await fetch(url, { ...options, headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt || `${res.status} ${res.statusText}`);
  try { return txt ? JSON.parse(txt) : null; } catch { return txt; }
}
async function writeSyncStatus(status, message, count = 0) {
  try { await supabaseRequest('daily_sync_status', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ status, message, games_count: count, source: 'v61-data-center', created_at: nowISO() }]) }); }
  catch(e) { console.warn('daily_sync_status not written:', e.message); }
}
async function archiveTodayToYesterday(reason = 'v61 parsed 0 valid games') {
  const today = dateTW(0), yesterday = dateTW(-1);
  let rows = [];
  try { rows = await supabaseRequest(`daily_games?game_date=eq.${today}&active=eq.true&select=*`) || []; } catch(e) { console.warn(e.message); }
  if (!rows.length) { await writeSyncStatus('empty', `${reason}; no active today rows`, 0); return; }
  const archived = rows.map(r => ({ ...r, id: undefined, game_date: yesterday, active: true, updated_at: nowISO(), analysis_json: { ...(r.analysis_json || {}), archived_from_today: today, archive_reason: reason } }));
  await supabaseRequest('daily_games?on_conflict=game_date,league,away,home', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(archived) });
  await supabaseRequest(`daily_games?game_date=eq.${today}&active=eq.true`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false, updated_at: nowISO() }) });
  await writeSyncStatus('empty_archived', reason, archived.length);
}
async function upsertDailyGames(rows) {
  const today = dateTW(0);
  if (!rows.length) { await archiveTodayToYesterday('v61 parsed 0 valid games'); return; }
  await supabaseRequest(`daily_games?game_date=eq.${today}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false, updated_at: nowISO() }) });
  await supabaseRequest('daily_games?on_conflict=game_date,league,away,home', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  await writeSyncStatus('success', `v61 synced ${rows.length} valid games`, rows.length);
}
async function main() {
  const games = await scrapePlaySportWithBrowser();
  console.log(`Parsed valid games: ${games.length}`);
  console.log(games.slice(0, 40).map(g => `${g.league} ${g.game_time} ${g.away} vs ${g.home} | ${g.spread} | ${g.total}`).join('\n'));
  await upsertDailyGames(games);
  console.log(games.length ? `Synced ${games.length} valid games to Supabase daily_games.` : 'No valid games parsed; archived today if needed.');
}
main().catch(err => { console.error(err); process.exit(1); });
