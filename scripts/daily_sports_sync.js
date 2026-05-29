import { chromium } from 'playwright';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in GitHub Secrets');

// v88：MLB 官方 API + CPBL 官方/Yahoo 運動 + AI 統整版
// 玩運彩只抓賽事與運彩盤口；MLB 官方 Stats API、CPBL 官方網站、Yahoo 運動補雙方數據；OpenAI 可選用來統整所有數據成 AI 分析。
const SEARCH_PROVIDER = (process.env.SEARCH_PROVIDER || 'google').toLowerCase();
const SEARCH_API_KEY = process.env.SEARCH_API_KEY || '';
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID || '';
const SEARCH_ENRICH_LIMIT = Number(process.env.SEARCH_ENRICH_LIMIT || 30);
const SEARCH_RESULTS_PER_QUERY = Number(process.env.SEARCH_RESULTS_PER_QUERY || 5);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-nano';
const API_SPORTS_KEY = process.env.API_SPORTS_KEY || ''; // 選填：日後可接 NBA/WNBA/足球付費資料 API


const BASE_URL = 'https://www.playsport.cc/predict/games';
const TARGETS = [
  { allianceId: 1, label: 'MLB', sport: 'baseball', league: 'MLB' },
  { allianceId: 2, label: '日本職棒', sport: 'baseball', league: 'NPB' },
  { allianceId: 6, label: '中華職棒', sport: 'baseball', league: 'CPBL' },
  { allianceId: 9, label: '韓國職棒', sport: 'baseball', league: 'KBO' },
  { allianceId: 3, label: 'NBA', sport: 'basketball', league: 'NBA' },
  { allianceId: 7, label: 'WNBA', sport: 'basketball', league: 'WNBA' },
  { allianceId: 94, label: '中國職籃', sport: 'basketball', league: 'CBA' },
  { allianceId: 4, label: '足球', sport: 'football', league: '足球' }
];
const US_SHIFT_LEAGUES = new Set(['MLB','NBA','WNBA']);
function sourceDayForLeague(league) {
  // MLB / NBA / WNBA 因美國時差，玩運彩要抓 gameday=tomorrow；其餘聯盟抓 gameday=today。
  return US_SHIFT_LEAGUES.has(league) ? 'tomorrow' : 'today';
}
function displayDayForLeague() { return 'today'; }
function displayDayLabelForLeague() { return '今日賽事'; }
function playSportUrl(target, dayType) {
  return `${BASE_URL}?allianceid=${target.allianceId}&gameday=${dayType}`;
}

function taipeiParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date()).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return { year: parts.year, month: parts.month, day: parts.day, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}
async function waitUntilTaipeiDateReady() {
  const t = taipeiParts();
  // 台灣時間剛跨日 00:00 時，玩運彩日期按鈕可能還沒完全刷新；等到 00:01:10 再抓。
  if (t.hour === 0 && t.minute === 0) {
    const waitMs = Math.max(0, (70 - t.second) * 1000);
    console.log(`Taipei time is 00:00:${String(t.second).padStart(2,'0')}; waiting ${Math.ceil(waitMs/1000)}s until 00:01 before syncing.`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}
function dateTW(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function mdTW(offsetDays = 0) {
  const d = dateTW(offsetDays).split('-');
  return `${d[1]}/${d[2]}`;
}
function twDateLabel(offsetDays = 0) {
  const [y,m,d] = dateTW(offsetDays).split('-');
  return { iso: `${y}-${m}-${d}`, mmdd: `${m}/${d}`, compact: `${m}${d}`, loose: `${Number(m)}/${Number(d)}` };
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
  const money = sport === 'football'
    ? (moneyPick?.side === '客' ? '客隊勝' : moneyPick?.side === '主' ? '主隊勝' : moneyPick?.side === '和' ? '和局' : '獨贏待確認')
    : (moneyPick?.side === '和' ? '和局' : `${moneyTeam || homeTeam || awayTeam}勝`);

  let spread = '盤口待確認';
  const spreadPick = chooseLowerOdd(spreadAway, spreadHome);
  if (sport === 'football') {
    // 足球：玩運彩「不讓分」視為獨贏，前台用短標籤避免長隊名擠在盤口卡片。
    if (moneyPick?.side === '客') spread = '客隊勝';
    else if (moneyPick?.side === '主') spread = '主隊勝';
    else if (moneyPick?.side === '和') spread = '和局';
    else spread = '待確認';
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
function hasFinishedScore(group) {
  // 玩運彩今日頁已完賽常會在 scores 欄位顯示兩邊比分，例如 7 V.S. 1。
  // 只要今日頁出現完整比分，就視為 finished，不放到可預測列表。
  return group.rows.flatMap(r => r.cells).some(c => {
    if (!String(c.cls || '').includes('scores')) return false;
    const nums = String(c.text || '').match(/\b\d+\b/g) || [];
    return /V\.?S\.?/i.test(String(c.text || '')) && nums.length >= 2;
  });
}


function firstLinkByText(group, re){
  for(const r of group.rows) for(const c of r.cells) for(const a of (c.links||[])) if(re.test(a.text||'') || re.test(a.href||'')) return a.href;
  return '';
}
function teamLinksFromGroup(group){
  const out=[];
  for(const r of group.rows) for(const c of r.cells) for(const a of (c.links||[])){
    if(/gamesData\/teams/.test(a.href||'') && a.text) out.push({team:cleanTeamName(a.text), url:a.href});
  }
  const seen=new Set();
  return out.filter(x=>x.team && !seen.has(x.team) && seen.add(x.team));
}
function compactTextForAnalysis(txt=''){
  return oneLine(txt).replace(/登入|加入會員|客服電話|玩運彩網路有限公司|This site is protected.*$/g,'').slice(0,1200);
}
function pickUsefulSentences(text, keys, limit=3){
  const raw=String(text||'').replace(/\s+/g,' ');
  const parts=raw.split(/[。；;\n]/).map(s=>s.trim()).filter(Boolean);
  const hits=parts.filter(s=>keys.some(k=>s.includes(k))).slice(0,limit);
  return hits.length ? hits.join('；') : '待更新';
}
function numericHint(text, keys){
  const raw=String(text||'');
  for(const k of keys){
    const idx=raw.indexOf(k);
    if(idx>=0){
      const chunk=raw.slice(Math.max(0,idx-18), idx+42).replace(/\s+/g,' ').trim();
      if(/[0-9]/.test(chunk)) return chunk;
    }
  }
  return '待更新';
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
  const corePlayers = target.sport === 'basketball' ? [
    { team: homeTeam, name: '核心球員待更新', role: '主隊', award: '近期狀態、傷兵與主客場數據待更新', stats: defaultCoreStats(target.sport) },
    { team: awayTeam, name: '核心球員待更新', role: '客隊', award: '近期狀態、傷兵與主客場數據待更新', stats: defaultCoreStats(target.sport) }
  ] : [];

  return {
    game_date: group.syncDate || dateTW(0), game_day_type: group.dayType || 'today', game_status: 'upcoming', sport: target.sport, league: target.league, game_time: time,
    // 前台用 away vs home 顯示；依需求主隊放第一個，故欄位反向存放。
    away: homeTeam, home: awayTeam,
    money: markets.money, spread: markets.spread, total: markets.total, confidence: markets.confidence,
    source_url: sourceUrl, source_name: '資料中心', active: true, updated_at: nowISO(),
    analysis_json: {
      parser_version: 'v87-individual-api-ai', true_away: awayTeam, true_home: homeTeam, battle_url: firstLinkByText(group,/對戰資訊|battle/), team_urls: teamLinksFromGroup(group),
      display_order: 'home_first', competition, sport_label: target.label, market_day_label: displayDayLabelForLeague(target.league, group.dayType || 'today'),
      starters, core_players: corePlayers,
      metrics: defaultMetrics(awayTeam, homeTeam, target.sport),
      injuries: defaultInjuries(awayTeam, homeTeam, target.sport),
      h2h: defaultH2H(awayTeam, homeTeam),
      recent: defaultRecent(awayTeam, homeTeam),
      football_summary: target.sport === 'football' ? {
        home: `${homeTeam} 近期狀態待更新，系統會依主場表現、近五場攻防與盤口變化補齊。`,
        away: `${awayTeam} 近期狀態待更新，系統會依客場表現、近五場攻防與盤口變化補齊。`,
        conclusion: `本場先以獨贏方向 ${markets.money}、大小分 ${markets.total} 作為初步參考；詳細近期對戰與雙方狀態由資料中心補齊。`
      } : null,
      detail_status: 'pending',
      odds_hidden: true,
      odds: { spread_away: spreadAway, spread_home: spreadHome, money_away: moneyAway, money_home: moneyHome, money_draw: moneyDraw, total_over: totalOver, total_under: totalUnder },
      source_note: '',
      data_sources: []
    },
    raw_data: {
      raw_day_type: group.rawDayType || group.dayType || 'today',
      raw_text: oneLine(group.rows.map(r => r.text).join(' | ')).slice(0, 6000),
      raw_markets: {
        spread_away: spreadAway, spread_home: spreadHome,
        money_away: moneyAway, money_home: moneyHome, money_draw: moneyDraw,
        total_over: totalOver, total_under: totalUnder
      },
      links: { battle_url: firstLinkByText(group,/對戰資訊|battle/), team_urls: teamLinksFromGroup(group) }
    }
  };
}
async function clickByText(page, label) {
  try { await page.getByText(label, { exact: true }).first().click({ timeout: 5000 }); await page.waitForTimeout(1500); return true; } catch {}
  try { await page.locator(`text=${label}`).first().click({ timeout: 5000 }); await page.waitForTimeout(1500); return true; } catch {}
  return false;
}
async function clickAllGames(page) {
  // 玩運彩進入 today/tomorrow 後，還要點「所有賽事」才會展開全部聯盟。
  const labels = ['所有賽事','全部賽事','全部','All'];
  for (const label of labels) {
    const ok = await clickByText(page, label);
    if (ok) { console.log(`Clicked all-games tab: ${label}`); await page.waitForTimeout(2000); return true; }
  }
  // 有些版面「所有賽事」不是按鈕，而是 tab 文字；用 DOM 模糊點擊。
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a,button,div,span,li')];
    const visible = el => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden';
    };
    const hit = els.find(el => visible(el) && /所有賽事|全部賽事/.test((el.innerText || el.textContent || '').replace(/\s+/g,'')));
    if (hit) { hit.click(); return (hit.innerText || hit.textContent || '').trim(); }
    return '';
  });
  if (clicked) { console.log(`Clicked all-games tab by DOM: ${clicked}`); await page.waitForTimeout(2000); return true; }
  console.warn('All-games tab not found; continuing with current page content.');
  return false;
}
async function clickTodayDate(page) { return true; }
async function extractGroups(page) {
  return await page.evaluate(() => {
    const norm = s => String(s || '').replace(/\u00a0/g, ' ').trim();
    const cellObj = td => { const st = window.getComputedStyle(td); return { text: norm(td.innerText || td.textContent || ''), cls: [...td.classList].join(' '), color: st.color || '', rowspan: Number(td.getAttribute('rowspan') || '1'), colspan: Number(td.getAttribute('colspan') || '1'), links: [...td.querySelectorAll('a')].map(a=>({text:norm(a.innerText||a.textContent||''), href:a.href||''})) }; };
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
    // 今日頁會包含已完賽賽事，玩運彩常以綠色字或完賽/結束字樣標示；同步時要排除。
    return groups.map(g => {
      const text = g.rows.map(r=>r.text).join(' ');
      const green = g.rows.flatMap(r=>r.cells).some(c => /rgb\(0,\s*128,\s*0\)|rgb\(34,\s*197,\s*94\)|green/i.test(c.color || '') && /完|結束|終了|已/.test(c.text || ''));
      const scoreFinished = g.rows.flatMap(r => r.cells).some(c => String(c.cls || '').includes('scores') && /V\.?S\.?/i.test(c.text || '') && ((c.text || '').match(/\b\d+\b/g) || []).length >= 2);
      return { ...g, finished: green || scoreFinished || /已完賽|完賽|比賽結束|賽事結束|終場|終了|Final/i.test(text) };
    });
  });
}
async function scrapePlaySportWithBrowser() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const context = await browser.newContext({ locale: 'zh-TW', timezoneId: 'Asia/Taipei', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' });
  const games = [];
  const syncDate = dateTW(0);
  try {
    console.log(`=== 今日賽事單一顯示池 / ${syncDate} ===`);
    for (const target of TARGETS) {
      const page = await context.newPage();
      const sourceDay = sourceDayForLeague(target.league);
      const url = playSportUrl(target, sourceDay);
      try {
        console.log(`Opening PlaySport target: display=today source=${sourceDay} ${target.label} -> ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch {}
        await page.waitForTimeout(1800);
        let groups = await extractGroups(page);
        const totalGroups = groups.length;
        // 只顯示今日可參考場次：非美國時差聯盟在 today 頁要排除已完賽；MLB/NBA/WNBA 讀 tomorrow，通常就是可下注場次。
        const shouldSkipFinished = sourceDay === 'today';
        if (shouldSkipFinished) groups = groups.filter(g => !g.finished);
        let parsed = 0, rejectedFinished = totalGroups - groups.length;
        for (const group of groups) {
          group.rawDayType = sourceDay;
          group.dayType = 'today';
          group.syncDate = syncDate;
          const g = convertGroupToGame(group, target, page.url());
          if (g) {
            g.game_status = group.finished ? 'finished' : 'upcoming';
            g.game_day_type = 'today';
            g.game_date = syncDate;
            games.push(g);
            parsed++;
          }
        }
        console.log(`today ${target.label}: source=${sourceDay}, groups=${totalGroups}, finished_skipped=${rejectedFinished}, parsed=${parsed}, game_date=${syncDate}${US_SHIFT_LEAGUES.has(target.league)?' (美國時差聯盟：來源用 tomorrow，但前台統一顯示今日賽事)':''}`);
      } catch(e) { console.warn(`today ${target.label} scrape failed: ${e.message}`); }
      finally { await page.close().catch(()=>{}); }
    }
  } finally { }
  await enrichGamesWithDetails(context, games);
  await context.close().catch(()=>{}); await browser.close().catch(()=>{});
  const map = new Map();
  for (const g of games) { const key = `${g.game_day_type}|${g.game_date}|${g.league}|${g.away}|${g.home}|${g.game_time}`; if (!map.has(key)) map.set(key, g); }
  return [...map.values()].sort((a,b)=>`${a.league}${a.game_time}`.localeCompare(`${b.league}${b.game_time}`));
}

async function safePageText(context, url){
  if(!url) return '';
  const page=await context.newPage();
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    try{ await page.waitForLoadState('networkidle',{timeout:10000}); }catch{}
    await page.waitForTimeout(1200);
    return await page.evaluate(()=>document.body ? document.body.innerText : '');
  }catch(e){ console.warn('detail page failed:', url, e.message); return ''; }
  finally{ await page.close().catch(()=>{}); }
}
function isUsefulDetailUrl(url=''){
  return /tw\.sports\.yahoo\.com|sports\.yahoo\.com|playsport\.cc\/gamesData|playsport\.cc\/predict/.test(String(url));
}
function rankDetailUrl(url=''){
  const u=String(url);
  if(/tw\.sports\.yahoo\.com/.test(u) && /(mlb|nba|wnba|soccer|basketball|scoreboard)/i.test(u)) return 0;
  if(/sports\.yahoo\.com/.test(u)) return 1;
  if(/playsport\.cc\/gamesData\/battle/.test(u)) return 2;
  if(/playsport\.cc\/gamesData\/teams/.test(u)) return 3;
  return 9;
}
async function fetchDetailTextsForGame(context, game, searchRows=[]){
  const urls=[];
  for(const r of searchRows){ if(r.link && isUsefulDetailUrl(r.link)) urls.push(r.link); }
  const aj=game.analysis_json||{};
  if(aj.battle_url) urls.push(aj.battle_url);
  for(const t of (aj.team_urls||[])){ if(t.url) urls.push(t.url); }
  const seen=new Set();
  const selected=urls.filter(u=>u && !seen.has(u) && seen.add(u)).sort((a,b)=>rankDetailUrl(a)-rankDetailUrl(b)).slice(0,4);
  const out=[];
  for(const url of selected){
    const text=await safePageText(context,url);
    if(text) out.push({url,text});
    await new Promise(r=>setTimeout(r,300));
  }
  if(out.length) console.log(`Fetched detail pages: ${game.league} ${game.home} vs ${game.away}, pages=${out.length}`);
  return out;
}

function strictSliceAround(text, key, radius = 220) {
  const raw = String(text || '').replace(/\s+/g, ' ');
  const k = String(key || '').trim();
  if (!k) return raw.slice(0, radius);
  const idx = raw.indexOf(k);
  if (idx < 0) return '';
  return raw.slice(Math.max(0, idx - radius), idx + k.length + radius);
}
function firstStrictNumber(text, regexes) {
  const raw = String(text || '').replace(/\s+/g, ' ');
  for (const re of regexes) {
    const m = raw.match(re);
    if (m && (m[1] || m[2])) return (m[1] || m[2]).trim();
  }
  return '待更新';
}
function strictPitcherStat(allText, pitcherName, field) {
  const area = strictSliceAround(allText, pitcherName, 260) || String(allText || '').slice(0, 1200);
  if (field === 'ERA') return firstStrictNumber(area, [/\bERA\b\s*[:：]?\s*(\d+(?:\.\d+)?)/i, /防禦率\s*[:：]?\s*(\d+(?:\.\d+)?)/]);
  if (field === 'WHIP') return firstStrictNumber(area, [/\bWHIP\b\s*[:：]?\s*(\d+(?:\.\d+)?)/i]);
  if (field === '勝投') return firstStrictNumber(area, [/(\d+)\s*勝/, /\bW\s*[:：]?\s*(\d+)\b/i]);
  if (field === '敗投') return firstStrictNumber(area, [/(\d+)\s*敗/, /\bL\s*[:：]?\s*(\d+)\b/i]);
  if (field === '近況') {
    const v = pickUsefulSentences(area, [pitcherName, '近況', '最近', '先發'], 1);
    return v && v.length <= 70 ? cleanAnalysisText(v) : '待更新';
  }
  return '待更新';
}
function strictTeamNumber(allText, team, labels) {
  const area = strictSliceAround(allText, team, 280) || '';
  if (!area) return '待更新';
  for (const label of labels) {
    const v = firstStrictNumber(area, [new RegExp(`${label}\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?%?)`, 'i')]);
    if (v !== '待更新') return v;
  }
  return '待更新';
}
function safeShortNote(text, keys) {
  const v = cleanAnalysisText(pickUsefulSentences(text, keys, 1));
  if (!v || v === '待更新' || v.length > 80) return '待更新';
  return v;
}

function compactSearchDoc(results = []) {
  return results.map((r, idx) => `${idx + 1}. ${r.title || ''} ${r.snippet || ''}`).join(' ').replace(/\s+/g, ' ').trim();
}
function searchQueriesForGame(game) {
  const aj = game.analysis_json || {};
  const away = aj.true_away || game.home;
  const home = aj.true_home || game.away;
  const league = game.league || aj.sport_label || '';
  return [
    `${away} ${home} ${league} Yahoo 奇摩 運動 近期戰績 對戰`,
    `${home} ${away} ${league} 玩運彩 對戰資訊 盤口`,
    `${away} ${home} ${league} 先發 傷兵 近況`,
    `${away} vs ${home} ${league} preview stats injury`
  ];
}
async function searchGoogleCSE(query) {
  if (!SEARCH_API_KEY || !GOOGLE_CSE_ID) return [];
  const u = new URL('https://www.googleapis.com/customsearch/v1');
  u.searchParams.set('key', SEARCH_API_KEY);
  u.searchParams.set('cx', GOOGLE_CSE_ID);
  u.searchParams.set('q', query);
  u.searchParams.set('num', String(Math.min(10, SEARCH_RESULTS_PER_QUERY)));
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Google CSE ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.items || []).map(x => ({ title: x.title || '', link: x.link || '', snippet: x.snippet || '' }));
}
async function searchSerpApi(query) {
  if (!SEARCH_API_KEY) return [];
  const u = new URL('https://serpapi.com/search.json');
  u.searchParams.set('engine', 'google');
  u.searchParams.set('q', query);
  u.searchParams.set('api_key', SEARCH_API_KEY);
  u.searchParams.set('hl', 'zh-tw');
  u.searchParams.set('num', String(SEARCH_RESULTS_PER_QUERY));
  const res = await fetch(u);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.organic_results || []).map(x => ({ title: x.title || '', link: x.link || '', snippet: x.snippet || '' }));
}
async function searchTavily(query) {
  if (!SEARCH_API_KEY) return [];
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: SEARCH_API_KEY, query, search_depth: 'basic', include_answer: false, max_results: SEARCH_RESULTS_PER_QUERY })
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.results || []).map(x => ({ title: x.title || '', link: x.url || '', snippet: x.content || '' }));
}
async function runSearch(query) {
  try {
    if (!SEARCH_API_KEY) return [];
    if (SEARCH_PROVIDER === 'serpapi') return await searchSerpApi(query);
    if (SEARCH_PROVIDER === 'tavily') return await searchTavily(query);
    return await searchGoogleCSE(query);
  } catch (e) {
    console.warn(`search failed (${SEARCH_PROVIDER}) for "${query}":`, e.message);
    return [];
  }
}
async function searchIntelForGame(game) {
  const queries = searchQueriesForGame(game);
  const out = [];
  for (const q of queries) {
    const rows = await runSearch(q);
    rows.forEach(r => out.push({ ...r, query: q }));
    await new Promise(r => setTimeout(r, 250));
  }
  const seen = new Set();
  return out.filter(r => { const k = (r.link || r.title || r.snippet).slice(0, 160); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
}
function pctFromTextSeed(seed, min=54, max=76) {
  let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return min + (h % (max - min + 1));
}
function estimateMarketSupport(game, searchText) {
  const moneyPct = Math.max(Number(game.confidence?.[0] || 58), pctFromTextSeed(game.away + game.home + game.money, 55, 72));
  const spreadPct = Math.max(Number(game.confidence?.[1] || 56), pctFromTextSeed(game.spread + searchText.slice(0,80), 53, 70));
  const totalPct = Math.max(Number(game.confidence?.[2] || 55), pctFromTextSeed(game.total + searchText.slice(80,160), 52, 68));
  return { money: moneyPct, spread: spreadPct, total: totalPct };
}
function chooseMainAndSecond(game, support) {
  const rows = [
    { key: '獨贏', pick: game.money || '獨贏待確認', pct: support.money || 0 },
    { key: '讓分', pick: game.spread || '讓分待確認', pct: support.spread || 0 },
    { key: '大小', pick: game.total || '大小待確認', pct: support.total || 0 }
  ].filter(x => !/待確認|待更新/.test(x.pick));
  rows.sort((a,b)=>b.pct-a.pct);
  return { safest: rows[0]?.pick || game.money || game.spread || game.total || '待確認', main: rows[0]?.pick || '待確認', second: rows[1]?.pick || rows[0]?.pick || '待確認', confidence: rows[0]?.pct >= 70 ? '高' : rows[0]?.pct >= 62 ? '中高' : rows[0]?.pct >= 56 ? '中' : '低' };
}
function sentenceFromSearch(text, keys, fallback) {
  const s = cleanAnalysisText(pickUsefulSentences(text, keys, 2));
  if (s && s !== '待更新' && s.length >= 10) return s.slice(0, 180);
  return fallback;
}
function buildSearchBasedAnalysis(game, searchRows) {
  const aj = game.analysis_json || {};
  const away = aj.true_away || game.home;
  const home = aj.true_home || game.away;
  const searchText = cleanAnalysisText(compactSearchDoc(searchRows));
  const support = estimateMarketSupport(game, searchText);
  const picks = chooseMainAndSecond(game, support);
  const recentAway = sentenceFromSearch(searchText, [away, '近況', '近期', '戰績', '連勝', '連敗'], `${away} 近期狀態需配合臨場名單與盤口變化觀察。`);
  const recentHome = sentenceFromSearch(searchText, [home, '近況', '近期', '戰績', '主場', '客場'], `${home} 近期狀態需配合臨場名單與盤口變化觀察。`);
  const h2hNote = sentenceFromSearch(searchText, ['對戰', '交手', '歷史', 'head to head', 'H2H'], `雙方歷史對戰資料未完全明確，本場先以盤口深淺與近期狀態作主要判斷。`);
  const risk = game.sport === 'football'
    ? '足球賽事需留意和局與早段進球影響，若盤口偏深，不宜過度追讓。'
    : game.sport === 'basketball'
      ? '籃球盤口受節奏與輪休影響較大，若臨場名單變動，大小分與讓分方向都需要保守看待。'
      : '棒球盤口容易受先發投手與牛棚使用量影響，若臨場投手異動，讓分與大小分都要重新評估。';
  const summary = `綜合目前賽事盤口與公開搜尋摘要，本場市場方向較偏向「${picks.main}」。${game.spread || ''} 與 ${game.total || ''} 是主要觀察點，若臨場盤沒有明顯反向修正，主推方向可延續。`;
  return {
    summary, away_recent: recentAway, home_recent: recentHome, h2h_note: h2hNote, risk,
    support,
    picks,
    search_available: searchRows.length > 0,
    generated_at: nowISO(),
    search_titles: searchRows.slice(0,5).map(r => r.title).filter(Boolean)
  };
}
function applySearchIntel(game, searchRows) {
  const aj = game.analysis_json || {};
  const intel = buildSearchBasedAnalysis(game, searchRows);
  aj.search_intel = intel;
  aj.detail_status = searchRows.length ? 'search_enriched' : 'market_model_only';
  const away = aj.true_away || game.home;
  const home = aj.true_home || game.away;
  aj.recent = [
    { team: away, side: '客隊', items: [['近期情蒐', away, intel.away_recent, '-']] },
    { team: home, side: '主隊', items: [['近期情蒐', home, intel.home_recent, '-']] }
  ];
  aj.h2h = [['近期對戰', [away, '-'], [home, '-'], intel.h2h_note]];
  aj.metrics = [
    ['獨贏方向', game.money, `${intel.support.money}%`, intel.support.money, 100-intel.support.money, '盤口/搜尋', '模型'],
    ['讓分方向', game.spread, `${intel.support.spread}%`, intel.support.spread, 100-intel.support.spread, '盤口/搜尋', '模型'],
    ['大小分方向', game.total, `${intel.support.total}%`, intel.support.total, 100-intel.support.total, '盤口/搜尋', '模型'],
    ['情蒐可信度', intel.search_available ? '已搜尋' : '盤口模型', intel.picks.confidence, 60, 40, '', '']
  ];
  aj.football_summary = game.sport === 'football' ? { home: intel.home_recent, away: intel.away_recent, conclusion: intel.summary } : aj.football_summary;
  game.confidence = [intel.support.money, intel.support.spread, intel.support.total];
  game.analysis_json = aj;
  return game;
}
function enrichGameFromTexts(game, battleText, teamTexts){
  const aj=game.analysis_json||{};
  const allText=cleanAnalysisText(compactTextForAnalysis([battleText,...teamTexts.map(x=>x.text)].join(' ')));
  const away=aj.true_away || game.home;
  const home=aj.true_home || game.away;

  const recentAway=safeShortNote(strictSliceAround(allText, away, 360), [away,'近況','近五場','最近','戰績']);
  const recentHome=safeShortNote(strictSliceAround(allText, home, 360), [home,'近況','近五場','最近','戰績']);
  const h2hNote=safeShortNote(allText, ['對戰','交手','歷史']);
  const injuryAway=safeShortNote(strictSliceAround(allText, away, 360), ['傷','缺陣','傷兵','injury']);
  const injuryHome=safeShortNote(strictSliceAround(allText, home, 360), ['傷','缺陣','傷兵','injury']);

  aj.h2h = [['近期對戰', [away,'待更新'], [home,'待更新'], h2hNote]];
  aj.recent = [
    {team: away, side:'客隊', items:[['近期', away, recentAway, '-']]},
    {team: home, side:'主隊', items:[['近期', home, recentHome, '-']]}
  ];
  aj.injuries = [[away,'傷員狀況',injuryAway,'-'],[home,'傷員狀況',injuryHome,'-']];

  if(game.sport==='baseball'){
    const starterStats = name => [
      ['ERA', strictPitcherStat(allText, name, 'ERA')],
      ['WHIP', strictPitcherStat(allText, name, 'WHIP')],
      ['勝投', strictPitcherStat(allText, name, '勝投')],
      ['敗投', strictPitcherStat(allText, name, '敗投')],
      ['近況', strictPitcherStat(allText, name, '近況')]
    ];
    if(Array.isArray(aj.starters)) aj.starters = aj.starters.map(s=>({...s, stats: starterStats(s.name||'')}));
    aj.metrics = [
      ['打擊率', strictTeamNumber(allText, away, ['打擊率','AVG']), strictTeamNumber(allText, home, ['打擊率','AVG']),50,50,'',''],
      ['場均得分', strictTeamNumber(allText, away, ['場均得分','得分']), strictTeamNumber(allText, home, ['場均得分','得分']),50,50,'',''],
      ['團隊防禦率', strictTeamNumber(allText, away, ['防禦率','ERA']), strictTeamNumber(allText, home, ['防禦率','ERA']),50,50,'',''],
      ['近五場', recentAway, recentHome,50,50,'','']
    ];
  } else if(game.sport==='basketball'){
    aj.metrics = [
      ['場均得分', strictTeamNumber(allText, away, ['場均得分','得分','PTS']), strictTeamNumber(allText, home, ['場均得分','得分','PTS']),50,50,'',''],
      ['場均失分', strictTeamNumber(allText, away, ['場均失分','失分']), strictTeamNumber(allText, home, ['場均失分','失分']),50,50,'',''],
      ['命中率', strictTeamNumber(allText, away, ['命中率','FG%']), strictTeamNumber(allText, home, ['命中率','FG%']),50,50,'',''],
      ['近五場', recentAway, recentHome,50,50,'','']
    ];
    if(Array.isArray(aj.core_players)) aj.core_players = aj.core_players.map(p=>({...p, name:'核心球員待更新', award:'待更新', stats:[['場均得分', strictTeamNumber(allText,p.team,['場均得分','得分','PTS'])],['籃板', strictTeamNumber(allText,p.team,['籃板','REB'])],['助攻', strictTeamNumber(allText,p.team,['助攻','AST'])],['傷停', safeShortNote(strictSliceAround(allText,p.team,360),['傷','缺陣'])]]}));
  } else if(game.sport==='football'){
    aj.football_summary = {
      home: `${home}：${recentHome}`,
      away: `${away}：${recentAway}`,
      conclusion: `綜合盤口方向與近期狀態，本場先以 ${game.money}、${game.total} 作為主要參考。`
    };
    aj.metrics = [
      ['近期進球', strictTeamNumber(allText, away, ['進球']), strictTeamNumber(allText, home, ['進球']),50,50,'',''],
      ['近期失球', strictTeamNumber(allText, away, ['失球']), strictTeamNumber(allText, home, ['失球']),50,50,'',''],
      ['近五場', recentAway, recentHome,50,50,'',''],
      ['歷史對戰', h2hNote, h2hNote,50,50,'','']
    ];
  }
  aj.detail_status = allText ? 'strict_partial' : 'pending';
  aj.source_note=''; aj.data_sources=[];
  game.analysis_json=aj;
  return game;
}

const YAHOO_SCOREBOARD_URLS = {
  MLB: 'https://tw.sports.yahoo.com/mlb/scoreboard/',
  NBA: 'https://tw.sports.yahoo.com/nba/scoreboard/',
  WNBA: 'https://tw.sports.yahoo.com/wnba/scoreboard/',
  football: 'https://tw.sports.yahoo.com/soccer/scoreboard/',
  CPBL: [
    'https://cpbl.com.tw/standings/season',
    'https://cpbl.com.tw/stats/toplist',
    'https://cpbl.com.tw/box'
  ]
};
function yahooLeagueKey(game){
  if(game.league === 'MLB') return 'MLB';
  if(game.league === 'CPBL') return 'CPBL';
  if(game.league === 'NBA') return 'NBA';
  if(game.league === 'WNBA') return 'WNBA';
  if(game.sport === 'football') return 'football';
  return '';
}
function teamTokens(name=''){
  const t=cleanTeamName(name);
  const arr=[t];
  if(/[A-Za-z]/.test(t)){
    const parts=t.split(/\s+/).filter(Boolean);
    if(parts.length) arr.push(parts[parts.length-1]);
  }
  return [...new Set(arr.filter(x=>x && x.length>=2))];
}
function textContainsTeam(text, team){
  const raw=String(text||'').toLowerCase();
  return teamTokens(team).some(tok=>raw.includes(tok.toLowerCase()));
}
async function fetchYahooScoreboard(context, key){
  const rawUrls=YAHOO_SCOREBOARD_URLS[key];
  if(!rawUrls) return {url:'', text:'', links:[]};
  const urls=Array.isArray(rawUrls) ? rawUrls : [rawUrls];
  const combined={url:urls.join(' | '), text:'', links:[]};
  for(const url of urls){
    const page=await context.newPage();
    try{
      console.log(`Opening sports data batch: ${key} -> ${url}`);
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
      try{ await page.waitForLoadState('networkidle',{timeout:12000}); }catch{}
      await page.waitForTimeout(2500);
      const data=await page.evaluate(()=>{
        const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
        const links=[...document.querySelectorAll('a')].map(a=>({text:norm(a.innerText||a.textContent||''), href:a.href||''}))
          .filter(a=>a.href && /(sports\.yahoo\.|tw\.sports\.yahoo\.|cpbl\.com\.tw)/.test(a.href));
        return { text: document.body ? document.body.innerText : '', links };
      });
      combined.text += `\n\nURL:${url}\n${data.text||''}`;
      combined.links.push(...(data.links||[]));
      console.log(`Sports data page loaded: ${key}, links=${data.links.length}, textLen=${(data.text||'').length}`);
    }catch(e){ console.warn(`Sports data page failed ${key} ${url}:`, e.message); }
    finally{ await page.close().catch(()=>{}); }
    await new Promise(r=>setTimeout(r,350));
  }
  console.log(`Sports data batch loaded: ${key}, totalLinks=${combined.links.length}, totalTextLen=${combined.text.length}`);
  return combined;
}
async function buildYahooScoreboardCache(context, games){
  const keys=[...new Set(games.map(yahooLeagueKey).filter(Boolean))];
  const cache={};
  for(const k of keys){
    cache[k]=await fetchYahooScoreboard(context,k);
    await new Promise(r=>setTimeout(r,500));
  }
  return cache;
}
function yahooCandidateLinksFromScoreboard(game, board){
  const away=(game.analysis_json||{}).true_away || game.home;
  const home=(game.analysis_json||{}).true_home || game.away;
  const links=(board?.links||[]).filter(a=>{
    const hay=`${a.text} ${decodeURIComponent(a.href||'')}`;
    return textContainsTeam(hay,away) && textContainsTeam(hay,home);
  });
  const seen=new Set();
  return links.filter(x=>!seen.has(x.href)&&seen.add(x.href)).slice(0,3).map(x=>x.href);
}
function parseYahooPitcherStatsFromBlock(allText, pitcherName){
  const raw=String(allText||'').replace(/\s+/g,' ');
  const variants=teamTokens(pitcherName);
  for(const v of variants){
    const idx=raw.toLowerCase().indexOf(String(v).toLowerCase());
    if(idx<0) continue;
    const area=raw.slice(Math.max(0,idx-80), idx+260);
    // Yahoo 常見：G. HOLMES RHP 3.78 3 2 48 24 1.30 防禦率 勝 敗 三振 四壞 WHIP
    const after=area.slice(Math.max(0, area.toLowerCase().indexOf(String(v).toLowerCase())));
    const nums=[...after.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(m=>m[0]);
    if(nums.length>=6 && /防禦率|ERA|WHIP|勝|敗/.test(after)){
      return { ERA: nums[0], 勝投: nums[1], 敗投: nums[2], WHIP: nums[5], 近況: 'Yahoo 賽前頁已公布先發數據' };
    }
  }
  return null;
}
function extractCPBLTeamLine(allText, team){
  const area = strictSliceAround(allText, team, 520) || '';
  if(!area) return '待更新';
  const compact = cleanAnalysisText(area);
  const m = compact.match(/(\d{1,3}\s+\d{1,2}-\d{1,2}-\d{1,2}\s+\d(?:\.\d{2,3})?[^\n]{0,120})/);
  if(m) return m[1].replace(/\s+/g,' ').slice(0,120);
  return safeShortNote(area, [team, '近十場', '連勝', '連敗', '主場', '客場', '勝率']);
}
function extractCPBLPitcherFromToplist(allText, pitcherName){
  if(!pitcherName || pitcherName === '待更新') return null;
  const area = strictSliceAround(allText, pitcherName, 280) || '';
  if(!area) return null;
  const era = firstStrictNumber(area, [/防禦率ERA\s*[^\d]*(\d+(?:\.\d+)?)/, /防禦率\s*[^\d]*(\d+(?:\.\d+)?)/, /ERA\s*[^\d]*(\d+(?:\.\d+)?)/i]);
  const wins = firstStrictNumber(area, [/勝投W\s*[^\d]*(\d+)/, /勝投\s*[^\d]*(\d+)/]);
  const k = firstStrictNumber(area, [/奪三振\s*[^\d]*(\d+)/, /三振\s*[^\d]*(\d+)/]);
  const stats=[['ERA',era],['WHIP','待更新'],['勝投',wins],['敗投','待更新'],['近況', k !== '待更新' ? `CPBL 官方排行榜可見三振 ${k}，其餘投手細項需賽前頁確認` : 'CPBL 官方資料整理中']];
  return stats.some(x=>x[1] !== '待更新') ? stats : null;
}
function applyCPBLOfficialText(game, boardText){
  if(game.league !== 'CPBL' || !boardText) return false;
  const aj=game.analysis_json||{};
  const allText=cleanAnalysisText(boardText);
  const away=aj.true_away || game.home;
  const home=aj.true_home || game.away;
  let changed=false;
  const awayLine=extractCPBLTeamLine(allText, away);
  const homeLine=extractCPBLTeamLine(allText, home);
  if(awayLine !== '待更新' || homeLine !== '待更新'){
    aj.metrics=[
      ['本季戰績', awayLine, homeLine, 50, 50, '', ''],
      ['獨贏方向', game.money, `${game.confidence?.[0]||58}%`, game.confidence?.[0]||58, 100-(game.confidence?.[0]||58), '', ''],
      ['讓分方向', game.spread, `${game.confidence?.[1]||56}%`, game.confidence?.[1]||56, 100-(game.confidence?.[1]||56), '', ''],
      ['大小分方向', game.total, `${game.confidence?.[2]||55}%`, game.confidence?.[2]||55, 100-(game.confidence?.[2]||55), '', '']
    ];
    aj.recent=[
      {team:away, side:'客隊', items:[['近期/戰績', away, awayLine, '-']]},
      {team:home, side:'主隊', items:[['近期/戰績', home, homeLine, '-']]}
    ];
    changed=true;
  }
  if(game.sport==='baseball' && Array.isArray(aj.starters)){
    aj.starters=aj.starters.map(s=>{
      const stats=extractCPBLPitcherFromToplist(allText, s.name||'');
      if(stats){ changed=true; return {...s, stats}; }
      return s;
    });
  }
  if(changed){
    aj.detail_status='cpbl_official_enriched';
    aj.h2h = aj.h2h || [['近期對戰',[away,'-'],[home,'-'],'CPBL 官方戰績頁已補入本季/近期資訊，對戰細項依賽前頁更新']];
    aj.source_note=''; aj.data_sources=[];
    game.analysis_json=aj;
  }
  return changed;
}

function applyYahooScoreboardText(game, boardText){
  if(!boardText) return false;
  if(game.league === 'CPBL') return applyCPBLOfficialText(game, boardText);
  const aj=game.analysis_json||{};
  const allText=cleanAnalysisText(boardText);
  const away=aj.true_away || game.home;
  const home=aj.true_home || game.away;
  let changed=false;
  if(game.sport==='baseball' && Array.isArray(aj.starters)){
    aj.starters=aj.starters.map(s=>{
      const found=parseYahooPitcherStatsFromBlock(allText, s.name||'');
      if(found){ changed=true; return {...s, stats:[['ERA',found.ERA],['WHIP',found.WHIP],['勝投',found.勝投],['敗投',found.敗投],['近況',found.近況]]}; }
      return s;
    });
  }
  const recentAway=safeShortNote(strictSliceAround(allText, away, 520), [away,'RECENT GAMES','Recent Games','近況','最近','戰績','勝','敗']);
  const recentHome=safeShortNote(strictSliceAround(allText, home, 520), [home,'RECENT GAMES','Recent Games','近況','最近','戰績','勝','敗']);
  const h2h=safeShortNote(allText, ['TEAM MATCHUPS','Matchups','對戰','交手','歷史']);
  if(recentAway!=='待更新' || recentHome!=='待更新'){
    aj.recent=[
      {team:away, side:'客隊', items:[['近期', away, recentAway, '-']]},
      {team:home, side:'主隊', items:[['近期', home, recentHome, '-']]}
    ]; changed=true;
  }
  if(h2h!=='待更新') { aj.h2h=[['近期對戰',[away,'-'],[home,'-'],h2h]]; changed=true; }
  if(/TEAM COMPARISON|Team Comparison|Batting Average|Runs Scored|Home Runs|場均得分|命中率/.test(allText)){
    const metricNote = safeShortNote(allText, ['TEAM COMPARISON','Batting Average','Runs Scored','Home Runs','場均得分','命中率']);
    if(metricNote!=='待更新'){
      aj.metrics = [
        ['隊伍比較', metricNote, metricNote, 55, 45, '', ''],
        ['獨贏方向', game.money, `${game.confidence?.[0]||58}%`, game.confidence?.[0]||58, 100-(game.confidence?.[0]||58), '', ''],
        ['讓分方向', game.spread, `${game.confidence?.[1]||56}%`, game.confidence?.[1]||56, 100-(game.confidence?.[1]||56), '', ''],
        ['大小分方向', game.total, `${game.confidence?.[2]||55}%`, game.confidence?.[2]||55, 100-(game.confidence?.[2]||55), '', '']
      ]; changed=true;
    }
  }
  if(changed){ aj.detail_status='yahoo_scoreboard_batch_enriched'; aj.source_note=''; aj.data_sources=[]; game.analysis_json=aj; }
  return changed;
}



// ===== v87 individual game API layer =====
async function fetchJsonUrl(url, options = {}) {
  const res = await fetch(url, options);
  const txt = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${txt.slice(0, 300)}`);
  try { return txt ? JSON.parse(txt) : null; } catch { return null; }
}
const MLB_TEAM_IDS = new Map(Object.entries({
  '響尾蛇':109,'亞歷桑那':109,'勇士':144,'亞特蘭大':144,'金鶯':110,'巴爾的摩':110,'紅襪':111,'波士頓':111,
  '小熊':112,'芝加哥小熊':112,'紅人':113,'辛辛那提':113,'守護者':114,'印地安人':114,'克里夫蘭':114,
  '洛磯':115,'科羅拉多':115,'老虎':116,'底特律':116,'太空人':117,'休士頓':117,'皇家':118,'堪薩斯':118,
  '道奇':119,'洛杉磯道奇':119,'國民':120,'華盛頓':120,'大都會':121,'紐約大都會':121,'運動家':133,'運動人':133,
  '海盜':134,'匹茲堡':134,'教士':135,'聖地牙哥':135,'水手':136,'西雅圖':136,'巨人':137,'舊金山':137,
  '紅雀':138,'聖路易':138,'光芒':139,'坦帕灣':139,'遊騎兵':140,'德州':140,'藍鳥':141,'多倫多':141,
  '雙城':142,'明尼蘇達':142,'費城人':143,'費城':143,'白襪':145,'芝加哥白襪':145,'馬林魚':146,'邁阿密':146,
  '洋基':147,'紐約洋基':147,'釀酒人':158,'密爾瓦基':158,'天使':108,'洛杉磯天使':108
}).map(([k,v])=>[k,v]));
function mlbTeamId(name='') {
  const clean = cleanTeamName(name);
  for (const [k,v] of MLB_TEAM_IDS) if (clean.includes(k) || k.includes(clean)) return v;
  return null;
}
function gameApiDate(game) {
  const rawDay = game.raw_data?.raw_day_type || game.game_day_type || 'today';
  if (US_SHIFT_LEAGUES.has(game.league) && rawDay === 'tomorrow') return dateTW(1);
  return game.game_date || dateTW(0);
}
async function fetchMlbPitcherSeason(playerId, season) {
  if (!playerId) return null;
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=pitching&season=${season}`;
  const data = await fetchJsonUrl(url);
  const stat = data?.stats?.[0]?.splits?.[0]?.stat || null;
  if (!stat) return null;
  return {
    ERA: stat.era || '待更新',
    WHIP: stat.whip || '待更新',
    勝投: stat.wins != null ? String(stat.wins) : '待更新',
    敗投: stat.losses != null ? String(stat.losses) : '待更新',
    近況: `本季 ${stat.inningsPitched || '-'} 局，${stat.strikeOuts || '-'} 次三振，ERA ${stat.era || '待更新'}，WHIP ${stat.whip || '待更新'}`
  };
}
function applyPitcherStatsToStarter(starter, stats) {
  if (!starter || !stats) return;
  starter.stats = [
    ['ERA', stats.ERA || '待更新'],
    ['WHIP', stats.WHIP || '待更新'],
    ['勝投', stats.勝投 || '待更新'],
    ['敗投', stats.敗投 || '待更新'],
    ['近況', stats.近況 || '待更新']
  ];
}
async function fetchMlbTeamStats(teamId, season, group='hitting') {
  if (!teamId) return null;
  try {
    const url = `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=${group}&season=${season}`;
    const data = await fetchJsonUrl(url);
    return data?.stats?.[0]?.splits?.[0]?.stat || null;
  } catch (e) { console.warn(`MLB team stats failed team=${teamId} group=${group}:`, e.message); return null; }
}
async function enrichMLBOfficialStats(game) {
  if (game.league !== 'MLB') return false;
  const aj = game.analysis_json || {};
  const awayName = aj.true_away || game.home;
  const homeName = aj.true_home || game.away;
  const awayId = mlbTeamId(awayName);
  const homeId = mlbTeamId(homeName);
  if (!awayId || !homeId) { aj.api_status = 'mlb_team_id_not_matched'; game.analysis_json = aj; return false; }
  const date = gameApiDate(game);
  const season = date.slice(0,4);
  try {
    const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team`;
    const sched = await fetchJsonUrl(scheduleUrl);
    const games = (sched?.dates || []).flatMap(d=>d.games || []);
    const found = games.find(g => {
      const h = g?.teams?.home?.team?.id;
      const a = g?.teams?.away?.team?.id;
      return (h === homeId && a === awayId) || (h === awayId && a === homeId);
    });
    if (!found) { aj.api_status = `mlb_official_no_match_${date}`; game.analysis_json = aj; return false; }
    const homePitcher = found.teams?.home?.probablePitcher;
    const awayPitcher = found.teams?.away?.probablePitcher;
    const homeStarter = (aj.starters || []).find(s => s.team === homeName || s.role?.includes('主'));
    const awayStarter = (aj.starters || []).find(s => s.team === awayName || s.role?.includes('客'));
    if (homePitcher?.fullName && homeStarter) homeStarter.name = homePitcher.fullName;
    if (awayPitcher?.fullName && awayStarter) awayStarter.name = awayPitcher.fullName;
    const [homePStats, awayPStats, homeHit, awayHit, homePit, awayPit] = await Promise.all([
      fetchMlbPitcherSeason(homePitcher?.id, season).catch(()=>null),
      fetchMlbPitcherSeason(awayPitcher?.id, season).catch(()=>null),
      fetchMlbTeamStats(homeId, season, 'hitting'),
      fetchMlbTeamStats(awayId, season, 'hitting'),
      fetchMlbTeamStats(homeId, season, 'pitching'),
      fetchMlbTeamStats(awayId, season, 'pitching')
    ]);
    applyPitcherStatsToStarter(homeStarter, homePStats);
    applyPitcherStatsToStarter(awayStarter, awayPStats);
    const metricRows = [];
    const addMetric = (name, awayVal, homeVal) => {
      if (awayVal == null && homeVal == null) return;
      metricRows.push([name, awayVal ?? '待更新', homeVal ?? '待更新', 50, 50, '', '']);
    };
    addMetric('打擊率', awayHit?.avg, homeHit?.avg);
    addMetric('上壘率', awayHit?.obp, homeHit?.obp);
    addMetric('長打率', awayHit?.slg, homeHit?.slg);
    addMetric('全壘打', awayHit?.homeRuns, homeHit?.homeRuns);
    addMetric('得分', awayHit?.runs, homeHit?.runs);
    addMetric('防禦率', awayPit?.era, homePit?.era);
    addMetric('WHIP', awayPit?.whip, homePit?.whip);
    if (metricRows.length) aj.metrics = metricRows;
    aj.api_status = 'mlb_official_enriched';
    aj.detail_status = 'official_api_enriched';
    aj.source_note = '';
    aj.data_sources = [];
    game.analysis_json = aj;
    return true;
  } catch (e) { console.warn(`MLB official API enrichment failed ${awayName} vs ${homeName}:`, e.message); aj.api_status = 'mlb_official_failed'; game.analysis_json = aj; return false; }
}
function cleanJsonFromText(text='') {
  const raw = String(text).trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  return a >= 0 && b > a ? raw.slice(a,b+1) : raw;
}
async function openAiSummarizeGame(game) {
  if (!OPENAI_API_KEY) return false;
  const aj = game.analysis_json || {};
  const payload = {
    league: game.league, sport: game.sport, time: game.game_time,
    home: aj.true_home || game.away, away: aj.true_away || game.home,
    money: game.money, spread: game.spread, total: game.total,
    starters: aj.starters || [], core_players: aj.core_players || [], metrics: aj.metrics || [], recent: aj.recent || [], h2h: aj.h2h || []
  };
  const prompt = `你是台灣運彩賽事分析助理。請只根據提供的 JSON 資料整理，不要編造不存在的精準數字。輸出 JSON，欄位：summary,risk,picks{safest,main,second,confidence},support{money,spread,total},home_recent,away_recent,h2h_note。主推與副推不可相同。資料：${JSON.stringify(payload).slice(0,12000)}`;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.35, messages: [{role:'system', content:'你只輸出有效 JSON，不要 markdown。'}, {role:'user', content: prompt}] })
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(txt.slice(0,300));
    const data = JSON.parse(txt);
    const content = data?.choices?.[0]?.message?.content || '';
    const obj = JSON.parse(cleanJsonFromText(content));
    if (obj?.summary) {
      aj.search_intel = { ...(aj.search_intel || {}), ...obj, generated_at: nowISO(), ai_model: OPENAI_MODEL, api_based: true };
      if (obj.support) game.confidence = [obj.support.money || game.confidence?.[0] || 58, obj.support.spread || game.confidence?.[1] || 56, obj.support.total || game.confidence?.[2] || 55];
      game.analysis_json = aj;
      return true;
    }
  } catch (e) { console.warn(`OpenAI analysis failed ${game.league} ${game.away} vs ${game.home}:`, e.message); }
  return false;
}
async function enrichGamesWithApiLayer(games) {
  let officialHits = 0, aiHits = 0;
  for (const game of games) {
    if (await enrichMLBOfficialStats(game)) officialHits++;
    if (await openAiSummarizeGame(game)) aiHits++;
    await new Promise(r=>setTimeout(r,150));
  }
  console.log(`Individual API layer done. officialApiHits=${officialHits}, openAiAnalyses=${aiHits}. ${OPENAI_API_KEY ? 'OPENAI_API_KEY found' : 'OPENAI_API_KEY not set, using rule-based analysis only.'}`);
}

async function enrichGamesWithDetails(context, games){
  const limit = Math.min(SEARCH_ENRICH_LIMIT, games.length);
  if (!SEARCH_API_KEY) {
    console.warn('SEARCH_API_KEY not set; Google fallback search skipped. Yahoo scoreboard batch will still run.');
  } else {
    console.log(`SEARCH_PROVIDER = ${SEARCH_PROVIDER}`);
    if(SEARCH_PROVIDER === 'google') console.log(`Google Custom Search fallback enabled, GOOGLE_CSE_ID ${GOOGLE_CSE_ID ? 'found' : 'missing'}`);
  }

  // v85：先用 Yahoo scoreboard 批次頁抓資料，不吃 Google 搜尋額度。
  const yahooCache = await buildYahooScoreboardCache(context, games);
  let yahooBatchHits = 0;

  for (let i=0; i<games.length; i++) {
    const game = games[i];
    const key = yahooLeagueKey(game);
    const board = key ? yahooCache[key] : null;
    let detailPages = [];
    let searchRows = [];

    // 先嘗試用該聯盟 Yahoo scoreboard 文字直接補數據。
    if(board?.text && applyYahooScoreboardText(game, board.text)) yahooBatchHits++;

    // 再從 scoreboard 找疑似單場連結，點進去抓詳細頁；這也不吃 Google 搜尋次數。
    const yahooLinks = yahooCandidateLinksFromScoreboard(game, board);
    for(const url of yahooLinks){
      const text = await safePageText(context, url);
      if(text) detailPages.push({url, text});
      await new Promise(r=>setTimeout(r,250));
    }

    // 如果 Yahoo scoreboard 沒找到單場頁，才使用 Google 搜尋備援。
    if (!detailPages.length && i < limit && SEARCH_API_KEY) {
      searchRows = await searchIntelForGame(game);
      console.log(`Google fallback ${i+1}/${limit}: ${game.league} ${game.away} vs ${game.home}, results=${searchRows.length}`);
      detailPages = await fetchDetailTextsForGame(context, game, searchRows);
    }

    // 先用搜尋摘要/盤口模型建立每場獨立分析；沒有 key 也會用盤口模型產生不空白的分析。
    applySearchIntel(game, searchRows);

    // 再用 Yahoo / 玩運彩詳情頁文字嚴格抽取數據欄位。
    if(detailPages.length){
      const joined = detailPages.map(x=>`URL:${x.url}\n${x.text}`).join('\n\n');
      enrichGameFromTexts(game, joined, []);
      game.analysis_json.detail_pages = detailPages.map(x=>x.url).slice(0,4);
      game.analysis_json.detail_status = 'yahoo_detail_enriched';
    }
  }
  await enrichGamesWithApiLayer(games);
  console.log(`Yahoo scoreboard batch enrichment done. yahooBatchHits=${yahooBatchHits}, games=${games.length}, googleFallback=${SEARCH_API_KEY?limit:0}`);
  return games;
}


async function supabaseRequest(path, options = {}) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
  const res = await fetch(url, { ...options, headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt || `${res.status} ${res.statusText}`);
  try { return txt ? JSON.parse(txt) : null; } catch { return txt; }
}
async function writeSyncStatus(status, message, count = 0) {
  try { await supabaseRequest('daily_sync_status', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ status, message, games_count: count, source: 'v88-cpbl-official-ai', created_at: nowISO() }]) }); }
  catch(e) { console.warn('daily_sync_status not written:', e.message); }
}

function stripDailyRow(row) {
  const { raw_data, ...clean } = row;
  return clean;
}
async function writeRawSportsData(rows) {
  let runId = null;
  try {
    const run = await supabaseRequest('raw_sports_sync_runs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ source: 'github_actions', version: 'v87-individual-api-ai', status: 'success', total_games: rows.length, created_at: nowISO() }])
    });
    runId = Array.isArray(run) && run[0] ? run[0].id : null;
  } catch (e) { console.warn('raw_sports_sync_runs not written:', e.message); }

  if (!runId || !rows.length) return;
  const rawRows = rows.map(g => ({
    run_id: runId,
    game_date: g.game_date,
    game_day_type: g.game_day_type,
    game_status: g.game_status || 'upcoming',
    sport: g.sport,
    league: g.league,
    game_time: g.game_time,
    away: g.away,
    home: g.home,
    source_url: g.source_url,
    raw_text: g.raw_data?.raw_text || '',
    parsed_json: { ...g, raw_data: g.raw_data || {} },
    created_at: nowISO()
  }));
  try {
    await supabaseRequest('raw_sports_games', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rawRows) });
    console.log(`Raw data center saved ${rawRows.length} raw_sports_games rows.`);
  } catch (e) { console.warn('raw_sports_games not written:', e.message); }

  // SQL 統整層：若 Supabase 已建立 function，讓資料庫統一做二次整理；失敗不影響前台基本賽事。
  try {
    await supabaseRequest('rpc/normalize_raw_sports_games_v70_optional', { method: 'POST', body: JSON.stringify({ p_run_id: runId }) });
    console.log('Supabase normalize_raw_sports_games_v70_optional executed.');
  } catch (e) { console.warn('normalize_raw_sports_games_v70_optional skipped:', e.message); }
}
function dedupeGames(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = [row.game_day_type, row.sport, row.league, row.game_time, row.home, row.away].map(v => String(v || '').trim()).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
async function upsertDailyGames(rows) {
  // v87：每次只維護今日賽事顯示池；同步前先刪除 today 舊資料，再寫入本次乾淨資料。
  const cleanRows = dedupeGames(rows).map(stripDailyRow);
  try { await writeRawSportsData(cleanRows); } catch(e) { console.warn('raw data center skipped:', e.message); }
  await supabaseRequest(`daily_games?game_day_type=eq.today`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  }).catch(e=>console.warn('delete old display rows failed:', e.message));
  if (!cleanRows.length) { await writeSyncStatus('empty', 'v87 parsed 0 valid games', 0); return; }
  await supabaseRequest('daily_games', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(cleanRows)
  });
  await writeSyncStatus('success', `v87 synced ${cleanRows.length} valid games`, cleanRows.length);
}

async function main() {
  await waitUntilTaipeiDateReady();
  console.log(`Taiwan sync date: today=${dateTW(0)} (${mdTW(0)}). Single display pool enabled.`);
  const games = await scrapePlaySportWithBrowser();
  console.log(`Parsed valid games v87 individual api ai: ${games.length}`);
  console.log(games.slice(0, 60).map(g => `${g.game_day_type} ${g.league} ${g.game_time} ${g.away} vs ${g.home} | ${g.spread} | ${g.total}`).join('\n'));
  await upsertDailyGames(games);
  console.log(games.length ? `Synced ${games.length} valid games to Supabase daily_games.` : 'No valid games parsed for today display pool.');
}
main().catch(err => { console.error(err); process.exit(1); });
