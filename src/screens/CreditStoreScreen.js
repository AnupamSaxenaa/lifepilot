/**
 * LifePilot — AI Credit Store
 * ---------------------------------------------------------------------------
 * Reached from Settings. Shows the authoritative credit balance, explains the
 * replenishment rule honestly, and sells credit packs through Google Play
 * Billing (via RevenueCat).
 *
 * Design rules this screen obeys:
 *   • Screens never call Supabase — balance comes from dataManager.
 *   • Cached balance paints immediately; the server value replaces it.
 *   • The client NEVER grants credits. A purchase is confirmed by Play, then
 *     credited by the revenuecat-webhook edge function. This screen only polls
 *     for the result, which is why "may take a moment" is shown rather than a
 *     fake instant balance bump.
 */

import { ArrowLeft, Check, Infinity as InfinityIcon, PlayCircle, RefreshCw, Zap } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator, Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLAYSTORE_MODE } from '../config/flags';
import { useTheme } from '../context/ThemeContext';
import { isRewardedAdAvailable, showRewardedAd } from '../lib/adRewards';
import { describeBalance } from '../lib/creditRules';
import {
    fetchAdRewardStatus,
    fetchAiCreditBalance,
    getCurrentUserId,
    loadAiCreditBalance
} from '../lib/dataManager';
import {
    PRODUCTS, getOfferings,
    isBillingAvailable,
    purchasePackage, restorePurchases,
} from '../lib/purchases';

const BG = '#000000';
const SURFACE = '#0A0A0A';
const BORDER = '#1C1C1E';
const TEXT = '#FAFAFA';
const MUTED = '#71717A';

// Fallback prices, shown only until live Play prices load. Play is the source of
// truth for what a user actually pays, so these are never used for charging.
const CREDIT_PACKS = [
  { id: PRODUCTS.TOKENS_50, credits: 50, price: '₹19' },
  { id: PRODUCTS.TOKENS_150, credits: 150, price: '₹39', badgeKey: 'packPopularBadge' },
  { id: PRODUCTS.TOKENS_500, credits: 500, price: '₹99', badgeKey: 'packBestValueBadge' },
];

// A purchase is credited asynchronously by the billing webhook, so poll briefly
// rather than claiming success with a stale balance on screen.
const POLL_DELAYS_MS = [1500, 3000, 5000];

export const CreditStoreScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const ACCENT = useTheme().theme.accent;

  const [userId, setUserId] = useState(null);
  const [balance, setBalance] = useState(null);
  const [adStatus, setAdStatus] = useState(null);
  const [offering, setOffering] = useState(null);
  const [loadingOffers, setLoadingOffers] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const init = async () => {
      const resolvedUserId = await getCurrentUserId();
      if (cancelled.current) return;
      setUserId(resolvedUserId);

      if (resolvedUserId) {
        // Cached first so the number is on screen before any network call.
        const cached = await loadAiCreditBalance(resolvedUserId, (fresh) => {
          if (!cancelled.current) setBalance(fresh);
        });
        if (!cancelled.current) setBalance(cached);

        fetchAdRewardStatus().then((status) => {
          if (!cancelled.current && status) setAdStatus(status);
        }).catch(() => {});
      }

      const off = await getOfferings();
      if (cancelled.current) return;
      setOffering(off);
      setLoadingOffers(false);
    };
    init();
    return () => { cancelled.current = true; };
  }, []);

  const findPackage = (productId) => {
    if (!offering?.availablePackages) return null;
    return offering.availablePackages.find(
      (p) => p.product?.identifier === productId,
    ) || null;
  };

  const priceFor = (productId, fallback) => findPackage(productId)?.product?.priceString || fallback;

  const refresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    const [fresh, status] = await Promise.all([
      fetchAiCreditBalance(userId),
      fetchAdRewardStatus(),
    ]);
    if (!cancelled.current) {
      if (fresh) setBalance(fresh);
      if (status) setAdStatus(status);
      setRefreshing(false);
    }
  }, [userId]);

  /**
   * Poll for the webhook-applied grant. Stops as soon as the total rises.
   * Returns true when the increase was observed.
   */
  const pollForGrant = async (previousTotal) => {
    for (const delay of POLL_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (cancelled.current) return false;
      const fresh = await fetchAiCreditBalance(userId);
      if (fresh) {
        if (!cancelled.current) setBalance(fresh);
        if (fresh.total > previousTotal) return true;
      }
    }
    return false;
  };

  const handleBuy = async (productId) => {
    if (!isBillingAvailable()) {
      Alert.alert(t('creditStore.comingSoonTitle'), t('creditStore.comingSoonMessage'));
      return;
    }
    const pkg = findPackage(productId);
    if (!pkg) {
      Alert.alert(t('creditStore.unavailableTitle'), t('creditStore.unavailableMessage'));
      return;
    }

    const previousTotal = describeBalance(balance).total;
    setBusyId(productId);
    const res = await purchasePackage(pkg);

    if (res.userCancelled) {
      setBusyId(null);
      return;
    }
    if (!res.success) {
      setBusyId(null);
      Alert.alert(t('creditStore.purchaseFailedTitle'), t('creditStore.purchaseFailedMessage'));
      return;
    }

    // Play confirmed payment. Credits arrive when the webhook lands.
    const credited = await pollForGrant(previousTotal);
    if (cancelled.current) return;
    setBusyId(null);
    Alert.alert(
      t('creditStore.purchaseSuccessTitle'),
      credited
        ? t('creditStore.purchaseCreditedMessage')
        : t('creditStore.purchasePendingMessage'),
    );
  };

  const handleWatchAd = async () => {
    if (!isRewardedAdAvailable()) {
      Alert.alert(t('creditStore.adsUnavailableTitle'), t('creditStore.adsUnavailableMessage'));
      return;
    }
    // The cap is enforced server-side; this is just a courtesy check so we don't
    // burn an impression on a reward that would be refused.
    if (adStatus?.exhausted) {
      Alert.alert(t('creditStore.adCapTitle'), t('creditStore.adCapMessage'));
      return;
    }

    const previousTotal = describeBalance(balance).total;
    setBusyId('ad');
    const result = await showRewardedAd({ userId });

    if (!result.earned) {
      setBusyId(null);
      if (result.reason === 'load_failed') {
        Alert.alert(t('creditStore.adFailedTitle'), t('creditStore.adFailedMessage'));
      } else if (result.reason === 'consent_declined') {
        // The user declined ad consent, so no ad can be shown. Explain rather
        // than silently doing nothing, and point at how to change it.
        Alert.alert(t('creditStore.adConsentTitle'), t('creditStore.adConsentMessage'));
      }
      // 'dismissed' is a deliberate user choice — no alert.
      return;
    }

    // Credits arrive via AdMob's SSV callback, so poll rather than assuming.
    const credited = await pollForGrant(previousTotal);
    const status = await fetchAdRewardStatus();
    if (cancelled.current) return;
    if (status) setAdStatus(status);
    setBusyId(null);
    Alert.alert(
      t('creditStore.adRewardTitle'),
      credited
        ? t('creditStore.adRewardCreditedMessage')
        : t('creditStore.adRewardPendingMessage'),
    );
  };

  const handleRestore = async () => {
    if (!isBillingAvailable()) {
      Alert.alert(t('creditStore.comingSoonTitle'), t('creditStore.comingSoonMessage'));
      return;
    }
    setBusyId('restore');
    await restorePurchases();
    await refresh();
    if (cancelled.current) return;
    setBusyId(null);
    Alert.alert(t('creditStore.restoreTitle'), t('creditStore.restoreMessage'));
  };

  const view = describeBalance(balance);

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', { defaultValue: 'Back' })}
        >
          <ArrowLeft color={TEXT} size={22} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('creditStore.headerTitle')}</Text>
        <TouchableOpacity
          onPress={refresh}
          style={styles.iconButton}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel={t('creditStore.refreshBalance')}
        >
          {refreshing
            ? <ActivityIndicator color={MUTED} size="small" />
            : <RefreshCw color={MUTED} size={18} />}
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
      >
        {/* ── Balance ── */}
        <View style={[styles.balanceCard, { borderColor: `${ACCENT}44` }]}>
          <Text style={styles.balanceLabel}>{t('creditStore.balanceLabel')}</Text>
          <View style={styles.balanceRow}>
            <Zap color={ACCENT} size={26} fill={ACCENT} />
            <Text style={styles.balanceValue}>{view.total}</Text>
          </View>

          <View style={styles.breakdown}>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownKey}>{t('creditStore.dailyCreditsLabel')}</Text>
              <Text style={styles.breakdownValue}>{view.free}</Text>
            </View>
            {view.hasBonus && (
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownKey}>{t('creditStore.bonusCreditsLabel')}</Text>
                <Text style={styles.breakdownValue}>{view.bonus}</Text>
              </View>
            )}
            {view.hasPaid && (
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownKey}>{t('creditStore.purchasedCreditsLabel')}</Text>
                <Text style={styles.breakdownValue}>{view.paid}</Text>
              </View>
            )}
          </View>

          {/* The honest description of the top-up rule. `aboveFloor` users are
              told nothing will be added, so the copy never over-promises. */}
          <Text style={styles.balanceHint}>
            {view.aboveFloor
              ? t('creditStore.topUpHintAboveFloor', { floor: view.floor })
              : t('creditStore.topUpHint', { floor: view.floor })}
            {view.hasBonus ? ` ${t('creditStore.bonusExpiryHint', { count: view.bonus })}` : ''}
          </Text>
        </View>

        {/* ── How credits work ── */}
        <View style={styles.infoCard}>
          {[
            t('creditStore.ruleDailyTopUp', { floor: view.floor }),
            t('creditStore.rulePurchasedNeverExpire'),
            t('creditStore.ruleFreeSpentFirst'),
          ].map((line) => (
            <View style={styles.infoRow} key={line}>
              <Check color={ACCENT} size={16} />
              <Text style={styles.infoText}>{line}</Text>
            </View>
          ))}
        </View>

        {/* ── Free credits by watching an ad ──
              Hidden entirely when ads aren't configured, rather than showing a
              button that can only disappoint. ── */}
        {isRewardedAdAvailable() && adStatus && (
          <>
            <Text style={styles.sectionTitle}>{t('creditStore.earnTitle')}</Text>
            <Text style={styles.sectionSub}>
              {t('creditStore.earnSubtitle', {
                credits: adStatus.creditsPerAd,
                max: adStatus.dailyMax,
              })}
            </Text>
            <TouchableOpacity
              style={[styles.packRow, adStatus.exhausted && styles.rowDisabled]}
              activeOpacity={0.85}
              onPress={handleWatchAd}
              disabled={!!busyId || adStatus.exhausted}
              accessibilityRole="button"
              accessibilityLabel={t('creditStore.watchAdAction')}
              accessibilityState={{ disabled: !!busyId || adStatus.exhausted }}
            >
              <PlayCircle color={adStatus.exhausted ? MUTED : ACCENT} size={18} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.packTitle}>{t('creditStore.watchAdAction')}</Text>
                <Text style={styles.packSub}>
                  {adStatus.exhausted
                    ? t('creditStore.adsDoneForToday')
                    : t('creditStore.adsLeftToday', { count: adStatus.adsLeft })}
                </Text>
              </View>
              {busyId === 'ad'
                ? <ActivityIndicator color={ACCENT} />
                : (
                  <Text style={[styles.packPrice, adStatus.exhausted && { color: MUTED }]}>
                    +{adStatus.nextReward}
                  </Text>
                )}
            </TouchableOpacity>
            <Text style={styles.adNote}>{t('creditStore.adCreditsExpireNote')}</Text>
          </>
        )}

        {/* ── Packs ──
              Hidden entirely unless PLAYSTORE_MODE is on. Showing prices while
              billing is unavailable would advertise something the user cannot
              buy: every tap would land on "Coming Soon". The free ad-credit
              surface above stays visible either way. ── */}
        {PLAYSTORE_MODE && (
          <>
        <Text style={styles.sectionTitle}>{t('creditStore.packsTitle')}</Text>
        <Text style={styles.sectionSub}>{t('creditStore.packsSubtitle')}</Text>

        {loadingOffers ? (
          <View style={styles.offersLoading}>
            <ActivityIndicator color={MUTED} />
          </View>
        ) : (
          CREDIT_PACKS.map((pack) => (
            <TouchableOpacity
              key={pack.id}
              style={styles.packRow}
              activeOpacity={0.85}
              onPress={() => handleBuy(pack.id)}
              disabled={!!busyId}
              accessibilityRole="button"
              accessibilityLabel={t('creditStore.buyCredits', { count: pack.credits })}
            >
              <Zap color={ACCENT} size={18} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.packTitle}>
                  {t('creditStore.packCount', { count: pack.credits })}
                </Text>
                {pack.badgeKey && (
                  <Text style={[styles.packBadge, { color: ACCENT }]}>
                    {t(`creditStore.${pack.badgeKey}`)}
                  </Text>
                )}
              </View>
              {busyId === pack.id
                ? <ActivityIndicator color={ACCENT} />
                : <Text style={styles.packPrice}>{priceFor(pack.id, pack.price)}</Text>}
            </TouchableOpacity>
          ))
        )}

        {/* ── Pro upsell ── */}
        <TouchableOpacity
          style={[styles.proRow, { borderColor: `${ACCENT}55` }]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Paywall')}
        >
          <InfinityIcon color={ACCENT} size={18} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.packTitle}>{t('creditStore.proTitle')}</Text>
            <Text style={styles.packSub}>{t('creditStore.proSubtitle')}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.restoreBtn}
          onPress={handleRestore}
          disabled={busyId === 'restore'}
        >
          {busyId === 'restore'
            ? <ActivityIndicator color={MUTED} size="small" />
            : <Text style={styles.restoreText}>{t('creditStore.restorePurchases')}</Text>}
        </TouchableOpacity>

        <Text style={styles.legal}>{t('creditStore.legalText')}</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: TEXT, fontSize: 14, fontWeight: '800', letterSpacing: 1.6 },

  balanceCard: {
    backgroundColor: SURFACE, borderWidth: 1, borderRadius: 18,
    padding: 20, marginBottom: 16,
  },
  balanceLabel: { color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  balanceValue: { color: TEXT, fontSize: 40, fontWeight: '200', letterSpacing: -1 },
  breakdown: { marginTop: 14, gap: 6 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  breakdownKey: { color: MUTED, fontSize: 13 },
  breakdownValue: { color: TEXT, fontSize: 13, fontWeight: '700' },
  balanceHint: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 14 },

  infoCard: {
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    borderRadius: 16, padding: 16, marginBottom: 26,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  infoText: { color: TEXT, fontSize: 13, flex: 1, lineHeight: 19 },

  sectionTitle: { color: TEXT, fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
  sectionSub: { color: MUTED, fontSize: 12, marginTop: 4, marginBottom: 12 },
  offersLoading: { paddingVertical: 24, alignItems: 'center' },

  packRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 16, marginBottom: 10,
  },
  packTitle: { color: TEXT, fontSize: 15, fontWeight: '700' },
  packSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  packBadge: { fontSize: 10, fontWeight: '700', marginTop: 2, letterSpacing: 0.5 },
  packPrice: { color: TEXT, fontSize: 17, fontWeight: '800' },
  rowDisabled: { opacity: 0.55 },
  adNote: { color: MUTED, fontSize: 11, lineHeight: 16, marginTop: -2, marginBottom: 26 },

  proRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE,
    borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 18,
  },

  restoreBtn: { alignItems: 'center', paddingVertical: 18, marginTop: 8 },
  restoreText: { color: MUTED, fontSize: 14, fontWeight: '600' },
  legal: { color: '#3F3F46', fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
