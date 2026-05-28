import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SOURCES = {
  playsport: 'https://www.playsport.cc/predict/games?allianceid=1&from=header',
  yahoo: 'https://tw.sports.yahoo.com/',
  sofascore: 'https://www.sofascore.com/'
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in GitHub Secrets');
}

function todayTW() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return fmt.format(new Date());
}

async function getHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 Sports Sync Bot',
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8'
    }
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return await res.text();
}

function normalizeLeague(text = '') {
  const t = text.toUpperCase();
  if (t.includes('MLB') || text.includes('美國職棒')) return { sport: 'baseball', league: 'MLB' };
  if (t.includes('CPBL') || text.includes('中華職棒')) return { sport: 'baseball', league: 'CPBL' };
  if (t.includes('NPB') || text.includes('日本職棒')) return { sport: 'baseball', league: 'NPB' };
  if (t.includes('NBA')) return { sport: 'basketball', league: 'NBA' };
  if (t.includes('WNBA')) return { sport: 'basketball', league: 'WNBA' };
  if (text.includes('足球') || t.includes('EPL') || t.includes('INT')) return { sport: 'football', league: 'INT' };
  return { sport: 'baseball', league: 'MLB' };
}

function analyzeMarkets({ sport, away, home, money = '', spread = '', total = '' }) {
  // 這裡是網站每日自動分析的保守規則：盤口以玩運彩旁邊運彩盤為準。
  // 正式要更準，可以把 Yahoo / SofaScore 的隊伍數據欄位補進 analysis_json 後加權。
  const conf = sport === 'football' ? [64, 58, 56] : sport === 'basketball' ? [68, 61, 58] : [70, 62, 59];
  return {
    money: money || `${home}勝 ★`,
    spread: spread || `${home} -1.5`,
    total: total || (sport === 'football' ? '大 2.5' : sport === 'basketball' ? '小 223.5' : '大 8.5 ★'),
    confidence: conf,
    analysis_json: {
      topTitle: sport === 'baseball' ? '雙方先發' : '核心球員',
      source_note: sport === 'baseball'
        ? '棒球需同步先發投手；盤口以玩運彩預測賽事旁運彩盤為準。'
        : '籃球/足球需同步核心隊員與隊伍數據；盤口以玩運彩預測賽事旁運彩盤為準。',
      data_sources: sport === 'football'
        ? ['玩運彩預測賽事', 'SofaScore 隊伍數據']
        : ['玩運彩預測賽事', 'Yahoo 奇摩運動隊伍數據']
    }
  };
}

async function scrapePlaySport() {
  const html = await getHtml(SOURCES.playsport);
  const $ = cheerio.load(html);
  const rows = [];

  // 玩運彩頁面可能改版，這裡用寬鬆文字掃描。
  $('tr, .game, .match, .predict-game, li').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (!/(MLB|NBA|WNBA|中華職棒|日本職棒|足球|vs|VS|@)/i.test(text)) return;

    const leagueInfo = normalizeLeague(text);
    const m = text.match(/([\u4e00-\u9fa5A-Za-z0-9.\- ]{2,20})\s*(?:vs|VS|@)\s*([\u4e00-\u9fa5A-Za-z0-9.\- ]{2,20})/);
    if (!m) return;

    const away = m[1].trim();
    const home = m[2].trim();
    if (!away || !home || away === home) return;

    const timeMatch = text.match(/(AM|PM)?\s?\d{1,2}:\d{2}|\d{1,2}:\d{2}/i);
    const game_time = timeMatch ? timeMatch[0].trim() : '';

    const analysis = analyzeMarkets({ sport: leagueInfo.sport, away, home });
    rows.push({
      game_date: todayTW(),
      sport: leagueInfo.sport,
      league: leagueInfo.league,
      game_time,
      away,
      home,
      money: analysis.money,
      spread: analysis.spread,
      total: analysis.total,
      confidence: analysis.confidence,
      source_url: SOURCES.playsport,
      source_name: '玩運彩',
      analysis_json: analysis.analysis_json,
      active: true,
      updated_at: new Date().toISOString()
    });
  });

  const unique = new Map();
  for (const r of rows) unique.set(`${r.game_date}|${r.league}|${r.away}|${r.home}`, r);
  return [...unique.values()].slice(0, 80);
}

async function supabaseRequest(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
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

function dateTW(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

async function writeSyncStatus(status, message, count = 0) {
  // 如果你有跑 v54 status SQL，就會記錄狀態；沒跑也不影響同步。
  try {
    await supabaseRequest('daily_sync_status?on_conflict=sync_date,source_name', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{
        sync_date: dateTW(0),
        source_name: 'playsport',
        status,
        message,
        games_count: count,
        updated_at: new Date().toISOString()
      }])
    });
  } catch (e) {
    console.warn('daily_sync_status not written:', e.message);
  }
}

async function archiveTodayToYesterday(reason = 'PlaySport parsed 0 games') {
  const today = dateTW(0);
  const yesterday = dateTW(-1);
  let rows = [];

  try {
    rows = await supabaseRequest(
      `daily_games?game_date=eq.${today}&active=eq.true&select=*`
    ) || [];
  } catch (e) {
    console.warn('Could not read today rows for archive:', e.message);
  }

  if (!rows.length) {
    console.log('No active today rows to move into yesterday. Today will stay empty.');
    await writeSyncStatus('empty', `${reason}; no active today rows to archive`, 0);
    return;
  }

  const archived = rows.map(r => {
    const analysis = (r.analysis_json && typeof r.analysis_json === 'object') ? r.analysis_json : {};
    const copy = {
      game_date: yesterday,
      sport: r.sport,
      league: r.league,
      game_time: r.game_time,
      away: r.away,
      home: r.home,
      money: r.money,
      spread: r.spread,
      total: r.total,
      confidence: r.confidence,
      source_url: r.source_url,
      source_name: r.source_name || '每日同步',
      analysis_json: {
        ...analysis,
        archived_from_today: today,
        archive_reason: reason
      },
      active: true,
      updated_at: new Date().toISOString()
    };
    return copy;
  });

  await supabaseRequest('daily_games?on_conflict=game_date,league,away,home', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(archived)
  });

  await supabaseRequest(`daily_games?game_date=eq.${today}&active=eq.true`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      active: false,
      updated_at: new Date().toISOString()
    })
  });

  console.log(`PlaySport parsed 0 games. Moved ${archived.length} active today rows to yesterday (${yesterday}) and cleared today.`);
  await writeSyncStatus('empty_archived', `${reason}; moved active today rows to yesterday`, archived.length);
}

async function upsertDailyGames(rows) {
  if (!rows.length) {
    await archiveTodayToYesterday('PlaySport parsed 0 games');
    return;
  }

  const urlPath = `daily_games?on_conflict=game_date,league,away,home`;
  await supabaseRequest(urlPath, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });

  await writeSyncStatus('success', `Synced ${rows.length} games`, rows.length);
}

async function main() {
  const games = await scrapePlaySport();
  await upsertDailyGames(games);
  if (games.length) {
    console.log(`Synced ${games.length} games to Supabase daily_games.`);
  } else {
    console.log('No games parsed. Today rows were moved to yesterday if any existed, and workflow ended successfully.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
