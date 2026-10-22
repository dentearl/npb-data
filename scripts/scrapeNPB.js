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

  // Future months for the current year or later haven't occurred yet
  const isFutureMonth = (parseInt(season, 10) > currentYear) ||
                        (parseInt(season, 10) === currentYear && monthNum > currentMonthNum);
  if (isFutureMonth) {
    return '';
  }

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

  if (fs.existsSync(cacheFile)) {
    try {
      console.warn(`  ⚠️ Network fetch failed for ${season}-${month}. Falling back to cached file.`);
      return fs.readFileSync(cacheFile, 'utf-8');
    } catch {
      // ignore
    }
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
      isStarted: true,
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
          team2: { id: 3001, name: 'Yomiuri Giants', shortName: 'Giants', wins: 0, isWinner: false, isEliminated: true },
          team3: { id: 3003, name: 'Yokohama DeNA BayStars', shortName: 'BayStars', wins: 2, isWinner: true, isEliminated: false },
          isStarted: true,
          isComplete: true,
          games: [
            { game: 1, date: '2026-10-10', away: 'Yomiuri Giants', home: 'Yokohama DeNA BayStars', awayScore: 1, homeScore: 2, winnerId: 3003, isFinal: true },
            { game: 2, date: '2026-10-11', away: 'Yomiuri Giants', home: 'Yokohama DeNA BayStars', awayScore: 1, homeScore: 4, winnerId: 3003, isFinal: true }
          ],
          winnerId: 3003
        },
        finalStage: {
          name: 'Central League Final Stage',
          format: 'Best of 6 (+1 Adv)',
          winsNeeded: 4,
          team1: { id: 3002, name: 'Hanshin Tigers', shortName: 'Tigers', wins: 1, advantageWins: 1, isWinner: false, isEliminated: false, hasAdvantage: true },
          adv: { id: 3003, name: 'Yokohama DeNA BayStars', shortName: 'BayStars', wins: 0, isWinner: false, isEliminated: false },
          isStarted: false,
          isComplete: false,
          games: [
            { game: 1, date: '2026-10-14', away: 'Yokohama DeNA BayStars', home: 'Hanshin Tigers' },
            { game: 2, date: '2026-10-15', away: 'Yokohama DeNA BayStars', home: 'Hanshin Tigers' },
            { game: 3, date: '2026-10-16', away: 'Yokohama DeNA BayStars', home: 'Hanshin Tigers' },
            { game: 4, date: '2026-10-17', away: 'Yokohama DeNA BayStars', home: 'Hanshin Tigers', ifNeeded: true },
            { game: 5, date: '2026-10-18', away: 'Yokohama DeNA BayStars', home: 'Hanshin Tigers', ifNeeded: true },
            { game: 6, date: '2026-10-19', away: 'Yokohama DeNA BayStars', home: 'Hanshin Tigers', ifNeeded: true }
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
          team2: { id: 3012, name: 'Saitama Seibu Lions', shortName: 'Lions', wins: 1, isWinner: false, isEliminated: true },
          team3: { id: 3008, name: 'Hokkaido Nippon-Ham Fighters', shortName: 'Fighters', wins: 2, isWinner: true, isEliminated: false },
          isStarted: true,
          isComplete: true,
          games: [
            { game: 1, date: '2026-10-10', away: 'Saitama Seibu Lions', home: 'Hokkaido Nippon-Ham Fighters', awayScore: 3, homeScore: 2, winnerId: 3012, isFinal: true },
            { game: 2, date: '2026-10-11', away: 'Saitama Seibu Lions', home: 'Hokkaido Nippon-Ham Fighters', awayScore: 0, homeScore: 1, winnerId: 3008, isFinal: true },
            { game: 3, date: '2026-10-12', away: 'Saitama Seibu Lions', home: 'Hokkaido Nippon-Ham Fighters', awayScore: 1, homeScore: 4, winnerId: 3008, isFinal: true }
          ],
          winnerId: 3008
        },
        finalStage: {
          name: 'Pacific League Final Stage',
          format: 'Best of 7 (+2 Adv)',
          winsNeeded: 5,
          team1: { id: 3007, name: 'Fukuoka SoftBank Hawks', shortName: 'Hawks', wins: 2, advantageWins: 2, isWinner: false, isEliminated: false, hasAdvantage: true },
          adv: { id: 3008, name: 'Hokkaido Nippon-Ham Fighters', shortName: 'Fighters', wins: 0, isWinner: false, isEliminated: false },
          isStarted: false,
          isComplete: false,
          games: [
            { game: 1, date: '2026-10-14', away: 'Hokkaido Nippon-Ham Fighters', home: 'Fukuoka SoftBank Hawks' },
            { game: 2, date: '2026-10-15', away: 'Hokkaido Nippon-Ham Fighters', home: 'Fukuoka SoftBank Hawks' },
            { game: 3, date: '2026-10-16', away: 'Hokkaido Nippon-Ham Fighters', home: 'Fukuoka SoftBank Hawks' },
            { game: 4, date: '2026-10-17', away: 'Hokkaido Nippon-Ham Fighters', home: 'Fukuoka SoftBank Hawks', ifNeeded: true },
            { game: 5, date: '2026-10-18', away: 'Hokkaido Nippon-Ham Fighters', home: 'Fukuoka SoftBank Hawks', ifNeeded: true },
            { game: 6, date: '2026-10-19', away: 'Hokkaido Nippon-Ham Fighters', home: 'Fukuoka SoftBank Hawks', ifNeeded: true },
            { game: 7, date: '2026-10-20', away: 'Hokkaido Nippon-Ham Fighters', home: 'Fukuoka SoftBank Hawks', ifNeeded: true }
          ]
        },
        pennantWinner: null
      },
      japanSeries: {
        name: 'Japan Series',
        format: 'Best of 7',
        clTeam: { id: 3003, name: 'Yokohama DeNA BayStars', shortName: 'BayStars', wins: 0, isWinner: false },
        plTeam: { id: 3007, name: 'Fukuoka SoftBank Hawks', shortName: 'Hawks', wins: 0, isWinner: false },
        isStarted: false,
        isComplete: false,
        games: [
          { game: 1, date: '2026-10-24', away: 'Fukuoka SoftBank Hawks', home: 'Yokohama DeNA BayStars' },
          { game: 2, date: '2026-10-25', away: 'Fukuoka SoftBank Hawks', home: 'Yokohama DeNA BayStars' },
          { game: 3, date: '2026-10-27', away: 'Yokohama DeNA BayStars', home: 'Fukuoka SoftBank Hawks' },
          { game: 4, date: '2026-10-28', away: 'Yokohama DeNA BayStars', home: 'Fukuoka SoftBank Hawks' },
          { game: 5, date: '2026-10-29', away: 'Yokohama DeNA BayStars', home: 'Fukuoka SoftBank Hawks', ifNeeded: true },
          { game: 6, date: '2026-10-31', away: 'Fukuoka SoftBank Hawks', home: 'Yokohama DeNA BayStars', ifNeeded: true },
          { game: 7, date: '2026-11-01', away: 'Fukuoka SoftBank Hawks', home: 'Yokohama DeNA BayStars', ifNeeded: true }
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
 * Ingests full season schedule & scores from BaseballFreak (baseball-freak.com/game/{YY}/)
 * Covers seasons 2009 through 2025.
 */
export async function fetchBaseballFreakSeason(season) {
  const yy = String(season).slice(2);
  const url = `https://baseball-freak.com/game/${yy}/`;
  console.log(`  🌐 [Freak] Fetching season ${season} archive from ${url}...`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`BaseballFreak HTTP ${response.status} ${response.statusText} for ${url}`);
  }

  const html = await response.text();
  const tableStart = html.indexOf('<table class="schedule">');
  if (tableStart === -1) {
    throw new Error(`Could not find schedule table in BaseballFreak ${season}`);
  }
  const tableEnd = html.indexOf('</table>', tableStart);
  const table = html.slice(tableStart, tableEnd);

  const teamCodeMap = {
    g: 3001, t: 3002, yb: 3003, c: 3004, d: 3005, s: 3006,
    h: 3007, f: 3008, m: 3009, e: 3010, bs: 3011, l: 3012
  };

  const games = [];
  const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
  let match;

  while ((match = rowRegex.exec(table)) !== null) {
    const row = match[1];
    const dateMatch = row.match(/<td>(?:<span[^>]*>)?(\d+)月(\d+)日/);
    if (!dateMatch) continue;
    const month = dateMatch[1].padStart(2, '0');
    const day = dateMatch[2].padStart(2, '0');
    const officialDate = `${season}-${month}-${day}`;

    const cellRegex = /<td class="[cpi]d">([\s\S]*?)<\/td>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(row)) !== null) {
      const cell = cellMatch[1];
      const gameLinkMatch = cell.match(/href="game\/\d{6}([a-z]+)-([a-z]+)\.html">([\s\S]*?)<\/a>/);
      const timeMatch = cell.match(/(\d{1,2}:\d{2})/);
      const startTime = timeMatch ? timeMatch[1] : '18:00';
      const timePadded = startTime.length === 4 ? `0${startTime}:00` : `${startTime}:00`;
      const gameDate = `${officialDate}T${timePadded}+09:00`;

      if (gameLinkMatch) {
        const homeCode = gameLinkMatch[1];
        const awayCode = gameLinkMatch[2];
        const homeId = teamCodeMap[homeCode];
        const awayId = teamCodeMap[awayCode];
        const homeTeam = Object.values(NPB_TEAM_MAPPING).find(t => t.id === homeId);
        const awayTeam = Object.values(NPB_TEAM_MAPPING).find(t => t.id === awayId);

        if (!homeTeam || !awayTeam) continue;

        const scoreSnippet = gameLinkMatch[3].replace(/<[^>]+>/g, '').trim();
        const [homeScoreStr, awayScoreStr] = scoreSnippet.split(/\s*-\s*/);
        const homeScore = parseInt(homeScoreStr, 10);
        const awayScore = parseInt(awayScoreStr, 10);

        if (isNaN(homeScore) || isNaN(awayScore)) continue;

        const isTie = homeScore === awayScore;
        const homeWin = !isTie && homeScore > awayScore;
        const awayWin = !isTie && awayScore > homeScore;
        const gamePk = `${officialDate.replace(/-/g, '')}${homeTeam.id}${awayTeam.id}`;

        games.push({
          gamePk,
          gameDate,
          officialDate,
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
    }
  }

  return games;
}

/**
 * Ingests full season schedule & scores from NF3 (nf3.sakura.ne.jp)
 * Covers seasons 2005 through 2008.
 */
export async function fetchNf3Season(season) {
  console.log(`  🌐 [NF3] Fetching season ${season} from nf3.sakura.ne.jp...`);
  const teamMeta = {
    D:  { id: 3005, leg: 0 },
    S:  { id: 3006, leg: 0 },
    G:  { id: 3001, leg: 0 },
    T:  { id: 3002, leg: 0 },
    C:  { id: 3004, leg: 0 },
    YB: { id: 3003, leg: 0 },
    L:  { id: 3012, leg: 1 },
    H:  { id: 3007, leg: 1 },
    F:  { id: 3008, leg: 1 },
    M:  { id: 3009, leg: 1 },
    Bs: { id: 3011, leg: 1 },
    E:  { id: 3010, leg: 1 }
  };

  const nameToId = {
    '中日': 3005, 'ヤクルト': 3006, '巨人': 3001, '阪神': 3002, '広島': 3004, '横浜': 3003,
    '西武': 3012, 'ソフトバンク': 3007, '日本ハム': 3008, 'ロッテ': 3009, 'オリックス': 3011, '楽天': 3010
  };

  const gamesMap = new Map();

  for (const [code, meta] of Object.entries(teamMeta)) {
    const url = `https://nf3.sakura.ne.jp/php/stat_disp/stat_disp.php?y=${season}&leg=${meta.leg}&mon=0&tm=${code}&vst=all`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      console.warn(`    ⚠️ NF3 failed for team ${code}: HTTP ${response.status}`);
      continue;
    }

    const html = await response.text();
    const tableStart = html.indexOf('<table class="Base"');
    if (tableStart === -1) continue;
    const tableEnd = html.indexOf('</table>', tableStart);
    const table = html.slice(tableStart, tableEnd);

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let match;

    while ((match = rowRegex.exec(table)) !== null) {
      const row = match[1];
      if (row.includes('<th') && (row.includes('日付') || row.includes('対戦T'))) continue;
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1].trim());
      if (cells.length < 19) continue;

      const dateStr = cells[0];
      const oppName = cells[2].replace(/<[^>]+>/g, '').trim();
      const oppId = nameToId[oppName];
      if (!oppId) continue;

      const isHome = cells[4].includes('Ｈ');
      const homeId = isHome ? meta.id : oppId;
      const awayId = isHome ? oppId : meta.id;

      const homeTeam = Object.values(NPB_TEAM_MAPPING).find(t => t.id === homeId);
      const awayTeam = Object.values(NPB_TEAM_MAPPING).find(t => t.id === awayId);
      if (!homeTeam || !awayTeam) continue;

      const [m, d] = dateStr.split('/');
      const officialDate = `${season}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      const key = `${officialDate}_${homeId}_${awayId}`;

      const scoreCell = cells[18].replace(/<[^>]+>/g, '').trim();
      const scoreMatch = scoreCell.match(/^(\d+)-(\d+)$/);
      if (scoreMatch) {
        const teamScore = parseInt(scoreMatch[1], 10);
        const oppScore = parseInt(scoreMatch[2], 10);
        const homeScore = isHome ? teamScore : oppScore;
        const awayScore = isHome ? oppScore : teamScore;
        const isTie = homeScore === awayScore;
        const homeWin = !isTie && homeScore > awayScore;
        const awayWin = !isTie && awayScore > homeScore;

        const timeStr = cells[5] ? cells[5].trim() : '18:00';
        const timePadded = timeStr.length === 4 ? `0${timeStr}:00` : (timeStr.includes(':') ? `${timeStr}:00` : '18:00:00');
        const gameDate = `${officialDate}T${timePadded}+09:00`;
        const gamePk = `${officialDate.replace(/-/g, '')}${homeTeam.id}${awayTeam.id}`;

        if (!gamesMap.has(key)) {
          gamesMap.set(key, {
            gamePk,
            gameDate,
            officialDate,
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
      }
    }
    // Respectful delay between team requests
    await new Promise(r => setTimeout(r, 150));
  }

  return Array.from(gamesMap.values());
}

/**
 * Writes data/<league>/metadata.json and updates src/constants/scrapeMeta.js if present
 */
function saveScrapeMetadata(rootDir, league, season, games) {
  if (String(season) !== '2026' && fs.existsSync(path.join(rootDir, 'data', league, 'metadata.json'))) {
    return;
  }
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

/**
 * Safely merges newly scraped NPB postseason data with existing on-disk postseason data.
 * Prevents downgrading completed series (isComplete: true) or wiping out completed games
 * if scraping fails or returns an unstarted template.
 */
export function mergeNpbPostseason(existingData, newData, seasonKey = '2026') {
  if (!existingData || !existingData[seasonKey]) return newData;
  if (!newData || !newData[seasonKey]) return existingData;

  const existingSeason = existingData[seasonKey];
  const newSeason = JSON.parse(JSON.stringify(newData[seasonKey]));
  const merged = { ...newSeason };

  function mergeSeries(existingSeries, incomingSeries) {
    if (!existingSeries) return incomingSeries;
    if (!incomingSeries) return existingSeries;

    const existingGames = Array.isArray(existingSeries.games) ? existingSeries.games : [];
    const incomingGames = Array.isArray(incomingSeries.games) ? incomingSeries.games : [];

    const existingFinals = existingGames.filter(g => g.isFinal).length;
    const incomingFinals = incomingGames.filter(g => g.isFinal).length;

    if (existingSeries.isComplete && !incomingSeries.isComplete) {
      return existingSeries;
    }
    if (existingFinals > incomingFinals) {
      return existingSeries;
    }

    const res = { ...incomingSeries };
    ['team1', 'team2', 'team3', 'adv', 'clTeam', 'plTeam'].forEach(key => {
      if (existingSeries[key] && existingSeries[key].id && (!res[key] || !res[key].id)) {
        res[key] = existingSeries[key];
      }
    });

    return res;
  }

  if (existingSeason.CL) {
    merged.CL = merged.CL || {};
    merged.CL.firstStage = mergeSeries(existingSeason.CL.firstStage, merged.CL.firstStage);
    merged.CL.finalStage = mergeSeries(existingSeason.CL.finalStage, merged.CL.finalStage);
    if (existingSeason.CL.pennantWinner && (!merged.CL.pennantWinner || !merged.CL.pennantWinner.id)) {
      merged.CL.pennantWinner = existingSeason.CL.pennantWinner;
    }
  }

  if (existingSeason.PL) {
    merged.PL = merged.PL || {};
    merged.PL.firstStage = mergeSeries(existingSeason.PL.firstStage, merged.PL.firstStage);
    merged.PL.finalStage = mergeSeries(existingSeason.PL.finalStage, merged.PL.finalStage);
    if (existingSeason.PL.pennantWinner && (!merged.PL.pennantWinner || !merged.PL.pennantWinner.id)) {
      merged.PL.pennantWinner = existingSeason.PL.pennantWinner;
    }
  }

  if (existingSeason.japanSeries) {
    merged.japanSeries = mergeSeries(existingSeason.japanSeries, merged.japanSeries);
  }

  return { [seasonKey]: merged };
}

/**
 * Persists compiled NPB games and postseason datasets to all appropriate directories
 */
export function saveDataset(season, dedupedGames, dedupedPsGames = []) {
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

  // Safety guard: if newly scraped games is empty, but an existing target file has games, preserve existing games
  let gamesToWrite = dedupedGames;
  if (!Array.isArray(gamesToWrite) || gamesToWrite.length === 0) {
    let existingGameCount = 0;
    let existingGamesOnDisk = null;
    for (const t of targets) {
      if (fs.existsSync(t)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(t, 'utf-8'));
          const gamesArr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.games) ? parsed.games : null);
          if (gamesArr && gamesArr.length > existingGameCount) {
            existingGameCount = gamesArr.length;
            existingGamesOnDisk = gamesArr;
          }
        } catch (_e) {}
      }
    }
    if (existingGameCount > 0) {
      console.warn(`  ⚠️ [Safety Guard] Scraped game count is 0, but existing dataset has ${existingGameCount} games. Preserving existing games to prevent data loss.`);
      gamesToWrite = existingGamesOnDisk;
      dedupedGames = existingGamesOnDisk;
    }
  }

  // Check if any existing target file has a postseason block to preserve
  let fileData = gamesToWrite;
  let existingPostseason = null;
  for (const t of targets) {
    if (fs.existsSync(t)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(t, 'utf-8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.postseason) {
          existingPostseason = parsed.postseason;
          break;
        }
      } catch (_e) {}
    }
  }

  if (existingPostseason) {
    fileData = {
      season: String(season),
      games: gamesToWrite,
      postseason: existingPostseason
    };
  }

  const serializedData = JSON.stringify(fileData, null, 2);

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
  const dataset = ${serializedData};
  const games = dataset.games || dataset;
  if (typeof window !== "undefined") {
    window.NPB_STATIC_DATA = window.NPB_STATIC_DATA || {};
    window.NPB_STATIC_DATA["${season}"] = games;
    if (dataset.postseason) {
      window.NPB_POSTSEASON_STATIC = window.NPB_POSTSEASON_STATIC || {};
      window.NPB_POSTSEASON_STATIC["${season}"] = dataset.postseason;
    }
  }
  if (typeof globalThis !== "undefined") {
    globalThis.NPB_STATIC_DATA = globalThis.NPB_STATIC_DATA || {};
    globalThis.NPB_STATIC_DATA["${season}"] = games;
    if (dataset.postseason) {
      globalThis.NPB_POSTSEASON_STATIC = globalThis.NPB_POSTSEASON_STATIC || {};
      globalThis.NPB_POSTSEASON_STATIC["${season}"] = dataset.postseason;
    }
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = dataset;
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
    let postseasonData = parseNpbPostseason(dedupedPsGames, dedupedGames, sStr);
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

    // Safety guard: merge with existing on-disk postseason data to avoid clobbering completed series
    let existingDiskPostseason = null;
    for (const pt of postseasonTargets) {
      if (fs.existsSync(pt)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(pt, 'utf-8'));
          if (parsed && parsed['2026']) {
            existingDiskPostseason = parsed;
            break;
          }
        } catch (_e) {}
      }
    }

    if (existingDiskPostseason) {
      postseasonData = mergeNpbPostseason(existingDiskPostseason, postseasonData, '2026');
    }

    const serializedPostseason = JSON.stringify(postseasonData, null, 2);

    postseasonTargets.forEach(targetFile => {
      const parent = path.dirname(targetFile);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
      fs.writeFileSync(targetFile, serializedPostseason, 'utf-8');
      console.log(`  🏆 [Written] ${path.relative(rootDir, targetFile)} (${(serializedPostseason.length / 1024).toFixed(1)} KB)`);
    });

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

    updateNpbPostseasonSeriesDataConstant(rootDir, postseasonData['2026']);
  }

  saveScrapeMetadata(rootDir, 'npb', season, dedupedGames);
}

/**
 * Scrapes and compiles full NPB season into static JSON datasets
 */
export async function scrapeNpbSeason(season = '2026', options = {}) {
  const { forceRefresh = false } = options;
  console.log(`🇯🇵 Compiling NPB ${season} Regular Season Data...`);

  const sNum = parseInt(season, 10);
  let dedupedGames = [];
  let dedupedPsGames = [];

  // For historical seasons (pre-2026), ingest from alternative archives
  if (sNum < 2026) {
    if (sNum >= 2009) {
      try {
        dedupedGames = await fetchBaseballFreakSeason(season);
      } catch (err) {
        console.warn(`  ⚠️ BaseballFreak failed for ${season}: ${err.message}`);
      }
    } else if (sNum >= 2005 && sNum <= 2008) {
      try {
        dedupedGames = await fetchNf3Season(season);
      } catch (err) {
        console.warn(`  ⚠️ NF3 failed for ${season}: ${err.message}`);
      }
    }

    if (dedupedGames.length > 0) {
      dedupedGames.sort((a, b) => {
        if (a.officialDate !== b.officialDate) {
          return a.officialDate.localeCompare(b.officialDate);
        }
        return String(a.gamePk).localeCompare(String(b.gamePk));
      });

      const finalGames = dedupedGames.filter(g => g.status?.detailedState === 'Final');
      const tieGames = finalGames.filter(g => g.isTie);

      console.log(`\n📊 Season Summary (${season}):`);
      console.log(`   Total Games Recorded: ${dedupedGames.length}`);
      console.log(`   Final Games Completed: ${finalGames.length}`);
      console.log(`   Tie Games: ${tieGames.length}`);

      // Summary per team by division
      const teamRecords = {};
      finalGames.forEach(g => {
        const homeId = g.teams.home.team.id;
        const awayId = g.teams.away.team.id;
        if (!teamRecords[homeId]) teamRecords[homeId] = { w: 0, l: 0, t: 0 };
        if (!teamRecords[awayId]) teamRecords[awayId] = { w: 0, l: 0, t: 0 };

        if (g.isTie) {
          teamRecords[homeId].t++;
          teamRecords[awayId].t++;
        } else if (g.teams.home.isWinner) {
          teamRecords[homeId].w++;
          teamRecords[awayId].l++;
        } else if (g.teams.away.isWinner) {
          teamRecords[awayId].w++;
          teamRecords[homeId].l++;
        }
      });

      ['Central League', 'Pacific League'].forEach(div => {
        console.log(`\n   ${div}:`);
        const seenIds = new Set();
        const divTeams = [];
        Object.values(NPB_TEAM_MAPPING).forEach(t => {
          if (t.division === div && !seenIds.has(t.id)) {
            seenIds.add(t.id);
            divTeams.push(t);
          }
        });
        divTeams
          .sort((a, b) => {
            const recA = teamRecords[a.id] || { w: 0, l: 0, t: 0 };
            const recB = teamRecords[b.id] || { w: 0, l: 0, t: 0 };
            const pctA = (recA.w + recA.l) > 0 ? recA.w / (recA.w + recA.l) : 0;
            const pctB = (recB.w + recB.l) > 0 ? recB.w / (recB.w + recB.l) : 0;
            return pctB - pctA;
          })
          .forEach((t, idx) => {
            const r = teamRecords[t.id] || { w: 0, l: 0, t: 0 };
            const total = r.w + r.l + r.t;
            const pct = (r.w + r.l) > 0 ? (r.w / (r.w + r.l)).toFixed(3) : '.000';
            console.log(`     ${idx + 1}. ${t.abbrev.padEnd(5)} ${r.w}W-${r.l}L-${r.t}T (${total} GP)  PCT: ${pct}`);
          });
      });

      saveDataset(season, dedupedGames, dedupedPsGames);
      return dedupedGames;
    }
  }

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
  dedupedGames = Array.from(uniqueMap.values());

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
  dedupedPsGames = Array.from(uniquePsMap.values());

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

  saveDataset(season, dedupedGames, dedupedPsGames);
  return dedupedGames;
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
