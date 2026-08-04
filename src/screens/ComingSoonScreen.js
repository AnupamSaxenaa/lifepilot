// ─── What's Coming (Roadmap) Screen ──────────────────────────
// Shows users what to expect in upcoming updates. Content is owner-managed
// server-side (roadmap_items) and loaded offline-first (instant from cache,
// refreshed in the background). See src/lib/roadmap.js + migration 0010.
// ─────────────────────────────────────────────────────────────
import { ChevronLeft, Rocket, Sparkles } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { loadRoadmap } from '../lib/roadmap';

const BG = '#000000';
const SURFACE = '#0A0A0A';
const BORDER = '#1C1C1E';
const TEXT = '#FAFAFA';
const MUTED = '#71717A';

// Status → section grouping + styling. Lower `order` shows first.
const STATUS_META = {
  next: { order: 0, labelKey: 'sectionNext', color: '#34D399' },
  in_progress: { order: 1, labelKey: 'sectionInProgress', color: '#60A5FA' },
  planned: { order: 2, labelKey: 'sectionPlanned', color: '#FBBF24' },
};
const STATUS_ORDER = ['next', 'in_progress', 'planned'];

export const ComingSoonScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const ACCENT = useTheme().theme.accent;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const cached = await loadRoadmap((fresh) => {
      setItems(fresh);
      setLoading(false);
    });
    if (cached && cached.length > 0) {
      setItems(cached);
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group items by status, preserving each group's server sort order.
  const grouped = STATUS_ORDER
    .map((status) => ({
      status,
      items: items.filter((i) => (i.status || 'planned') === status),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft color={TEXT} size={26} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('comingSoon.headerTitle')}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={ACCENT} size="large" /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Rocket color="#333" size={48} style={{ marginBottom: 14 }} />
          <Text style={styles.emptyTitle}>{t('comingSoon.emptyTitle')}</Text>
          <Text style={styles.emptyText}>{t('comingSoon.emptyText')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {/* Intro hero */}
          <View style={[styles.hero, { borderColor: ACCENT + '3A', backgroundColor: ACCENT + '14' }]}>
            <Sparkles color={ACCENT} size={22} />
            <Text style={styles.heroText}>{t('comingSoon.intro')}</Text>
          </View>

          {grouped.map(({ status, items: groupItems }) => {
            const meta = STATUS_META[status] || STATUS_META.planned;
            return (
              <View key={status} style={{ marginBottom: 26 }}>
                <View style={styles.sectionHeaderRow}>
                  <View style={[styles.sectionDot, { backgroundColor: meta.color }]} />
                  <Text style={styles.sectionTitle}>{t(`comingSoon.${meta.labelKey}`)}</Text>
                </View>

                {groupItems.map((item) => (
                  <View key={item.id} style={styles.card}>
                    <View style={styles.cardTop}>
                      <Text style={styles.cardEmoji}>{item.emoji || '✨'}</Text>
                      <View style={{ flex: 1 }}>
                        <View style={styles.titleRow}>
                          <Text style={styles.cardTitle}>{item.title}</Text>
                          {!!item.target_version && (
                            <View style={[styles.versionPill, { borderColor: ACCENT + '55' }]}>
                              <Text style={[styles.versionPillText, { color: ACCENT }]}>{item.target_version}</Text>
                            </View>
                          )}
                        </View>
                        {!!item.description && <Text style={styles.cardDesc}>{item.description}</Text>}
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            );
          })}

          <Text style={styles.footerNote}>{t('comingSoon.footerNote')}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { color: TEXT, fontSize: 16, fontWeight: '800', letterSpacing: 2 },

  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 24,
  },
  heroText: { flex: 1, color: '#D4D4D8', fontSize: 13, lineHeight: 19 },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { color: TEXT, fontSize: 13, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },

  card: {
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 16,
    padding: 16, marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardEmoji: { fontSize: 24, marginTop: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle: { color: TEXT, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  cardDesc: { color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 5 },

  versionPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  versionPillText: { fontSize: 11, fontWeight: '800' },

  emptyTitle: { color: TEXT, fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  emptyText: { color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center' },

  footerNote: { color: '#52525b', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8, paddingHorizontal: 10 },
});
