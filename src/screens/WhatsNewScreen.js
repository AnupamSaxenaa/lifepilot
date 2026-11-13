// ─── What's New (Changelog) Screen ───────────────────────────
// Lists what shipped in each release, newest first.
//
// Deliberately the visual counterpart of ComingSoonScreen: that screen is a
// forward-looking timeline of things that do not exist yet, this one is a backward
// record of things that do. They share the header, spacing and colour language so
// moving between them feels like one feature with two directions, but the shapes
// differ on purpose — releases are grouped and dated, roadmap items are sequenced.
//
// Content comes from src/config/changelog.js (local, not server-driven — see the
// reasoning in that file).
// ─────────────────────────────────────────────────────────────
import { ChevronLeft, Sparkles, TrendingUp, Wrench } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CHANGELOG } from '../config/changelog';
import { useTheme } from '../context/ThemeContext';

const BG = '#000000';
const SURFACE = '#0A0A0A';
const BORDER = '#1C1C1E';
const TEXT = '#FAFAFA';
const MUTED = '#71717A';
const DIM = '#52525B';

// Icon + tint per highlight type. Shape carries the meaning as well as colour, so
// the categories stay distinguishable without relying on hue alone.
const KIND_META = {
  feature: { icon: Sparkles, color: '#34D399', labelKey: 'kindFeature', fallback: 'New' },
  improvement: { icon: TrendingUp, color: '#60A5FA', labelKey: 'kindImprovement', fallback: 'Improved' },
  fix: { icon: Wrench, color: '#FBBF24', labelKey: 'kindFix', fallback: 'Fixed' },
};

const formatDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Locale-aware rather than a hardcoded format: this screen is translated into
  // 21 languages and a fixed "26 Aug 2026" would be wrong in most of them.
  try {
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
};

const Highlight = ({ entry, t }) => {
  const meta = KIND_META[entry.kind] || KIND_META.improvement;
  const Icon = meta.icon;
  return (
    <View style={styles.highlight}>
      <View style={[styles.highlightIcon, { backgroundColor: `${meta.color}14`, borderColor: `${meta.color}33` }]}>
        <Icon color={meta.color} size={14} />
      </View>
      <View style={styles.highlightBody}>
        <View style={styles.highlightTitleRow}>
          <Text style={styles.highlightTitle}>{entry.title}</Text>
          <Text style={[styles.kindLabel, { color: meta.color }]}>
            {t(`whatsNew.${meta.labelKey}`, { defaultValue: meta.fallback })}
          </Text>
        </View>
        {!!entry.body && <Text style={styles.highlightText}>{entry.body}</Text>}
      </View>
    </View>
  );
};

export const WhatsNewScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const ACCENT = useTheme().theme.accent;

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
        <Text style={styles.headerTitle}>
          {t('whatsNew.headerTitle', { defaultValue: "WHAT'S NEW" })}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
        {CHANGELOG.map((release, index) => (
          <View key={release.version} style={styles.release}>
            <View style={styles.releaseHeader}>
              <View style={[
                styles.versionBadge,
                // Only the newest release is accented; older ones recede so the
                // current version is obvious without reading version numbers.
                index === 0
                  ? { backgroundColor: `${ACCENT}1A`, borderColor: `${ACCENT}55` }
                  : { backgroundColor: SURFACE, borderColor: BORDER },
              ]}>
                <Text style={[styles.versionText, { color: index === 0 ? ACCENT : MUTED }]}>
                  {release.version}
                </Text>
              </View>

              {index === 0 && (
                <Text style={[styles.currentTag, { color: ACCENT }]}>
                  {t('whatsNew.current', { defaultValue: 'CURRENT' })}
                </Text>
              )}

              <View style={styles.headerSpacer} />
              <Text style={styles.releaseDate}>{formatDate(release.date)}</Text>
            </View>

            {!!release.summary && <Text style={styles.summary}>{release.summary}</Text>}

            <View style={styles.highlightList}>
              {(release.highlights || []).map((entry, i) => (
                <Highlight key={`${release.version}-${i}`} entry={entry} t={t} />
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.footerNote}>
          {t('whatsNew.footerNote', {
            defaultValue: 'Have an idea or found something broken? Send feedback from Settings.',
          })}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { color: TEXT, fontSize: 16, fontWeight: '800', letterSpacing: 2 },

  scrollBody: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },

  // Generous separation between releases: this is the primary grouping, and
  // without it a long history reads as one continuous wall of bullet points.
  release: { marginBottom: 34 },
  releaseHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  versionBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7, borderWidth: 1 },
  versionText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  currentTag: { fontSize: 9, fontWeight: '800', letterSpacing: 1.1 },
  headerSpacer: { flex: 1 },
  releaseDate: { color: DIM, fontSize: 11, fontWeight: '600' },

  summary: { color: MUTED, fontSize: 13, lineHeight: 20, marginBottom: 16 },

  highlightList: { gap: 14 },
  highlight: { flexDirection: 'row', gap: 11 },
  // A small tinted square rather than a bare icon, so the icon column stays
  // visually aligned no matter which glyph each entry uses.
  highlightIcon: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  highlightBody: { flex: 1 },
  highlightTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  highlightTitle: { color: TEXT, fontSize: 14.5, fontWeight: '700', flexShrink: 1, lineHeight: 19 },
  kindLabel: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8 },
  highlightText: { color: MUTED, fontSize: 12.5, lineHeight: 18.5, marginTop: 3 },

  footerNote: { color: DIM, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 4, paddingHorizontal: 10 },
});
