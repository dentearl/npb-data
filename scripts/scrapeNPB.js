/**
 * NPB Schedule & Game Results Scraper
 * 
 * Fetches official regular season schedule and box scores from the NPB web service
 * (npb.jp/bis/eng/{season}/calendar/index_{month}.html), normalizes game outcomes
 * (including tie/draw games and cancellations), and outputs production-grade JSON
 * for the baseball division race visualization.
 * 
 * 
 * ARCHITECTURAL CONSTRAINT FOR AI AGENTS & DEVELOPERS:
 * This scraper script is intentionally 100% self-contained with ZERO internal repository imports.
 * It must ONLY import Node.js built-ins (node:fs, node:path, node:url).
 * DO NOT import from ../src/ or couple this script to frontend constants.
 * It is deployed and executed independently in standalone scraper repositories (e.g. npb-data-repo).
 * Parity between NPB_TEAM_MAPPING and src/constants/npbTeams.js is enforced by tests/scraperConsistency.test.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const NPB_TEAM_MAPPING = {
  // Central League
  'G':  { id: 3001, abbrev: 'YOM',  name: 'Yomiuri Giants', nativeName: '読売ジャイアンツ', league: 'NPB', division: 'Central League' },
  'T':  { id: 3002, abbrev: 'HAN',  name: 'Hanshin Tigers', nativeName: '阪神タイガース', league: 'NPB', division: 'Central League' },
  'DB': { id: 3003, abbrev: 'DeNA', name: 'Yokohama DeNA BayStars', nativeName: '横浜DeNAベイスターズ', league: 'NPB', division: 'Central League' },
  'YB': { id: 3003, abbrev: 'DeNA', name: 'Yokohama DeNA BayStars', nativeName: '横浜DeNAベイスターズ', league: 'NPB', division: 'Central League' },
  'C':  { id: 3004, abbrev: 'HIR',  name: 'Hiroshima Toyo Carp', nativeName: '広島東洋カープ', league: 'NPB', division: 'Central League' },
  'D':  { id: 3005, abbrev: 'CHU',  name: 'Chunichi Dragons', nativeName: '中日ドラゴンズ', league: 'NPB', division: 'Central League' },
  'S':  { id: 3006, abbrev: 'YAK',  name: 'Tokyo Yakult Swallows', nativeName: '東京ヤクルトスワローズ', league: 'NPB', division: 'Central League' },

  // Pacific League
  'H':  { id: 3007, abbrev: 'SBH',  name: 'Fukuoka SoftBank Hawks', nativeName: '福岡ソフトバンクホークス', league: 'NPB', division: 'Pacific League' },
  'F':  { id: 3008, abbrev: 'NHF',  name: 'Hokkaido Nippon-Ham Fighters', nativeName: '北海道日本ハムファイターズ', league: 'NPB', division: 'Pacific League' },
  'M':  { id: 3009, abbrev: 'LOT',  name: 'Chiba Lotte Marines', nativeName: '千葉ロッテマリーンズ', league: 'NPB', division: 'Pacific League' },
  'E':  { id: 3010, abbrev: 'RAK',  name: 'Tohoku Rakuten Golden Eagles', nativeName: '東北楽天ゴールデンイーグルス', league: 'NPB', division: 'Pacific League' },
  'B':  { id: 3011, abbrev: 'ORX',  name: 'ORIX Buffaloes', nativeName: 'オリックス・バファローズ', league: 'NPB', division: 'Pacific League' },
  'L':  { id: 3012, abbrev: 'SEI',  name: 'Saitama Seibu Lions', nativeName: '埼玉西武ライオンズ', league: 'NPB', division: 'Pacific League' }
};

// Aliases for full names, canonical abbreviations, or common alternative notations
export const NPB_ALIASES = {
  'YOM': 3001,
  'GIANTS': 3001,
  'YOMIURI': 3001,
  'HAN': 3002,
  'TIGERS': 3002,
  'HANSHIN': 3002,
  'DENA': 3003,
  'YB': 3003,
  'BAYSTARS': 3003,
  'YOKOHAMA': 3003,
  'HIR': 3004,
  'CARP': 3004,
  'HIROSHIMA': 3004,
  'CHU': 3005,
  'DRAGONS': 3005,
  'CHUNICHI': 3005,
  'YAK': 3006,
  'SWALLOWS': 3006,
  'YAKULT': 3006,
  'SBH': 3007,
  'HAWKS': 3007,
  'SOFTBANK': 3007,
  'NHF': 3008,
  'FIGHTERS': 3008,
  'NIPPON-HAM': 3008,
  'NIPPONHAM': 3008,
  'LOT': 3009,
  'MARINES': 3009,
  'LOTTE': 3009,
  'RAK': 3010,
  'EAGLES': 3010,
  'RAKUTEN': 3010,
  'ORX': 3011,
  'BUFFALOES': 3011,
  'ORIX': 3011,
  'SEI': 3012,
  'LIONS': 3012,
  'SEIBU': 3012
};

/**
 * Resolves raw team abbreviation or name to canonical team object
 */
export function resolveNpbTeam(rawName) {
  if (!rawName) return null;
  const trimmed = rawName.trim().toUpperCase();
  if (NPB_TEAM_MAPPING[trimmed]) {
    return NPB_TEAM_MAPPING[trimmed];
  }

  const aliasId = NPB_ALIASES[trimmed];
  if (aliasId) {
    return Object.values(NPB_TEAM_MAPPING).find(t => t.id === aliasId) || null;
  }

  // Fallback search across names
  for (const team of Object.values(NPB_TEAM_MAPPING)) {
    if (team.name.toUpperCase().includes(trimmed) || team.nativeName.includes(rawName.trim())) {
      return team;
    }
  }

  return null;
}

/**
 * Polite asynchronous delay helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetches or reads from cache raw NPB calendar HTML for a specific month
 */
async function fetchMonthHtml(season, month, options = {}) {
  const {
    cacheDir = path.join(rootDir, '.npb_cache'),
    forceRefresh = false,
    ttlHours = 6
  } = options;

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const cacheFile = path.join(cacheDir, `calendar_${season}_${month}.html`);
  const now = new Date();
  const currentMonthNum = now.getMonth() + 1; // 1-12
  const currentYear = now.getFullYear();
  const monthNum = parseInt(month, 10);

  // Month 04 includes March and April. Consider month past if year < current or month < current
  const isPastMonth = (parseInt(season, 10) < currentYear) || 
                      (parseInt(season, 10) === currentYear && monthNum < currentMonthNum);

  if (!forceRefresh && fs.existsSync(cacheFile)) {
    try {
      const stats = fs.statSync(cacheFile);
      const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);

      // Past months never change and are kept indefinitely; active months expire after ttlHours
      if (isPastMonth || ageHours < ttlHours) {
        console.log(`  💾 [Cache Hit] ${season}-${month} (${isPastMonth ? 'Immutable past month' : `${ageHours.toFixed(1)}h old < ${ttlHours}h TTL`})`);
        return fs.readFileSync(cacheFile, 'utf-8');
      }
    } catch (err) {
      console.warn(`  ⚠️ Could not read cache for ${season}-${month}: ${err.message}. Refetching.`);
    }
  }

  const candidateUrls = [
    `https://npb.jp/bis/eng/${season}/calendar/index_${month}.html`,
    `https://npb.jp/bis/${season}/calendar/index_${month}.html`
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1'
  };

  // Polite courtesy delay with jitter (3.0s - 4.5s) to strictly respect NPB anti-scraping limits
  const delayMs = Math.floor(3000 + Math.random() * 1500);
  console.log(`  ⏳ [Rate Limit] Pacing requests (${(delayMs / 1000).toFixed(1)}s delay)...`);
  await sleep(delayMs);

  let lastError = null;
  for (const url of candidateUrls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`  🌐 [Network Fetch] Requesting ${url}${attempt > 1 ? ` (Attempt ${attempt}/3)` : ''} ...`);
        const response = await fetch(url, { headers });

        if (response.ok) {
          const html = await response.text();
          if (html && html.length > 500) {
            fs.writeFileSync(cacheFile, html, 'utf-8');
            return html;
          }
        }

        if (response.status === 404) {
          if (month === '11') return '';
          // Try next candidate URL (e.g. Japanese fallback)
          break;
        }

        if (response.status === 429 || response.status === 503) {
          const backoff = attempt * 8000 + Math.floor(Math.random() * 4000);
          console.warn(`  ⚠️ Server status ${response.status}. Backing off for ${(backoff / 1000).toFixed(1)}s...`);
          await sleep(backoff);
          continue;
        }

        throw new Error(`NPB server HTTP error ${response.status}: ${response.statusText}`);
      } catch (err) {
        lastError = err;
        if (attempt < 3) {
          const backoff = attempt * 5000;
          console.warn(`  ⚠️ Request attempt ${attempt} failed: ${err.message}. Retrying in ${(backoff / 1000).toFixed(1)}s...`);
          await sleep(backoff);
        }
      }
    }
  }

  if (month === '11') {
    return '';
  }

  throw lastError || new Error(`Unable to fetch NPB calendar for ${season}-${month}`);
}

/**
 * Parses raw NPB calendar HTML table into normalized game objects
 */
export function parseNpbCalendarHtml(html = '', seasonYear = '2026', month = '01', options = {}) {
  const games = [];

  // Each calendar day is represented inside <td class="stschedule"...> or <td> ... </td>
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let tdMatch;

  while ((tdMatch = tdRegex.exec(html)) !== null) {
    const cellContent = tdMatch[1];

    // Find date link or day number
    // e.g. <div class="teschedate"><a href="/bis/eng/2026/games/gm20260327.html">27</a></div>
    // or <div class="date"><span>27</span></div>
    let officialDate = null;
    const dateLinkMatch = cellContent.match(/<div[^>]*class=["']teschedate["'][^>]*>\s*<a[^>]*href=["'][^"']*gm(\d{8})\.html["'][^>]*>/i);
    if (dateLinkMatch) {
      const dStr = dateLinkMatch[1];
      officialDate = `${dStr.slice(0, 4)}-${dStr.slice(4, 6)}-${dStr.slice(6, 8)}`;
    } else {
      const daySpanMatch = cellContent.match(/<div[^>]*class=["'](?:teschedate|date)["'][^>]*>[\s\S]*?<span>(\d+)<\/span>/i) || cellContent.match(/<span>(\d+)<\/span>/i);
      if (daySpanMatch) {
        const dNum = daySpanMatch[1].padStart(2, '0');
        const mStr = String(month || '01').padStart(2, '0');
        officialDate = `${seasonYear}-${mStr}-${dNum}`;
      }
    }

    if (!officialDate) {
      // Cell without games or unlinked day
      continue;
    }

    // Parse games inside this day cell
    // Format 1 (Completed / Final or Postponed with link):
    // <div><a href="/bis/eng/2026/games/s2026032701085.html">G 3 - 1 T</a></div>
    // or with stage marker: <div class="tescheaten">CS First Stage</div><div><a ...>...</a></div>
    const linkGameRegex = /(?:<div class=["']tescheaten["'][^>]*>([^<]+)<\/div>\s*)?(?:<div>)?\s*<a[^>]*href=["'][^"']*\/games\/s(\d+)\.html["'][^>]*>\s*([A-Za-z]+)\s+([\d*]+)\s*-\s*([\d*]+)\s+([A-Za-z]+)\s*<\/a>/gi;
    let gameMatch;

    while ((gameMatch = linkGameRegex.exec(cellContent)) !== null) {
      const specialStage = gameMatch[1];
      const gameId = gameMatch[2];
      const rawAway = gameMatch[3];
      const awayScoreStr = gameMatch[4];
      const homeScoreStr = gameMatch[5];
      const rawHome = gameMatch[6];

      // Skip non-regular season games unless includePostseason is requested
      if (specialStage && !options.includePostseason) {
        continue;
      }

      // Skip NPB All-Star Games (CL vs PL exhibition)
      if ((rawAway === 'CL' && rawHome === 'PL') || (rawAway === 'PL' && rawHome === 'CL')) {
        continue;
      }

      const awayTeam = resolveNpbTeam(rawAway);
      const homeTeam = resolveNpbTeam(rawHome);

      if (!awayTeam || !homeTeam) {
        console.warn(`Could not resolve NPB teams: "${rawAway}" vs "${rawHome}" on ${officialDate}`);
        continue;
      }

      // Check for postponed / cancelled (* - *)
      if (awayScoreStr === '*' || homeScoreStr === '*') {
        games.push({
          gamePk: gameId,
          gameDate: `${officialDate}T18:00:00+09:00`,
          officialDate,
          stage: specialStage || null,
          status: { detailedState: 'Postponed', abstractGameState: 'F' },
          teams: {
            away: {
              team: { id: awayTeam.id, name: awayTeam.name, abbrev: awayTeam.abbrev, league: awayTeam.league, division: awayTeam.division },
              score: null,
              isWinner: false
            },
            home: {
              team: { id: homeTeam.id, name: homeTeam.name, abbrev: homeTeam.abbrev, league: homeTeam.league, division: homeTeam.division },
              score: null,
              isWinner: false
            }
          },
          isTie: false,
          isCancelled: true
        });
        continue;
      }

      const awayScore = parseInt(awayScoreStr, 10);
      const homeScore = parseInt(homeScoreStr, 10);
      const isTie = awayScore === homeScore;
      const awayWin = !isTie && awayScore > homeScore;
      const homeWin = !isTie && homeScore > awayScore;

      games.push({
        gamePk: gameId,
        gameDate: `${officialDate}T18:00:00+09:00`,
        officialDate,
        stage: specialStage || null,
        status: { detailedState: 'Final', abstractGameState: 'F' },
        teams: {
          away: {
            team: { id: awayTeam.id, name: awayTeam.name, abbrev: awayTeam.abbrev, league: awayTeam.league, division: awayTeam.division },
            score: awayScore,
            isWinner: awayWin
          },
          home: {
            team: { id: homeTeam.id, name: homeTeam.name, abbrev: homeTeam.abbrev, league: homeTeam.league, division: homeTeam.division },
            score: homeScore,
            isWinner: homeWin
          }
        },
        isTie
      });
    }

    // Format 2 (Future scheduled game without link):
    // <div>C - DB 18:00</div>
    const scheduledRegex = /(?:<div class=["']tescheaten["'][^>]*>([^<]+)<\/div>\s*)?<div>\s*([A-Za-z]+)\s*-\s*([A-Za-z]+)\s+(\d{1,2}:\d{2})\s*<\/div>/gi;
    let schedMatch;

    while ((schedMatch = scheduledRegex.exec(cellContent)) !== null) {
      if (schedMatch[1] && !options.includePostseason) continue; // Skip non-regular season unless requested
      const rawAway = schedMatch[2];
      const rawHome = schedMatch[3];
      const gameTime = schedMatch[4];

      const awayTeam = resolveNpbTeam(rawAway);
      const homeTeam = resolveNpbTeam(rawHome);

      if (!awayTeam || !homeTeam) continue;

      const cleanDate = officialDate.replace(/-/g, '');
      const gameId = `${cleanDate}_${awayTeam.abbrev}_${homeTeam.abbrev}`;

      // Only add if not already added by linked format
      if (!games.some(g => g.officialDate === officialDate && g.teams.away.team.id === awayTeam.id && g.teams.home.team.id === homeTeam.id)) {
        games.push({
          gamePk: gameId,
          gameDate: `${officialDate}T${gameTime}:00+09:00`,
          officialDate,
          stage: schedMatch[1] || null,
          status: { detailedState: 'Scheduled', abstractGameState: 'P' },
          teams: {
            away: {
              team: { id: awayTeam.id, name: awayTeam.name, abbrev: awayTeam.abbrev, league: awayTeam.league, division: awayTeam.division },
              score: null,
              isWinner: false
            },
            home: {
              team: { id: homeTeam.id, name: homeTeam.name, abbrev: homeTeam.abbrev, league: homeTeam.league, division: homeTeam.division },
              score: null,
              isWinner: false
            }
          },
          isTie: false
        });
      }
    }
  }

  return games;
}

export const parseNpbCalendarHTML = parseNpbCalendarHtml;

/**
 * Calculates NPB Climax Series Final Stage advantage wins (1 or 2).
 * 
 * Rules:
 * Prior to 2026: Flat +1 advantage for the league champion (Best of 6, 4 wins needed).
 * Starting in 2026:
 * The league champion (seed 1) receives a +2 advantage (Best of 7, 5 wins needed) IF:
 *   1. The games back (GB) between seed 1 and the First Stage winner is >= 10.0 games, OR
 *   2. The First Stage winner had a regular season winning percentage < .500.
 * Otherwise, the standard +1 advantage applies (Best of 6, 4 wins needed).
 */
export function calculateNpbFinalStageAdvantage(seed1Record, firstStageWinnerRecord, season = 2026) {
  const sNum = parseInt(season, 10);
  if (sNum < 2026) {
    return { advantageWins: 1, winsNeeded: 4, format: 'Best of 6 (+1 Adv)' };
  }

  if (!seed1Record || !firstStageWinnerRecord) {
    return { advantageWins: 1, winsNeeded: 4, format: 'Best of 6 (+1 Adv)' };
  }

  const w1 = seed1Record.w ?? seed1Record.wins ?? 0;
  const l1 = seed1Record.l ?? seed1Record.losses ?? 0;
  const w2 = firstStageWinnerRecord.w ?? firstStageWinnerRecord.wins ?? 0;
  const l2 = firstStageWinnerRecord.l ?? firstStageWinnerRecord.losses ?? 0;

  // Games Back: ((w1 - w2) + (l2 - l1)) / 2
  const gb = ((w1 - w2) + (l2 - l1)) / 2;

  // Win percentage excluding ties (official NPB rule: wins / (wins + losses))
  const totalDecisions = w2 + l2;
  const winPct = totalDecisions > 0 ? (w2 / totalDecisions) : 0.500;

  if (gb >= 10.0 || winPct < 0.500) {
    return { advantageWins: 2, winsNeeded: 5, format: 'Best of 7 (+2 Adv)', gb, winPct };
  }

  return { advantageWins: 1, winsNeeded: 4, format: 'Best of 6 (+1 Adv)', gb, winPct };
}

/**
 * Calculates regular season records (wins, losses, ties) from completed regular season games
 */
export function calculateStandingsFromGames(games = []) {
  const records = {};
  if (!Array.isArray(games)) return records;
  games.forEach(g => {
    const isFinal = Boolean(
      g.isFinal ||
      (g.status && (g.status.detailedState === 'Final' || g.status.abstractGameState === 'F'))
    );
    if (!isFinal) return;

    const awayTeam = resolveNpbTeam(g.teams?.away?.team?.name || g.away);
    const homeTeam = resolveNpbTeam(g.teams?.home?.team?.name || g.home);
    const awayScore = typeof g.teams?.away?.score === 'number' ? g.teams.away.score : (typeof g.awayScore === 'number' ? g.awayScore : null);
    const homeScore = typeof g.teams?.home?.score === 'number' ? g.teams.home.score : (typeof g.homeScore === 'number' ? g.homeScore : null);

    if (!awayTeam || !homeTeam || awayScore === null || homeScore === null) return;

    if (!records[awayTeam.id]) records[awayTeam.id] = { id: awayTeam.id, name: awayTeam.name, wins: 0, losses: 0, ties: 0 };
    if (!records[homeTeam.id]) records[homeTeam.id] = { id: homeTeam.id, name: homeTeam.name, wins: 0, losses: 0, ties: 0 };

    if (awayScore > homeScore) {
      records[awayTeam.id].wins++;
      records[homeTeam.id].losses++;
    } else if (homeScore > awayScore) {
      records[homeTeam.id].wins++;
      records[awayTeam.id].losses++;
    } else {
      records[awayTeam.id].ties++;
      records[homeTeam.id].ties++;
    }
  });
  return records;
}

/**
 * Default fallback 2026 NPB postseason data for offline execution.
 */
export function getDefault2026NpbPostseasonData() {
  return {
    '2026': {
      era: 'climax_series',
      isStarted: false,
      isComplete: false,
      CL: {
        seeds: {
          1: { id: 3002, name: 'Hanshin Tigers', shortName: 'Tigers' },
          2: { id: 3001, name: 'Yomiuri Giants', shortName: 'Giants' },
          3: { id: 3003, name: 'Yokohama DeNA BayStars', shortName: 'BayStars' }
        },
        firstStage: {
          name: 'Central League First Stage',
          format: 'Best of 3',
          team2: { id: 3001, name: 'Yomiuri Giants', shortName: 'Giants', wins: 0, isWinner: false, isEliminated: false },
          team3: { id: 3003, name: 'Yokohama DeNA BayStars', shortName: 'BayStars', wins: 0, isWinner: false, isEliminated: false },
          isStarted: false,
          isComplete: false,
          games: [
            { game: 1, date: '2026-10-10', away: 'Yokohama DeNA BayStars', home: 'Yomiuri Giants' },
            { game: 2, date: '2026-10-11', away: 'Yokohama DeNA BayStars', home: 'Yomiuri Giants' },
            { game: 3, date: '2026-10-12', away: 'Yokohama DeNA BayStars', home: 'Yomiuri Giants', ifNeeded: true }
          ]
        },
        finalStage: {
          name: 'Central League Final Stage',
          format: 'Best of 6 (+1 Adv)',
          winsNeeded: 4,
          team1: { id: 3002, name: 'Hanshin Tigers', shortName: 'Tigers', wins: 1, advantageWins: 1, isWinner: false, isEliminated: false, hasAdvantage: true },
          adv: { name: 'First Stage Winner', shortName: 'First Winner', wins: 0, isWinner: false, isEliminated: false },
          isStarted: false,
          isComplete: false,
          games: [
            { game: 1, date: '2026-10-14', away: 'First Stage Winner', home: 'Hanshin Tigers' },
            { game: 2, date: '2026-10-15', away: 'First Stage Winner', home: 'Hanshin Tigers' },
            { game: 3, date: '2026-10-16', away: 'First Stage Winner', home: 'Hanshin Tigers' },
            { game: 4, date: '2026-10-17', away: 'First Stage Winner', home: 'Hanshin Tigers', ifNeeded: true },
            { game: 5, date: '2026-10-18', away: 'First Stage Winner', home: 'Hanshin Tigers', ifNeeded: true },
            { game: 6, date: '2026-10-19', away: 'First Stage Winner', home: 'Hanshin Tigers', ifNeeded: true }
          ]
        },
        pennantWinner: null
      },
      PL: {
        seeds: {
          1: { id: 3007, name: 'Fukuoka SoftBank Hawks', shortName: 'Hawks' },
          2: { id: 3012, name: 'Saitama Seibu Lions', shortName: 'Lions' },
          3: { id: 3008, name: 'Hokkaido Nippon-Ham Fighters', shortName: 'Fighters' }
        },
        firstStage: {
          name: 'Pacific League First Stage',
          format: 'Best of 3',
          team2: { id: 3012, name: 'Saitama Seibu Lions', shortName: 'Lions', wins: 0, isWinner: false, isEliminated: false },
          team3: { id: 3008, name: 'Hokkaido Nippon-Ham Fighters', shortName: 'Fighters', wins: 0, isWinner: false, isEliminated: false },
          isStarted: false,
          isComplete: false,
          games: [
            { game: 1, date: '2026-10-10', away: 'Hokkaido Nippon-Ham Fighters', home: 'Saitama Seibu Lions' },
            { game: 2, date: '2026-10-11', away: 'Hokkaido Nippon-Ham Fighters', home: 'Saitama Seibu Lions' },
            { game: 3, date: '2026-10-12', away: 'Hokkaido Nippon-Ham Fighters', home: 'Saitama Seibu Lions', ifNeeded: true }
          ]
        },
        finalStage: {
          name: 'Pacific League Final Stage',
          format: 'Best of 7 (+2 Adv)',
          winsNeeded: 5,
          team1: { id: 3007, name: 'Fukuoka SoftBank Hawks', shortName: 'Hawks', wins: 2, advantageWins: 2, isWinner: false, isEliminated: false, hasAdvantage: true },
          adv: { name: 'First Stage Winner', shortName: 'First Winner', wins: 0, isWinner: false, isEliminated: false },
          isStarted: false,
          isComplete: false,
          games: [
            { game: 1, date: '2026-10-14', away: 'First Stage Winner', home: 'Fukuoka SoftBank Hawks' },
            { game: 2, date: '2026-10-15', away: 'First Stage Winner', home: 'Fukuoka SoftBank Hawks' },
            { game: 3, date: '2026-10-16', away: 'First Stage Winner', home: 'Fukuoka SoftBank Hawks' },
            { game: 4, date: '2026-10-17', away: 'First Stage Winner', home: 'Fukuoka SoftBank Hawks', ifNeeded: true },
            { game: 5, date: '2026-10-18', away: 'First Stage Winner', home: 'Fukuoka SoftBank Hawks', ifNeeded: true },
            { game: 6, date: '2026-10-19', away: 'First Stage Winner', home: 'Fukuoka SoftBank Hawks', ifNeeded: true },
            { game: 7, date: '2026-10-20', away: 'First Stage Winner', home: 'Fukuoka SoftBank Hawks', ifNeeded: true }
          ]
        },
        pennantWinner: null
      },
      japanSeries: {
        name: 'Japan Series',
        format: 'Best of 7',
        clTeam: { name: 'Central League Champion', shortName: 'CL Champ', wins: 0, isWinner: false },
        plTeam: { name: 'Pacific League Champion', shortName: 'PL Champ', wins: 0, isWinner: false },
        isStarted: false,
        isComplete: false,
        games: [
          { game: 1, date: '2026-10-24', away: 'Pacific League Champion', home: 'Central League Champion' },
          { game: 2, date: '2026-10-25', away: 'Pacific League Champion', home: 'Central League Champion' },
          { game: 3, date: '2026-10-27', away: 'Central League Champion', home: 'Pacific League Champion' },
          { game: 4, date: '2026-10-28', away: 'Central League Champion', home: 'Pacific League Champion' },
          { game: 5, date: '2026-10-29', away: 'Central League Champion', home: 'Pacific League Champion', ifNeeded: true },
          { game: 6, date: '2026-10-31', away: 'Pacific League Champion', home: 'Central League Champion', ifNeeded: true },
          { game: 7, date: '2026-11-01', away: 'Pacific League Champion', home: 'Central League Champion', ifNeeded: true }
        ]
      }
    }
  };
}

/**
 * Builds structured NPB postseason series from playoff events.
 */
export function parseNpbPostseason(postseasonGames = [], regularSeasonGames = [], season = '2026') {
  const sStr = String(season);
  const baseData = getDefault2026NpbPostseasonData();
  const seasonPostseason = baseData[sStr] || baseData['2026'];
  const standings = calculateStandingsFromGames(regularSeasonGames);

  if (!Array.isArray(postseasonGames) || postseasonGames.length === 0) {
    return baseData;
  }

  const clFirstGames = [];
  const clFinalGames = [];
  const plFirstGames = [];
  const plFinalGames = [];
  const jsGames = [];

  postseasonGames.forEach(g => {
    const rawStage = (g.stage || g.series || '').toLowerCase();
    const rawAway = g.away || g.teams?.away?.team?.name || '';
    const rawHome = g.home || g.teams?.home?.team?.name || '';
    const awayTeam = resolveNpbTeam(rawAway);
    const homeTeam = resolveNpbTeam(rawHome);
    const isCentral = (awayTeam && awayTeam.division === 'Central League') || (homeTeam && homeTeam.division === 'Central League') || (g.league && g.league.includes('Central'));
    const isPacific = (awayTeam && awayTeam.division === 'Pacific League') || (homeTeam && homeTeam.division === 'Pacific League') || (g.league && g.league.includes('Pacific'));

    if (rawStage.includes('japan') || rawStage.includes('nippon') || (isCentral && isPacific)) {
      jsGames.push(g);
    } else if (rawStage.includes('first') || rawStage.includes('1st')) {
      if (isCentral) clFirstGames.push(g);
      else if (isPacific) plFirstGames.push(g);
      else clFirstGames.push(g);
    } else if (rawStage.includes('final')) {
      if (isCentral) clFinalGames.push(g);
      else if (isPacific) plFinalGames.push(g);
      else clFinalGames.push(g);
    } else {
      if (isCentral) clFirstGames.push(g);
      else if (isPacific) plFirstGames.push(g);
      else jsGames.push(g);
    }
  });

  function processSeries(seriesObj, gamesList, winsNeeded, advantageWins = 0) {
    if (!seriesObj) return;
    const initialAdv = typeof advantageWins === 'number' ? advantageWins : (advantageWins ? 1 : 0);

    if (!Array.isArray(gamesList) || gamesList.length === 0) {
      if (initialAdv > 0 && seriesObj.team1) {
        seriesObj.team1.wins = initialAdv;
        seriesObj.team1.advantageWins = initialAdv;
        seriesObj.team1.hasAdvantage = true;
      }
      return;
    }

    // Check if any games in this series have actually started or completed
    const hasStarted = gamesList.some(g =>
      Boolean(
        g.isFinal ||
        (g.status && (g.status.detailedState === 'Final' || g.status.abstractGameState === 'F')) ||
        (typeof g.awayScore === 'number' && typeof g.homeScore === 'number') ||
        (typeof g.teams?.away?.score === 'number' && typeof g.teams?.home?.score === 'number')
      )
    );
    if (!hasStarted) {
      seriesObj.isStarted = false;
      if (initialAdv > 0 && seriesObj.team1) {
        seriesObj.team1.wins = initialAdv;
        seriesObj.team1.advantageWins = initialAdv;
        seriesObj.team1.hasAdvantage = true;
      }
      return;
    }

    seriesObj.isStarted = true;
    const parsedGames = [];
    let winsTop = initialAdv;
    let winsBot = 0;

    gamesList.forEach((g, idx) => {
      const rawAway = g.away || g.teams?.away?.team?.name || '';
      const rawHome = g.home || g.teams?.home?.team?.name || '';
      const awayTeam = resolveNpbTeam(rawAway);
      const homeTeam = resolveNpbTeam(rawHome);
      const awayName = awayTeam?.name || (typeof g.away === 'string' ? g.away : 'Away');
      const homeName = homeTeam?.name || (typeof g.home === 'string' ? g.home : 'Home');
      const awayScore = typeof g.awayScore === 'number' ? g.awayScore : (g.teams?.away?.score ?? null);
      const homeScore = typeof g.homeScore === 'number' ? g.homeScore : (g.teams?.home?.score ?? null);
      const isFinal = Boolean(g.isFinal || (g.status && (g.status.detailedState === 'Final' || g.status.abstractGameState === 'F')));

      let winnerId = null;
      if (isFinal && awayScore !== null && homeScore !== null) {
        if (awayScore > homeScore) {
          winnerId = awayTeam?.id || null;
        } else if (homeScore > awayScore) {
          winnerId = homeTeam?.id || null;
        }
      } else if (g.winnerId) {
        winnerId = g.winnerId;
      }

      parsedGames.push({
        game: idx + 1,
        date: g.officialDate || g.date,
        away: awayName,
        home: homeName,
        awayScore,
        homeScore,
        winnerId,
        isFinal
      });

      const topId = seriesObj.team1?.id || seriesObj.team2?.id || seriesObj.clTeam?.id;
      const botId = seriesObj.adv?.id || seriesObj.team3?.id || seriesObj.plTeam?.id;

      if (winnerId && topId && winnerId === topId) winsTop++;
      else if (winnerId && botId && winnerId === botId) winsBot++;
      else if (winnerId && awayTeam && winnerId === awayTeam.id) winsBot++;
      else if (winnerId && homeTeam && winnerId === homeTeam.id) winsTop++;
    });

    seriesObj.games = parsedGames;
    if (seriesObj.team1) {
      seriesObj.team1.wins = winsTop;
      if (initialAdv > 0) {
        seriesObj.team1.advantageWins = initialAdv;
        seriesObj.team1.hasAdvantage = true;
      }
    }
    if (seriesObj.team2) seriesObj.team2.wins = winsTop;
    if (seriesObj.clTeam) seriesObj.clTeam.wins = winsTop;

    if (seriesObj.adv) seriesObj.adv.wins = winsBot;
    if (seriesObj.team3) seriesObj.team3.wins = winsBot;
    if (seriesObj.plTeam) seriesObj.plTeam.wins = winsBot;

    if (winsTop >= winsNeeded) {
      seriesObj.isComplete = true;
      seriesObj.winnerId = seriesObj.team1?.id || seriesObj.team2?.id || seriesObj.clTeam?.id;
      if (seriesObj.team1) seriesObj.team1.isWinner = true;
      if (seriesObj.team2) seriesObj.team2.isWinner = true;
      if (seriesObj.clTeam) seriesObj.clTeam.isWinner = true;
      if (seriesObj.adv) seriesObj.adv.isEliminated = true;
      if (seriesObj.team3) seriesObj.team3.isEliminated = true;
      if (seriesObj.plTeam) seriesObj.plTeam.isEliminated = true;
    } else if (winsBot >= winsNeeded) {
      seriesObj.isComplete = true;
      seriesObj.winnerId = seriesObj.adv?.id || seriesObj.team3?.id || seriesObj.plTeam?.id;
      if (seriesObj.adv) seriesObj.adv.isWinner = true;
      if (seriesObj.team3) seriesObj.team3.isWinner = true;
      if (seriesObj.plTeam) seriesObj.plTeam.isWinner = true;
      if (seriesObj.team1) seriesObj.team1.isEliminated = true;
      if (seriesObj.team2) seriesObj.team2.isEliminated = true;
      if (seriesObj.clTeam) seriesObj.clTeam.isEliminated = true;
    }
  }

  processSeries(seasonPostseason.CL.firstStage, clFirstGames, 2, false);
  processSeries(seasonPostseason.PL.firstStage, plFirstGames, 2, false);

  // Advance First Stage winners into Final Stage
  if (seasonPostseason.CL?.firstStage?.isComplete && seasonPostseason.CL.firstStage.winnerId) {
    const wId = seasonPostseason.CL.firstStage.winnerId;
    const fs = seasonPostseason.CL.firstStage;
    const winnerTeam = (fs.team3?.id === wId) ? fs.team3 : ((fs.team2?.id === wId) ? fs.team2 : null);
    if (winnerTeam && seasonPostseason.CL.finalStage) {
      seasonPostseason.CL.finalStage.adv = {
        id: winnerTeam.id,
        name: winnerTeam.name,
        shortName: winnerTeam.shortName || winnerTeam.name,
        wins: 0,
        isWinner: false,
        isEliminated: false
      };
      if (Array.isArray(seasonPostseason.CL.finalStage.games)) {
        seasonPostseason.CL.finalStage.games.forEach(g => {
          if (g.away === 'First Stage Winner' || g.away === 'First Winner') {
            g.away = winnerTeam.name;
          }
        });
      }
    }
  }

  if (seasonPostseason.PL?.firstStage?.isComplete && seasonPostseason.PL.firstStage.winnerId) {
    const wId = seasonPostseason.PL.firstStage.winnerId;
    const fs = seasonPostseason.PL.firstStage;
    const winnerTeam = (fs.team3?.id === wId) ? fs.team3 : ((fs.team2?.id === wId) ? fs.team2 : null);
    if (winnerTeam && seasonPostseason.PL.finalStage) {
      seasonPostseason.PL.finalStage.adv = {
        id: winnerTeam.id,
        name: winnerTeam.name,
        shortName: winnerTeam.shortName || winnerTeam.name,
        wins: 0,
        isWinner: false,
        isEliminated: false
      };
      if (Array.isArray(seasonPostseason.PL.finalStage.games)) {
        seasonPostseason.PL.finalStage.games.forEach(g => {
          if (g.away === 'First Stage Winner' || g.away === 'First Winner') {
            g.away = winnerTeam.name;
          }
        });
      }
    }
  }

  // Calculate dynamic Final Stage advantage rules (2026+ revision)
  const clSeed1Record = standings[seasonPostseason.CL?.seeds?.['1']?.id] || { wins: 79, losses: 62, ties: 2 };
  const clAdvId = seasonPostseason.CL?.finalStage?.adv?.id || seasonPostseason.CL?.firstStage?.winnerId || seasonPostseason.CL?.seeds?.['3']?.id || seasonPostseason.CL?.seeds?.['2']?.id;
  const clChallengerRecord = standings[clAdvId] || { wins: 71, losses: 69, ties: 3 };
  const clAdvantage = calculateNpbFinalStageAdvantage(clSeed1Record, clChallengerRecord, season);

  if (seasonPostseason.CL?.finalStage) {
    seasonPostseason.CL.finalStage.format = clAdvantage.format;
    seasonPostseason.CL.finalStage.winsNeeded = clAdvantage.winsNeeded;
    if (seasonPostseason.CL.finalStage.team1) {
      seasonPostseason.CL.finalStage.team1.advantageWins = clAdvantage.advantageWins;
      seasonPostseason.CL.finalStage.team1.hasAdvantage = true;
      if (!clFinalGames || clFinalGames.length === 0) {
        seasonPostseason.CL.finalStage.team1.wins = clAdvantage.advantageWins;
      }
    }
  }

  const plSeed1Record = standings[seasonPostseason.PL?.seeds?.['1']?.id] || { wins: 91, losses: 49, ties: 3 };
  const plAdvId = seasonPostseason.PL?.finalStage?.adv?.id || seasonPostseason.PL?.firstStage?.winnerId || seasonPostseason.PL?.seeds?.['3']?.id || seasonPostseason.PL?.seeds?.['2']?.id;
  const plChallengerRecord = standings[plAdvId] || { wins: 78, losses: 62, ties: 3 };
  const plAdvantage = calculateNpbFinalStageAdvantage(plSeed1Record, plChallengerRecord, season);

  if (seasonPostseason.PL?.finalStage) {
    seasonPostseason.PL.finalStage.format = plAdvantage.format;
    seasonPostseason.PL.finalStage.winsNeeded = plAdvantage.winsNeeded;
    if (seasonPostseason.PL.finalStage.team1) {
      seasonPostseason.PL.finalStage.team1.advantageWins = plAdvantage.advantageWins;
      seasonPostseason.PL.finalStage.team1.hasAdvantage = true;
      if (!plFinalGames || plFinalGames.length === 0) {
        seasonPostseason.PL.finalStage.team1.wins = plAdvantage.advantageWins;
      }
    }
    if (plAdvantage.winsNeeded === 5 && Array.isArray(seasonPostseason.PL.finalStage.games) && seasonPostseason.PL.finalStage.games.length === 6) {
      const g6 = seasonPostseason.PL.finalStage.games[5];
      seasonPostseason.PL.finalStage.games.push({
        game: 7,
        date: '2026-10-20',
        away: g6?.away || 'First Stage Winner',
        home: g6?.home || 'Fukuoka SoftBank Hawks',
        ifNeeded: true
      });
    }
  }

  processSeries(seasonPostseason.CL.finalStage, clFinalGames, clAdvantage.winsNeeded, clAdvantage.advantageWins);
  processSeries(seasonPostseason.PL.finalStage, plFinalGames, plAdvantage.winsNeeded, plAdvantage.advantageWins);

  // If Final Stage completes, advance pennant winner / league champ into Japan Series
  if (seasonPostseason.CL?.finalStage?.isComplete && seasonPostseason.CL.finalStage.winnerId) {
    const wId = seasonPostseason.CL.finalStage.winnerId;
    const fs = seasonPostseason.CL.finalStage;
    const winnerTeam = (fs.team1?.id === wId) ? fs.team1 : ((fs.adv?.id === wId) ? fs.adv : null);
    if (winnerTeam) {
      seasonPostseason.CL.pennantWinner = winnerTeam;
      if (seasonPostseason.japanSeries?.clTeam) {
        seasonPostseason.japanSeries.clTeam = {
          id: winnerTeam.id,
          name: winnerTeam.name,
          shortName: winnerTeam.shortName || winnerTeam.name,
          wins: 0,
          isWinner: false
        };
      }
    }
  }

  if (seasonPostseason.PL?.finalStage?.isComplete && seasonPostseason.PL.finalStage.winnerId) {
    const wId = seasonPostseason.PL.finalStage.winnerId;
    const fs = seasonPostseason.PL.finalStage;
    const winnerTeam = (fs.team1?.id === wId) ? fs.team1 : ((fs.adv?.id === wId) ? fs.adv : null);
    if (winnerTeam) {
      seasonPostseason.PL.pennantWinner = winnerTeam;
      if (seasonPostseason.japanSeries?.plTeam) {
        seasonPostseason.japanSeries.plTeam = {
          id: winnerTeam.id,
          name: winnerTeam.name,
          shortName: winnerTeam.shortName || winnerTeam.name,
          wins: 0,
          isWinner: false
        };
      }
    }
  }

  processSeries(seasonPostseason.japanSeries, jsGames, 4, false);

  seasonPostseason.isStarted = Boolean(
    seasonPostseason.CL?.firstStage?.isStarted ||
    seasonPostseason.PL?.firstStage?.isStarted ||
    seasonPostseason.CL?.finalStage?.isStarted ||
    seasonPostseason.PL?.finalStage?.isStarted ||
    seasonPostseason.japanSeries?.isStarted
  );
  seasonPostseason.isComplete = Boolean(
    seasonPostseason.japanSeries?.isComplete
  );

  return { [sStr]: seasonPostseason };
}

/**
 * Updates NPB_POSTSEASON_DATA in src/constants/postseasonSeriesData.js with fresh results
 */
export function updateNpbPostseasonSeriesDataConstant(rootDir, npb2026Data) {
  if (!npb2026Data) return;
  const targetFile = path.join(rootDir, 'src', 'constants', 'postseasonSeriesData.js');
  if (!fs.existsSync(targetFile)) return;

  try {
    let content = fs.readFileSync(targetFile, 'utf-8');
    const npbRegex = /(const\s+NPB_POSTSEASON_DATA\s*=\s*{[\s\S]*?'2026':\s*){[\s\S]*?}(\s*,\s*['"]2025['"])/;
    if (npbRegex.test(content)) {
      const indentedJson = JSON.stringify(npb2026Data, null, 6)
        .replace(/\n/g, '\n      ');
      content = content.replace(npbRegex, `$1${indentedJson}$2`);
      fs.writeFileSync(targetFile, content, 'utf-8');
      console.log(`  🔄 [Updated] ${path.relative(rootDir, targetFile)} NPB_POSTSEASON_DATA['2026']`);
    }
  } catch (err) {
    console.warn('  ⚠️ Could not update postseasonSeriesData.js for NPB:', err.message);
  }
}

/**
 * Scrapes and compiles full NPB season into static JSON datasets
 */
export async function scrapeNpbSeason(season = '2026', options = {}) {
  const { forceRefresh = false } = options;
  console.log(`🇯🇵 Compiling NPB ${season} Regular Season Data...`);

  // Months active in NPB regular season (04 = Mar/Apr, 05 = May, 06 = Jun, 07 = Jul, 08 = Aug, 09 = Sep, 10 = Oct, 11 = Nov for Olympic-delayed seasons)
  const months = ['04', '05', '06', '07', '08', '09', '10', '11'];
  const allGames = [];
  const allPostseasonGames = [];

  for (const month of months) {
    try {
      const html = await fetchMonthHtml(season, month, { forceRefresh });
      if (!html) {
        continue;
      }
      const monthGames = parseNpbCalendarHtml(html, season, month, { includePostseason: false });
      console.log(`  Month ${month}: parsed ${monthGames.length} regular season games`);
      allGames.push(...monthGames);

      // Parse and collect postseason games in October and November
      if (month === '10' || month === '11') {
        const monthAllGames = parseNpbCalendarHtml(html, season, month, { includePostseason: true });
        const psOnly = monthAllGames.filter(g => g.stage && (
          g.stage.toLowerCase().includes('cs') ||
          g.stage.toLowerCase().includes('stage') ||
          g.stage.toLowerCase().includes('climax') ||
          g.stage.toLowerCase().includes('japan') ||
          g.stage.toLowerCase().includes('nippon')
        ));
        allPostseasonGames.push(...psOnly);
      }
    } catch (err) {
      console.error(`  ❌ Error processing month ${month}:`, err.message);
    }
  }

  // Deduplicate and sort chronologically by officialDate and gamePk
  const uniqueMap = new Map();
  allGames.forEach(g => {
    uniqueMap.set(g.gamePk, g);
  });
  const dedupedGames = Array.from(uniqueMap.values());

  dedupedGames.sort((a, b) => {
    if (a.officialDate !== b.officialDate) {
      return a.officialDate.localeCompare(b.officialDate);
    }
    return String(a.gamePk).localeCompare(String(b.gamePk));
  });

  const uniquePsMap = new Map();
  allPostseasonGames.forEach(g => {
    uniquePsMap.set(g.gamePk, g);
  });
  const dedupedPsGames = Array.from(uniquePsMap.values());

  const finalGames = dedupedGames.filter(g => g.status?.detailedState === 'Final');
  const tieGames = finalGames.filter(g => g.isTie);

  console.log(`\n📊 Season Summary (${season}):`);
  console.log(`   Total Games Recorded: ${dedupedGames.length}`);
  console.log(`   Final Games Completed: ${finalGames.length}`);
  console.log(`   Tie Games: ${tieGames.length}`);
  console.log(`   Postseason Games Scraped: ${dedupedPsGames.length}`);

  // Summary per team by division
  const teamRecords = {};
  finalGames.forEach(g => {
    const home = g.teams.home;
    const away = g.teams.away;

    if (!teamRecords[home.team.id]) {
      teamRecords[home.team.id] = { name: home.team.name, division: home.team.division, w: 0, l: 0, t: 0 };
    }
    if (!teamRecords[away.team.id]) {
      teamRecords[away.team.id] = { name: away.team.name, division: away.team.division, w: 0, l: 0, t: 0 };
    }

    if (g.isTie) {
      teamRecords[home.team.id].t += 1;
      teamRecords[away.team.id].t += 1;
    } else if (home.isWinner) {
      teamRecords[home.team.id].w += 1;
      teamRecords[away.team.id].l += 1;
    } else if (away.isWinner) {
      teamRecords[away.team.id].w += 1;
      teamRecords[home.team.id].l += 1;
    }
  });

  const centralTeams = Object.values(teamRecords).filter(t => t.division === 'Central League');
  const pacificTeams = Object.values(teamRecords).filter(t => t.division === 'Pacific League');

  const printDivision = (title, teams) => {
    console.log(`\n🏆 ${title} Standings (W-L-T):`);
    teams
      .sort((a, b) => {
        const pctA = (a.w + a.l) > 0 ? a.w / (a.w + a.l) : 0;
        const pctB = (b.w + b.l) > 0 ? b.w / (b.w + b.l) : 0;
        return pctB - pctA;
      })
      .forEach((t, idx) => {
        const pct = (t.w + t.l) > 0 ? (t.w / (t.w + t.l)).toFixed(3) : '.000';
        console.log(`   ${String(idx + 1).padStart(2, ' ')}. ${t.name.padEnd(28, ' ')} ${t.w}-${t.l}-${t.t}  (${pct})`);
      });
  };

  printDivision('Central League', centralTeams);
  printDivision('Pacific League', pacificTeams);

  // Target paths (supports both standalone scraper repo and full web app repo)
  const targets = [];
  const publicDir = path.join(rootDir, 'public', 'data', 'npb');
  const srcDataDir = path.join(rootDir, 'src', 'data', 'npb');
  const standaloneDir = path.join(rootDir, 'data', 'npb');

  if (fs.existsSync(path.join(rootDir, 'public'))) {
    targets.push(path.join(publicDir, `${season}.json`));
  }
  if (fs.existsSync(path.join(rootDir, 'src'))) {
    targets.push(path.join(srcDataDir, `${season}.json`));
  }
  if (targets.length === 0 || fs.existsSync(standaloneDir)) {
    targets.push(path.join(standaloneDir, `${season}.json`));
  }

  targets.forEach(targetFile => {
    const parent = path.dirname(targetFile);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
  });

  const serializedData = JSON.stringify(dedupedGames, null, 2);

  targets.forEach(targetFile => {
    if (fs.existsSync(targetFile)) {
      const existingContent = fs.readFileSync(targetFile, 'utf-8');
      if (existingContent === serializedData) {
        console.log(`  ✨ [No Diff] ${path.relative(rootDir, targetFile)} is already up to date.`);
        return;
      }
    }
    fs.writeFileSync(targetFile, serializedData, 'utf-8');
    console.log(`  💾 [Written] ${path.relative(rootDir, targetFile)} (${(serializedData.length / 1024).toFixed(1)} KB)`);
  });

  // If src/data/npb exists, also keep the embedded JS file in sync for file:// protocol support
  const embeddedJsTarget = path.join(srcDataDir, `${season}.js`);
  if (fs.existsSync(srcDataDir)) {
    const jsContent = `/**
 * Embedded ${season} NPB Schedule & Results Dataset
 * Enables zero-server local execution (file:/// protocol) without CORS restrictions.
 */
(function() {
  const games = ${serializedData};
  if (typeof window !== "undefined") {
    window.NPB_STATIC_DATA = window.NPB_STATIC_DATA || {};
    window.NPB_STATIC_DATA["${season}"] = games;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = games;
  }
})();
`;
    if (fs.existsSync(embeddedJsTarget) && fs.readFileSync(embeddedJsTarget, 'utf-8') === jsContent) {
      console.log(`  ✨ [No Diff] ${path.relative(rootDir, embeddedJsTarget)} is already up to date.`);
    } else {
      fs.writeFileSync(embeddedJsTarget, jsContent, 'utf-8');
      console.log(`  💾 [Written] ${path.relative(rootDir, embeddedJsTarget)} (${(jsContent.length / 1024).toFixed(1)} KB)`);
    }
  }

  // Compile & Write Postseason Data (Active 2026 season)
  const sStr = String(season);
  if (sStr === '2026') {
    const postseasonData = parseNpbPostseason(dedupedPsGames, dedupedGames, sStr);
    const serializedPostseason = JSON.stringify(postseasonData, null, 2);
    const postseasonTargets = [];
    if (fs.existsSync(path.join(rootDir, 'public'))) {
      postseasonTargets.push(path.join(publicDir, 'postseason.json'));
    }
    if (fs.existsSync(path.join(rootDir, 'src'))) {
      postseasonTargets.push(path.join(srcDataDir, 'postseason.json'));
    }
    if (postseasonTargets.length === 0 || fs.existsSync(standaloneDir)) {
      postseasonTargets.push(path.join(standaloneDir, 'postseason.json'));
    }

    postseasonTargets.forEach(targetFile => {
      const parent = path.dirname(targetFile);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
      fs.writeFileSync(targetFile, serializedPostseason, 'utf-8');
      console.log(`  🏆 [Written] ${path.relative(rootDir, targetFile)} (${(serializedPostseason.length / 1024).toFixed(1)} KB)`);
    });

    // Write Postseason Embedded JS
    if (fs.existsSync(srcDataDir)) {
      const embeddedPostseasonJsTarget = path.join(srcDataDir, 'postseason.js');
      const psJsContent = `/**
   * Embedded NPB Postseason Series Dataset
   * Enables zero-server local execution (file:/// protocol) without CORS restrictions.
   */
(function() {
  const postseason = ${serializedPostseason};
  if (typeof window !== "undefined") {
    window.NPB_POSTSEASON_STATIC = postseason;
    if (window.postseasonSeriesData && window.postseasonSeriesData.POSTSEASON_SERIES_DATA) {
      window.postseasonSeriesData.POSTSEASON_SERIES_DATA.npb = postseason;
    }
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = postseason;
  }
})();
`;
      fs.writeFileSync(embeddedPostseasonJsTarget, psJsContent, 'utf-8');
      console.log(`  🏆 [Written] ${path.relative(rootDir, embeddedPostseasonJsTarget)} (${(psJsContent.length / 1024).toFixed(1)} KB)`);
    }

    // Update src/constants/postseasonSeriesData.js with synced postseason results if file exists
    updateNpbPostseasonSeriesDataConstant(rootDir, postseasonData['2026']);
  }

  // Save scrape metadata with timestamp
  saveScrapeMetadata(rootDir, 'npb', season, dedupedGames);

  return dedupedGames;
}

/**
 * Writes data/<league>/metadata.json and updates src/constants/scrapeMeta.js if present
 */
function saveScrapeMetadata(rootDir, league, season, games) {
  const now = new Date();
  let ptString = '';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    const parts = formatter.formatToParts(now);
    const getP = t => parts.find(p => p.type === t)?.value || '';
    ptString = `${getP('year')}-${getP('month')}-${getP('day')} ${getP('hour')}:${getP('minute')} PT`;
  } catch (_e) {
    ptString = now.toISOString();
  }

  const metaObj = {
    league,
    season: String(season),
    lastUpdated: now.toISOString(),
    lastUpdatedPT: ptString,
    lastScraped: now.toISOString(),
    lastScrapedPT: ptString,
    totalGames: Array.isArray(games) ? games.length : 0,
    completedGames: Array.isArray(games) ? games.filter(g => g.status?.detailedState === 'Final').length : 0
  };

  const serialized = JSON.stringify(metaObj, null, 2);
  const candidateDirs = [
    path.join(rootDir, 'public', 'data', league),
    path.join(rootDir, 'src', 'data', league),
    path.join(rootDir, 'data', league)
  ];

  candidateDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      const metaPath = path.join(dir, 'metadata.json');
      fs.writeFileSync(metaPath, serialized, 'utf-8');
      console.log(`  ⏱️ [Metadata] ${path.relative(rootDir, metaPath)} (${ptString})`);
    }
  });

  const scrapeMetaFile = path.join(rootDir, 'src', 'constants', 'scrapeMeta.js');
  if (fs.existsSync(scrapeMetaFile)) {
    try {
      let content = fs.readFileSync(scrapeMetaFile, 'utf-8');
      const lgRegex = new RegExp(`(${league}\\s*:\\s*{[\\s\\S]*?lastScraped:\\s*['"])([^'"]+)(['"])`);
      if (lgRegex.test(content)) {
        content = content.replace(lgRegex, `$1${ptString}$3`);
      }
      const isoRegex = new RegExp(`(${league}\\s*:\\s*{[\\s\\S]*?iso:\\s*['"])([^'"]+)(['"])`);
      if (isoRegex.test(content)) {
        content = content.replace(isoRegex, `$1${now.toISOString()}$3`);
      }
      fs.writeFileSync(scrapeMetaFile, content, 'utf-8');
    } catch (_e) {}
  }
}

// CLI Execution entry point
if (process.argv[1] && process.argv[1].endsWith('scrapeNPB.js')) {
  const args = process.argv.slice(2);
  let seasons = ['2026'];
  let forceRefresh = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--season' && args[i + 1]) {
      seasons = [args[i + 1]];
      i++;
    } else if (args[i] === '--seasons' && args[i + 1]) {
      seasons = args[i + 1].split(',').map(s => s.trim()).filter(Boolean);
      i++;
    } else if (args[i] === '--all') {
      seasons = Array.from({ length: 2026 - 2005 + 1 }, (_, k) => String(2005 + k));
    } else if (args[i] === '--force' || args[i] === '--no-cache') {
      forceRefresh = true;
    }
  }

  (async () => {
    for (const yr of seasons) {
      await scrapeNpbSeason(yr, { forceRefresh });
    }
  })()
    .then(() => {
      console.log('\n✅ NPB data extraction complete.');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ NPB scraping failed:', err);
      process.exit(1);
    });
}
