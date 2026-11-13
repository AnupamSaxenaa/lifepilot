import { BlurView } from 'expo-blur';
import { ArrowRight, Sparkles, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, useColorScheme, View } from 'react-native';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { COLORS } from '../theme/theme';

export const UpdatesModal = ({ isVisible, onClose, updateData, isLoading }) => {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();
  useAppTheme().themeVersion;
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const ACCENT = theme.accent;
  const ON_ACCENT = theme.onAccent || '#0B0B0D';
  const styles = useMemo(() => makeStyles(ACCENT, ON_ACCENT), [ACCENT, ON_ACCENT]);

  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [scaleAnim] = useState(() => new Animated.Value(0.95));

  useEffect(() => {
    if (isVisible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 60,
          useNativeDriver: true,
        })
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.95,
          duration: 200,
          useNativeDriver: true,
        })
      ]).start();
    }
  }, [isVisible]);

  if (!isVisible && fadeAnim._value === 0) return null;

  return (
    <Modal visible={isVisible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <Animated.View style={[
          styles.container,
          {
            backgroundColor: colorScheme === 'dark' ? 'rgba(24, 24, 27, 0.75)' : 'rgba(255, 255, 255, 0.85)',
            borderColor: theme.border,
            transform: [{ scale: scaleAnim }]
          }
        ]}>
          <BlurView intensity={colorScheme === 'dark' ? 40 : 60} tint={colorScheme} style={StyleSheet.absoluteFill} />
          
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.iconBox}>
                <Sparkles color={theme.accent} size={24} />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>{t('updatesModal.title')}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <X color={theme.text} size={20} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={theme.accent} size="large" />
              <Text style={[styles.loadingText, { color: theme.textMuted }]}>{t('updatesModal.loadingText')}</Text>
            </View>
          ) : updateData ? (
            <ScrollView style={styles.content} showsVerticalScrollIndicator={false} bounces={true}>
              <View style={styles.versionBadge}>
                <Text style={styles.versionText}>{updateData.version_info || t('updatesModal.latestUpdateFallback')}</Text>
              </View>

              <Text style={[styles.heading, { color: theme.text }]}>
                {updateData.heading}
              </Text>
              
              <Text style={[styles.paragraph, { color: theme.textMuted }]}>
                {updateData.paragraph}
              </Text>

              {updateData.features && updateData.features.length > 0 && (
                <View style={styles.featuresList}>
                  {updateData.features.map((feature, index) => (
                    <View key={index} style={[styles.featureItem, { backgroundColor: colorScheme === 'dark' ? ACCENT + '0D' : ACCENT + '1A' }]}>
                      <View style={styles.featureIcon}>
                        <ArrowRight color={theme.accent} size={16} />
                      </View>
                      <Text style={[styles.featureText, { color: theme.text }]}>{feature}</Text>
                    </View>
                  ))}
                </View>
              )}
              
              <View style={{ height: 40 }} />
            </ScrollView>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: theme.textMuted }]}>{t('updatesModal.emptyText')}</Text>
              <Text style={[styles.emptySubtext, { color: theme.textMuted }]}>{t('updatesModal.emptySubtext')}</Text>
            </View>
          )}

          {!isLoading && updateData && (
            <View style={[styles.footer, { borderTopColor: theme.border }]}>
              <TouchableOpacity style={styles.primaryBtn} onPress={onClose} activeOpacity={0.8}>
                <Text style={styles.primaryBtnText}>{t('updatesModal.gotItButton')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const makeStyles = (ACCENT, ON_ACCENT) => StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: '100%',
    maxHeight: '85%',
    borderRadius: 32,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    paddingBottom: 16,
    zIndex: 10,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: ACCENT + '26',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    paddingHorizontal: 24,
  },
  versionBadge: {
    alignSelf: 'flex-start',
    backgroundColor: ACCENT,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 20,
  },
  versionText: {
    color: ON_ACCENT,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  heading: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 16,
    lineHeight: 34,
  },
  paragraph: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
    opacity: 0.9,
  },
  featuresList: {
    gap: 12,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ACCENT + '33',
  },
  featureIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: ACCENT + '1A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  featureText: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    zIndex: 10,
  },
  primaryBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: {
    color: ON_ACCENT,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 15,
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 15,
  }
});
