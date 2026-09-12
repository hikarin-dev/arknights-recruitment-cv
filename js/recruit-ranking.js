(function (root) {
  // Rarity is zero-based. Recruitment rates are not inferred from pool sizes.
  function rank(groups) {
    const candidates = groups.map(group => {
      const eligible = group.matches.filter(op => op.rarity >= 2);
      if (!eligible.length || eligible.some(op => op.rarity === 2)) return null;
      const min = Math.min(...eligible.map(op => op.rarity));
      const hasFive = eligible.some(op => op.rarity === 4);
      const tier = min === 5 ? 4 : min === 4 ? 3 : hasFive ? 2 : 1;
      return { group, eligible, tier };
    }).filter(Boolean);
    const bestTier = Math.max(0, ...candidates.map(c => c.tier));
    const best = candidates.filter(c => c.tier === bestTier).map(c => c.group);
    return { candidates, best, tier: bestTier };
  }
  const api = { rank };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RecruitRanking = api;
})(globalThis);
