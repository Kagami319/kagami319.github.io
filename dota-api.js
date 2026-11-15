import { aggregateHeroStats } from './hero-stats.js';

const API_BASE = 'https://api.opendota.com/api';
const STEAM_BASE = 76561197960265728n;
const MAX_ACCOUNT_ID = 4294967294n;
const TIMEOUT_MS = 120000;
const PAGE_SIZE = 10000;
const MAX_HISTORY_PAGES = 100;
const MEDALS = ['Unranked', 'Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'];

/** Accept a Dota account ID, Steam64 ID, or a supported numeric profile URL. */
export function normalizeAccountId(input) {
  if (typeof input !== 'string' && typeof input !== 'number' && typeof input !== 'bigint') {
    throw new Error('Enter a numeric Dota 2 ID, Steam64 ID, or player profile URL.');
  }
  if (typeof input === 'number' && !Number.isSafeInteger(input)) {
    throw new Error('Enter the full Steam64 ID as text to preserve its precision.');
  }
  let value = String(input).trim();
  if (!value) throw new Error('Enter a numeric Dota 2 ID or player profile URL.');
  if (!/^\d+$/.test(value)) {
    let url;
    try {
      url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      throw new Error('Account not recognized. Use a numeric ID or an OpenDota / Dotabuff player URL.');
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Use a valid Steam, OpenDota, or Dotabuff player URL.');
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.split('/').filter(Boolean);
    if (host === 'steamcommunity.com' && path[0] === 'id') {
      throw new Error('Steam custom-name URLs cannot be resolved here. Use a numeric Steam64 ID, Dota 2 ID, or OpenDota player URL.');
    }
    const isStats = ['opendota.com', 'dotabuff.com'].includes(host) && path[0] === 'players';
    const isSteam = host === 'steamcommunity.com' && path[0] === 'profiles';
    if ((!isStats && !isSteam) || !/^\d+$/.test(path[1] || '')) {
      throw new Error('Use a numeric Steam profile URL or an OpenDota / Dotabuff player URL.');
    }
    value = path[1];
    if (isSteam && BigInt(value) < STEAM_BASE) {
      throw new Error('A numeric Steam profile URL must contain the full Steam64 ID.');
    }
  }
  let id = BigInt(value);
  if (id >= STEAM_BASE) id -= STEAM_BASE;
  if (id < 1n || id > MAX_ACCOUNT_ID) throw new Error('Account ID is outside the valid range. Check it and try again.');
  return id.toString();
}

function numberOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}

function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function medalLabel(tier) {
  if (!Number.isInteger(tier)) return 'Not available';
  const medal = Math.floor(tier / 10);
  const stars = tier % 10;
  if (medal === 8) return MEDALS[medal];
  return medal >= 1 && medal <= 7 && stars >= 1 && stars <= 5
    ? `${MEDALS[medal]} ${stars}` : 'Not available';
}

async function getJson(path, signal) {
  const response = await fetch(`${API_BASE}${path}`, {
    signal,
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error('OpenDota rate limit reached. Please try again later.');
    if (response.status === 404) throw new Error('OpenDota could not find this player. Check the account or try again later.');
    throw new Error(`OpenDota is temporarily unavailable (${response.status}). Please try again later.`);
  }
  try {
    return await response.json();
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('OpenDota returned an unexpected response. Please try again later.');
  }
}

async function getMatchHistory(id, signal) {
  const matches = [];
  const sources = [];
  const seen = new Set();
  for (let pageIndex = 0; pageIndex < MAX_HISTORY_PAGES; pageIndex += 1) {
    const path = `/players/${id}/matches?significant=0&project=hero_id&project=kills&project=deaths&project=assists&limit=${PAGE_SIZE}&offset=${pageIndex * PAGE_SIZE}`;
    const page = await getJson(path, signal);
    if (!Array.isArray(page) || page.length > PAGE_SIZE) {
      throw new Error('OpenDota returned an unexpected match-history response. Please try again later.');
    }
    for (const match of page) {
      if (!match || !Number.isSafeInteger(match.match_id) || match.match_id <= 0) {
        throw new Error('OpenDota returned an invalid match record. Please try again later.');
      }
      if (seen.has(match.match_id)) {
        throw new Error('Match-history pages overlap or changed while loading. Please try again later.');
      }
      seen.add(match.match_id);
      matches.push(match);
    }
    sources.push(`${API_BASE}${path}`);
    if (page.length < PAGE_SIZE) return { matches, sources, pages: pageIndex + 1 };
  }
  throw new Error('The complete match history could not be retrieved. Please try again later.');
}

/** Fetch complete public history, including Turbo; missing statistics remain null. */
export async function fetchDotaStats(accountId, { signal } = {}) {
  const id = normalizeAccountId(accountId);
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  try {
    let constantsAvailable = false;
    const [player, counts, history, heroMap] = await Promise.all([
      getJson(`/players/${id}`, controller.signal),
      getJson(`/players/${id}/wl?significant=0`, controller.signal),
      getMatchHistory(id, controller.signal),
      getJson('/constants/heroes', controller.signal).then(data => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
        constantsAvailable = true;
        return data;
      }).catch(() => ({})),
    ]);
    if (!player || typeof player !== 'object' || Array.isArray(player)
      || !counts || typeof counts !== 'object' || Array.isArray(counts)) {
      throw new Error('OpenDota returned an unexpected response. Please try again later.');
    }
    const win = numberOrNull(counts.win);
    const lose = numberOrNull(counts.lose);
    if (win === null || lose === null) {
      throw new Error('OpenDota returned incomplete win/loss totals. Please try again later.');
    }
    // An absent history must not be presented as a confirmed zero-match career.
    const total = win + lose === 0 ? null : win + lose;
    const profile = player.profile || {};
    if (profile.account_id != null && String(profile.account_id) !== id) {
      throw new Error('OpenDota returned a different player account. Please try again later.');
    }
    const { heroes, coverage } = aggregateHeroStats(history.matches, heroMap);
    if (coverage.uniqueMatches !== win + lose) {
      throw new Error('Match history and totals are still updating. Please try again later.');
    }
    return {
      accountId: id,
      profile: {
        name: textOrNull(profile.personaname) || `Player ${id}`,
        avatar: httpsUrl(profile.avatarfull) || httpsUrl(profile.avatarmedium),
        profileUrl: `https://www.opendota.com/players/${id}`,
        rank: medalLabel(player.rank_tier),
        rankTier: numberOrNull(player.rank_tier),
        leaderboardRank: numberOrNull(player.leaderboard_rank) || null,
      },
      win: total === null ? null : win,
      lose: total === null ? null : lose,
      total,
      winrate: total === null ? null : win / total * 100,
      heroes,
      coverage: { ...coverage, historyComplete: true, pages: history.pages },
      updatedAt: new Date().toISOString(),
      sources: [
        `${API_BASE}/players/${id}`,
        `${API_BASE}/players/${id}/wl?significant=0`,
        ...history.sources,
        ...(constantsAvailable ? [`${API_BASE}/constants/heroes`] : []),
      ],
    };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
    if (timedOut) throw new Error('OpenDota took too long to respond. Please try again later.');
    if (error instanceof TypeError) throw new Error('Could not connect to OpenDota. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}
