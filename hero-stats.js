const IMAGE_ORIGIN = 'https://cdn.cloudflare.steamstatic.com';
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const isPlayerSlot = value => Number.isInteger(value)
  && ((value >= 0 && value <= 4) || (value >= 128 && value <= 132));

/**
 * Aggregate a complete public match response. This pure helper does not fetch.
 * Deduplicates identical match IDs; conflicting duplicates and invalid match IDs fail.
 * Missing/zero hero IDs are excluded from hero rows and counted in coverage.
 * Incomplete K/D/A remains null. Wins count only known wins; win rate is
 * recorded wins / all recorded games, consistent with OpenDota hero summaries.
 * Unknown outcomes are reported separately, never reclassified as losses.
 * KDA is (total kills + total assists) / total deaths, not mean per-match KDA.
 */
export function aggregateHeroStats(matches, constants = {}) {
  if (!Array.isArray(matches)) throw new TypeError('Match data must be an array.');
  const seen = new Map();
  const groups = new Map();
  const coverage = {
    inputRows: matches.length,
    uniqueMatches: 0,
    duplicateRows: 0,
    wins: 0,
    losses: 0,
    unknownOutcomes: 0,
    kdaCompleteMatches: 0,
    kdaMissingMatches: 0,
    identifiedHeroMatches: 0,
    unidentifiedHeroMatches: 0,
    unidentifiedHeroMatchIds: [],
    heroesPlayed: 0,
  };
  for (const match of matches) {
    if (!match || !positiveInteger(match.match_id)) {
      throw new TypeError('Every match must have a valid numeric match_id.');
    }
    const signature = JSON.stringify([
      match.hero_id, match.player_slot, match.radiant_win,
      match.kills, match.deaths, match.assists,
    ]);
    if (seen.has(match.match_id)) {
      if (seen.get(match.match_id) !== signature) {
        throw new Error(`Conflicting duplicate match ${match.match_id}.`);
      }
      coverage.duplicateRows += 1;
      continue;
    }
    seen.set(match.match_id, signature);
    coverage.uniqueMatches += 1;
    const knownOutcome = isPlayerSlot(match.player_slot) && typeof match.radiant_win === 'boolean';
    const won = knownOutcome && (match.player_slot < 128) === match.radiant_win;
    if (knownOutcome) coverage[won ? 'wins' : 'losses'] += 1;
    else coverage.unknownOutcomes += 1;
    const hasKda = [match.kills, match.deaths, match.assists].every(nonnegativeInteger);
    coverage[hasKda ? 'kdaCompleteMatches' : 'kdaMissingMatches'] += 1;
    if (!positiveInteger(match.hero_id)) {
      coverage.unidentifiedHeroMatches += 1;
      coverage.unidentifiedHeroMatchIds.push(match.match_id);
      continue;
    }
    coverage.identifiedHeroMatches += 1;
    if (!groups.has(match.hero_id)) {
      groups.set(match.hero_id, {
        heroId: match.hero_id, games: 0, win: 0, knownOutcomes: 0,
        kills: 0, deaths: 0, assists: 0, kdaGames: 0,
      });
    }
    const row = groups.get(match.hero_id);
    row.games += 1;
    if (knownOutcome) {
      row.knownOutcomes += 1;
      row.win += Number(won);
    }
    if (hasKda) {
      row.kills += match.kills;
      row.deaths += match.deaths;
      row.assists += match.assists;
      row.kdaGames += 1;
    }
  }

  const heroes = Array.from(groups.values(), row => {
    const hero = constants?.[row.heroId] || {};
    const name = typeof hero.localized_name === 'string' && hero.localized_name.trim()
      ? hero.localized_name.trim() : `Hero #${row.heroId}`;
    const image = typeof hero.img === 'string' && /^\/apps\/dota2\//.test(hero.img)
      ? new URL(hero.img, IMAGE_ORIGIN).href : null;
    const completeKda = row.kdaGames === row.games && row.kdaGames > 0;
    const numerator = row.kills + row.assists;
    return {
      heroId: row.heroId,
      hero: name,
      heroImage: image,
      games: row.games,
      win: row.win,
      winrate: row.win / row.games * 100,
      knownOutcomes: row.knownOutcomes,
      unknownOutcomes: row.games - row.knownOutcomes,
      kills: completeKda ? row.kills : null,
      deaths: completeKda ? row.deaths : null,
      assists: completeKda ? row.assists : null,
      kda: completeKda && row.deaths > 0 ? numerator / row.deaths : null,
      kdaInfinite: completeKda && row.deaths === 0 && numerator > 0,
      kdaGames: row.kdaGames,
      avgKills: completeKda ? row.kills / row.games : null,
      avgDeaths: completeKda ? row.deaths / row.games : null,
      avgAssists: completeKda ? row.assists / row.games : null,
    };
  }).sort((a, b) => b.games - a.games || a.heroId - b.heroId);
  coverage.heroesPlayed = heroes.length;
  return { heroes, coverage };
}
