import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Animated, {
    FadeIn,
    FadeInDown,
    interpolateColor,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { readableOn } from '../../theme/contrast';
import { BackgroundWrapper } from '../BackgroundWrapper';

const SPRING = { damping: 18, stiffness: 220, mass: 0.65 };
const STAGGER_BASE = 130;
const STAGGER_STEP = 52;
const AUTH_PALETTE = Object.freeze({
  background: '#000000',
  surface: '#0B0B0D',
  focusSurface: '#101012',
  text: '#FFFFFF',
  muted: '#929299',
  border: '#202025',
  accent: '#FFFFFF',
  // Label colour for the accent-filled primary button. Explicit rather than
  // reusing `background`, which only happened to work because this palette is
  // pure white on pure black.
  onAccent: '#0B0B0D',
  danger: '#FB7185',
  success: '#34D399',
  warning: '#FBBF24',
  info: '#60A5FA',
});

// Logged-out screens intentionally ignore equipped marketplace themes.
export const useAuthPalette = () => AUTH_PALETTE;

export const AuthReveal = ({ children, index = 0, style }) => (
  <Animated.View entering={FadeInDown.duration(360).delay(index * 65)} style={style}>
    {children}
  </Animated.View>
);

export const AuthScreen = ({ children, contentStyle, centered = false }) => (
  <BackgroundWrapper plainBlack>
    <KeyboardAwareScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.screenContent,
        centered && styles.screenContentCentered,
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      extraScrollHeight={24}
    >
      <SafeAreaView style={styles.safeArea}>{children}</SafeAreaView>
    </KeyboardAwareScrollView>
  </BackgroundWrapper>
);

export const AuthBackButton = ({ onPress }) => {
  const palette = useAuthPalette();
  const [pressed, setPressed] = useState(false);
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(pressed ? 0.92 : 1, SPRING);
  }, [pressed, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(260)}
      style={[styles.backButtonWrap, animatedStyle]}
    >
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={[styles.backButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        <ArrowLeft color={palette.text} size={19} strokeWidth={2.2} />
      </Pressable>
    </Animated.View>
  );
};

export const AuthBrand = ({ compact = false, caption }) => {
  const palette = useAuthPalette();
  return (
    <View style={styles.brandRow}>
      <View
        style={[
          compact ? styles.brandMarkCompact : styles.brandMark,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Image source={require('../../../assets/images/logo-bw.png')} style={styles.brandImage} />
      </View>
      <View>
        <Text style={[styles.brandName, { color: palette.text }]}>LifePilot</Text>
        {caption ? <Text style={[styles.brandCaption, { color: palette.muted }]}>{caption}</Text> : null}
      </View>
    </View>
  );
};

export const AuthHero = ({ icon: Icon, eyebrow, title, subtitle, align = 'left' }) => {
  const palette = useAuthPalette();
  const centered = align === 'center';
  return (
    <View style={[styles.hero, centered && styles.heroCentered]}>
      {(Icon || eyebrow) ? (
        <Animated.View entering={FadeInDown.duration(280)} style={[styles.heroMeta, centered && styles.heroMetaCentered]}>
          {Icon ? <Icon color={palette.accent} size={18} strokeWidth={2.1} /> : null}
          {eyebrow ? <Text style={[styles.eyebrow, { color: palette.accent }]}>{eyebrow}</Text> : null}
        </Animated.View>
      ) : null}
      <Animated.Text
        entering={FadeInDown.duration(340).delay(50)}
        style={[styles.heroTitle, centered && styles.textCentered, { color: palette.text }]}
      >
        {title}
      </Animated.Text>
      {subtitle ? (
        <Animated.Text
          entering={FadeInDown.duration(340).delay(100)}
          style={[styles.heroSubtitle, centered && styles.textCentered, { color: palette.muted }]}
        >
          {subtitle}
        </Animated.Text>
      ) : null}
    </View>
  );
};

export const AuthCard = ({ children, style }) => (
  <Animated.View
    entering={FadeInDown.duration(380).delay(90)}
    style={[styles.card, style]}
  >
    {children}
  </Animated.View>
);

export const AuthField = ({
  icon: Icon,
  label,
  error,
  secureTextEntry,
  containerStyle,
  index = 0,
  ...props
}) => {
  const palette = useAuthPalette();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);
  const focus = useSharedValue(0);
  const errorPulse = useSharedValue(0);
  const shake = useSharedValue(0);
  const iconScale = useSharedValue(1);
  const previousError = useRef(error);

  useEffect(() => {
    focus.value = withTiming(focused ? 1 : 0, { duration: 200 });
    iconScale.value = withSequence(
      withTiming(focused ? 1.12 : 1, { duration: 140 }),
      withSpring(focused ? 1.06 : 1, { damping: 14, stiffness: 240 }),
    );
  }, [focused, focus, iconScale]);

  useEffect(() => {
    errorPulse.value = withTiming(error ? 1 : 0, { duration: 160 });
    if (error && error !== previousError.current) {
      shake.value = withSequence(
        withTiming(-5, { duration: 45 }),
        withTiming(5, { duration: 45 }),
        withTiming(-3, { duration: 45 }),
        withTiming(0, { duration: 45 }),
      );
    }
    previousError.current = error;
  }, [error, errorPulse, shake]);

  const fieldStyle = useAnimatedStyle(() => ({
    borderColor: errorPulse.value > 0
      ? palette.danger
      : interpolateColor(focus.value, [0, 1], [palette.border, palette.info]),
    backgroundColor: interpolateColor(focus.value, [0, 1], [palette.surface, palette.focusSurface]),
    transform: [{ translateX: shake.value }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  return (
    <Animated.View
      entering={FadeInDown.duration(360).delay(STAGGER_BASE + index * STAGGER_STEP)}
      style={[styles.fieldGroup, containerStyle]}
    >
      {label ? <Text style={[styles.fieldLabel, { color: palette.muted }]}>{label}</Text> : null}
      <Animated.View style={[styles.field, fieldStyle]}>
        {Icon ? (
          <Animated.View style={iconStyle}>
            <Icon color={focused ? palette.info : palette.muted} size={18} strokeWidth={2} />
          </Animated.View>
        ) : null}
        <TextInput
          {...props}
          secureTextEntry={hidden}
          placeholderTextColor={`${palette.muted}B8`}
          selectionColor={palette.info}
          onFocus={(event) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
          style={[styles.fieldInput, { color: palette.text }]}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setHidden((value) => !value)}
            hitSlop={10}
            style={styles.eyeButton}
          >
            {hidden ? <EyeOff color={palette.muted} size={18} /> : <Eye color={palette.muted} size={18} />}
          </Pressable>
        ) : null}
      </Animated.View>
      {error ? (
        <Animated.Text entering={FadeInDown.duration(180)} style={[styles.fieldError, { color: palette.danger }]}>
          {error}
        </Animated.Text>
      ) : null}
    </Animated.View>
  );
};

export const AuthButton = ({
  title,
  onPress,
  icon: Icon,
  imageSource,
  loading = false,
  disabled = false,
  variant = 'primary',
  style,
}) => {
  const palette = useAuthPalette();
  const blocked = disabled || loading;
  const primary = variant === 'primary';
  const [pressed, setPressed] = useState(false);
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(pressed ? 0.966 : 1, SPRING);
  }, [pressed, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: withTiming(pressed ? 0.92 : 1, { duration: 120 }),
  }));
  const color = primary ? (palette.onAccent || readableOn(palette.accent)) : palette.text;

  return (
    <Animated.View style={[styles.buttonShell, blocked && styles.disabled, animatedStyle, style]}>
      <Pressable
        onPress={onPress}
        disabled={blocked}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={styles.buttonPressable}
      >
        {primary ? (
          <View style={[styles.button, { backgroundColor: palette.accent }]}>
            <View style={styles.buttonContent}>
              {loading ? <ActivityIndicator color={color} size="small" /> : null}
              {!loading && Icon ? <Icon color={color} size={18} strokeWidth={2.2} /> : null}
              <Text style={[styles.buttonText, { color }]}>{title}</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.button, { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 }]}>
            <View style={styles.buttonContent}>
              {loading ? <ActivityIndicator color={color} size="small" /> : null}
              {!loading && imageSource ? <Image source={imageSource} style={styles.buttonImage} /> : null}
              {!loading && Icon ? <Icon color={color} size={18} strokeWidth={2.2} /> : null}
              <Text style={[styles.buttonText, { color }]}>{title}</Text>
            </View>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
};

export const AuthDivider = ({ label }) => {
  const palette = useAuthPalette();
  return (
    <Animated.View entering={FadeIn.duration(300).delay(140)} style={styles.divider}>
      <View style={[styles.dividerLine, { backgroundColor: palette.border }]} />
      <Text style={[styles.dividerLabel, { color: palette.muted }]}>{label}</Text>
      <View style={[styles.dividerLine, { backgroundColor: palette.border }]} />
    </Animated.View>
  );
};

export const AuthStatus = ({ children, tone = 'error', style }) => {
  const palette = useAuthPalette();
  const color = tone === 'muted'
    ? palette.muted
    : tone === 'success'
      ? palette.success
      : palette.danger;
  if (!children) return null;
  return (
    <Animated.Text
      entering={FadeInDown.duration(220)}
      style={[styles.status, { color, backgroundColor: `${color}10`, borderColor: `${color}30` }, style]}
    >
      {children}
    </Animated.Text>
  );
};

export const AuthFooter = ({ prompt, action, onPress }) => {
  const palette = useAuthPalette();
  return (
    <Animated.View entering={FadeIn.duration(300).delay(180)} style={styles.footer}>
      <Text style={[styles.footerPrompt, { color: palette.muted }]}>{prompt}</Text>
      <Pressable onPress={onPress} hitSlop={8}>
        <Text style={[styles.footerAction, { color: palette.accent }]}>{action}</Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, width: '100%' },
  screenContent: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 28 },
  screenContentCentered: { justifyContent: 'center' },
  backButtonWrap: { position: 'absolute', top: 8, left: 0, zIndex: 20 },
  backButton: {
    width: 40, height: 40, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 50, height: 50, borderRadius: 13, borderWidth: 1, overflow: 'hidden' },
  brandMarkCompact: { width: 40, height: 40, borderRadius: 11, borderWidth: 1, overflow: 'hidden' },
  brandImage: { width: '100%', height: '100%' },
  brandName: { fontSize: 17, fontWeight: '800', letterSpacing: -0.35 },
  brandCaption: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  hero: { marginTop: 64, marginBottom: 22 },
  heroCentered: { alignItems: 'center' },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  heroMetaCentered: { justifyContent: 'center' },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  heroTitle: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.9 },
  heroSubtitle: { fontSize: 14, lineHeight: 20, marginTop: 6, maxWidth: 420 },
  textCentered: { textAlign: 'center' },
  card: { width: '100%' },
  fieldGroup: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '700', marginBottom: 7, marginLeft: 1 },
  field: {
    minHeight: 50, borderRadius: 13, borderWidth: 1, paddingHorizontal: 13,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  fieldInput: { flex: 1, fontSize: 15, paddingVertical: 12 },
  eyeButton: { padding: 4 },
  fieldError: { fontSize: 12, lineHeight: 17, marginTop: 5, marginLeft: 2 },
  buttonShell: { minHeight: 50, borderRadius: 13 },
  buttonPressable: { borderRadius: 13, overflow: 'hidden' },
  button: {
    minHeight: 50, borderRadius: 13, paddingHorizontal: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  buttonText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.05 },
  buttonImage: { width: 19, height: 19, resizeMode: 'contain' },
  disabled: { opacity: 0.48 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerLabel: { fontSize: 11, fontWeight: '700', marginHorizontal: 12 },
  status: { fontSize: 12, lineHeight: 17, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  footer: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    flexWrap: 'wrap', gap: 6, marginTop: 18,
  },
  footerPrompt: { fontSize: 14 },
  footerAction: { fontSize: 14, fontWeight: '800' },
});