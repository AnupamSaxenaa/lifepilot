// ─── Marketplace Screen ──────────────────────────────────────
// Spend Shards (earned by leveling / unearthing stones) on cosmetics.
// Everything here is SERVER-AUTHORITATIVE: balance, prices, ownership, and
// purchases all round-trip through Supabase RPCs. The client only displays.
// ─────────────────────────────────────────────────────────────

import { useFocusEffect } from '@react-navigation/native';
import { Check, ChevronLeft, Hexagon, Lock, RotateCcw } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator, Alert, Image,
    NativeModules, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { loadProfile, updateProfile } from '../lib/dataManager';
import {
    claimStoneShards, getCatalog, getOwnedCosmetics, purchaseCosmetic, refreshShardBalance,
} from '../lib/marketplace';
import { readableOn } from '../theme/contrast';
import { Storage } from '../utils/storage';

const BG = '#000000';
const SURFACE = '#0A0A0A';
const SURFACE_2 = '#121214';
const BORDER = '#1C1C1E';
const TEXT = '#FAFAFA';
const MUTED = '#71717A';
// Deliberately fixed rather than the equipped accent: this is the screen where
// you preview and buy accents, so the store chrome must not shift underneath you.
const ACCENT = '#FFFFFF';
// Derived, not hardcoded, so the label follows ACCENT if it ever changes.
const ON_ACCENT = readableOn(ACCENT);
const GREEN = '#E5E7EB';

// The real app logo artwork, shown as-is (no tint) for the single icon variant.
const APP_LOGO_2 = require('../assets/stones/app-logo-2.png');

// App-icon variant styling: background tile color behind the logo artwork.
const ICON_VARIANTS = {
  icon_logo2: { bg: '#04080A', border: '#2A3538' },
};

// Marketplace item id -> native AppIconModule variant key. The native module
// (Android only, activity-alias swap) enables exactly one launcher icon and
// disables the rest — see AppIconModule.kt.
const NATIVE_ICON_VARIANT = {
  icon_logo2: 'logo2',
};

const CATEGORY_META = {
  accent: { labelKey: 'categoryAccentLabel', blurbKey: 'categoryAccentBlurb' },
  theme: { labelKey: 'categoryThemeLabel', blurbKey: 'categoryThemeBlurb' },
  font: { labelKey: 'categoryFontLabel', blurbKey: 'categoryFontBlurb' },
  icon: { labelKey: 'categoryIconLabel', blurbKey: 'categoryIconBlurb' },
};
// The dashboard showcase/pedestal was retired, so its category is no longer
// surfaced here. Any pedestal rows still in the catalog are simply not listed.
const CATEGORY_ORDER = ['accent', 'theme', 'font', 'icon'];

// Which categories are "equippable" (single active choice) vs one-off unlocks.
const EQUIP_FIELD = {
  accent: 'equipped_accent',
  theme: 'equipped_theme',
  font: 'equipped_font',
  icon: 'equipped_icon',
};

// Short per-item descriptions so non-preview categories (icons) still clearly
// explain what the item does.
const ITEM_DESC_KEYS = {
  icon_logo2: 'descIconLogo2',
};

// Map a font id → a real platform font family for the live preview.
const FONT_PREVIEW = {
  font_rounded: Platform.select({ ios: 'System', android: 'sans-serif-medium' }),
  font_serif: 'serif',
  font_mono: 'monospace',
  font_condensed: Platform.select({ ios: 'System', android: 'sans-serif-condensed' }),
};

export const MarketplaceScreen = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { refreshTheme } = useTheme();
  const userId = route?.params?.userId;

  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [catalog, setCatalog] = useState([]);
  const [owned, setOwned] = useState([]);
  const [equipped, setEquipped] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [applyingLabel, setApplyingLabel] = useState(null);

  // Offline-first: paint instantly from cache (catalog/owned/balance/equipped
  // all already cache themselves in Storage), then refresh from the server in
  // the background. The full-screen spinner only shows on a true cold start
  // with nothing cached — every other visit (including re-focusing the
  // screen) is instant.
  const loadFromCache = useCallback(async () => {
    if (!userId) return false;
    try {
      const [cachedCatalog, cachedOwned, cachedBal, cachedEq] = await Promise.all([
        Storage.get('marketplace_catalog_v1'),
        Storage.get(`owned_cosmetics_${userId}`),
        Storage.get(`shard_balance_${userId}`),
        Storage.get(`equipped_cosmetics_${userId}`),
      ]);
      let hasAny = false;
      if (cachedCatalog) { try { setCatalog(JSON.parse(cachedCatalog)); hasAny = true; } catch (_e) {} }
      if (cachedOwned) { try { setOwned(JSON.parse(cachedOwned)); hasAny = true; } catch (_e) {} }
      if (cachedBal) { try { setBalance(JSON.parse(cachedBal).balance ?? 0); hasAny = true; } catch (_e) {} }
      if (cachedEq) { try { setEquipped(JSON.parse(cachedEq)); hasAny = true; } catch (_e) {} }
      return hasAny;
    } catch (_e) {
      return false;
    }
  }, [userId]);

  /**
   * Project a profile row onto the equipped-cosmetics view and cache it.
   * Tolerates a null/partial profile so an offline first run is a no-op rather
   * than clearing what the user already has equipped.
   */
  const applyEquippedFromProfile = useCallback(async (profile) => {
    if (!profile) return;
    const eq = {
      theme: profile.equipped_theme ?? null,
      accent: profile.equipped_accent ?? null,
      font: profile.equipped_font ?? null,
      icon: profile.equipped_icon ?? null,
    };
    setEquipped(eq);
    await Storage.set(`equipped_cosmetics_${userId}`, JSON.stringify(eq));
  }, [userId]);

  /**
   * Persist an equip/unequip through dataManager so it is written to the local
   * cache first and queued for sync.
   *
   * This replaced `supabase.from('profiles').update(...)` called straight from
   * the screen, which broke in two different ways offline: equipping threw and
   * therefore applied nothing at all, while unequipping swallowed the error and
   * applied locally but never reached the server — so it silently reverted on
   * the next reinstall.
   *
   * The current profile is read with refresh:false because updateProfile spreads
   * over it; passing a stub would overwrite the cached display name and username.
   */
  const persistEquipField = useCallback(async (field, value) => {
    const current = await loadProfile(userId, undefined, { refresh: false });
    await updateProfile(userId, current, { [field]: value });
  }, [userId]);

  const loadFromServer = useCallback(async () => {
    if (!userId) return;
    try {
      // Fire every network call in parallel — no more waterfalling one
      // request after another.
      const [, bal, cat, own, profile] = await Promise.all([
        claimStoneShards(userId),
        refreshShardBalance(userId),
        getCatalog(),
        getOwnedCosmetics(userId),
        // Equipped state comes from the cached profile rather than its own
        // query. loadProfile already selects '*' and caches it, so a dedicated
        // request was both redundant and the reason this screen could not
        // resolve equipped cosmetics offline. It returns cache immediately and
        // reconciles in the background via the onFresh callback.
        loadProfile(userId, (fresh) => applyEquippedFromProfile(fresh)),
      ]);
      setBalance(bal.balance ?? 0);
      setCatalog(cat);
      setOwned(own);
      await applyEquippedFromProfile(profile);
    } catch (_e) {
      // Offline or request failed — cached values already painted, so this
      // is a silent no-op rather than an error state.
    }
  }, [userId, applyEquippedFromProfile]);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const hadCache = await loadFromCache();
    // Only block on the network if we had nothing to show yet.
    if (hadCache) setLoading(false);
    await loadFromServer();
    setLoading(false);
  }, [userId, loadFromCache, loadFromServer]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleBuy = async (item) => {
    if (busyId) return;
    if (balance < item.price) {
      Alert.alert(t('marketplace.notEnoughShardsTitle'), t('marketplace.notEnoughShardsMessage', { price: item.price.toLocaleString(), name: item.name }));
      return;
    }
    setBusyId(item.id);
    const res = await purchaseCosmetic(userId, item.id);
    setBusyId(null);
    if (res.success) {
      setBalance(res.balance ?? balance);
      setOwned((prev) => [...new Set([...prev, item.id])]);
      Alert.alert(t('marketplace.unlockedTitle'), t('marketplace.unlockedMessage', { name: item.name }));
    } else if (res.reason === 'insufficient_shards') {
      Alert.alert(t('marketplace.notEnoughShardsTitle'), t('marketplace.balanceChangedMessage'));
      load();
    } else {
      Alert.alert(t('marketplace.purchaseFailedTitle'), t('marketplace.purchaseFailedMessage'));
    }
  };

  const handleEquip = async (item) => {
    const field = EQUIP_FIELD[item.category];
    if (!field) { Alert.alert(t('marketplace.owned'), t('marketplace.ownedMessage', { name: item.name })); return; }
    const categoryLabel = t(`marketplace.${CATEGORY_META[item.category]?.labelKey}`)?.replace(/s$/, '') || item.name;
    setApplyingLabel(t('marketplace.applyingLabel', { category: categoryLabel }));
    try {
      // App icons require an extra native step: flip the enabled activity-alias
      // so the actual home-screen launcher icon changes (Android only).
      if (item.category === 'icon') {
        const variant = NATIVE_ICON_VARIANT[item.id];
        if (Platform.OS === 'android' && NativeModules.AppIcon && variant) {
          await NativeModules.AppIcon.setAppIcon(variant);
        }
      }

      await persistEquipField(field, item.id);
      const next = { ...equipped, [item.category]: item.id };
      setEquipped(next);
      await Storage.set(`equipped_cosmetics_${userId}`, JSON.stringify(next));
      await refreshTheme();
      setApplyingLabel(null);
      Alert.alert(t('marketplace.equipped'), t('marketplace.equippedMessage', { name: item.name }));
    } catch (_e) {
      setApplyingLabel(null);
      Alert.alert(t('common.error'), t('marketplace.equipErrorMessage'));
    }
  };

  // Revert to the default launcher icon (native alias reset) and clear the
  // equipped_icon field. Only relevant for the "icon" category.
  const handleUnequipIcon = async () => {
    await resetCategory('icon');
    Alert.alert(t('marketplace.revertedTitle'), t('marketplace.revertedIconMessage'));
  };

  // Reset a single equippable category back to its default (nothing equipped).
  // For icons this also flips the native launcher alias back to default.
  const resetCategory = async (cat) => {
    const field = EQUIP_FIELD[cat];
    if (!field) return;
    setApplyingLabel(t('marketplace.revertingLabel'));
    if (cat === 'icon' && Platform.OS === 'android' && NativeModules.AppIcon) {
      try { await NativeModules.AppIcon.setAppIcon('default'); } catch (_e) {}
    }
    // No try/catch swallowing here any more: the write goes to the local cache
    // first and is queued, so it cannot fail because the device is offline.
    await persistEquipField(field, null);
    const next = { ...equipped, [cat]: null };
    setEquipped(next);
    await Storage.set(`equipped_cosmetics_${userId}`, JSON.stringify(next));
    await refreshTheme();
    setApplyingLabel(null);
  };

  const handleResetSection = (cat) => {
    const label = CATEGORY_META[cat]?.labelKey ? t(`marketplace.${CATEGORY_META[cat].labelKey}`) : cat;
    Alert.alert(t('marketplace.resetSectionTitle', { label }), t('marketplace.resetSectionMessage', { label: label.toLowerCase() }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('marketplace.resetButton'), style: 'destructive', onPress: () => resetCategory(cat) },
    ]);
  };

  const handleResetAll = () => {
    Alert.alert(t('marketplace.resetAllTitle'), t('marketplace.resetAllMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('marketplace.resetAllButton'),
        style: 'destructive',
        onPress: async () => {
          for (const cat of Object.keys(EQUIP_FIELD)) {
            await resetCategory(cat);
          }
          Alert.alert(t('marketplace.doneTitle'), t('marketplace.resetAllDoneMessage'));
        },
      },
    ]);
  };

  const grouped = CATEGORY_ORDER
    .map((cat) => ({ cat, items: catalog.filter((c) => c.category === cat) }))
    .filter((g) => g.items.length > 0);

  const ownedCount = owned.length;

  // ── Per-category / per-item preview tile ──
  const renderPreview = (item) => {
    const m = item.metadata || {};

    if (item.category === 'accent') {
      return <View style={[styles.previewTile, { backgroundColor: SURFACE_2 }]}><View style={[styles.dot, { backgroundColor: m.color || ACCENT }]} /></View>;
    }
    if (item.category === 'theme') {
      return (
        <View style={[styles.previewTile, styles.themePreview]}>
          <View style={[styles.themeBar, { backgroundColor: m.bg || '#000' }]} />
          <View style={[styles.themeBar, { backgroundColor: m.surface || '#111' }]} />
          <View style={[styles.themeBar, { backgroundColor: m.accent || ACCENT }]} />
        </View>
      );
    }
    if (item.category === 'font') {
      return (
        <View style={[styles.previewTile, { backgroundColor: SURFACE_2 }]}>
          <Text style={{ color: TEXT, fontSize: 26, fontWeight: '700', fontFamily: FONT_PREVIEW[item.id] }}>Aa</Text>
        </View>
      );
    }

    // ── App icon: the real app logo artwork, shown in full color ──
    if (item.category === 'icon') {
      const v = ICON_VARIANTS[item.id] || ICON_VARIANTS.icon_logo2;
      return (
        <View style={[styles.previewTile, { backgroundColor: SURFACE_2 }]}>
          <View style={[styles.iconTile, { backgroundColor: v.bg, borderColor: v.border }]}>
            <Image source={APP_LOGO_2} style={styles.iconLogo} resizeMode="cover" />
          </View>
        </View>
      );
    }

    return <View style={[styles.previewTile, { backgroundColor: SURFACE_2 }]}><Hexagon color={ACCENT} size={22} /></View>;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Applying overlay — equipping repaints the whole app, which takes a moment */}
      {applyingLabel && (
        <View style={styles.applyingOverlay} pointerEvents="auto">
          <View style={styles.applyingCard}>
            <ActivityIndicator color={ACCENT} size="large" />
            <Text style={styles.applyingText}>{applyingLabel}</Text>
          </View>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft color={TEXT} size={26} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('marketplace.headerTitle')}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={ACCENT} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {/* Balance hero */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{t('marketplace.balanceLabel')}</Text>
            <View style={styles.heroRow}>
              <Hexagon color={ACCENT} size={26} fill={ACCENT} />
              <Text style={styles.heroValue}>{balance.toLocaleString()}</Text>
              <Text style={styles.heroUnit}>{t('marketplace.shardsUnit')}</Text>
            </View>
            <Text style={styles.heroSub}>
              {ownedCount > 0 ? t('marketplace.itemsUnlocked', { count: ownedCount }) : ''}{t('marketplace.earnMoreByLevelingUp')}
            </Text>

            {/* Reset everything back to default (keeps ownership) */}
            {Object.keys(EQUIP_FIELD).some((c) => equipped[c]) && (
              <TouchableOpacity style={styles.resetAllBtn} onPress={handleResetAll} activeOpacity={0.8}>
                <RotateCcw color={MUTED} size={14} />
                <Text style={styles.resetAllText}>{t('marketplace.resetAllToDefaultButton')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {grouped.map(({ cat, items }) => (
            <View key={cat} style={{ marginBottom: 28 }}>
              <View style={styles.sectionHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>{CATEGORY_META[cat]?.labelKey ? t(`marketplace.${CATEGORY_META[cat].labelKey}`) : cat}</Text>
                  <Text style={styles.sectionBlurb}>{CATEGORY_META[cat]?.blurbKey ? t(`marketplace.${CATEGORY_META[cat].blurbKey}`) : ''}</Text>
                </View>
                {/* Per-section reset — only when this category is equippable and active */}
                {EQUIP_FIELD[cat] && equipped[cat] && (
                  <TouchableOpacity style={styles.sectionResetBtn} onPress={() => handleResetSection(cat)} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <RotateCcw color={MUTED} size={13} />
                    <Text style={styles.sectionResetText}>{t('marketplace.resetButton')}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {items.map((item) => {
                const isOwned = owned.includes(item.id);
                const isEquipped = equipped[cat] === item.id;
                const canAfford = balance >= item.price;
                const isFont = cat === 'font';

                return (
                  <View key={item.id} style={[styles.card, isEquipped && styles.cardEquipped]}>
                    <View style={styles.cardTop}>
                      {renderPreview(item)}
                      <View style={{ flex: 1, marginLeft: 14 }}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        {isOwned ? (
                          <View style={styles.ownedRow}>
                            <Check color={GREEN} size={13} />
                            <Text style={styles.ownedLabel}>{isEquipped ? t('marketplace.equipped') : t('marketplace.owned')}</Text>
                          </View>
                        ) : (
                          <View style={styles.priceRow}>
                            <Hexagon color={canAfford ? ACCENT : MUTED} size={13} fill={canAfford ? ACCENT : 'none'} />
                            <Text style={[styles.priceText, { color: canAfford ? TEXT : MUTED }]}>
                              {item.price.toLocaleString()}
                            </Text>
                            {!canAfford && <Lock color={MUTED} size={12} style={{ marginLeft: 4 }} />}
                          </View>
                        )}
                      </View>

                      {/* Action */}
                      {isOwned ? (
                        EQUIP_FIELD[cat] ? (
                          <TouchableOpacity
                            style={[styles.actionBtn, isEquipped ? styles.equippedBtn : styles.equipBtn]}
                            onPress={() => handleEquip(item)}
                            disabled={isEquipped}
                            activeOpacity={0.85}
                          >
                            {isEquipped
                              ? <><Check color={ON_ACCENT} size={14} /><Text style={styles.equippedBtnText}>{t('marketplace.activeLabel')}</Text></>
                              : <Text style={styles.equipBtnText}>{t('marketplace.equipButton')}</Text>}
                          </TouchableOpacity>
                        ) : (
                          <View style={[styles.actionBtn, styles.ownedPill]}>
                            <Text style={styles.ownedPillText}>{t('marketplace.owned')}</Text>
                          </View>
                        )
                      ) : (
                        <TouchableOpacity
                          style={[styles.actionBtn, canAfford ? styles.buyBtn : styles.buyBtnDisabled]}
                          onPress={() => handleBuy(item)}
                          disabled={busyId === item.id}
                          activeOpacity={0.85}
                        >
                          {busyId === item.id
                            ? <ActivityIndicator color="#000" size="small" />
                            : <Text style={[styles.buyBtnText, !canAfford && { color: MUTED }]}>{t('marketplace.buyButton')}</Text>}
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* App icon: let the user revert to the default launcher icon */}
                    {cat === 'icon' && isEquipped && (
                      <TouchableOpacity onPress={handleUnequipIcon} style={styles.unequipLink} activeOpacity={0.7}>
                        <Text style={styles.unequipLinkText}>{t('marketplace.revertToDefaultIcon')}</Text>
                      </TouchableOpacity>
                    )}

                    {/* Font sample line */}
                    {isFont && (
                      <View style={styles.fontSampleWrap}>
                        <Text style={[styles.fontSample, { fontFamily: FONT_PREVIEW[item.id] }]}>
                          {t('marketplace.fontSampleText')}
                        </Text>
                      </View>
                    )}
                    {/* Theme swatch legend */}
                    {cat === 'theme' && (
                      <View style={styles.themeLegend}>
                        <LegendDot color={item.metadata?.bg} label={t('marketplace.legendBg')} />
                        <LegendDot color={item.metadata?.surface} label={t('marketplace.legendSurface')} />
                        <LegendDot color={item.metadata?.accent} label={t('marketplace.legendAccent')} />
                      </View>
                    )}
                    {/* Description for icons */}
                    {ITEM_DESC_KEYS[item.id] && cat === 'icon' && (
                      <View style={styles.descWrap}>
                        <Text style={styles.descText}>{t(`marketplace.${ITEM_DESC_KEYS[item.id]}`)}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))}

          <Text style={styles.footerNote}>
            {t('marketplace.footerNote')}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const LegendDot = ({ color, label }) => (
  <View style={styles.legendItem}>
    <View style={[styles.legendDot, { backgroundColor: color || '#000' }]} />
    <Text style={styles.legendLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { color: TEXT, fontSize: 16, fontWeight: '800', letterSpacing: 2 },

  // Hero balance
  hero: {
    backgroundColor: 'rgba(255, 255, 255,0.08)', borderWidth: 1, borderColor: 'rgba(255, 255, 255,0.3)',
    borderRadius: 20, padding: 20, marginBottom: 26, alignItems: 'center',
  },
  heroLabel: { color: MUTED, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 10 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroValue: { color: TEXT, fontSize: 38, fontWeight: '900', letterSpacing: -1 },
  heroUnit: { color: ACCENT, fontSize: 15, fontWeight: '700', marginTop: 10 },
  heroSub: { color: MUTED, fontSize: 12, marginTop: 8 },
  resetAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 14, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10,
    borderWidth: 1, borderColor: BORDER, backgroundColor: SURFACE_2,
  },
  resetAllText: { color: MUTED, fontSize: 12, fontWeight: '700' },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  sectionResetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9,
    borderWidth: 1, borderColor: BORDER, backgroundColor: SURFACE_2,
  },
  sectionResetText: { color: MUTED, fontSize: 11, fontWeight: '700' },
  sectionTitle: { color: TEXT, fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  sectionBlurb: { color: MUTED, fontSize: 12, marginTop: 3, marginBottom: 14 },

  card: {
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 16,
    padding: 14, marginBottom: 12,
  },
  cardEquipped: { borderColor: ACCENT, backgroundColor: 'rgba(255, 255, 255,0.06)' },
  cardTop: { flexDirection: 'row', alignItems: 'center' },

  previewTile: {
    width: 52, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
  },
  dot: { width: 28, height: 28, borderRadius: 14 },
  themePreview: { flexDirection: 'row', padding: 0 },
  themeBar: { flex: 1, height: '100%' },

  // App icon preview
  iconTile: {
    width: 40, height: 40, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  iconLogo: { width: 40, height: 40 },

  itemName: { color: TEXT, fontSize: 16, fontWeight: '700' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  priceText: { fontSize: 14, fontWeight: '700' },
  ownedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  ownedLabel: { color: GREEN, fontSize: 13, fontWeight: '700' },

  actionBtn: { minWidth: 82, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 14 },
  buyBtn: { backgroundColor: ACCENT },
  buyBtnText: { color: ON_ACCENT, fontWeight: '800', fontSize: 14 },
  buyBtnDisabled: { backgroundColor: SURFACE_2, borderWidth: 1, borderColor: BORDER },
  equipBtn: { backgroundColor: 'rgba(255, 255, 255,0.15)', borderWidth: 1, borderColor: ACCENT },
  equipBtnText: { color: ACCENT, fontWeight: '800', fontSize: 14 },
  equippedBtn: { backgroundColor: ACCENT },
  equippedBtnText: { color: ON_ACCENT, fontWeight: '800', fontSize: 13 },
  ownedPill: { backgroundColor: SURFACE_2, borderWidth: 1, borderColor: BORDER },
  ownedPillText: { color: MUTED, fontWeight: '700', fontSize: 13 },

  fontSampleWrap: {
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER,
  },
  fontSample: { color: '#D4D4D8', fontSize: 16 },

  unequipLink: {
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER,
  },
  unequipLinkText: { color: MUTED, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },

  applyingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100, elevation: 100,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  applyingCard: {
    backgroundColor: SURFACE_2, borderRadius: 18, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 28, paddingHorizontal: 36, alignItems: 'center', gap: 14,
  },
  applyingText: { color: TEXT, fontSize: 15, fontWeight: '700' },

  descWrap: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER },
  descText: { color: '#A1A1AA', fontSize: 13, lineHeight: 19 },

  themeLegend: { flexDirection: 'row', gap: 16, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  legendLabel: { color: MUTED, fontSize: 11, fontWeight: '600' },

  footerNote: { color: '#52525b', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8, paddingHorizontal: 10 },
});
