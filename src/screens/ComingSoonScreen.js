// ─── What's Coming (Roadmap) Screen ──────────────────────────
// Shows users what to expect in upcoming updates. Content is owner-managed
// server-side (roadmap_items) and loaded offline-first (instant from cache,
// refreshed in the background). See src/lib/roadmap.js + migration 0010.
//
// LAYOUT: a vertical timeline rather than a list of cards.
//
// The previous version gave every item an identical bordered card on a raised
// surface. With ten items that produced ten visually identical boxes, so the one
// thing a roadmap needs to communicate — that these things are ordered, and some
// are closer than others — was carried only by an 8px coloured dot in each section
// heading. Status was defined per group but never reached the items themselves.
//
// A connected rail makes the ordering structural: items hang off a single spine,
// each with a node whose shape encodes how far along it is (solid = next, ringed =
// in progress, hollow = planned). That also removes the need for a border around
// every row, so the text carries the page instead of competing with chrome.
// ─────────────────────────────────────────────────────────────
import { ChevronLeft, Rocket } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { loadRoadmap } from '../lib/roadmap';

const BG = '#000000';
const BORDER = '#1C1C1E';
const TEXT = '#FAFAFA';
const MUTED = '#71717A';
const DIM = '#52525B';

// Status → section grouping + styling. Lower `order` shows first.
// `node` drives the timeline marker: how complete the item reads at a glance.
const STATUS_META = {
  next: { labelKey: 'sectionNext', color: '#34D399', node: 'solid' },
  in_progress: { labelKey: 'sectionInProgress', color: '#60A5FA', node: 'ring' },
  planned: { labelKey: 'sectionPlanned', color: '#FBBF24', node: 'hollow' },
};
const STATUS_ORDER = ['next', 'in_progress', 'planned'];

const RAIL_WIDTH = 30;
const NODE_SIZE = 11;

/**
 * Timeline marker. Its shape, not just its colour, carries the status — colour
 * alone would leave the distinction invisible to anyone who cannot separate the
 * green/blue/amber hues.
 */
const TimelineNode = ({ meta }) => {
  if (meta.node === 'solid') {
    return <View style={[styles.node, { backgroundColor: meta.color, borderColor: meta.color }]} />;
  }
  if (meta.node === 'ring') {
    return (
      <View style={[styles.node, { borderColor: meta.color, backgroundColor: BG }]}>
        <View style={[styles.nodeCore, { backgroundColor: meta.color }]} />
      </View>
    );
  }
  return <View style={[styles.node, { borderColor: `${meta.color}99`, backgroundColor: BG }]} />;
};

const RoadmapRow = ({ item, meta, isLast }) => (
  <View style={styles.row}>
    <View style={styles.rail}>
      {/* The spine runs the full height and is clipped short on the final row so
          the timeline terminates instead of trailing into empty space. */}
      <View style={[styles.railLine, isLast && styles.railLineLast]} />
      <TimelineNode meta={meta} />
    </View>

    <View style={[styles.rowBody, isLast && styles.rowBodyLast]}>
      <View style={styles.titleRow}>
        {!!item.emoji && <Text style={styles.emoji}>{item.emoji}</Text>}
        <Text style={styles.title}>{item.title}</Text>
      </View>

      {!!item.description && <Text style={styles.desc}>{item.description}</Text>}

      {!!item.target_version && (
        <View style={styles.metaRow}>
          <View style={[styles.versionPill, { borderColor: `${meta.color}55` }]}>
            {/* Tinted per status rather than always the theme accent, so the pill
                agrees with its node instead of implying every item is equally near. */}
            <Text style={[styles.versionPillText, { color: meta.color }]}>{item.target_version}</Text>
          </View>
        </View>
      )}
    </View>
  </View>
);

export const ComingSoonScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const ACCENT = useTheme().theme.accent;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // The load runs inside the effect rather than through a useCallback invoked by
  // it. Beyond satisfying the set-state-in-effect rule, the `alive` flag closes a
  // real leak: loadRoadmap's onFresh callback fires whenever the background
  // refresh completes, which can easily be after the user has navigated away, and
  // the previous version had nothing to stop it setting state on an unmounted
  // screen.
  useEffect(() => {
    let alive = true;

    (async () => {
      const cached = await loadRoadmap((fresh) => {
        if (!alive) return;
        setItems(fresh);
        setLoading(false);
      });
      if (!alive) return;
      if (cached && cached.length > 0) {
        setItems(cached);
        setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, []);

  // Group items by status, preserving each group's server sort order.
  const grouped = STATUS_ORDER
    .map((status) => ({
      status,
      items: items.filter((i) => (i.status || 'planned') === status),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', { defaultValue: 'Back' })}
        >
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
        <ScrollView
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator={false}
        >
          {/* The intro was a bordered, tinted hero block competing with the items
              for attention. As plain text under the title it still sets context
              without taking a card's worth of space above the actual content. */}
          <Text style={styles.intro}>{t('comingSoon.intro')}</Text>

          {grouped.map(({ status, items: groupItems }) => {
            const meta = STATUS_META[status] || STATUS_META.planned;
            return (
              <View key={status} style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionTitle, { color: meta.color }]}>
                    {t(`comingSoon.${meta.labelKey}`)}
                  </Text>
                  {/* A count tells you the shape of each phase before you scroll it. */}
                  <Text style={styles.sectionCount}>{groupItems.length}</Text>
                  <View style={[styles.sectionRule, { backgroundColor: BORDER }]} />
                </View>

                {groupItems.map((item, index) => (
                  <RoadmapRow
                    key={item.id}
                    item={item}
                    meta={meta}
                    isLast={index === groupItems.length - 1}
                  />
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

  scrollBody: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 60 },
  intro: { color: MUTED, fontSize: 13, lineHeight: 20, marginBottom: 26 },

  section: { marginBottom: 30 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase' },
  sectionCount: { color: DIM, fontSize: 11, fontWeight: '700' },
  // Fills the remaining width so each phase reads as its own band.
  sectionRule: { flex: 1, height: StyleSheet.hairlineWidth, marginLeft: 2 },

  row: { flexDirection: 'row' },
  rail: { width: RAIL_WIDTH, alignItems: 'center' },
  railLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: BORDER,
  },
  // Stops the spine just past the final node instead of running to the section end.
  railLineLast: { bottom: undefined, height: 9 },
  node: {
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    borderWidth: 1.5,
    marginTop: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeCore: { width: 3.5, height: 3.5, borderRadius: 2 },

  rowBody: { flex: 1, paddingBottom: 20 },
  rowBodyLast: { paddingBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  emoji: { fontSize: 15 },
  title: { color: TEXT, fontSize: 15, fontWeight: '700', flexShrink: 1, lineHeight: 20 },
  desc: { color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 5 },

  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 9 },
  versionPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  versionPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  emptyTitle: { color: TEXT, fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  emptyText: { color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center' },

  footerNote: { color: DIM, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 4, paddingHorizontal: 10 },
});
