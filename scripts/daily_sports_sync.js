import { chromium } from 'playwright';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in GitHub Secrets');

// v94：Yahoo 運動單場頁配對加強；用隊名別名 + 寬鬆候選連結補抓 TEAM MATCHUPS / RECENT GAMES
// 玩運彩只抓賽事與運彩盤口；Yahoo 運動用指定日期 scoreboard 補 MLB / CPBL 等數據；OpenAI 可選用來統整所有數據成 AI 分析。
const SEARCH_PROVIDER = (process.env.SEARCH_PROVIDER || 'off').toLowerCase();
const SEARCH_API_KEY = process.env.SEARCH_API_KEY || '';
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID || '';
// v112: 今日/明日全部照玩運彩 today/tomorrow 直讀；足球無建議不提參考率/無建議字樣；AI 文案強化每場差異。
const SEARCH_FALLBACK_ENABLED = String(process.env.SEARCH_FALLBACK_ENABLED || 'false').toLowerCase() === 'true';
const SEARCH_ENRICH_LIMIT = Number(process.env.SEARCH_ENRICH_LIMIT || 0);
const SEARCH_RESULTS_PER_QUERY = Number(process.env.SEARCH_RESULTS_PER_QUERY || 5);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-nano';
const API_SPORTS_KEY = process.env.API_SPORTS_KEY || ''; // 選填：日後可接 NBA/WNBA/足球付費資料 API
const SYNC_MODE = (process.env.SYNC_MODE || 'full').toLowerCase(); // full: 大同步；incremental: 每小時只檢查新增/盤口變動


const BASE_URL = 'https://www.playsport.cc/predict/games';
const TARGETS = [
  { allianceId: 1, label: 'MLB', sport: 'baseball', league: 'MLB' },
  { allianceId: 2, label: '日本職棒', sport: 'baseball', league: 'NPB' },
  { allianceId: 6, label: '中華職棒', sport: 'baseball', league: 'CPBL' },
  { allianceId: 9, label: '韓國職棒', sport: 'baseball', league: 'KBO' }, // 玩運彩韓棒分類使用 9；若改成 6 會和中職重複
  { allianceId: 3, label: 'NBA', sport: 'basketball', league: 'NBA' },
  { allianceId: 7, label: 'WNBA', sport: 'basketball', league: 'WNBA' },
  { allianceId: 94, label: '中國職籃', sport: 'basketball', league: 'CBA' },
  { allianceId: 4, label: '足球', sport: 'football', league: '足球' }
];
const SHIFT_LEAGUES = new Set();
const US_SHIFT_LEAGUES = SHIFT_LEAGUES;
const DISPLAY_DAY_TYPES = ['today','tomorrow'];
function shouldScrapePlaySport(target, dayType) {
  // v112：所有分類都照玩運彩 today / tomorrow 直接抓；今日就是今日，明日就是明日。
  return dayType === 'today' || dayType === 'tomorrow';
}
function displayDayLabelForLeague(league, dayType = 'today') { return dayType === 'tomorrow' ? '明日賽事' : '今日賽事'; }
function playSportUrl(target, dayType) {
  return `${BASE_URL}?allianceid=${target.allianceId}&gameday=${dayType}`;
}
function isValidMarketObj(x) {
  if (!x || !x.raw) return false;
  const raw = String(x.raw || '');
  if (/未開|待確認|請先登入|登入|預測賽事請先登入/i.test(raw)) return false;
  return typeof x.odds === 'number' || typeof x.line === 'number';
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
function addIsoDays(iso, offsetDays = 0) {
  const d = new Date(`${iso}T12:00:00+08:00`);
  d.setDate(d.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function isoDateUnique(list) { return [...new Set(list.filter(Boolean))]; }
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
    // 足球：不讓分屬於獨贏，不可塞到讓分。若玩運彩沒有真正讓球盤，就顯示無建議。
    if (spreadPick && spreadPick.line != null && Math.abs(Number(spreadPick.line)) > 0) {
      const team = spreadPick.side === '客' ? awayTeam : homeTeam;
      spread = `${team} ${displayLine(spreadPick.line)}`;
    } else {
      spread = '無建議';
    }
  } else if (spreadPick && spreadPick.line != null) {
    const team = spreadPick.side === '客' ? awayTeam : homeTeam;
    spread = `${team} ${displayLine(spreadPick.line)}`;
  }

  const totalPick = chooseLowerOdd(totalOver, totalUnder);
  const totalLine = totalOver?.line ?? totalUnder?.line;
  const total = totalLine != null ? `${totalPick?.side === '小' ? '小' : '大'} ${Math.abs(totalLine)}` : '大小待確認';

  const c0 = moneyPick?.odds ? Math.max(52, Math.min(76, Math.round(100 / moneyPick.odds))) : 60;
  const c1 = sport === 'football' && spread === '無建議' ? 50 : (spreadPick?.odds ? Math.max(52, Math.min(72, Math.round(100 / spreadPick.odds))) : 58);
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

  const marketOpen = [spreadAway, spreadHome, moneyAway, moneyHome, moneyDraw, totalOver, totalUnder].some(isValidMarketObj);
  const markets = marketOpen
    ? buildMarkets({ sport: target.sport, awayTeam, homeTeam, spreadAway, spreadHome, moneyAway, moneyHome, moneyDraw, totalOver, totalUnder })
    : { money: '未開盤', spread: '未開盤', total: '未開盤', confidence: [0, 0, 0] };
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
      parser_version: 'v119-keep-finished-cpbl-battle-info', true_away: awayTeam, true_home: homeTeam, battle_url: firstLinkByText(group,/對戰資訊|battle/), team_urls: teamLinksFromGroup(group),
      display_order: 'home_first', competition, sport_label: target.label, market_day_label: displayDayLabelForLeague(target.league, group.dayType || 'today'), market_open: marketOpen,
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
    const cellObj = td => {
      const st = window.getComputedStyle(td);
      // v108：玩運彩可投注盤通常會有 radio / input / label 圓點；已完賽列常只剩文字盤口沒有可點選項。
      const bettable = !!td.querySelector('input[type="radio"], input[type="checkbox"], label, .radio, .form-check-input, [role="radio"]');
      return {
        text: norm(td.innerText || td.textContent || ''),
        cls: [...td.classList].join(' '),
        color: st.color || '',
        rowspan: Number(td.getAttribute('rowspan') || '1'),
        colspan: Number(td.getAttribute('colspan') || '1'),
        bettable,
        links: [...td.querySelectorAll('a')].map(a=>({text:norm(a.innerText||a.textContent||''), href:a.href||''}))
      };
    };
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
    // 今日頁會包含已完賽賽事。v108 用「比分/完賽字樣 + 沒有可投注圓點」雙重判斷，避免誤刪未開盤但尚未開賽的賽事。
    return groups.map(g => {
      const text = g.rows.map(r=>r.text).join(' ');
      const cells = g.rows.flatMap(r=>r.cells);
      const hasBettable = cells.some(c => c.bettable && (/td-bank-bet|bet|bank/i.test(String(c.cls || '')) || /客|主|大|小|和|讓|受讓/.test(String(c.text || ''))));
      const green = cells.some(c => /rgb\(0,\s*128,\s*0\)|rgb\(34,\s*197,\s*94\)|green/i.test(c.color || '') && /完|結束|終了|已/.test(c.text || ''));
      const explicitFinished = /已完賽|完賽|比賽結束|賽事結束|終場|終了|Final/i.test(text);
      const scoreCellFinished = cells.some(c => String(c.cls || '').includes('scores') && /V\.?S\.?/i.test(c.text || '') && ((c.text || '').match(/\b\d+\b/g) || []).length >= 2);
      const genericScoreFinished = cells.some(c => {
        const t = norm(c.text || '').replace(/\s+/g, ' ');
        return /^\d{1,2}\s*(?:V\.?S\.?|vs)\s*\d{1,2}$/i.test(t);
      });
      const hasFinishedSignal = green || explicitFinished || scoreCellFinished || genericScoreFinished;
      return { ...g, has_bettable_option: hasBettable, finished: hasFinishedSignal && !hasBettable };
    });
  });
}
async function scrapePlaySportWithBrowser(options = {}) {
  const skipEnrichment = !!options.skipEnrichment;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const context = await browser.newContext({ locale: 'zh-TW', timezoneId: 'Asia/Taipei', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' });
  const games = [];
  const syncDate = dateTW(0);
  try {
    console.log(`=== 今日/明日賽事雙池 / today=${dateTW(0)} tomorrow=${dateTW(1)} ===`);
    for (const target of TARGETS) {
      for (const displayDay of DISPLAY_DAY_TYPES) {
        if (!shouldScrapePlaySport(target, displayDay)) {
          console.log(`skip scrape ${target.label} ${displayDay}: disabled.`);
          continue;
        }
        const page = await context.newPage();
        const url = playSportUrl(target, displayDay);
        try {
          console.log(`Opening PlaySport target: display=${displayDay} source=${displayDay} ${target.label} -> ${url}`);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch {}
          await page.waitForTimeout(1500);
          let groups = await extractGroups(page);
          const totalGroups = groups.length;
          // v108：今日頁所有球類都會移除『已結束且沒有投注選項』的場次；仍可下注、有白色圓點的場次會保留。
          // 未開盤但尚未開賽的場次不會因為沒有圓點就被刪除，會照規則顯示『未開盤』。
          // v119：今日賽事就算已開打/已完賽也要保留到當天結束。
          // 00:10 大同步時如果來源頁已經找不到該場，才會由 markMissingInactive 移除。
          const finishedDetected = groups.filter(g => g.finished).length;
          let parsed = 0, rejectedFinished = 0;
          for (const group of groups) {
            group.rawDayType = displayDay;
            group.dayType = displayDay;
            group.syncDate = displayDay === 'tomorrow' ? dateTW(1) : dateTW(0);
            const g = convertGroupToGame(group, target, page.url());
            if (g) {
              g.game_status = group.finished ? 'finished' : 'upcoming';
              g.game_day_type = displayDay;
              g.game_date = group.syncDate;
              games.push(g);
              parsed++;
            }
          }
          console.log(`${displayDay} ${target.label}: source=${displayDay}, groups=${totalGroups}, finished_detected_kept=${finishedDetected}, parsed=${parsed}, game_date=${syncDate}`);
        } catch(e) { console.warn(`${displayDay} ${target.label} scrape failed: ${e.message}`); }
        finally { await page.close().catch(()=>{}); }
      }
    }
  } finally { }
  if (skipEnrichment) {
    console.log('Incremental mode: detail enrichment skipped during scrape; only checking new games / odds changes.');
  } else {
    await enrichGamesWithDetails(context, games);
  }
  await context.close().catch(()=>{}); await browser.close().catch(()=>{});
  const map = new Map();
  for (const g of games) { const key = `${g.game_day_type}|${g.game_date}|${g.league}|${g.away}|${g.home}|${g.game_time}`; if (!map.has(key)) map.set(key, g); }
  return [...map.values()].sort((a,b)=>`${a.game_day_type}${a.league}${a.game_time}`.localeCompare(`${b.game_day_type}${b.league}${b.game_time}`));
}

async function safePageText(context, url){
  if(!url) return '';
  const page=await context.newPage();
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:9000});
    try{ await page.waitForLoadState('networkidle',{timeout:3500}); }catch{}
    await page.waitForTimeout(700);
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
  // v119：CPBL / NPB / KBO 都從該賽事列左側「對戰資訊」連結抓資料。
  // battle_url 來自同一個賽事 group，已先由賽事列的雙方隊伍解析確認，避免抓到其他場。
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

function isRealDetailValue(v){
  const t=String(v||'').trim();
  return t && !/待更新|資料整理中|未公布|尚未|^-$|未完全明確|主要判斷|無資料/.test(t);
}
function shortBattleNote(text, keys, fallback=''){
  const note = safeShortNote(text, keys);
  if(isRealDetailValue(note)) return note;
  const raw = cleanAnalysisText(String(text||'').replace(/\s+/g,' '));
  return fallback || raw.slice(0,72) || '待更新';
}
function strictPitcherStatEnhanced(allText, pitcherName, field){
  let v = strictPitcherStat(allText, pitcherName, field);
  if(isRealDetailValue(v)) return v;
  const area = strictSliceAround(allText, pitcherName, 420) || String(allText||'').slice(0, 1600);
  if(field === 'ERA') return firstStrictNumber(area, [/防(?:禦|御)率\s*[:：]?\s*(\d+(?:\.\d+)?)/, /ERA\s*[:：]?\s*(\d+(?:\.\d+)?)/i]);
  if(field === 'WHIP') return firstStrictNumber(area, [/WHIP\s*[:：]?\s*(\d+(?:\.\d+)?)/i]);
  if(field === '勝投') return firstStrictNumber(area, [/(\d+)\s*勝/, /勝\s*[:：]?\s*(\d+)/]);
  if(field === '敗投') return firstStrictNumber(area, [/(\d+)\s*敗/, /敗\s*[:：]?\s*(\d+)/]);
  if(field === '近況') {
    const note = shortBattleNote(area, [pitcherName,'近況','先發','最近','本季'], '先發資料已由玩運彩對戰資訊確認，詳細投手數據依來源更新。');
    return note.length > 92 ? note.slice(0,92) : note;
  }
  return '待更新';
}
function buildBattleInfoSummary(game, text){
  const aj=game.analysis_json||{};
  const away=aj.true_away || game.home;
  const home=aj.true_home || game.away;
  const raw=cleanAnalysisText(String(text||'').replace(/\s+/g,' '));
  const awayArea=strictSliceAround(raw, away, 520) || raw;
  const homeArea=strictSliceAround(raw, home, 520) || raw;
  const h2hArea = pickUsefulSentences(raw, ['對戰','交手','歷史','近年','近10場','近十場'], 2) || raw.slice(0,180);
  const awayRecent = shortBattleNote(awayArea, [away,'近況','近五場','最近','戰績','勝敗'], `${away} 近期戰況已由對戰資訊整理，仍需搭配盤口變化判斷。`);
  const homeRecent = shortBattleNote(homeArea, [home,'近況','近五場','最近','戰績','勝敗'], `${home} 近期戰況已由對戰資訊整理，仍需搭配盤口變化判斷。`);
  const h2hNote = shortBattleNote(h2hArea, ['對戰','交手','歷史','近10場','近十場'], '對戰資訊頁已讀取，歷史交手需以當日來源更新內容為準。');
  return {away,home,awayRecent,homeRecent,h2hNote,raw};
}
function applyPlaySportBattleInfo(game, battleText){
  if(!battleText || !/(CPBL|NPB|KBO|中華職棒|日本職棒|韓國職棒|對戰|近況|戰績|先發|投手|勝|敗)/i.test(battleText)) return false;
  if(!['CPBL','NPB','KBO'].includes(String(game.league||''))) return false;
  const aj=game.analysis_json||{};
  const info=buildBattleInfoSummary(game,battleText);
  aj.recent=[
    {team: info.away, side:'客隊', items:[['近況', info.away, info.awayRecent, '-']]},
    {team: info.home, side:'主隊', items:[['近況', info.home, info.homeRecent, '-']]}
  ];
  aj.h2h=[['對戰資訊', [info.away,'已讀取'], [info.home,'已讀取'], info.h2hNote]];
  // 棒球聯盟若對戰資訊有投手名稱，就用同一段文字補投手欄位；沒有就保留「先發尚未公布」。
  if(Array.isArray(aj.starters)){
    aj.starters=aj.starters.map(st=>{
      const name=String(st.name||'').trim();
      if(!name || /待公布|尚未/.test(name)) return st;
      return {...st, stats:[
        ['ERA', strictPitcherStatEnhanced(info.raw, name, 'ERA')],
        ['WHIP', strictPitcherStatEnhanced(info.raw, name, 'WHIP')],
        ['勝投', strictPitcherStatEnhanced(info.raw, name, '勝投')],
        ['敗投', strictPitcherStatEnhanced(info.raw, name, '敗投')],
        ['近況', strictPitcherStatEnhanced(info.raw, name, '近況')]
      ]};
    });
  }
  aj.metrics=[
    ['近期戰況', info.awayRecent, info.homeRecent, 50, 50, '', ''],
    ['歷史對戰', info.h2hNote, info.h2hNote, 50, 50, '', ''],
    ['盤口方向', game.spread || '盤口待確認', game.total || '大小待確認', 50, 50, '', ''],
    ['資料狀態', '對戰資訊已讀取', '對戰資訊已讀取', 50, 50, '', '']
  ];
  // 沒有真實傷員資料時不要顯示傷員區塊。
  delete aj.injuries;
  aj.detail_status='playsport_battle_info_enriched';
  aj.source_note=''; aj.data_sources=[];
  game.analysis_json=aj;
  return true;
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
  if (!SEARCH_FALLBACK_ENABLED) return [];
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
  return { money: moneyPct, spread: (game.sport === 'football' && /無建議|待確認|未開盤/.test(String(game.spread||''))) ? null : spreadPct, total: totalPct };
}
function chooseMainAndSecond(game, support) {
  const rows = [
    { key: '獨贏', pick: game.money || '獨贏待確認', pct: support.money || 0 },
    { key: '讓分', pick: game.spread || '讓分待確認', pct: support.spread || 0 },
    { key: '大小', pick: game.total || '大小待確認', pct: support.total || 0 }
  ].filter(x => !/待確認|待更新|無建議|未開盤/.test(x.pick));
  rows.sort((a,b)=>b.pct-a.pct);
  return { safest: rows[0]?.pick || game.money || game.spread || game.total || '待確認', main: rows[0]?.pick || '待確認', second: rows[1]?.pick || rows[0]?.pick || '待確認', confidence: rows[0]?.pct >= 70 ? '高' : rows[0]?.pct >= 62 ? '中高' : rows[0]?.pct >= 56 ? '中' : '低' };
}
function sentenceFromSearch(text, keys, fallback) {
  const s = cleanAnalysisText(pickUsefulSentences(text, keys, 2));
  if (s && s !== '待更新' && s.length >= 10) return s.slice(0, 180);
  return fallback;
}
function pickVariant(seed, arr) {
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return arr[h % arr.length];
}
function isGenericIntelText(text) {
  return /未完全明確|需配合臨場|資料整理模型|主要判斷|待更新|未公布|資料未完|尚未明確/.test(String(text || ''));
}

function footballTeamNote(team, side, seed='') {
  return pickVariant(`${seed}|${team}|${side}|footballTeamV114`, [
    `${team} 這邊要先看開局壓迫與防線回收速度，若前 20 分鐘能穩住節奏，${side} 方向會比較有延展空間。`,
    `${team} 的重點不是單純控球率，而是禁區前沿的推進效率；若臨場陣型偏保守，大小分要比勝負更謹慎。`,
    `${team} 近期判斷會以攻守轉換速度與定位球防守為主，若早段失球，原本盤口優勢會被明顯削弱。`,
    `${team} 這場需要觀察邊路突破和反擊品質，若無法製造足夠射門，獨贏方向即使看好也不宜追太深。`,
    `${team} 的盤口價值取決於臨場名單與主客場節奏，若水位沒有同步支持，建議保留部分空間等開賽前確認。`,
    `${team} 若能把比賽壓在自己熟悉的節奏，盤口容錯會提升；但若被迫拉快攻防轉換，大小分變數會增加。`
  ]);
}
function buildSearchBasedAnalysis(game, searchRows) {
  const aj = game.analysis_json || {};
  const away = aj.true_away || game.home;
  const home = aj.true_home || game.away;
  const searchText = cleanAnalysisText(compactSearchDoc(searchRows));
  const marketSeed = `${game.league}|${away}|${home}|${game.money}|${game.spread}|${game.total}|${game.game_time}`;
  const support = estimateMarketSupport(game, searchText);
  const picks = chooseMainAndSecond(game, support);
  const hasSearch = searchRows.length > 0;
  const recentAway = game.sport === 'football' ? footballTeamNote(away, '客隊', marketSeed) : sentenceFromSearch(searchText, [away, '近況', '近期', '戰績', '連勝', '連敗'], `${away} 近期狀態需配合臨場名單與盤口變化觀察。`);
  const recentHome = game.sport === 'football' ? footballTeamNote(home, '主隊', marketSeed) : sentenceFromSearch(searchText, [home, '近況', '近期', '戰績', '主場', '客場'], `${home} 近期狀態需配合臨場名單與盤口變化觀察。`);
  const h2hNote = sentenceFromSearch(searchText, ['對戰', '交手', '歷史', 'head to head', 'H2H'], `雙方歷史對戰資料未完全明確，本場先以盤口深淺與近期狀態作主要判斷。`);
  const noSpreadAdvice = game.sport === 'football' && /無建議|待確認|未開盤/.test(String(game.spread || ''));
  const spreadText = noSpreadAdvice ? '讓球盤尚未提供明確可用方向' : (game.spread || '讓分盤');
  const moneyText = game.money || '獨贏待確認';
  const totalText = game.total || '大小待確認';
  const sportTone = game.sport === 'football'
    ? pickVariant(marketSeed + '|sportToneV113', [
        `足球盤最怕和局與早段紅黃牌改變節奏，本場若${totalText}偏低，進球效率會比控球率更關鍵。`,
        `足球賽事要先看盤口是否給出明確讓球空間；若讓球方向不明，獨贏與大小分會是比較主要的觀察方向。`,
        `此類足球盤通常要防上半場節奏過慢，若臨場水位沒有明顯往主隊傾斜，追深盤要保守。`,
        `本場足球盤要把和局風險放進去看，若兩隊前場效率都不穩，大小分比獨贏更容易出現臨場變化。`,
        `若盤口主要集中在獨贏與大小分，代表市場對讓球差距沒有明確共識，下注時應避免把勝負方向放得太滿。`,
        `足球臨場最怕陣型改保守，若開賽前總分盤沒有上修，進球期待值就不宜抓得太高。`
      ])
    : game.sport === 'basketball'
      ? pickVariant(marketSeed, [
          `籃球盤口受節奏、外線手感與輪休影響很大，讓分與大小分要一起看，不能只看單邊人氣。`,
          `若大小分盤偏高，代表市場預期回合數不低；臨場若主力名單有變，大小分方向要重新確認。`,
          `籃球讓分若落在中深盤，強隊不只要贏球，還要避免末節垃圾時間被追分。`
        ])
      : pickVariant(marketSeed, [
          `棒球盤口重點在先發投手、牛棚使用量與近況火力，若臨場投手異動，讓分與大小分都要重新評估。`,
          `棒球讓分容錯較低，若盤口偏向一方但大小分沒有同步放大，代表市場可能更看重投手壓制。`,
          `若雙方牛棚近期消耗偏高，後段失分風險會放大，大小分比獨贏更需要臨場確認。`
        ]);
  const timeNote = game.game_time ? `開賽時間落在 ${game.game_time}` : '開賽時間仍以盤口頁為準';
  const summaryPool = [
    `${game.league} 這場 ${away} 對 ${home}，${timeNote}；盤口目前給出「${moneyText}、${spreadText}、${totalText}」，模型先把「${picks.main}」排在主觀察。`,
    `這場不是單看人氣就能下，${away} 與 ${home} 的盤口重點在 ${spreadText} 是否合理；目前主推「${picks.main}」，副推則用「${picks.second}」分散風險。`,
    `以 ${away} vs ${home} 的盤型來看，獨贏與大小分方向沒有完全重疊，若臨場盤口維持不變，系統會優先考慮「${picks.main}」。`,
    `${game.league} 本場的核心是盤口深度：${game.spread || '讓分未開'} 搭配 ${totalText}，若沒有反向變盤，「${picks.main}」比其他方向更有連貫性。`,
    `目前已開盤資訊顯示，${home} 與 ${away} 的對位會受臨場名單影響，但從盤口結構看，「${picks.main}」仍是比較明確的第一順位。`,
    `這場 ${away} 作客、${home} 主場，模型會把開賽時間、讓分深度與大小分位置一起看；目前結論偏向「${picks.main}」，不建議三盤全押。`,
    `若只看單一盤容易誤判，${moneyText} 與 ${totalText} 要交叉確認；本場暫以「${picks.main}」作為主推方向。`
  ];
  const searchedLine = hasSearch && searchText.length >= 20 ? ` 已整理到的公開資料會優先影響近況判斷，但精準數字仍以已抓到欄位為準。` : '';
  const summary = pickVariant(marketSeed + 'summaryV113', summaryPool) + searchedLine;
  const riskPool = [
    `${sportTone} 若臨場盤口從「${spreadText}」突然改深，${picks.main} 的過盤壓力會提高，建議降低注碼。`,
    `本場最大風險是 ${totalText} 與 ${spreadText} 方向不同步；若臨場兩盤互相打架，就只保留主推。`,
    `若賽前名單、先發、天候或輪休有異動，${away} vs ${home} 的判斷要重新看，現在結論只適用目前盤口。`,
    `${picks.main} 雖然是目前第一順位，但若接近開賽前投注選項縮盤或關盤，代表市場不確定性升高。`,
    `如果 ${moneyText} 與 ${spreadText} 的方向出現反向修正，這場不要硬追副推，等臨場確認。`,
    `${away} 與 ${home} 若開局節奏和預期不同，${totalText} 會最先受影響，大小分方向要特別保守。`,
    `此場風險不在有沒有方向，而是在盤口是否已經反映過多期待；若水位被拉低，主推價值會被壓縮。`
  ];
  const risk = pickVariant(marketSeed + 'riskV113', riskPool);
  return {
    summary, away_recent: recentAway, home_recent: recentHome, h2h_note: h2hNote, risk,
    support,
    picks,
    search_available: hasSearch,
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
  // v111：搜尋摘要只用於 AI 文案，不再塞進「近期賽況 / 歷史對戰」欄位。
  // 這兩區只顯示官方 API 或 Yahoo 單場頁解析到的結構化資料，避免出現假資料或擠在格子內。
  aj.recent = Array.isArray(aj.recent) ? aj.recent : [];
  aj.h2h = Array.isArray(aj.h2h) ? aj.h2h : [];
  aj.metrics = [
    ['獨贏方向', game.money, `${intel.support.money}%`, intel.support.money, 100-intel.support.money, '盤口/搜尋', '模型'],
    ...((game.sport === 'football' && /無建議|待確認|未開盤/.test(String(game.spread||''))) ? [] : [['讓分方向', game.spread, `${intel.support.spread}%`, intel.support.spread, 100-intel.support.spread, '盤口/搜尋', '模型']]),
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
  if(injuryAway !== '待更新' || injuryHome !== '待更新') aj.injuries = [[away,'傷員狀況',injuryAway,'-'],[home,'傷員狀況',injuryHome,'-']];

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

function yahooDateForLeagueKey(key){
  // CPBL 依台灣日期；MLB 資料常以美國/台灣跨日呈現，會用多日期備援，但不是每場都 Google。
  if(key === 'MLB') return dateTW(1);
  return dateTW(0);
}
function yahooDateCandidatesForLeagueKey(key){
  if(key === 'MLB'){
    // 系列賽同隊可能連打三天；載入今天、明天、後天 scoreboard，後續用隊名+時間評分選正確單場。
    return [...new Set([dateTW(0), dateTW(1), dateTW(2)])];
  }
  return [yahooDateForLeagueKey(key)];
}
function yahooScoreboardUrls(key){
  const ds = yahooDateCandidatesForLeagueKey(key);
  const path = { MLB:'mlb', NBA:'nba', WNBA:'wnba', football:'soccer', CPBL:'cpbl' }[key];
  if(!path) return [];
  return ds.map(d=>`https://tw.sports.yahoo.com/${path}/scoreboard/?date=${d}`);
}
function yahooLeagueKey(game){
  if(game.league === 'MLB') return 'MLB';
  if(game.league === 'CPBL') return 'CPBL';
  if(game.league === 'NBA') return 'NBA';
  if(game.league === 'WNBA') return 'WNBA';
  if(game.sport === 'football') return 'football';
  return '';
}
const TEAM_ALIASES = {
  // MLB 中文常見別名 / Yahoo 顯示名
  '勇士':['勇士','亞特蘭大','Braves','ATL','Atlanta'], '紅人':['紅人','辛辛那提','Reds','CIN','Cincinnati'],
  '洋基':['洋基','紐約洋基','Yankees','NYY'], '道奇':['道奇','洛杉磯道奇','Dodgers','LAD'],
  '紅襪':['紅襪','波士頓','Red Sox','BOS'], '大都會':['大都會','紐約大都會','Mets','NYM'],
  '國民':['國民','華盛頓','Nationals','WSH'], '小熊':['小熊','芝加哥小熊','Cubs','CHC'],
  '費城人':['費城人','費城','Phillies','PHI'], '馬林魚':['馬林魚','邁阿密','Marlins','MIA'],
  '太空人':['太空人','休士頓','Astros','HOU'], '遊騎兵':['遊騎兵','德州','Rangers','TEX'],
  '教士':['教士','聖地牙哥','Padres','SD'], '巨人':['巨人','舊金山','Giants','SF'],
  '天使':['天使','洛杉磯天使','Angels','LAA'], '老虎':['老虎','底特律','Tigers','DET'],
  '藍鳥':['藍鳥','多倫多','Blue Jays','TOR'], '海盜':['海盜','匹茲堡','Pirates','PIT'],
  '水手':['水手','西雅圖','Mariners','SEA'], '皇家':['皇家','堪薩斯','Royals','KC'],
  '雙城':['雙城','明尼蘇達','Twins','MIN'], '釀酒人':['釀酒人','密爾瓦基','Brewers','MIL'],
  '紅雀':['紅雀','聖路易','Cardinals','STL'], '白襪':['白襪','芝加哥白襪','White Sox','CWS'],
  '光芒':['光芒','坦帕灣','Rays','TB'], '洛磯':['洛磯','科羅拉多','Rockies','COL'],
  '守護者':['守護者','克里夫蘭','Guardians','CLE'], '響尾蛇':['響尾蛇','亞利桑那','Diamondbacks','ARI'],
  // CPBL
  '統一':['統一','統一獅','Uni Lions','Lions'], '味全':['味全','味全龍','Dragons'],
  '中信':['中信','中信兄弟','兄弟','Brothers'], '兄弟':['兄弟','中信兄弟','Brothers'],
  '富邦':['富邦','富邦悍將','Guardians'], '樂天':['樂天','樂天桃猿','桃猿','Monkeys'],
  '台鋼':['台鋼','台鋼雄鷹','雄鷹','Hawks']
};
function teamTokens(name=''){
  const t=cleanTeamName(name);
  const arr=[t, ...(TEAM_ALIASES[t]||[])];
  // 若隊名包含空白或前綴，補最後詞 / 去除城市詞提高 Yahoo 配對率。
  if(/[A-Za-z]/.test(t)){
    const parts=t.split(/\s+/).filter(Boolean);
    if(parts.length) arr.push(parts[parts.length-1]);
  }
  for(const [k,v] of Object.entries(TEAM_ALIASES)){
    if(t.includes(k) || v.some(a=>String(a).toLowerCase()===t.toLowerCase())) arr.push(k, ...v);
  }
  return [...new Set(arr.map(x=>String(x||'').trim()).filter(x=>x && x.length>=2))];
}
function textContainsTeam(text, team){
  const raw=String(text||'').toLowerCase();
  return teamTokens(team).some(tok=>raw.includes(tok.toLowerCase()));
}
function timeToMinutes(t=''){
  const m=String(t||'').match(/(AM|PM)?\s*(\d{1,2}):(\d{2})/i);
  if(!m) return null;
  let h=Number(m[2]), min=Number(m[3]);
  const ap=(m[1]||'').toUpperCase();
  if(ap==='PM' && h<12) h+=12;
  if(ap==='AM' && h===12) h=0;
  return h*60+min;
}
function circularMinuteDiff(a,b){
  if(a==null || b==null) return null;
  const d=Math.abs(a-b);
  return Math.min(d, 1440-d);
}
function extractYahooTimes(text=''){
  const raw=String(text||'');
  const out=[];
  const patterns=[/(?:上午|AM)\s*(\d{1,2}):(\d{2})/ig,/(?:下午|PM)\s*(\d{1,2}):(\d{2})/ig,/(AM|PM)\s*(\d{1,2}):(\d{2})/ig];
  for(const re of patterns){
    let m;
    while((m=re.exec(raw))){
      let token=m[0].replace('上午','AM').replace('下午','PM');
      out.push(timeToMinutes(token));
    }
  }
  return out.filter(x=>x!=null);
}
function yahooTimeScore(game, text=''){
  const gm=timeToMinutes(game.game_time||'');
  const times=extractYahooTimes(text);
  if(gm==null || !times.length) return {score:0, diff:null};
  const diff=Math.min(...times.map(t=>circularMinuteDiff(gm,t)).filter(x=>x!=null));
  if(diff<=30) return {score:30, diff};
  if(diff<=90) return {score:18, diff};
  if(diff<=150) return {score:8, diff};
  return {score:-25, diff};
}
function yahooMatchScore(game, text=''){
  const aj=game.analysis_json||{};
  const away=aj.true_away || game.home;
  const home=aj.true_home || game.away;
  let score=0;
  if(textContainsTeam(text,away)) score+=35;
  if(textContainsTeam(text,home)) score+=35;
  if(score<70) return {score, diff:null, teams:false};
  const ts=yahooTimeScore(game,text);
  score+=ts.score;
  return {score, diff:ts.diff, teams:true};
}
function hasMeaningfulPitcherData(game){
  const aj=game.analysis_json||{};
  if(!Array.isArray(aj.starters)) return false;
  return aj.starters.some(st => Array.isArray(st.stats) && st.stats.some(([k,v]) => {
    const key=String(k||''); const val=String(v||'').trim();
    return /ERA|WHIP|勝投|敗投|防禦率/.test(key) && val && !/待更新|未公布|尚未/.test(val);
  }));
}
function markStartersPendingIfEmpty(game){
  const aj=game.analysis_json||{};
  if(!Array.isArray(aj.starters) || hasMeaningfulPitcherData(game)) return;
  aj.starters=aj.starters.map(s=>({
    ...s,
    name: (s.name && !/待更新/.test(s.name)) ? s.name : '先發尚未公布',
    stats: [['狀態','先發尚未公布']]
  }));
  aj.detail_status = aj.detail_status || 'pitchers_pending';
  game.analysis_json=aj;
}
async function fetchYahooScoreboard(context, key){
  const urls=yahooScoreboardUrls(key);
  if(!urls.length) return {url:'', text:'', links:[]};
  const combined={url:urls.join(' | '), text:'', links:[]};
  for(const url of urls){
    const page=await context.newPage();
    try{
      console.log(`Opening sports data batch: ${key} -> ${url}`);
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});
      try{ await page.waitForLoadState('networkidle',{timeout:5000}); }catch{}
      await page.waitForTimeout(700);
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
  // v96：只對真的有欄位可補的 MLB / CPBL 抓 Yahoo scoreboard。
  // 足球、NBA、WNBA 不再進 Yahoo detail，避免 workflow 被大量場次拖到一小時。
  const keys=[...new Set(games.map(yahooLeagueKey).filter(k => k === 'MLB' || k === 'CPBL'))];
  const cache={};
  for(const k of keys){
    cache[k]=await fetchYahooScoreboard(context,k);
    await new Promise(r=>setTimeout(r,250));
  }
  return cache;
}
function yahooCandidateLinksFromScoreboard(game, board){
  const all=(board?.links||[]).filter(a=>a.href && /tw\.sports\.yahoo\.com/.test(a.href));
  const scored=[];
  for(const a of all){
    const h=a.href||'';
    if(/scoreboard|standings|teams|players|news|video|fantasy|betting/i.test(h)) continue;
    if(game.league==='MLB' && !/\/mlb\//i.test(h)) continue;
    if(game.league==='CPBL' && !/\/cpbl\//i.test(h)) continue;
    const hay=`${a.text||''} ${decodeURIComponent(h)}`;
    const ms=yahooMatchScore(game, hay);
    if(ms.score>=45) scored.push({href:h, score:ms.score, text:a.text||''});
  }
  const seen=new Set();
  return scored.sort((a,b)=>b.score-a.score).filter(x=>!seen.has(x.href)&&seen.add(x.href)).slice(0,5).map(x=>x.href);
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
    // CPBL 若沒有真正對戰紀錄，不硬塞假歷史對戰；前台會自動隱藏。
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
  // v113：MLB 不再從整個 Yahoo scoreboard 文字直接抽投手數據。
  // scoreboard 同一天會有很多場，容易把 A 場投手數據套到 B 場，造成兩邊數字一樣。
  // MLB 投手數據只使用官方 MLB Stats API 或已通過隊名+時間配對的單場頁。
  if(game.sport==='baseball' && game.league !== 'MLB' && Array.isArray(aj.starters)){
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
  // v111：Yahoo 整頁文字抓到的 TEAM MATCHUPS 標題不一定是結構化對戰紀錄，不直接塞入 H2H。
  if(game.league !== 'MLB' && /TEAM COMPARISON|Team Comparison|Batting Average|Runs Scored|Home Runs|場均得分|命中率/.test(allText)){
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
  '洛磯':115,'落磯':115,'科羅拉多':115,'Rockies':115,'Colorado':115,'老虎':116,'底特律':116,'Tigers':116,'Detroit':116,'DET':116,'太空人':117,'休士頓':117,'皇家':118,'堪薩斯':118,
  '道奇':119,'洛杉磯道奇':119,'國民':120,'華盛頓':120,'大都會':121,'紐約大都會':121,'運動家':133,'運動人':133,
  '海盜':134,'匹茲堡':134,'教士':135,'聖地牙哥':135,'水手':136,'西雅圖':136,'巨人':137,'舊金山':137,'Giants':137,'San Francisco':137,
  '紅雀':138,'聖路易':138,'光芒':139,'坦帕灣':139,'遊騎兵':140,'德州':140,'藍鳥':141,'多倫多':141,
  '雙城':142,'明尼蘇達':142,'費城人':143,'費城':143,'白襪':145,'芝加哥白襪':145,'White Sox':145,'Chicago White Sox':145,'CWS':145,'馬林魚':146,'邁阿密':146,
  '洋基':147,'紐約洋基':147,'釀酒人':158,'密爾瓦基':158,'天使':108,'洛杉磯天使':108
}).map(([k,v])=>[k,v]));
function mlbTeamId(name='') {
  const clean = cleanTeamName(name);
  for (const [k,v] of MLB_TEAM_IDS) if (clean.includes(k) || k.includes(clean)) return v;
  return null;
}
function gameApiDate(game) {
  // v112：MLB 也照該場 game_date 對應，不再用搬移邏輯推日期。
  return game.game_date || (game.game_day_type === 'tomorrow' ? dateTW(1) : dateTW(0));
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

function pitcherStatsSignature(stats){
  if(!stats) return '';
  return [stats.ERA, stats.WHIP, stats.勝投, stats.敗投].map(v=>String(v||'').trim()).join('|');
}
function isSuspiciousSamePitcherStats(aName,bName,aStats,bStats){
  if(!aStats || !bStats) return false;
  const sigA=pitcherStatsSignature(aStats), sigB=pitcherStatsSignature(bStats);
  if(!sigA || sigA.includes('待更新') || sigA !== sigB) return false;
  return cleanTeamName(aName||'') !== cleanTeamName(bName||'');
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

function mlbGameWinnerLabel(game, awayId, homeId) {
  const aScore = game?.teams?.away?.score;
  const hScore = game?.teams?.home?.score;
  if (aScore == null || hScore == null) return '-';
  if (aScore === hScore) return '平';
  const winAway = aScore > hScore;
  const ourAway = game?.teams?.away?.team?.id === awayId;
  const ourHome = game?.teams?.home?.team?.id === homeId;
  if (winAway && ourAway) return '客勝';
  if (!winAway && ourHome) return '主勝';
  return winAway ? '客勝' : '主勝';
}
function mlbDisplayPair(game) {
  const a = game?.teams?.away?.team?.name || game?.teams?.away?.team?.teamName || '客隊';
  const h = game?.teams?.home?.team?.name || game?.teams?.home?.team?.teamName || '主隊';
  const as = game?.teams?.away?.score;
  const hs = game?.teams?.home?.score;
  return { away:a, home:h, awayScore: as ?? '-', homeScore: hs ?? '-' };
}
function mlbGameDateTW(game) {
  if (!game?.gameDate) return '';
  return new Intl.DateTimeFormat('zh-TW', { timeZone:'Asia/Taipei', month:'2-digit', day:'2-digit' }).format(new Date(game.gameDate));
}
async function fetchMlbH2HAndRecent(awayId, homeId, baseDate) {
  const startDate = addIsoDays(baseDate, -210);
  const endDate = addIsoDays(baseDate, 1);
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${awayId}&opponentId=${homeId}&startDate=${startDate}&endDate=${endDate}&hydrate=team`;
  const data = await fetchJsonUrl(url).catch(e => { console.warn('MLB H2H schedule failed:', e.message); return null; });
  const games = (data?.dates || []).flatMap(d => d.games || []).filter(g => g?.status?.abstractGameState === 'Final' || g?.status?.detailedState === 'Final');
  const sorted = games.sort((a,b)=>new Date(b.gameDate)-new Date(a.gameDate));
  const h2h = sorted.slice(0,6).map(g => {
    const p = mlbDisplayPair(g);
    return [mlbGameDateTW(g), [p.away, String(p.awayScore)], [p.home, String(p.homeScore)], mlbGameWinnerLabel(g, awayId, homeId)];
  });
  return h2h;
}
async function fetchMlbTeamRecent(teamId, teamName, baseDate) {
  const startDate = addIsoDays(baseDate, -35);
  const endDate = addIsoDays(baseDate, -1);
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&startDate=${startDate}&endDate=${endDate}&hydrate=team`;
  const data = await fetchJsonUrl(url).catch(e => { console.warn(`MLB recent schedule failed ${teamName}:`, e.message); return null; });
  const games = (data?.dates || []).flatMap(d => d.games || []).filter(g => g?.status?.abstractGameState === 'Final' || g?.status?.detailedState === 'Final').sort((a,b)=>new Date(b.gameDate)-new Date(a.gameDate)).slice(0,5);
  const items = games.map(g => {
    const isAway = g?.teams?.away?.team?.id === teamId;
    const opp = isAway ? (g?.teams?.home?.team?.teamName || g?.teams?.home?.team?.name || '對手') : (g?.teams?.away?.team?.teamName || g?.teams?.away?.team?.name || '對手');
    const myScore = isAway ? g?.teams?.away?.score : g?.teams?.home?.score;
    const oppScore = isAway ? g?.teams?.home?.score : g?.teams?.away?.score;
    const result = myScore > oppScore ? '贏' : myScore < oppScore ? '輸' : '平';
    return [mlbGameDateTW(g), `${isAway ? '@' : 'vs'} ${opp}`, `${myScore ?? '-'} - ${oppScore ?? '-'}`, result];
  });
  return { team: teamName, side:'近期', items };
}

async function enrichMLBOfficialStats(game) {
  if (game.league !== 'MLB') return false;
  const aj = game.analysis_json || {};
  const awayName = aj.true_away || game.home;
  const homeName = aj.true_home || game.away;
  const awayId = mlbTeamId(awayName);
  const homeId = mlbTeamId(homeName);
  if (!awayId || !homeId) { aj.api_status = 'mlb_team_id_not_matched'; game.analysis_json = aj; return false; }
  const baseDate = gameApiDate(game);
  const candidateDates = isoDateUnique([baseDate, addIsoDays(baseDate, -1), addIsoDays(baseDate, 1)]);
  const season = baseDate.slice(0,4);
  try {
    let allGames = [];
    for (const date of candidateDates) {
      const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team`;
      const sched = await fetchJsonUrl(scheduleUrl).catch(e => { console.warn(`MLB schedule failed ${date}:`, e.message); return null; });
      allGames.push(...((sched?.dates || []).flatMap(d=>d.games || []).map(g=>({...g, _apiDate: date}))));
    }
    const gm = timeToMinutes(game.game_time || '');
    const apiMinutesTW = (g) => {
      if (!g?.gameDate) return null;
      const str = new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Taipei', hour:'2-digit', minute:'2-digit', hour12:true }).format(new Date(g.gameDate));
      return timeToMinutes(str.replace('AM','AM ').replace('PM','PM '));
    };
    const candidates = allGames.map(g => {
      const h = g?.teams?.home?.team?.id;
      const a = g?.teams?.away?.team?.id;
      const exact = (h === homeId && a === awayId);
      const reversed = (h === awayId && a === homeId);
      if (!exact && !reversed) return null;
      const diff = circularMinuteDiff(gm, apiMinutesTW(g));
      let score = exact ? 80 : 55;
      if (diff != null) score += diff <= 30 ? 35 : diff <= 90 ? 22 : diff <= 150 ? 8 : -35;
      if (g._apiDate === baseDate) score += 12;
      return { g, score, diff, exact, reversed };
    }).filter(Boolean).sort((a,b)=>b.score-a.score);
    const best = candidates[0];
    const found = best?.score >= 70 ? best.g : null;
    if (!found) { aj.api_status = `mlb_official_no_match_${candidateDates.join(',')}`; game.analysis_json = aj; return false; }
    console.log(`MLB official matched: ${awayName} vs ${homeName}, date=${found._apiDate}, score=${best.score}, timeDiff=${best.diff ?? 'NA'}`);
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
    if (isSuspiciousSamePitcherStats(homePitcher?.fullName, awayPitcher?.fullName, homePStats, awayPStats)) {
      console.warn(`MLB pitcher stats suspiciously identical for different pitchers: ${homePitcher?.fullName} / ${awayPitcher?.fullName}; keeping pitchers pending to avoid wrong mirrored data.`);
    } else {
      applyPitcherStatsToStarter(homeStarter, homePStats);
      applyPitcherStatsToStarter(awayStarter, awayPStats);
    }
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
    const [h2hRows, awayRecent, homeRecent] = await Promise.all([
      fetchMlbH2HAndRecent(awayId, homeId, baseDate).catch(()=>[]),
      fetchMlbTeamRecent(awayId, awayName, baseDate).catch(()=>null),
      fetchMlbTeamRecent(homeId, homeName, baseDate).catch(()=>null)
    ]);
    if (Array.isArray(h2hRows) && h2hRows.length) aj.h2h = h2hRows;
    const recentBlocks = [awayRecent, homeRecent].filter(x=>x && Array.isArray(x.items) && x.items.length);
    if (recentBlocks.length) aj.recent = recentBlocks;
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
    markStartersPendingIfEmpty(game);
    if (await openAiSummarizeGame(game)) aiHits++;
    await new Promise(r=>setTimeout(r,120));
  }
  console.log(`Individual API layer done. officialApiHits=${officialHits}, openAiAnalyses=${aiHits}. ${OPENAI_API_KEY ? 'OPENAI_API_KEY found' : 'OPENAI_API_KEY not set, using rule-based analysis only.'}`);
}

async function enrichGamesWithDetails(context, games){
  const limit = Math.min(SEARCH_ENRICH_LIMIT, games.length);
  if (!SEARCH_FALLBACK_ENABLED) {
    console.log('Search fallback disabled in v95; using PlaySport + Yahoo Sports scoreboard only.');
  } else if (!SEARCH_API_KEY) {
    console.warn('SEARCH_API_KEY not set; search fallback skipped. Yahoo scoreboard batch will still run.');
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
      if(text){
        const ms=yahooMatchScore(game, text);
        // MLB 系列賽同隊可能連打多天，必須隊名符合且時間不能差太遠；若頁面沒有時間，允許但分數要足夠。
        const timeOk = ms.diff == null || ms.diff <= 150;
        if(ms.teams && ms.score >= 60 && timeOk) detailPages.push({url, text, matchScore:ms.score, timeDiff:ms.diff});
      }
      await new Promise(r=>setTimeout(r,180));
    }
    detailPages.sort((a,b)=>(b.matchScore||0)-(a.matchScore||0));
    detailPages=detailPages.slice(0,1);

    // CPBL / NPB / KBO：玩運彩的「對戰資訊」才是主要補資料來源。
    // 不需要固定賽事編碼，因為 battle_url 是從該場賽事列直接抓到的。
    const ajForBattle = game.analysis_json || {};
    if(['CPBL','NPB','KBO'].includes(String(game.league||'')) && ajForBattle.battle_url){
      const battleText = await safePageText(context, ajForBattle.battle_url);
      if(battleText){
        detailPages.push({url: ajForBattle.battle_url, text: battleText, matchScore: 95, timeDiff: 0, source: 'playsport_battle'});
        applyPlaySportBattleInfo(game, battleText);
        console.log(`PlaySport battle info enriched: ${game.league} ${game.home} vs ${game.away}`);
      }
      await new Promise(r=>setTimeout(r,180));
    }

    // 如果 Yahoo scoreboard 沒找到單場頁，才使用 Google 搜尋備援。
    if (!detailPages.length && SEARCH_FALLBACK_ENABLED && i < limit && SEARCH_API_KEY) {
      searchRows = await searchIntelForGame(game);
      console.log(`Google fallback ${i+1}/${limit}: ${game.league} ${game.away} vs ${game.home}, results=${searchRows.length}`);
      detailPages = await fetchDetailTextsForGame(context, game, searchRows);
    }

    // 先用搜尋摘要/盤口模型建立每場獨立分析；沒有 key 也會用盤口模型產生不空白的分析。
    applySearchIntel(game, searchRows);

    // 再用 Yahoo / 玩運彩詳情頁文字嚴格抽取數據欄位。
    if(detailPages.length){
      const joined = detailPages.map(x=>`URL:${x.url}\n${x.text}`).join('\n\n');
      const hasBattle = detailPages.some(x=>x.source === 'playsport_battle');
      if(!(hasBattle && ['CPBL','NPB','KBO'].includes(String(game.league||'')))){
        enrichGameFromTexts(game, joined, []);
        game.analysis_json.detail_status = 'yahoo_detail_enriched';
      }
      game.analysis_json.detail_pages = detailPages.map(x=>x.url).slice(0,4);
    }
  }
  await enrichGamesWithApiLayer(games);
  console.log(`Yahoo scoreboard batch enrichment done. yahooBatchHits=${yahooBatchHits}, games=${games.length}, googleFallback=${(SEARCH_FALLBACK_ENABLED && SEARCH_API_KEY)?limit:0}`);
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
  try { await supabaseRequest('daily_sync_status', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ status, message, games_count: count, source: 'v119-keep-finished-cpbl-battle-info', created_at: nowISO() }]) }); }
  catch(e) { console.warn('daily_sync_status not written:', e.message); }
}

function stripDailyRow(row) {
  // Supabase/PostgREST bulk insert requires every object in the array to have the same keys.
  // Promoted rows read back from daily_games contain db-only fields such as id/created_at, while
  // freshly scraped rows do not. Keep only the columns we intentionally write, then normalize later.
  const { id, created_at, raw_data, ...clean } = row;
  return clean;
}

const DAILY_GAME_COLUMNS = [
  'game_date', 'game_day_type', 'game_status', 'sport', 'league', 'game_time',
  'away', 'home', 'money', 'spread', 'total', 'confidence',
  'source_url', 'source_name', 'analysis_json', 'active', 'updated_at'
];

function normalizeDailyRowsForInsert(rows) {
  return rows.map(row => {
    const out = {};
    for (const col of DAILY_GAME_COLUMNS) {
      if (col === 'analysis_json') out[col] = row[col] && typeof row[col] === 'object' ? row[col] : {};
      else if (col === 'confidence') out[col] = Array.isArray(row[col]) ? row[col] : [0, 0, 0];
      else if (col === 'active') out[col] = row[col] !== false;
      else if (col === 'game_status') out[col] = row[col] || 'upcoming';
      else if (col === 'updated_at') out[col] = row[col] || nowISO();
      else out[col] = row[col] ?? null;
    }
    return out;
  });
}
async function writeRawSportsData(rows) {
  let runId = null;
  try {
    const run = await supabaseRequest('raw_sports_sync_runs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ source: 'github_actions', version: 'v119-hourly-new-games-odds-refresh', status: 'success', total_games: rows.length, created_at: nowISO() }])
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

async function loadPromotedTomorrowRows() {
  // v119：不再用另外搬資料的方式處理跨日；改用 event identity 合併。
  return [];
}

function withAnalysisMeta(row, extra = {}) {
  const aj = row.analysis_json && typeof row.analysis_json === 'object' ? row.analysis_json : {};
  row.analysis_json = {
    ...aj,
    parser_version: 'v119-keep-finished-cpbl-battle-info',
    event_date: row.game_date,
    display_pool: row.game_day_type,
    source_day: row.raw_data?.raw_day_type || aj.source_day || row.game_day_type,
    odds_hash: oddsHash(row),
    ...extra
  };
  return row;
}

function dedupeGames(rows) {
  // v119：同一場比賽不以今日/明日作為唯一判斷，避免 12 點後明日賽事移到今日時重複。
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = gameIdentityKey(row);
    if (seen.has(key)) {
      const prev = out.find(x => gameIdentityKey(x) === key);
      // 若同場重複，優先保留有盤口的資料；否則保留較新的顯示池。
      if (prev && !isMarketOpenRow(prev) && isMarketOpenRow(row)) Object.assign(prev, row);
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return out;
}

function gameIdentityKey(row) {
  // 同一場 = 實際比賽日 + 聯盟 + 開賽時間 + 主客隊。
  // 不包含 game_day_type，讓「明日 → 今日」只改顯示池，不被當成新比賽。
  return [row.game_date, row.sport, row.league, row.game_time, row.home, row.away]
    .map(v => String(v || '').trim()).join('|');
}
function isPendingMarketText(v) {
  return !v || /未開盤|未開賽|盤口待確認|無建議|待確認|資料整理中/i.test(String(v || '').trim());
}
function isMarketOpenRow(row) {
  const aj = row.analysis_json || {};
  if (aj.market_open === true) return true;
  if (aj.market_open === false) return false;
  return [row.money, row.spread, row.total].some(v => !isPendingMarketText(v));
}
function oddsHash(row) {
  const status = isMarketOpenRow(row) ? 'open' : 'pending';
  return [row.money, row.spread, row.total, status].map(v => String(v || '').trim()).join('|');
}
function eqFilter(col, val) {
  return `${col}=eq.${encodeURIComponent(String(val ?? ''))}`;
}
function dailyGameFilter(row) {
  // 用目前資料庫實際列定位；包含 game_day_type，避免 PATCH 錯其他顯示池。
  return [
    eqFilter('game_day_type', row.game_day_type),
    eqFilter('game_date', row.game_date),
    eqFilter('sport', row.sport),
    eqFilter('league', row.league),
    eqFilter('game_time', row.game_time),
    eqFilter('home', row.home),
    eqFilter('away', row.away)
  ].join('&');
}
function eventIdentityFilter(row) {
  return [
    eqFilter('game_date', row.game_date),
    eqFilter('sport', row.sport),
    eqFilter('league', row.league),
    eqFilter('game_time', row.game_time),
    eqFilter('home', row.home),
    eqFilter('away', row.away)
  ].join('&');
}
function dailyUniqueFilter(row) {
  // 對應目前 Supabase 的 daily_games_v74_unique_idx：game_date + game_day_type + league + away + home + game_time
  // 注意：這個 unique key 沒有 sport，所以這裡也不要放 sport，避免撞到舊資料時查不到。
  return [
    eqFilter('game_date', row.game_date),
    eqFilter('game_day_type', row.game_day_type),
    eqFilter('league', row.league),
    eqFilter('away', row.away),
    eqFilter('home', row.home),
    eqFilter('game_time', row.game_time)
  ].join('&');
}
async function patchDailyUniqueRow(row, patch) {
  await supabaseRequest(`daily_games?${dailyUniqueFilter(row)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch)
  });
}
function isDuplicateKeyError(err) {
  const msg = String(err?.message || err || '');
  return msg.includes('23505') || msg.includes('duplicate key value') || msg.includes('daily_games_v74_unique_idx');
}
async function insertDailyRows(rows) {
  if (!rows.length) return;
  const cleanRows = normalizeDailyRowsForInsert(rows.map(r => stripDailyRow(withAnalysisMeta(r))));

  // v120：不要批次一次 POST，避免其中一筆撞 unique key 導致整批失敗。
  // 如果資料庫已有同場同顯示池資料，就改成 PATCH 更新，保留已分析內容，避免 workflow 紅叉。
  let inserted = 0, patchedDup = 0;
  for (const row of cleanRows) {
    try {
      await supabaseRequest('daily_games', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([row])
      });
      inserted++;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const existing = await supabaseRequest(`daily_games?${dailyUniqueFilter(row)}&select=*&limit=1`, { method: 'GET' }).catch(() => []);
      const old = Array.isArray(existing) ? existing[0] : null;
      if (old) {
        const { patch, reason } = buildPatchForExisting(old, row, 'insert_duplicate_patch');
        await patchDailyUniqueRow(row, { ...patch, active: true });
        patchedDup++;
        console.log(`duplicate daily_game patched instead of inserted: ${row.league} ${row.away} vs ${row.home} ${row.game_time} (${reason})`);
      } else {
        // 找不到舊列但仍撞 unique，通常是 schema cache/隱藏舊資料；保守略過，不讓整批失敗。
        console.warn(`duplicate daily_game skipped: ${row.league} ${row.away} vs ${row.home} ${row.game_time}`);
      }
    }
  }
  console.log(`insertDailyRows complete: inserted=${inserted}, duplicate_patched=${patchedDup}, requested=${cleanRows.length}`);
}
async function patchDailyRow(row, patch) {
  await supabaseRequest(`daily_games?${dailyGameFilter(row)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch)
  });
}
async function deleteIncomingDisplayConflict(row) {
  // 若同一場已經有 today/tomorrow 另一列，準備把舊列改顯示池前，先刪掉新顯示池的重複列，避免 unique constraint 撞到。
  await supabaseRequest(`daily_games?${eventIdentityFilter(row)}&game_day_type=eq.${encodeURIComponent(String(row.game_day_type || ''))}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  }).catch(e => console.warn('delete display-pool conflict skipped:', e.message));
}
function buildPatchForExisting(old, row, modeLabel) {
  const incomingOpen = isMarketOpenRow(row);
  const oldOpen = isMarketOpenRow(old);
  const rowHash = oddsHash(row);
  const oldHash = old?.analysis_json?.odds_hash || oddsHash(old);

  const baseAnalysis = old.analysis_json && typeof old.analysis_json === 'object' ? old.analysis_json : {};
  const incomingAnalysis = row.analysis_json && typeof row.analysis_json === 'object' ? row.analysis_json : {};
  const displayOnlyPatch = {
    game_day_type: row.game_day_type,
    game_date: row.game_date,
    game_status: row.game_status || old.game_status || 'upcoming',
    source_url: row.source_url || old.source_url,
    source_name: row.source_name || old.source_name || '資料中心',
    active: true,
    updated_at: nowISO(),
    analysis_json: {
      ...baseAnalysis,
      event_date: row.game_date,
      display_pool: row.game_day_type,
      source_day: row.raw_data?.raw_day_type || baseAnalysis.source_day || row.game_day_type,
      last_checked_at: nowISO(),
      last_check_mode: modeLabel,
      odds_hash: oldHash
    }
  };

  // 新抓到還是未開盤：只更新顯示池，不用未開盤覆蓋已經開盤/已分析資料。
  if (!incomingOpen) {
    if (oldOpen || baseAnalysis.analysis_status || baseAnalysis.odds_hash) {
      return {
        patch: displayOnlyPatch,
        reason: 'display_only_pending_does_not_override'
      };
    }
    return {
      patch: {
        ...displayOnlyPatch,
        money: row.money,
        spread: row.spread,
        total: row.total,
        confidence: row.confidence,
        analysis_json: {
          ...incomingAnalysis,
          ...displayOnlyPatch.analysis_json,
          analysis_status: 'pending_market',
          odds_hash: rowHash
        }
      },
      reason: 'still_pending'
    };
  }

  // 新盤口已開，且舊盤口未開：第一次開盤，產生分析。
  if (!oldOpen) {
    return {
      patch: {
        ...displayOnlyPatch,
        money: row.money,
        spread: row.spread,
        total: row.total,
        confidence: row.confidence,
        analysis_json: {
          ...baseAnalysis,
          ...incomingAnalysis,
          event_date: row.game_date,
          display_pool: row.game_day_type,
          source_day: row.raw_data?.raw_day_type || incomingAnalysis.source_day || row.game_day_type,
          analysis_status: 'market_opened',
          odds_opened_at: nowISO(),
          odds_hash: rowHash
        }
      },
      reason: 'market_opened'
    };
  }

  // 盤口有變：更新盤口並重新分析。
  if (oldHash !== rowHash || old.money !== row.money || old.spread !== row.spread || old.total !== row.total) {
    return {
      patch: {
        ...displayOnlyPatch,
        money: row.money,
        spread: row.spread,
        total: row.total,
        confidence: row.confidence,
        analysis_json: {
          ...baseAnalysis,
          ...incomingAnalysis,
          event_date: row.game_date,
          display_pool: row.game_day_type,
          source_day: row.raw_data?.raw_day_type || incomingAnalysis.source_day || row.game_day_type,
          analysis_status: 'odds_changed',
          odds_changed_at: nowISO(),
          previous_odds_hash: oldHash,
          odds_hash: rowHash
        }
      },
      reason: 'odds_changed'
    };
  }

  // 盤口一樣：只更新顯示池與檢查時間，不重新分析。
  return {
    patch: displayOnlyPatch,
    reason: 'same_odds_display_only'
  };
}
async function mergeDailyGames(rows, { markMissingInactive = false, modeLabel = 'merge' } = {}) {
  const incoming = dedupeGames(rows).map(r => stripDailyRow(withAnalysisMeta(r)));
  try { await writeRawSportsData(incoming); } catch(e) { console.warn('raw data center skipped:', e.message); }

  const existingRows = await supabaseRequest('daily_games?game_day_type=in.(today,tomorrow)&active=eq.true&select=*&limit=2000', { method: 'GET' }).catch(e => {
    console.warn('load existing daily_games failed, fallback to insert-only:', e.message);
    return [];
  });
  const existingList = Array.isArray(existingRows) ? existingRows : [];
  const byIdentity = new Map();
  for (const old of existingList) {
    const key = gameIdentityKey(old);
    const bucket = byIdentity.get(key) || [];
    bucket.push(old);
    byIdentity.set(key, bucket);
  }

  const toInsert = [];
  let patched = 0, inserted = 0, skipped = 0, pendingKept = 0, oddsChanged = 0, marketOpened = 0, displayMoved = 0;

  for (const row of incoming) {
    const key = gameIdentityKey(row);
    const bucket = byIdentity.get(key) || [];
    // 優先沿用已有分析/已開盤資料；避免跨日移動後重新分析。
    const old = bucket.sort((a,b) => {
      const score = x => (isMarketOpenRow(x) ? 10 : 0) + (x.analysis_json?.odds_hash ? 5 : 0) + (x.game_day_type === row.game_day_type ? 1 : 0);
      return score(b) - score(a);
    })[0];

    if (!old) {
      toInsert.push(row);
      continue;
    }

    const { patch, reason } = buildPatchForExisting(old, row, modeLabel);
    if (old.game_day_type !== row.game_day_type) {
      await deleteIncomingDisplayConflict(row);
      displayMoved++;
    }
    await patchDailyRow(old, patch).catch(e => console.warn(`patch existing ${reason} failed:`, e.message));
    patched++;
    if (reason === 'same_odds_display_only') skipped++;
    if (reason === 'display_only_pending_does_not_override') pendingKept++;
    if (reason === 'odds_changed') oddsChanged++;
    if (reason === 'market_opened') marketOpened++;
  }

  await insertDailyRows(toInsert);
  inserted = toInsert.length;

  let inactive = 0;
  if (markMissingInactive && incoming.length > 0) {
    const incomingKeys = new Set(incoming.map(gameIdentityKey));
    for (const old of existingList) {
      const key = gameIdentityKey(old);
      if (!incomingKeys.has(key)) {
        inactive++;
        await patchDailyRow(old, {
          active: false,
          updated_at: nowISO(),
          analysis_json: {
            ...(old.analysis_json || {}),
            inactive_reason: 'not_found_in_latest_full_sync',
            inactive_at: nowISO()
          }
        }).catch(e => console.warn('mark inactive failed:', e.message));
      }
    }
  }

  const msg = `v120 ${modeLabel}: inserted=${inserted}, patched=${patched}, same_odds=${skipped}, market_opened=${marketOpened}, odds_changed=${oddsChanged}, pending_kept=${pendingKept}, display_moved=${displayMoved}, inactive=${inactive}, incoming=${incoming.length}`;
  console.log(msg);
  await writeSyncStatus('success', msg, incoming.length);
}
async function incrementalDailyGames(rows) {
  // v119：每小時重新掃描玩運彩，不只補刷舊賽事，也會新增 00:10 後才上架的新賽事。
  // A. 新場次：直接新增；若已有盤口就用目前盤口產生分析，未開盤則先標記待確認。
  // B. 舊場次：盤口一樣不重寫；盤口開出或變動才重新分析。
  // C. 已分析過的場次不會被空盤口/未開賽覆蓋。
  return mergeDailyGames(rows, { markMissingInactive: false, modeLabel: 'incremental' });
}
async function upsertDailyGames(rows) {
  // v119：大同步不整批刪除重寫，避免明日賽事 00:10 移到今日時重複分析。
  // 只用 event_date + league + home + away 判斷同一場；盤口不變就保留舊分析。
  return mergeDailyGames(rows, { markMissingInactive: true, modeLabel: 'full' });
}

async function main() {
  await waitUntilTaipeiDateReady();
  console.log(`Taiwan sync date: today=${dateTW(0)} (${mdTW(0)}). Today/tomorrow display pools enabled. SYNC_MODE=${SYNC_MODE}`);
  const promoted = await loadPromotedTomorrowRows();
  const incremental = SYNC_MODE === 'incremental';
  const scraped = await scrapePlaySportWithBrowser({ skipEnrichment: incremental });
  const games = [...promoted, ...scraped];
  console.log(`Parsed valid games v120 hourly-new-games display-pool: promoted=${promoted.length}, scraped=${scraped.length}, total=${games.length}`);
  console.log(games.slice(0, 80).map(g => `${g.game_day_type} ${g.league} ${g.game_time} ${g.away} vs ${g.home} | ${g.spread} | ${g.total}`).join('\n'));
  if (incremental) {
    await incrementalDailyGames(games);
    console.log(games.length ? `Incremental check finished for ${games.length} games.` : 'Incremental check found no games.');
  } else {
    await upsertDailyGames(games);
    console.log(games.length ? `Full sync wrote ${games.length} valid games to Supabase daily_games.` : 'No valid games parsed for today/tomorrow display pools.');
  }
}
main().catch(err => { console.error(err); process.exit(1); });
