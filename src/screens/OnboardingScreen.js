import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, ArrowRight, Check, Flame, Gem, LockKeyhole, Shield, Sparkles, Target, Timer } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
    FadeIn,
    FadeInDown,
    FadeInUp,
    FadeOut,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthBrand, AuthButton, useAuthPalette } from '../components/auth/AuthKit';
import { BackgroundWrapper } from '../components/BackgroundWrapper';

const ICONS = [Target, Shield, Sparkles, Timer, Gem];
const slideNumber = (value) => String(value).padStart(2, '0');

export const OnboardingScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const palette = useAuthPalette();
  const insets = useSafeAreaInsets();

  const slides = [
    { title: t('onboarding.slide1Title'), description: t('onboarding.slide1Description'), eyebrow: t('onboarding.preview.organize', { defaultValue: 'ORGANIZE YOUR DAY' }), icon: ICONS[0] },
    { title: t('onboarding.slide2Title'), description: t('onboarding.slide2Description'), eyebrow: t('onboarding.preview.protect', { defaultValue: 'PROTECT YOUR ATTENTION' }), icon: ICONS[1] },
    { title: t('onboarding.slide3Title'), description: t('onboarding.slide3Description'), eyebrow: t('onboarding.preview.plan', { defaultValue: 'PLAN WITH INTELLIGENCE' }), icon: ICONS[2] },
    { title: t('onboarding.slide4Title'), description: t('onboarding.slide4Description'), eyebrow: t('onboarding.preview.focus', { defaultValue: 'DO THE DEEP WORK' }), icon: ICONS[3] },
    { title: t('onboarding.slide5Title'), description: t('onboarding.slide5Description'), eyebrow: t('onboarding.preview.progress', { defaultValue: 'SEE YOUR PROGRESS' }), icon: ICONS[4] },
  ];

  const slide = slides[currentIndex];
  const isLast = currentIndex === slides.length - 1;

  const next = () => {
    if (isLast) navigation.navigate('Login');
    else setCurrentIndex((value) => value + 1);
  };

  return (
    <BackgroundWrapper plainBlack>
      <View style={[styles.screen, { paddingTop: Math.max(insets.top, 14), paddingBottom: Math.max(insets.bottom, 18) }]}>
        <Animated.View entering={FadeIn.duration(260)} style={styles.header}>
          <View style={styles.headerLeading}>
            {currentIndex > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.back', { defaultValue: 'Back' })}
                onPress={() => setCurrentIndex((value) => Math.max(0, value - 1))}
                hitSlop={8}
                style={[styles.backButton, { backgroundColor: '#090909', borderColor: palette.border }]}
              >
                <ArrowLeft color={palette.text} size={17} strokeWidth={2.2} />
              </Pressable>
            ) : null}
            <AuthBrand compact />
          </View>
          {!isLast ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Login')}
              hitSlop={10}
            >
              <Text style={[styles.skip, { color: palette.muted }]}>{t('onboarding.skip')}</Text>
            </Pressable>
          ) : <View style={styles.skipPlaceholder} />}
        </Animated.View>

        <View style={styles.progressRow}>
          {slides.map((_, index) => (
            <View key={index} style={[styles.progressTrack, { backgroundColor: palette.border }]}>
              {index <= currentIndex ? (
                <Animated.View
                  entering={FadeIn.duration(220)}
                  style={[StyleSheet.absoluteFill, { backgroundColor: palette.accent }]}
                />
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.content}>
          <Animated.View
            key={`slide-${currentIndex}`}
            entering={FadeInDown.duration(320)}
            style={styles.copy}
          >
            <View style={styles.eyebrowRow}>
              <Text style={[styles.eyebrow, { color: palette.accent }]}>{slide.eyebrow}</Text>
              <Text style={[styles.pageCount, { color: palette.muted }]}>
                {slideNumber(currentIndex + 1)} / {slideNumber(slides.length)}
              </Text>
            </View>

            <Text style={[styles.title, { color: palette.text }]}>{slide.title}</Text>
            <Text style={[styles.description, { color: palette.muted }]}>{slide.description}</Text>

            <FeaturePreview
              index={currentIndex}
              icon={slide.icon}
              palette={palette}
              t={t}
            />
          </Animated.View>
        </View>

        <View style={styles.footer}>
          <AuthButton
            title={isLast ? t('onboarding.letsGo') : t('onboarding.next')}
            icon={ArrowRight}
            onPress={next}
          />
        </View>
      </View>
    </BackgroundWrapper>
  );
};

// Shared card chrome: soft gradient wash + hairline border + elevation, so
// every preview reads as one polished "device panel" rather than a plain box.
const PreviewCard = ({ palette, children }) => (
  <View style={[styles.panel, { borderColor: palette.border }]}>
    <LinearGradient
      pointerEvents="none"
      colors={[`${palette.accent}12`, '#0C0C0C', '#0A0A0A']}
      locations={[0, 0.4, 1]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    {children}
  </View>
);

const PreviewHeader = ({ icon: Icon, title, meta, palette }) => (
  <View style={[styles.panelHeader, { borderBottomColor: palette.border }]}>
    <View style={styles.panelHeading}>
      <View style={[styles.iconBadge, { backgroundColor: `${palette.accent}18`, borderColor: `${palette.accent}30` }]}>
        <Icon color={palette.accent} size={14} strokeWidth={2.3} />
      </View>
      <Text style={[styles.panelTitle, { color: palette.text }]}>{title}</Text>
    </View>
    <View style={[styles.metaPill, { backgroundColor: `${palette.accent}16`, borderColor: `${palette.accent}30` }]}>
      <Text style={[styles.panelMeta, { color: palette.accent }]}>{meta}</Text>
    </View>
  </View>
);

const TaskDivider = ({ palette }) => (
  <View style={[styles.taskDivider, { backgroundColor: palette.border }]} />
);

const TaskRow = ({ title, meta, done = false, palette }) => (
  <View style={styles.taskRow}>
    <View
      style={[
        styles.taskCheck,
        {
          borderColor: done ? palette.accent : `${palette.border}` ,
          backgroundColor: done ? palette.accent : `${palette.text}08`,
        },
      ]}
    >
      {done ? <Check color="#FFFFFF" size={12} strokeWidth={3} /> : null}
    </View>
    <View style={styles.taskCopy}>
      <Text style={[styles.taskTitle, { color: palette.text }, done && styles.completed]}>{title}</Text>
      <Text style={[styles.taskMeta, { color: palette.muted }]}>{meta}</Text>
    </View>
  </View>
);

// Card 1 (Today): tap-to-complete task with an autoplaying press → check →
// strike-through loop so the preview feels like a real interaction, not a
// static mock.
const DemoTaskRow = ({ title, palette, t }) => {
  const [done, setDone] = useState(false);
  const [pulse, setPulse] = useState(0);
  const checkScale = useSharedValue(1);

  useEffect(() => {
    let cancelled = false;
    const timers = [];

    const play = () => {
      if (cancelled) return;
      setDone(false);
      timers.push(setTimeout(() => {
        if (cancelled) return;
        setPulse((value) => value + 1);
        setDone(true);
      }, 700));
      timers.push(setTimeout(() => {
        if (!cancelled) setDone(false);
      }, 2700));
      timers.push(setTimeout(play, 3400));
    };

    play();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (pulse === 0) return;
    checkScale.value = withSequence(
      withTiming(0.76, { duration: 85 }),
      withSpring(1, { damping: 12, stiffness: 260 }),
    );
  }, [pulse, checkScale]);

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const toggle = () => {
    setPulse((value) => value + 1);
    setDone((value) => !value);
  };

  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: done }} onPress={toggle}>
      <View style={styles.taskRow}>
        <Animated.View
          style={[
            styles.taskCheck,
            {
              borderColor: done ? palette.accent : palette.border,
              backgroundColor: done ? palette.accent : `${palette.text}08`,
            },
            checkStyle,
          ]}
        >
          {done ? (
            <Animated.View entering={FadeIn.duration(120)}>
              <Check color="#FFFFFF" size={12} strokeWidth={3} />
            </Animated.View>
          ) : null}
        </Animated.View>
        <View style={styles.taskCopy}>
          <Text style={[styles.taskTitle, { color: palette.text }, done && styles.completed]}>{title}</Text>
          <Text style={[styles.taskMeta, { color: done ? palette.accent : palette.muted }]}>
            {done
              ? t('onboarding.preview.completedNow', { defaultValue: 'Completed just now' })
              : t('onboarding.preview.tapToComplete', { defaultValue: 'Tap to complete' })}
          </Text>
        </View>
      </View>
    </Pressable>
  );
};

// Shared progress bar. Resets from 0 only on first mount — later target
// changes animate smoothly from the current value instead of snapping back,
// so it can be driven by a live/looping counter without flicker.
const AnimatedProgress = ({ target, palette, delay = 260 }) => {
  const progress = useSharedValue(0);
  const hasMounted = useRef(false);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      progress.value = 0;
      progress.value = withDelay(delay, withTiming(target, { duration: 900 }));
    } else {
      progress.value = withTiming(target, { duration: 900 });
    }
  }, [target, delay, progress]);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  return (
    <View style={[styles.progressBar, { backgroundColor: palette.border }]}>
      <Animated.View style={[styles.animatedProgressValue, { backgroundColor: palette.accent }, progressStyle]} />
    </View>
  );
};

// A small continuous pulse used for "live" status icons (lock, flame). Kept
// subtle and only applied to a single icon per card.
const PulseIcon = ({ children }) => {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.14, { duration: 620 }),
        withTiming(1, { duration: 620 }),
      ),
      -1,
      false,
    );
  }, [scale]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
};

const BLOCKED_APPS = ['Instagram', 'YouTube', 'Shorts'];

// Card 2 (Mindful Lock): minutes-protected counter ticks up live, blocked
// apps reveal one at a time on a loop, and the lock icon pulses to show the
// session is actively protected.
const MindfulLockPreview = ({ icon, palette, copy }) => {
  const [minutes, setMinutes] = useState(42);
  const [visibleApps, setVisibleApps] = useState(BLOCKED_APPS.length);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setMinutes((value) => value + 1), 1700);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timers = [];

    const play = () => {
      if (cancelled) return;
      setCycle((value) => value + 1);
      setVisibleApps(0);
      BLOCKED_APPS.forEach((_, i) => {
        timers.push(setTimeout(() => {
          if (!cancelled) setVisibleApps(i + 1);
        }, 420 * (i + 1)));
      });
      timers.push(setTimeout(play, 420 * (BLOCKED_APPS.length + 1) + 2600));
    };

    play();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <PreviewCard palette={palette}>
      <PreviewHeader icon={icon} title={copy('mindfulLock', 'MINDFUL LOCK')} meta={copy('active', 'ACTIVE')} palette={palette} />
      <View style={styles.protectionBody}>
        <View style={styles.metricRow}>
          <Text style={[styles.metricValue, { color: palette.text }]}>{minutes}</Text>
          <View>
            <Text style={[styles.metricLabel, { color: palette.muted }]}>{copy('minutesProtected', 'MINUTES PROTECTED')}</Text>
            <Text style={[styles.metricDetail, { color: palette.text }]}>{copy('focusWindow', 'Focus window ends at 11:30')}</Text>
          </View>
        </View>
        <View style={[styles.infoBlock, { borderColor: palette.border }]}>
          <Text style={[styles.infoLabel, { color: palette.muted }]}>{copy('appsBlocked', 'APPS BLOCKED NOW')}</Text>
          <View style={styles.chipRow}>
            {BLOCKED_APPS.map((name, i) => (
              i < visibleApps ? (
                <Animated.View
                  key={`${name}-${cycle}`}
                  entering={FadeInDown.duration(220).delay(i * 70)}
                  style={[styles.chip, { borderColor: palette.border, backgroundColor: `${palette.accent}14` }]}
                >
                  <Text style={[styles.chipText, { color: palette.text }]}>{name}</Text>
                </Animated.View>
              ) : null
            ))}
          </View>
        </View>
        <View style={styles.statusRow}>
          <PulseIcon>
            <LockKeyhole color={palette.accent} size={15} />
          </PulseIcon>
          <Text style={[styles.statusText, { color: palette.text }]}>{copy('strictMode', 'Strict mode is protecting this session')}</Text>
        </View>
      </View>
    </PreviewCard>
  );
};

// Card 3 (AI Plan): the schedule quietly rebuilds itself every few seconds —
// rows fade out together and stagger back in — like the AI is actively
// re-planning the day rather than showing a frozen list.
const AiSchedulePreview = ({ icon, palette, copy }) => {
  const [cycle, setCycle] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const timers = [];

    const loop = () => {
      timers.push(setTimeout(() => {
        if (cancelled) return;
        setVisible(false);
        timers.push(setTimeout(() => {
          if (cancelled) return;
          setCycle((value) => value + 1);
          setVisible(true);
          loop();
        }, 260));
      }, 4200));
    };

    loop();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  const schedule = [
    ['09:00', copy('scheduleDeepWork', 'Deep work · Launch plan')],
    ['11:30', copy('scheduleReset', 'Break and mindful reset')],
    ['14:00', copy('schedulePriority', 'Complete priority task')],
  ];

  return (
    <PreviewCard palette={palette}>
      <PreviewHeader icon={icon} title={copy('aiSchedule', 'AI DAILY PLAN')} meta={copy('balanced', 'BALANCED')} palette={palette} />
      <View style={styles.scheduleBody}>
        {visible ? schedule.map(([time, title], rowIndex) => (
          <Animated.View
            entering={FadeInDown.duration(240).delay(100 + rowIndex * 90)}
            exiting={FadeOut.duration(160)}
            key={`${cycle}-${time}`}
            style={styles.scheduleRow}
          >
            <Text style={[styles.scheduleTime, { color: palette.accent }]}>{time}</Text>
            <View style={[styles.scheduleRule, { backgroundColor: palette.border }]} />
            <Text style={[styles.scheduleTitle, { color: palette.text }]}>{title}</Text>
          </Animated.View>
        )) : null}
        <Text style={[styles.panelNote, { color: palette.muted }]}>{copy('energyNote', 'Built around your priorities, energy, and available time.')}</Text>
      </View>
    </PreviewCard>
  );
};

// Card 4 (Focus Session): the timer counts down for real, the progress bar
// creeps forward with it, and a "Blocked" tag periodically pops to show a
// distraction attempt getting intercepted.
const FocusSessionPreview = ({ icon, palette, copy }) => {
  const initialSeconds = 42 * 60 + 18;
  const totalSeconds = 58 * 60;
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);
  const [showBlockedTag, setShowBlockedTag] = useState(false);
  const cellScale = useSharedValue(1);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((value) => (value > 0 ? value - 1 : initialSeconds));
    }, 1000);
    return () => clearInterval(id);
  }, [initialSeconds]);

  // A recurring "distraction blocked" pulse: scale the stat cell, flash a
  // tiny tag, then hide it — all triggered from the same tick so no effect
  // reacts to state it just set (avoids cascading-render warnings).
  useEffect(() => {
    let hideTimer;
    const id = setInterval(() => {
      cellScale.value = withSequence(
        withTiming(1.08, { duration: 110 }),
        withSpring(1, { damping: 10, stiffness: 220 }),
      );
      setShowBlockedTag(true);
      hideTimer = setTimeout(() => setShowBlockedTag(false), 900);
    }, 3400);
    return () => {
      clearInterval(id);
      clearTimeout(hideTimer);
    };
  }, [cellScale]);

  const cellStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cellScale.value }],
  }));

  const minutes = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeLabel = `${minutes}:${secs.toString().padStart(2, '0')}`;
  const elapsed = Math.max(0, totalSeconds - secondsLeft);
  const progressPercent = Math.min(100, Math.round((elapsed / totalSeconds) * 100));

  return (
    <PreviewCard palette={palette}>
      <PreviewHeader icon={icon} title={copy('focusSession', 'FOCUS SESSION')} meta={copy('live', 'LIVE')} palette={palette} />
      <View style={styles.timerBody}>
        <Text style={[styles.timerValue, { color: palette.text }]}>{timeLabel}</Text>
        <Text style={[styles.timerTask, { color: palette.muted }]}>{copy('currentTask', 'Working on · Finish product brief')}</Text>
        <AnimatedProgress target={progressPercent} palette={palette} delay={0} />
        <View style={styles.statsRow}>
          <Animated.View style={[styles.statCell, { borderColor: palette.border }, cellStyle]}>
            <Text style={[styles.statValue, { color: palette.text }]}>0</Text>
            <Text style={[styles.statLabel, { color: palette.muted }]}>{copy('distractions', 'DISTRACTIONS')}</Text>
            {showBlockedTag ? (
              <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(220)} style={[styles.blockedTag, { backgroundColor: `${palette.accent}22` }]}>
                <Text style={[styles.blockedTagText, { color: palette.accent }]}>{copy('blocked', 'Blocked')}</Text>
              </Animated.View>
            ) : null}
          </Animated.View>
          <View style={[styles.statCell, { borderColor: palette.border }]}>
            <Text style={[styles.statValue, { color: palette.text }]}>{progressPercent}%</Text>
            <Text style={[styles.statLabel, { color: palette.muted }]}>{copy('sessionDone', 'SESSION DONE')}</Text>
          </View>
        </View>
      </View>
    </PreviewCard>
  );
};

// Card 5 (Weekly Progress): XP creeps upward on a loop with a floating
// "+XP" pop each tick, and the streak flame pulses to feel alive.
const ProgressPreview = ({ icon, palette, copy }) => {
  const [xp, setXp] = useState(760);
  const [xpPulse, setXpPulse] = useState(0);
  const flameScale = useSharedValue(1);

  useEffect(() => {
    flameScale.value = withRepeat(
      withSequence(
        withTiming(1.16, { duration: 600 }),
        withTiming(1, { duration: 600 }),
      ),
      -1,
      false,
    );
  }, [flameScale]);

  useEffect(() => {
    const id = setInterval(() => {
      setXp((value) => (value + 12 > 1000 ? 760 : value + 12));
      setXpPulse((value) => value + 1);
    }, 2400);
    return () => clearInterval(id);
  }, []);

  const flameStyle = useAnimatedStyle(() => ({
    transform: [{ scale: flameScale.value }],
  }));

  const progressPercent = Math.min(100, Math.round((xp / 1000) * 100));

  return (
    <PreviewCard palette={palette}>
      <PreviewHeader icon={icon} title={copy('weeklyProgress', 'WEEKLY PROGRESS')} meta={copy('level', 'LEVEL 12')} palette={palette} />
      <View style={styles.levelBody}>
        <View style={styles.levelTopRow}>
          <View style={styles.xpRow}>
            <View>
              <Text style={[styles.xpValue, { color: palette.text }]}>{xp} XP</Text>
              <Text style={[styles.xpCaption, { color: palette.muted }]}>
                {copy('nextLevel', '{{count}} XP to your next level', { count: Math.max(0, 1000 - xp) })}
              </Text>
            </View>
            {xpPulse > 0 ? (
              <Animated.View key={xpPulse} entering={FadeInUp.duration(220)} exiting={FadeOut.duration(500)} style={styles.xpPop}>
                <Text style={[styles.xpPopText, { color: palette.accent }]}>+12 XP</Text>
              </Animated.View>
            ) : null}
          </View>
          <Gem color={palette.accent} size={30} strokeWidth={1.7} />
        </View>
        <AnimatedProgress target={progressPercent} palette={palette} delay={0} />
        <View style={styles.statsRow}>
          <View style={[styles.statCell, { borderColor: palette.border }]}>
            <View style={styles.inlineStat}>
              <Animated.View style={flameStyle}>
                <Flame color={palette.accent} size={16} />
              </Animated.View>
              <Text style={[styles.statValue, { color: palette.text }]}>7</Text>
            </View>
            <Text style={[styles.statLabel, { color: palette.muted }]}>{copy('dayStreak', 'DAY STREAK')}</Text>
          </View>
          <View style={[styles.statCell, { borderColor: palette.border }]}>
            <Text style={[styles.statValue, { color: palette.text }]}>3</Text>
            <Text style={[styles.statLabel, { color: palette.muted }]}>{copy('stonesEarned', 'STONES EARNED')}</Text>
          </View>
        </View>
      </View>
    </PreviewCard>
  );
};

const FeaturePreview = ({ index, icon, palette, t }) => {
  const copy = (key, fallback, options) => t(`onboarding.preview.${key}`, { defaultValue: fallback, ...options });

  if (index === 0) {
    return (
      <PreviewCard palette={palette}>
        <PreviewHeader icon={icon} title={copy('today', 'TODAY')} meta={copy('threePriorities', '3 PRIORITIES')} palette={palette} />
        <View style={styles.panelBody}>
          <DemoTaskRow title={copy('planDay', 'Plan the day')} t={t} palette={palette} />
          <TaskDivider palette={palette} />
          <TaskRow title={copy('deepWork', 'Deep work session')} meta={copy('deepWorkMeta', '45 min · High priority')} palette={palette} />
          <TaskDivider palette={palette} />
          <TaskRow title={copy('dailyReview', 'Review daily goals')} meta={copy('dailyReviewMeta', 'Today · 7:00 PM')} palette={palette} />
        </View>
      </PreviewCard>
    );
  }

  if (index === 1) {
    return <MindfulLockPreview icon={icon} palette={palette} copy={copy} />;
  }

  if (index === 2) {
    return <AiSchedulePreview icon={icon} palette={palette} copy={copy} />;
  }

  if (index === 3) {
    return <FocusSessionPreview icon={icon} palette={palette} copy={copy} />;
  }

  return <ProgressPreview icon={icon} palette={palette} copy={copy} />;
};

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skip: { fontSize: 13, fontWeight: '700', paddingVertical: 10 },
  skipPlaceholder: { width: 32 },
  progressRow: { flexDirection: 'row', gap: 6, marginTop: 18 },
  progressTrack: { flex: 1, height: 3, overflow: 'hidden' },
  content: { flex: 1, paddingTop: 46, paddingBottom: 18 },
  copy: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.35 },
  pageCount: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1.1, maxWidth: 430 },
  description: { fontSize: 14, lineHeight: 21, marginTop: 9, maxWidth: 440 },
  panel: {
    borderWidth: 1,
    borderRadius: 22,
    marginTop: 28,
    overflow: 'hidden',
  },
  panelHeader: {
    minHeight: 54,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  panelHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  metaPill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  panelMeta: { fontSize: 9.5, fontWeight: '900', letterSpacing: 0.8 },
  panelBody: { paddingHorizontal: 16, paddingBottom: 6, paddingTop: 4 },
  taskRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 13 },
  taskDivider: { height: StyleSheet.hairlineWidth, marginLeft: 35 },
  taskCheck: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.3, alignItems: 'center', justifyContent: 'center' },
  taskCopy: { flex: 1, gap: 3 },
  taskTitle: { fontSize: 14.5, fontWeight: '700', letterSpacing: -0.1 },
  taskMeta: { fontSize: 11, fontWeight: '500' },
  completed: { textDecorationLine: 'line-through', opacity: 0.5 },
  protectionBody: { padding: 17, gap: 16 },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  metricValue: { fontSize: 44, lineHeight: 48, fontWeight: '800', letterSpacing: -1.6, minWidth: 70 },
  metricLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  metricDetail: { fontSize: 12, fontWeight: '650', marginTop: 5 },
  infoBlock: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 9 },
  infoLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6 },
  chipText: { fontSize: 11, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusText: { fontSize: 11.5, fontWeight: '650' },
  scheduleBody: { padding: 17, gap: 15, minHeight: 136 },
  scheduleRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center' },
  scheduleTime: { width: 48, fontSize: 11, fontWeight: '900' },
  scheduleRule: { width: 2, borderRadius: 1, alignSelf: 'stretch', marginRight: 14 },
  scheduleTitle: { flex: 1, fontSize: 13.5, fontWeight: '700' },
  panelNote: { fontSize: 10, lineHeight: 15, marginTop: 1 },
  timerBody: { padding: 17 },
  timerValue: { fontSize: 46, lineHeight: 51, fontWeight: '800', letterSpacing: -1.9 },
  timerTask: { fontSize: 11.5, fontWeight: '600', marginTop: 4 },
  progressBar: { height: 6, borderRadius: 4, overflow: 'hidden', marginTop: 18 },
  animatedProgressValue: { height: '100%', borderRadius: 4 },
  statsRow: { flexDirection: 'row', gap: 11, marginTop: 17 },
  statCell: { flex: 1, borderWidth: 1, borderRadius: 13, padding: 12, gap: 5, overflow: 'hidden' },
  statValue: { fontSize: 18, fontWeight: '850' },
  statLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  blockedTag: { position: 'absolute', top: 9, right: 9, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 },
  blockedTagText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  levelBody: { padding: 17 },
  levelTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  xpRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  xpValue: { fontSize: 26, fontWeight: '850', letterSpacing: -0.8 },
  xpCaption: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  xpPop: { marginTop: 2 },
  xpPopText: { fontSize: 11, fontWeight: '900' },
  inlineStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footer: { paddingTop: 8 },
});
