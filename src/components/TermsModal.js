import { BlurView } from 'expo-blur';
import { ShieldCheck, X } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, useColorScheme, View } from 'react-native';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { COLORS } from '../theme/theme';

export const TermsModal = ({ isVisible, onClose, onAccept }) => {
  const colorScheme = useColorScheme();
  useAppTheme().themeVersion;
  const theme = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  const handleScroll = ({ nativeEvent }) => {
    // If already true, no need to re-check
    if (hasScrolledToBottom) return;
    
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    // Allow a small buffer (e.g., 50px) to consider it "scrolled to bottom"
    const isCloseToBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 50;
    
    if (isCloseToBottom) {
      setHasScrolledToBottom(true);
    }
  };

  const handleAccept = () => {
    if (hasScrolledToBottom) {
      onAccept();
    }
  };

  return (
    <Modal visible={isVisible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <View style={[
          styles.container,
          {
            backgroundColor: colorScheme === 'dark' ? 'rgba(24, 24, 27, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            borderColor: theme.border,
          }
        ]}>
          <BlurView intensity={colorScheme === 'dark' ? 40 : 80} tint={colorScheme} style={StyleSheet.absoluteFill} />
          
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.headerTitleRow}>
              <View style={styles.iconBox}>
                <ShieldCheck color="#34D399" size={24} />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>Terms & Conditions</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <X color={theme.text} size={20} />
            </TouchableOpacity>
          </View>

          <ScrollView 
            style={styles.content} 
            showsVerticalScrollIndicator={true} 
            bounces={true}
            onScroll={handleScroll}
            scrollEventThrottle={16}
          >
            <Text style={[styles.heading, { color: theme.text }]}>1. Acceptance of Terms</Text>
            <Text style={[styles.paragraph, { color: theme.textMuted }]}>
              By accessing and using LifePilot, you accept and agree to be bound by the terms and provision of this agreement. 
              In addition, when using these particular services, you shall be subject to any posted guidelines or rules applicable to such services.
            </Text>

            <Text style={[styles.heading, { color: theme.text }]}>2. User Accounts</Text>
            <Text style={[styles.paragraph, { color: theme.textMuted }]}>
              To use certain features of the App, you must register for an account. You agree to provide accurate, current, and complete information during the registration process and to update such information to keep it accurate, current, and complete.
            </Text>

            <Text style={[styles.heading, { color: theme.text }]}>3. Data Privacy</Text>
            <Text style={[styles.paragraph, { color: theme.textMuted }]}>
              Your privacy is extremely important to us. We only store the data necessary to provide you with the best possible gamified productivity experience. 
              We do not sell your personal data to third parties.
            </Text>

            <Text style={[styles.heading, { color: theme.text }]}>4. Prohibited Conduct</Text>
            <Text style={[styles.paragraph, { color: theme.textMuted }]}>
              You agree not to engage in any of the following activities:
              - Violating laws, third party rights, or our policies.
              - Using our app to distribute malware or harmful content.
              - Attempting to bypass or tamper with the Mindful Lock features.
            </Text>

            <Text style={[styles.heading, { color: theme.text }]}>5. Modifications to Service</Text>
            <Text style={[styles.paragraph, { color: theme.textMuted }]}>
              LifePilot reserves the right to modify or discontinue, temporarily or permanently, the Service (or any part thereof) with or without notice.
            </Text>

            <View style={{ height: 40 }} />
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <Text style={[styles.hintText, { color: theme.textMuted }]}>
              {hasScrolledToBottom ? "Thank you for reading." : "Please scroll to the bottom to accept."}
            </Text>
            <TouchableOpacity 
              style={[
                styles.primaryBtn, 
                { opacity: hasScrolledToBottom ? 1 : 0.4 }
              ]} 
              onPress={handleAccept} 
              activeOpacity={0.8}
              disabled={!hasScrolledToBottom}
            >
              <Text style={styles.primaryBtnText}>I Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    width: '100%',
    height: '85%',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
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
    backgroundColor: 'rgba(229, 231, 235, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
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
    padding: 24,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 16,
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 8,
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    zIndex: 10,
    alignItems: 'center',
  },
  hintText: {
    fontSize: 13,
    marginBottom: 12,
    fontWeight: '500',
  },
  primaryBtn: {
    backgroundColor: '#34D399',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
