import { BlurView } from 'expo-blur';
import { ArrowRight, Sparkles, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Animated, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, useColorScheme, View, ActivityIndicator } from 'react-native';
import { COLORS } from '../theme/theme';

export const UpdatesModal = ({ isVisible, onClose, updateData, isLoading }) => {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  
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
                <Sparkles color="#A855F7" size={24} />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>What's New</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <X color={theme.text} size={20} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#A855F7" size="large" />
              <Text style={[styles.loadingText, { color: theme.textMuted }]}>Checking for updates...</Text>
            </View>
          ) : updateData ? (
            <ScrollView style={styles.content} showsVerticalScrollIndicator={false} bounces={true}>
              <View style={styles.versionBadge}>
                <Text style={styles.versionText}>{updateData.version_info || 'Latest Update'}</Text>
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
                    <View key={index} style={[styles.featureItem, { backgroundColor: colorScheme === 'dark' ? 'rgba(168, 85, 247, 0.05)' : 'rgba(168, 85, 247, 0.1)' }]}>
                      <View style={styles.featureIcon}>
                        <ArrowRight color="#A855F7" size={16} />
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
              <Text style={[styles.emptyText, { color: theme.textMuted }]}>You're all caught up!</Text>
              <Text style={[styles.emptySubtext, { color: theme.textMuted }]}>No new announcements right now.</Text>
            </View>
          )}

          {!isLoading && updateData && (
            <View style={[styles.footer, { borderTopColor: theme.border }]}>
              <TouchableOpacity style={styles.primaryBtn} onPress={onClose} activeOpacity={0.8}>
                <Text style={styles.primaryBtnText}>Got it!</Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
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
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
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
    backgroundColor: '#A855F7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 20,
  },
  versionText: {
    color: '#FFF',
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
    borderColor: 'rgba(168, 85, 247, 0.2)',
  },
  featureIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
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
    backgroundColor: '#A855F7',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: {
    color: '#FFF',
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
