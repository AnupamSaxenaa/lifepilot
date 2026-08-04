import { Check, X, Zap } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator, Alert, Dimensions,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    PRODUCTS, getOfferings,
    isBillingAvailable,
    purchasePackage, restorePurchases,
} from '../lib/purchases';

const { width } = Dimensions.get('window');

// ── Palette ──
const BG = '#000000';
const SURFACE = '#0A0A0A';
const BORDER = '#1C1C1E';
const TEXT = '#FAFAFA';
const MUTED = '#71717A';
const ACCENT = '#FFFFFF';

// Fallback display data (shown until live store prices load).
const PRO_PLANS = [
  { id: PRODUCTS.PRO_MONTHLY, titleKey: 'planMonthlyTitle', price: '₹49', perKey: 'planMonthlyPer', highlight: false },
  { id: PRODUCTS.PRO_YEARLY, titleKey: 'planYearlyTitle', price: '₹299', perKey: 'planYearlyPer', highlight: true, badgeKey: 'planYearlyBadge' },
  { id: PRODUCTS.PRO_LIFETIME, titleKey: 'planLifetimeTitle', price: '₹699', perKey: 'planLifetimePer', highlight: false, badgeKey: 'planLifetimeBadge' },
];

const TOKEN_PACKS = [
  { id: PRODUCTS.TOKENS_50, tokens: 50, price: '₹19' },
  { id: PRODUCTS.TOKENS_150, tokens: 150, price: '₹39' },
  { id: PRODUCTS.TOKENS_500, tokens: 500, price: '₹99', badgeKey: 'tokenBestValueBadge' },
];

const PRO_FEATURE_KEYS = [
  'featureMindfulLock',
  'featureAiTokens',
  'featureWidgetsThemes',
  'featureHistoryAnalytics',
  'featurePrioritySupport',
];

export const PaywallScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [offering, setOffering] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    (async () => {
      const off = await getOfferings();
      setOffering(off);
      setLoading(false);
    })();
  }, []);

  // Find a live RevenueCat package matching a product id (for real pricing/purchase).
  const findPackage = (productId) => {
    if (!offering?.availablePackages) return null;
    return offering.availablePackages.find(
      (p) => p.product?.identifier === productId
    ) || null;
  };

  const priceFor = (productId, fallback) => {
    const pkg = findPackage(productId);
    return pkg?.product?.priceString || fallback;
  };

  const handleBuy = async (productId) => {
    if (!isBillingAvailable()) {
      Alert.alert(
        t('paywall.comingSoonTitle'),
        t('paywall.comingSoonMessage'),
      );
      return;
    }
    const pkg = findPackage(productId);
    if (!pkg) {
      Alert.alert(t('paywall.unavailableTitle'), t('paywall.unavailableMessage'));
      return;
    }
    setBusyId(productId);
    const res = await purchasePackage(pkg);
    setBusyId(null);

    if (res.success) {
      Alert.alert(t('common.success'), t('paywall.purchaseSuccessMessage'), [
        { text: t('paywall.greatButton'), onPress: () => navigation.goBack() },
      ]);
    } else if (res.userCancelled) {
      // silent
    } else {
      Alert.alert(t('paywall.purchaseFailedTitle'), t('paywall.purchaseFailedMessage'));
    }
  };

  const handleRestore = async () => {
    if (!isBillingAvailable()) return;
    setBusyId('restore');
    await restorePurchases();
    setBusyId(null);
    Alert.alert(t('paywall.restoreTitle'), t('paywall.restoreMessage'));
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Zap color={ACCENT} size={22} fill={ACCENT} />
          <Text style={styles.headerTitle}>{t('paywall.headerTitle')}</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X color={MUTED} size={24} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={ACCENT} size="large" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
          <Text style={styles.tagline}>{t('paywall.tagline')}</Text>

          {/* Pro features */}
          <View style={styles.featureCard}>
            {PRO_FEATURE_KEYS.map((key) => (
              <View style={styles.featureRow} key={key}>
                <Check color={ACCENT} size={18} />
                <Text style={styles.featureText}>{t(`paywall.${key}`)}</Text>
              </View>
            ))}
          </View>

          {/* Pro plans */}
          <Text style={styles.sectionTitle}>{t('paywall.choosePlanTitle')}</Text>
          {PRO_PLANS.map((plan) => (
            <TouchableOpacity
              key={plan.id}
              style={[styles.planCard, plan.highlight && styles.planCardHighlight]}
              activeOpacity={0.85}
              onPress={() => handleBuy(plan.id)}
              disabled={!!busyId}
            >
              {plan.badgeKey && (
                <View style={styles.planBadge}><Text style={styles.planBadgeText}>{t(`paywall.${plan.badgeKey}`)}</Text></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>{t(`paywall.${plan.titleKey}`)}</Text>
                <Text style={styles.planPer}>{t(`paywall.${plan.perKey}`)}</Text>
              </View>
              {busyId === plan.id ? (
                <ActivityIndicator color={ACCENT} />
              ) : (
                <Text style={styles.planPrice}>{priceFor(plan.id, plan.price)}</Text>
              )}
            </TouchableOpacity>
          ))}

          {/* Token packs */}
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>{t('paywall.tokenPacksTitle')}</Text>
          <Text style={styles.sectionSub}>{t('paywall.tokenPacksSubtitle')}</Text>
          {TOKEN_PACKS.map((pack) => (
            <TouchableOpacity
              key={pack.id}
              style={styles.tokenRow}
              activeOpacity={0.85}
              onPress={() => handleBuy(pack.id)}
              disabled={!!busyId}
            >
              <Zap color={ACCENT} size={18} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.tokenTitle}>{t('paywall.tokenCount', { count: pack.tokens })}</Text>
                {pack.badgeKey && <Text style={styles.tokenBadge}>{t(`paywall.${pack.badgeKey}`)}</Text>}
              </View>
              {busyId === pack.id ? (
                <ActivityIndicator color={ACCENT} />
              ) : (
                <Text style={styles.tokenPrice}>{priceFor(pack.id, pack.price)}</Text>
              )}
            </TouchableOpacity>
          ))}

          {/* Restore + legal */}
          <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore} disabled={busyId === 'restore'}>
            <Text style={styles.restoreText}>{t('paywall.restorePurchases')}</Text>
          </TouchableOpacity>

          <Text style={styles.legal}>
            {t('paywall.legalText')}
          </Text>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { color: TEXT, fontSize: 16, fontWeight: '800', letterSpacing: 2 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tagline: { color: MUTED, fontSize: 15, lineHeight: 22, marginBottom: 20 },
  featureCard: {
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: 18, marginBottom: 24,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  featureText: { color: TEXT, fontSize: 14, flex: 1 },
  sectionTitle: { color: TEXT, fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },
  sectionSub: { color: MUTED, fontSize: 12, marginTop: -6, marginBottom: 12 },
  planCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: 18, marginBottom: 12,
  },
  planCardHighlight: { borderColor: ACCENT, backgroundColor: 'rgba(255, 255, 255,0.08)' },
  planBadge: {
    position: 'absolute', top: -9, left: 16, backgroundColor: ACCENT,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
  },
  planBadgeText: { color: '#000', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  planTitle: { color: TEXT, fontSize: 17, fontWeight: '700' },
  planPer: { color: MUTED, fontSize: 12, marginTop: 2 },
  planPrice: { color: TEXT, fontSize: 20, fontWeight: '800' },
  tokenRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 16, marginBottom: 10,
  },
  tokenTitle: { color: TEXT, fontSize: 15, fontWeight: '700' },
  tokenBadge: { color: ACCENT, fontSize: 10, fontWeight: '700', marginTop: 2, letterSpacing: 0.5 },
  tokenPrice: { color: TEXT, fontSize: 17, fontWeight: '800' },
  restoreBtn: { alignItems: 'center', paddingVertical: 18, marginTop: 8 },
  restoreText: { color: MUTED, fontSize: 14, fontWeight: '600' },
  legal: { color: '#3F3F46', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 8 },
});
