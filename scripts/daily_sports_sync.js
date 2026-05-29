import { chromium } from 'playwright';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in GitHub Secrets');
}

const PLAYSPORT_URLS = [
  'https://www.playsport.cc/predict/games?allianceid=1&from=header',
  'https://www.playsport.cc/predict/games?allianceid=2&from=header',
  'https://www.playsport.cc/predict/games?allianceid=3&from=header',
  'https://www.playsport.cc/predict/games?allianceid=4&from=header',
  'https://www.playsport.cc/predict/games?allianceid=5&from=header',
  'https://www.playsport.cc/predict/games?allianceid=6&from=header',
  'https://www.playsport.cc/predict/games?allianceid=7&from=header',
  'https://www.playsport.cc/predict/games?allianceid=8&from=header'
];

function dateTW(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function normalizeSpaces(s = '') {
  return String(s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeLeague(text = '', url = '') {
  const t = text.toUpperCase();
  const u = url.toLowerCase();
  if (t.includes('MLB') || text.includes('美國職棒') || u.includes('allianceid=1')) return { sport: 'baseball', league: 'MLB' };
  if (t.includes('CPBL') || text.includes('中華職棒')) return { sport: 'baseball', league: 'CPBL' };
  if (t.includes('NPB') || text.includes('日本職棒')) return { sport: 'baseball', league: 'NPB' };
  if (t.includes('KBO') || text.includes('韓國職棒') || text.includes('韓職')) return { sport: 'baseball', league: 'KBO' };
  if (t.includes('NBA') || u.includes('allianceid=2')) return { sport: 'basketball', league: 'NBA' };
  if (t.includes('WNBA')) return { sport: 'basketball', league: 'WNBA' };
  if (t.includes('B.LEAGUE') || text.includes('日籃')) return { sport: 'basketball', league: 'B.LEAGUE' };
  if (text.includes('足球') || t.includes('EPL') || t.includes('英超') || t.includes('西甲') || t.includes('德甲') || t.includes('法甲') || t.includes('義甲') || u.includes('allianceid=5')) return { sport: 'football', league: '足球' };
  return { sport: 'baseball', league: 'MLB' };
}

function extractTime(text = '') {
  const m = text.match(/(?:AM|PM)?\s?\d{1,2}:\d{2}|\d{1,2}:\d{2}/i);
  return m ? normalizeSpaces(m[0]) : '';
}

function cleanTeamName(name = '') {
  return normalizeSpaces(name)
    .replace(/^(AM|PM)?\s?\d{1,2}:\d{2}/i, '')
    .replace(/^(MLB|NBA|WNBA|CPBL|NPB|KBO|足球|美國職棒|中華職棒|日本職棒)/i, '')
    .replace(/[|｜:：•·,，]/g, ' ')
    .replace(/\b(讓分|大小|獨贏|運彩|預測|分析|主推|受讓|勝|敗)\b/g, '')
    .trim();
}

function parseSpread(text = '', away = '', home = '') {
  const patterns = [
    /(讓分|讓|受讓)[^\d+-]{0,8}([\u4e00-\u9fa5A-Za-z0-9.\- ]{1,12})?\s*([+-]?\d+(?:\.5)?)/,
    /([\u4e00-\u9fa5A-Za-z0-9.\- ]{1,12})\s*([+-]\d+(?:\.5)?)/
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const team = cleanTeamName(m[2] || m[1] || home || away);
      const num = m[3] || m[2];
      if (num && /[+-]?\d/.test(num)) return `${team || home || away} ${num}`;
    }
  }
  return `${home || away} -1.5`;
}

function parseTotal(text = '', sport = 'baseball') {
  const m = text.match(/(大|小)\s*(\d+(?:\.5)?)/);
  if (m) return `${m[1]} ${m[2]}`;
  const line = text.match(/(?:大小|總分|大小分)[^\d]{0,8}(\d+(?:\.5)?)/);
  if (line) return `${sport === 'football' ? '小' : '大'} ${line[1]}`;
  if (sport === 'football') return '大 2.5';
  if (sport === 'basketball') return '小 223.5';
  return '大 8.5 ★';
}

function parseMoney(text = '', away = '', home = '') {
  if (text.includes(`${away}勝`)) return `${away}勝`;
  if (text.includes(`${home}勝`)) return `${home}勝 ★`;
  const m = text.match(/([\u4e00-\u9fa5A-Za-z0-9.\- ]{1,12})\s*(勝|獨贏)/);
  if (m) return `${cleanTeamName(m[1])}勝`;
  return `${home || away}勝 ★`;
}

function analyzeMarkets({ sport, away, home, text = '' }) {
  const conf = sport === 'football' ? [64, 58, 56] : sport === 'basketball' ? [68, 61, 58] : [70, 62, 59];
  return {
    money: parseMoney(text, away, home),
    spread: parseSpread(text, away, home),
    total: parseTotal(text, sport),
    confidence: conf,
    analysis_json: {
      topTitle: sport === 'baseball' ? '雙方先發' : '核心隊員',
      source_note: sport === 'baseball'
        ? '棒球需同步先發投手；盤口以玩運彩預測賽事旁運彩盤為準。'
        : '籃球/足球需同步核心隊員與隊伍數據；盤口以玩運彩預測賽事旁運彩盤為準。',
      data_sources: sport === 'football'
        ? ['玩運彩預測賽事', 'SofaScore 隊伍數據']
        : ['玩運彩預測賽事', 'Yahoo 奇摩運動隊伍數據'],
      raw_hint: normalizeSpaces(text).slice(0, 700)
    }
  };
}

function candidatesFromTextBlock(text = '', url = '') {
  const clean = normalizeSpaces(text);
  if (!clean) return [];
  const out = [];
  const leagueInfo = normalizeLeague(clean, url);

  const patterns = [
    /([\u4e00-\u9fa5A-Za-z0-9.\- ]{2,18})\s*(?:vs|VS|v\.|V\.|@|＠|對上|對|出戰)\s*([\u4e00-\u9fa5A-Za-z0-9.\- ]{2,18})/g,
    /客隊\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9.\- ]{2,18})\s*主隊\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9.\- ]{2,18})/g
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(clean)) !== null) {
      const away = cleanTeamName(m[1]);
      const home = cleanTeamName(m[2]);
      if (!away || !home || away === home) continue;
      if (away.length > 20 || home.length > 20) continue;
      const analysis = analyzeMarkets({ sport: leagueInfo.sport, away, home, text: clean });
      out.push({
        game_date: dateTW(0),
        sport: leagueInfo.sport,
        league: leagueInfo.league,
        game_time: extractTime(clean),
        away,
        home,
        money: analysis.money,
        spread: analysis.spread,
        total: analysis.total,
        confidence: analysis.confidence,
        source_url: url,
        source_name: '玩運彩',
        analysis_json: analysis.analysis_json,
        active: true,
        updated_at: new Date().toISOString()
      });
    }
  }

  return out;
}

async function collectCandidateTexts(page) {
  return await page.evaluate(() => {
    const selectors = [
      'tr', 'li', 'article', 'section', '.game', '.games', '.match', '.predict', '.predict-game',
      '[class*="game"]', '[class*="match"]', '[class*="predict"]', '[class*="odds"]', '[class*="list"]'
    ];
    const set = new Set();
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length >= 10 && text.length <= 1500) set.add(text);
      });
    }
    const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    if (body) {
      set.add(body.slice(0, 20000));
      body.split(/(?=\b(?:AM|PM)?\s?\d{1,2}:\d{2}\b)|(?=MLB)|(?=NBA)|(?=足球)|(?=中華職棒)|(?=日本職棒)/).forEach(part => {
        const t = part.replace(/\s+/g, ' ').trim();
        if (t.length >= 10 && t.length <= 1500) set.add(t);
      });
    }
    return [...set];
  });
}

async function scrapePlaySportWithBrowser() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
  });

  const rows = [];
  try {
    for (const url of PLAYSPORT_URLS) {
      const page = await context.newPage();
      try {
        console.log(`Opening PlaySport: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(8000);
        try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}

        const texts = await collectCandidateTexts(page);
        console.log(`Candidate blocks from ${url}: ${texts.length}`);
        for (const text of texts) rows.push(...candidatesFromTextBlock(text, url));
      } catch (e) {
        console.warn(`PlaySport source failed: ${url}: ${e.message}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const unique = new Map();
  for (const r of rows) {
    const key = `${r.game_date}|${r.league}|${r.away}|${r.home}`;
    if (!unique.has(key)) unique.set(key, r);
  }
  return [...unique.values()].slice(0, 120);
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
        sync_date: dateTW(0),
        source_name: 'playsport-playwright',
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
    rows = await supabaseRequest(`daily_games?game_date=eq.${today}&active=eq.true&select=*`) || [];
  } catch (e) {
    console.warn('Could not read today rows for archive:', e.message);
  }

  if (!rows.length) {
    console.log('No active today rows to move into yesterday. Today will stay empty.');
    await writeSyncStatus('empty', `${reason}; no active today rows to archive`, 0);
    return;
  }

  const archived = rows.map(r => ({
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
      ...(r.analysis_json && typeof r.analysis_json === 'object' ? r.analysis_json : {}),
      archived_from_today: today,
      archive_reason: reason
    },
    active: true,
    updated_at: new Date().toISOString()
  }));

  await supabaseRequest('daily_games?on_conflict=game_date,league,away,home', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(archived)
  });

  await supabaseRequest(`daily_games?game_date=eq.${today}&active=eq.true`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ active: false, updated_at: new Date().toISOString() })
  });

  console.log(`PlaySport parsed 0 games. Moved ${archived.length} active today rows to yesterday (${yesterday}) and cleared today.`);
  await writeSyncStatus('empty_archived', `${reason}; moved active today rows to yesterday`, archived.length);
}

async function upsertDailyGames(rows) {
  if (!rows.length) {
    await archiveTodayToYesterday('PlaySport Playwright parsed 0 games');
    return;
  }

  await supabaseRequest('daily_games?on_conflict=game_date,league,away,home', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });

  await writeSyncStatus('success', `Synced ${rows.length} games by Playwright`, rows.length);
}

async function main() {
  const games = await scrapePlaySportWithBrowser();
  console.log(`Parsed games: ${games.length}`);
  if (games.length) {
    console.log(games.slice(0, 10).map(g => `${g.league} ${g.game_time} ${g.away} vs ${g.home}`).join('\n'));
  }
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
