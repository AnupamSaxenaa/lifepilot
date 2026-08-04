import { X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert, Dimensions, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LifetimeProgressRing } from './LifetimeProgressRing';

const { width } = Dimensions.get('window');

export const LifetimeStatsModal = ({ isVisible, onClose, stats, onReset }) => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  if (!isVisible) return null;

  const { completed, total } = stats;
  const pending = total - completed;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Modal visible={isVisible} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={styles.safeArea}>
          <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
            <Text style={styles.headerTitle}>{t('lifetimeStats.headerTitle')}</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <X color="#fff" size={28} />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            <View style={styles.ringWrapper}>
              <LifetimeProgressRing 
                completed={completed} 
                total={total} 
                size={width * 0.6} 
                strokeWidth={12} 
              />
              <View style={styles.percentageCenter}>
                <Text style={styles.percentageText}>{percentage}%</Text>
                <Text style={styles.percentageLabel}>{t('lifetimeStats.completionLabel')}</Text>
              </View>
            </View>

            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{total}</Text>
                <Text style={styles.statLabel}>{t('lifetimeStats.totalCreatedLabel')}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, { color: '#E5E7EB' }]}>{completed}</Text>
                <Text style={styles.statLabel}>{t('lifetimeStats.completedLabel')}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, { color: '#A1A1AA' }]}>{pending}</Text>
                <Text style={styles.statLabel}>{t('lifetimeStats.pendingLabel')}</Text>
              </View>
            </View>

            {onReset && (
              <TouchableOpacity 
                style={{ marginTop: 32, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, backgroundColor: '#A1A1AA20', alignItems: 'center', width: '100%' }}
                onPress={() => {
                  Alert.alert(t('lifetimeStats.resetAlertTitle'), t('lifetimeStats.resetAlertMessage'), [
                    { text: t('lifetimeStats.cancelButton'), style: 'cancel' },
                    { text: t('lifetimeStats.resetButton'), style: 'destructive', onPress: onReset }
                  ]);
                }}
              >
                <Text style={{ color: '#A1A1AA', fontWeight: '700', fontSize: 13, letterSpacing: 1 }}>{t('lifetimeStats.resetMetricsButton')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#050505',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  headerTitle: {
    color: '#666',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
  },
  closeBtn: {
    padding: 8,
    marginRight: -8,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  ringWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 60,
  },
  percentageCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  percentageText: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '800',
  },
  percentageLabel: {
    color: '#555',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 16,
  },
  statCard: {
    alignItems: 'center',
  },
  statValue: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  statLabel: {
    color: '#666',
    fontSize: 13,
    fontWeight: '500',
  }
});
