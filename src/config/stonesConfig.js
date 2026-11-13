export const RARITIES = {
  COMMON: { label: 'Common', colors: ['#D1D5DB', '#9CA3AF', '#4B5563'], glow: 'rgba(156, 163, 175, 0.4)' },
  UNCOMMON: { label: 'Uncommon', colors: ['#6EE7B7', '#34D399', '#065F46'], glow: 'rgba(52, 211, 153, 0.4)' },
  RARE: { label: 'Rare', colors: ['#93C5FD', '#9CA3AF', '#1E3A8A'], glow: 'rgba(96, 165, 250, 0.4)' },
  EPIC: { label: 'Epic', colors: ['#D8B4FE', '#FFFFFF', '#4C1D95'], glow: 'rgba(192, 132, 252, 0.4)' },
  LEGENDARY: { label: 'Legendary', colors: ['#FDE68A', '#C7C7C7', '#78350F'], glow: 'rgba(251, 191, 36, 0.4)' },
  MYTHIC: { label: 'Mythic', colors: ['#FCA5A5', '#A1A1AA', '#7F1D1D'], glow: 'rgba(248, 113, 113, 0.4)' },
};

// NOTE: `shards` here is for DISPLAY ONLY. The authoritative shard balance is
// computed and enforced server-side (see migration 0004: cumulative_stone_shards).
// These values MUST match the server's per-level table or the UI will mislead.
export const STONES_CATALOG = [
  // Common
  { level: 1, name: 'Dusty Pebble', rarity: RARITIES.COMMON, shards: 10, image: require('../assets/stones/stone_1_1782398282601.png') },
  { level: 2, name: 'Iron Ore', rarity: RARITIES.COMMON, shards: 15, image: require('../assets/stones/stone_2_1782398294845.png') },
  { level: 3, name: 'Smooth Granite', rarity: RARITIES.COMMON, shards: 20, image: require('../assets/stones/stone_3_1782398306032.png') },
  { level: 4, name: 'Quartz Splinter', rarity: RARITIES.COMMON, shards: 25, image: require('../assets/stones/stone_4_1782398319335.png') },
  { level: 5, name: 'Basalt Geode', rarity: RARITIES.COMMON, shards: 35, image: require('../assets/stones/stone_5_1782398329991.png') },
  
  // Uncommon
  { level: 6, name: 'Mossy Pebble', rarity: RARITIES.UNCOMMON, shards: 50, image: require('../assets/stones/stone_6_1782398342576.png') },
  { level: 7, name: 'Jade Ore', rarity: RARITIES.UNCOMMON, shards: 60, image: require('../assets/stones/stone_7_1782398353964.png') },
  { level: 8, name: 'Malachite Cluster', rarity: RARITIES.UNCOMMON, shards: 75, image: require('../assets/stones/stone_8_1782398365861.png') },
  { level: 9, name: 'Emerald Cut Gem', rarity: RARITIES.UNCOMMON, shards: 90, image: require('../assets/stones/stone_9_1782398378817.png') },
  { level: 10, name: 'Verdant Geode', rarity: RARITIES.UNCOMMON, shards: 120, image: require('../assets/stones/stone_10_1782398392934.png') },
  
  // Rare
  { level: 11, name: 'Cobalt Shard', rarity: RARITIES.RARE, shards: 150, image: require('../assets/stones/stone_11_1782398417147.png') },
  { level: 12, name: 'Sapphire Ore', rarity: RARITIES.RARE, shards: 180, image: require('../assets/stones/stone_12_1782398429190.png') },
  { level: 13, name: 'Azure Cluster', rarity: RARITIES.RARE, shards: 210, image: require('../assets/stones/stone_13_1782398445224.png') },
  { level: 14, name: 'Round Sapphire', rarity: RARITIES.RARE, shards: 250, image: require('../assets/stones/stone_14_1782398456356.png') },
  { level: 15, name: 'Lapis Geode', rarity: RARITIES.RARE, shards: 320, image: require('../assets/stones/stone_15_1782398467304.png') },
  
  // Epic
  { level: 16, name: 'Amethyst Pillar', rarity: RARITIES.EPIC, shards: 400, image: require('../assets/stones/stone_16_1782398482446.png') },
  { level: 17, name: 'Void Ore', rarity: RARITIES.EPIC, shards: 480, image: require('../assets/stones/stone_17_1782399076152.png') },
  { level: 18, name: 'Ethereal Cluster', rarity: RARITIES.EPIC, shards: 560, image: require('../assets/stones/stone_18_1782399097343.png') },
  { level: 19, name: 'Purple Diamond', rarity: RARITIES.EPIC, shards: 660, image: require('../assets/stones/stone_19_1782399109669.png') },
  { level: 20, name: 'Abyssal Geode', rarity: RARITIES.EPIC, shards: 850, image: require('../assets/stones/stone_20_1782399122882.png') },
  
  // Legendary
  { level: 21, name: 'Sun Pillar', rarity: RARITIES.LEGENDARY, shards: 1000, image: require('../assets/stones/stone_21_1782399134667.png') },
  { level: 22, name: 'Gold Ore', rarity: RARITIES.LEGENDARY, shards: 1200, image: require('../assets/stones/stone_22_1782399146349.png') },
  { level: 23, name: 'Aurelian Cluster', rarity: RARITIES.LEGENDARY, shards: 1450, image: require('../assets/stones/stone_23_1782399158288.png') },
  { level: 24, name: 'Topaz Brilliant', rarity: RARITIES.LEGENDARY, shards: 1750, image: require('../assets/stones/stone_24_1782399169854.png') },
  { level: 25, name: 'Golden Geode', rarity: RARITIES.LEGENDARY, shards: 2200, image: require('../assets/stones/stone_25_1782399182527.png') },
  
  // Mythic
  { level: 26, name: 'Blood Pillar', rarity: RARITIES.MYTHIC, shards: 2800, image: require('../assets/stones/stone_26_1782399193602.png') },
  { level: 27, name: 'Crimson Ore', rarity: RARITIES.MYTHIC, shards: 3500, image: require('../assets/stones/stone_27_1782399205526.png') },
  { level: 28, name: 'Infernal Cluster', rarity: RARITIES.MYTHIC, shards: 4500, image: require('../assets/stones/stone_28_1782399214465.png') },
  { level: 29, name: 'Perfect Ruby', rarity: RARITIES.MYTHIC, shards: 6000, image: require('../assets/stones/stone_29_1782399227461.png') },
  { level: 30, name: 'Philosopher’s Stone', rarity: RARITIES.MYTHIC, shards: 10000, image: require('../assets/stones/stone_30_1782399239498.png') },
];
