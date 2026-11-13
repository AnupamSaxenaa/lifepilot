import {
    ArrowLeft,
    ArrowRight,
    BrainCircuit,
    Check,
    Lock,
    Search,
    ShieldCheck,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    NativeModules,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePro } from '../context/ProContext';
import {
    addApp,
    canLockMoreApps,
    getApps,
    getInstalledApps,
    lockedAppQuota,
    saveProfile,
} from '../utils/mindfulLock';

const { AppBlocker } = NativeModules;
const IS_ANDROID = Platform.OS === 'android';
const TOTAL_STEPS = IS_ANDROID ? 4 : 3;

const GOAL_PRESETS = [
  { emoji: '📚', labelKey: 'goalStudy' },
  { emoji: '😴', labelKey: 'goalSleep' },
  { emoji: '👨‍👩‍👧', labelKey: 'goalFamily' },
  { emoji: '💪', labelKey: 'goalHealth' },
  { emoji: '💼', labelKey: 'goalWork' },
  { emoji: '🎨', labelKey: 'goalCreative' },
];

const PERSONAS = [
  { id: 'gentle', emoji: '🤗', nameKey: 'personaGentleName', sampleKey: 'personaGentleSample' },
  { id: 'tough', emoji: '💪', nameKey: 'personaToughName', sampleKey: 'personaToughSample' },
  { id: 'stoic', emoji: '🧘', nameKey: 'personaStoicName', sampleKey: 'personaStoicSample' },
  { id: 'witty', emoji: '😏', nameKey: 'personaWittyName', sampleKey: 'personaWittySample' },
];

const APP_PRESETS = [
  { name: 'Instagram', package: 'com.instagram.android', icon: '📸' },
  { name: 'TikTok', package: 'com.zhiliaoapp.musically', icon: '🎵' },
  { name: 'YouTube', package: 'com.google.android.youtube', icon: '▶️' },
  { name: 'Twitter / X', package: 'com.twitter.android', icon: '🐦' },
  { name: 'Reddit', package: 'com.reddit.frontpage', icon: '🔴' },
  { name: 'Snapchat', package: 'com.snapchat.android', icon: '👻' },
  { name: 'Facebook', package: 'com.facebook.katana', icon: '📘' },
];

export const MindfulLockSetupScreen = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const userId = route?.params?.userId;
  const isAddingMore = route?.params?.isAddingMore || false;
  const initialStep = route?.params?.initialStep ?? 0;
  const [step, setStep] = useState(initialStep);
  const [installedApps, setInstalledApps] = useState([]);
  const [loadingApps, setLoadingApps] = useState(IS_ANDROID);
  const [searchQuery, setSearchQuery] = useState('');
  const [existingApps, setExistingApps] = useState([]);
  const [selectedGoal, setSelectedGoal] = useState('');
  const [customGoal, setCustomGoal] = useState('');
  const [selectedPersona, setSelectedPersona] = useState('gentle');
  const [blockingMode, setBlockingMode] = useState('cbt');
  const [selectedApps, setSelectedApps] = useState([]);
  const [customAppName, setCustomAppName] = useState('');
  const [customAppPackage] = useState('');

  const isNarrow = width < 360;
  const isShort = height < 700;
  const contentWidth = Math.min(width, 680);
  const horizontalPadding = isNarrow ? 14 : 22;
  const availableWidth = contentWidth - horizontalPadding * 2;
  const goalCardWidth = (availableWidth - 10) / 2;
  const styles = useMemo(
    () => createStyles({ isNarrow, isShort, goalCardWidth }),
    [goalCardWidth, isNarrow, isShort],
  );
  const isFinalStep = step === TOTAL_STEPS - 1;
  const { isPro } = usePro();
  // Apps already locked. Only loaded in the "add more" flow; the first-run flow
  // starts from zero by definition.
  const existingCount = isAddingMore ? existingApps.length : 0;
  const quota = lockedAppQuota({ isPro, currentCount: existingCount });

  useEffect(() => {
    if (isAddingMore) getApps(userId).then(setExistingApps);
  }, [isAddingMore, userId]);

  useEffect(() => {
    if (IS_ANDROID) {
      getInstalledApps().then((apps) => {
        apps.sort((a, b) => a.name.localeCompare(b.name));
        setInstalledApps(apps);
        setLoadingApps(false);
      });
    }
  }, []);

  const handleFinish = async () => {
    // Pro quota. Checked here rather than only on the picker so a stale selection
    // (e.g. the user was Pro, then the subscription lapsed mid-flow) can't slip
    // past. `existingCount` is the apps already locked, which the picker doesn't
    // know about when the user is adding more.
    const adding = selectedApps.length + (customAppName.trim() ? 1 : 0);
    if (!canLockMoreApps({ isPro, currentCount: existingCount, adding })) {
      const { limit } = lockedAppQuota({ isPro, currentCount: existingCount });
      Alert.alert(
        t('mindfulLockSetup.appLimitTitle'),
        t('mindfulLockSetup.appLimitMessage', { limit }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('mindfulLockSetup.upgradeButton'),
            onPress: () => navigation.navigate('Paywall'),
          },
        ],
      );
      return;
    }

    if (!isAddingMore) {
      const goal = customGoal.trim() || selectedGoal;
      await saveProfile(userId, {
        goal,
        coachPersona: selectedPersona,
        blockingMode,
        onboardingComplete: true,
      });
    }

    for (const app of selectedApps) {
      await addApp(userId, {
        name: app.name,
        packageName: app.package || app.packageName,
        icon: app.iconBase64 ? app.iconBase64 : app.icon,
        lockMode: 'allowance',
        dailyBudgetMinutes: app.dailyBudgetMinutes || 60,
      });
    }

    if (customAppName.trim()) {
      await addApp(userId, {
        name: customAppName.trim(),
        packageName: customAppPackage.trim() || customAppName.trim().toLowerCase(),
        icon: '📱',
        lockMode: 'allowance',
        dailyBudgetMinutes: 60,
      });
    }

    if (isAddingMore) navigation.goBack();
    else navigation.replace('MindfulLock', { userId });
  };

  const handleNext = async () => {
    if (IS_ANDROID && step === 2 && blockingMode === 'strict' && AppBlocker) {
      const isEnabled = await AppBlocker.isAccessibilityServiceEnabled();
      if (!isEnabled) {
        Alert.alert(
          t('mindfulLockSetup.permissionRequiredTitle'),
          t('mindfulLockSetup.permissionRequiredMessage'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('mindfulLockSetup.openSettings'), onPress: () => AppBlocker.openAccessibilitySettings() },
          ],
        );
        return;
      }
    }

    if (!isFinalStep) setStep((current) => current + 1);
    else handleFinish();
  };

  const handleBack = () => {
    if (isAddingMore && step === initialStep) navigation.goBack();
    else if (step > 0) setStep((current) => current - 1);
  };

  const toggleApp = (app) => {
    setSelectedApps((current) => {
      const exists = current.find((item) => item.name === app.name);
      if (exists) return current.filter((item) => item.name !== app.name);

      // Refuse at the point of tapping rather than letting the user pick ten apps
      // and only telling them at the end. Deselecting always works.
      if (!quota.unlimited && existingCount + current.length >= quota.limit) {
        Alert.alert(
          t('mindfulLockSetup.appLimitTitle'),
          t('mindfulLockSetup.appLimitMessage', { limit: quota.limit }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('mindfulLockSetup.upgradeButton'),
              onPress: () => navigation.navigate('Paywall'),
            },
          ],
        );
        return current;
      }
      return [...current, { ...app, dailyBudgetMinutes: 60 }];
    });
  };

  const updateAppTime = (appName, text) => {
    const mins = parseInt(text, 10);
    setSelectedApps((current) => current.map((app) => (
      app.name === appName ? { ...app, dailyBudgetMinutes: Number.isNaN(mins) ? 0 : mins } : app
    )));
  };

  const canProceed = () => {
    if (step === 0) return Boolean(selectedGoal || customGoal.trim());
    if (step === 1) return Boolean(selectedPersona);
    if (IS_ANDROID && step === 2) return Boolean(blockingMode);
    return true;
  };

  const filteredInstalledApps = installedApps.filter((app) => (
    app.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  ));
  const filteredPresets = APP_PRESETS.filter((app) => (
    app.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  ));
  const finalButtonLabel = selectedApps.length > 0 || customAppName.trim()
    ? t('mindfulLockSetup.finishButton')
    : t('mindfulLockSetup.skipButton');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.progressHeader, { width: contentWidth, paddingHorizontal: horizontalPadding }]}>
          <View style={styles.progressTrack}>
            {Array.from({ length: TOTAL_STEPS }).map((_, index) => {
              const complete = index < step;
              const active = index === step;
              return (
                <View key={index} style={styles.progressItem}>
                  <View style={[
                    styles.progressNumber,
                    (complete || active) && styles.progressNumberActive,
                    complete && styles.progressNumberComplete,
                  ]}>
                    {complete
                      ? <Check color="#0A0A0B" size={13} strokeWidth={2.4} />
                      : <Text style={[styles.progressNumberText, active && styles.progressNumberTextActive]}>{index + 1}</Text>}
                  </View>
                  {index < TOTAL_STEPS - 1 && (
                    <View style={[styles.progressLine, index < step && styles.progressLineComplete]} />
                  )}
                </View>
              );
            })}
          </View>
          <Text style={styles.progressCaption}>{step + 1} / {TOTAL_STEPS}</Text>
        </View>

        <ScrollView
          style={styles.flex}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { width: contentWidth, paddingHorizontal: horizontalPadding },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {step === 0 && (
            <Animated.View entering={FadeIn.duration(250)}>
              <View style={styles.stepIcon}>
                <BrainCircuit color="#E4E4E7" size={24} strokeWidth={1.6} />
              </View>
              <Text style={styles.heading}>{t('mindfulLockSetup.goalHeading')}</Text>
              <Text style={styles.subheading}>{t('mindfulLockSetup.goalSubheading')}</Text>

              <View style={styles.goalGrid}>
                {GOAL_PRESETS.map((goal) => {
                  const goalLabel = t(`mindfulLockSetup.${goal.labelKey}`);
                  const selected = selectedGoal === goalLabel;
                  return (
                    <TouchableOpacity
                      key={goal.labelKey}
                      style={[styles.goalCard, selected && styles.selectionCardActive]}
                      onPress={() => {
                        setSelectedGoal(goalLabel);
                        setCustomGoal('');
                      }}
                      activeOpacity={0.72}
                    >
                      <Text style={styles.goalEmoji}>{goal.emoji}</Text>
                      <Text style={[styles.goalLabel, selected && styles.selectionTextActive]} numberOfLines={2}>
                        {goalLabel}
                      </Text>
                      {selected && <Check color="#E4E4E7" size={16} style={styles.goalCheck} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.inputLabel}>{t('mindfulLockSetup.orTypeYourOwn')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('mindfulLockSetup.goalInputPlaceholder')}
                placeholderTextColor="#5C5C62"
                value={customGoal}
                onChangeText={(text) => {
                  setCustomGoal(text);
                  setSelectedGoal('');
                }}
                maxLength={100}
              />
            </Animated.View>
          )}

          {step === 1 && (
            <Animated.View entering={FadeIn.duration(250)}>
              <View style={styles.stepIcon}>
                <ShieldCheck color="#E4E4E7" size={24} strokeWidth={1.6} />
              </View>
              <Text style={styles.heading}>{t('mindfulLockSetup.personaHeading')}</Text>
              <Text style={styles.subheading}>{t('mindfulLockSetup.personaSubheading')}</Text>

              <View style={styles.selectionList}>
                {PERSONAS.map((persona) => {
                  const selected = selectedPersona === persona.id;
                  return (
                    <TouchableOpacity
                      key={persona.id}
                      style={[styles.selectionCard, selected && styles.selectionCardActive]}
                      onPress={() => setSelectedPersona(persona.id)}
                      activeOpacity={0.72}
                    >
                      <View style={styles.selectionHeader}>
                        <View style={styles.emojiIcon}><Text style={styles.personaEmoji}>{persona.emoji}</Text></View>
                        <Text style={[styles.selectionTitle, selected && styles.selectionTextActive]}>
                          {t(`mindfulLockSetup.${persona.nameKey}`)}
                        </Text>
                        <View style={[styles.checkCircle, selected && styles.checkCircleActive]}>
                          {selected && <Check color="#09090B" size={14} strokeWidth={2.4} />}
                        </View>
                      </View>
                      <Text style={styles.selectionDescription}>
                        “{t(`mindfulLockSetup.${persona.sampleKey}`)}”
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Animated.View>
          )}

          {IS_ANDROID && step === 2 && (
            <Animated.View entering={FadeIn.duration(250)}>
              <View style={styles.stepIcon}>
                <Lock color="#E4E4E7" size={23} strokeWidth={1.6} />
              </View>
              <Text style={styles.heading}>{t('mindfulLockSetup.modeHeading')}</Text>
              <Text style={styles.subheading}>{t('mindfulLockSetup.modeSubheading')}</Text>

              <View style={styles.selectionList}>
                <TouchableOpacity
                  style={[styles.modeCard, blockingMode === 'cbt' && styles.selectionCardActive]}
                  onPress={() => setBlockingMode('cbt')}
                  activeOpacity={0.72}
                >
                  <View style={styles.selectionHeader}>
                    <View style={styles.modeIcon}><BrainCircuit color="#D4D4D8" size={21} strokeWidth={1.7} /></View>
                    <Text style={styles.selectionTitle}>{t('mindfulLockSetup.modeCbtName')}</Text>
                    <View style={[styles.checkCircle, blockingMode === 'cbt' && styles.checkCircleActive]}>
                      {blockingMode === 'cbt' && <Check color="#09090B" size={14} strokeWidth={2.4} />}
                    </View>
                  </View>
                  <Text style={styles.selectionDescription}>{t('mindfulLockSetup.modeCbtDesc')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modeCard, blockingMode === 'strict' && styles.strictModeCardActive]}
                  onPress={() => setBlockingMode('strict')}
                  activeOpacity={0.72}
                >
                  <View style={styles.selectionHeader}>
                    <View style={[styles.modeIcon, styles.strictModeIcon]}><Lock color="#91B5D0" size={20} strokeWidth={1.7} /></View>
                    <Text style={styles.selectionTitle}>{t('mindfulLockSetup.modeStrictName')}</Text>
                    <View style={[styles.checkCircle, blockingMode === 'strict' && styles.strictCheckCircle]}>
                      {blockingMode === 'strict' && <Check color="#0E1A22" size={14} strokeWidth={2.4} />}
                    </View>
                  </View>
                  <Text style={styles.selectionDescription}>{t('mindfulLockSetup.modeStrictDesc')}</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          )}

          {isFinalStep && (
            <Animated.View entering={FadeIn.duration(250)}>
              <View style={styles.stepIcon}>
                <PlusAppIcon />
              </View>
              <Text style={styles.heading}>{t('mindfulLockSetup.appHeading')}</Text>
              <Text style={styles.subheading}>{t('mindfulLockSetup.appSubheading')}</Text>

              <View style={styles.searchContainer}>
                <Search color="#71717A" size={19} strokeWidth={1.8} />
                <TextInput
                  style={styles.searchInput}
                  placeholder={t('mindfulLockSetup.searchPlaceholder')}
                  placeholderTextColor="#64646A"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCorrect={false}
                />
              </View>

              {IS_ANDROID ? (
                loadingApps ? (
                  <ActivityIndicator size="small" color="#E4E4E7" style={styles.loader} />
                ) : (
                  <View style={styles.appList}>
                    {filteredInstalledApps.map((app) => {
                      const isAlreadyLocked = existingApps.some((item) => (
                        item.packageName === app.packageName || item.name === app.name
                      ));
                      const isSelected = selectedApps.some((item) => item.name === app.name);
                      const selectedApp = selectedApps.find((item) => item.name === app.name);
                      return (
                        <View key={app.packageName} style={styles.appRow}>
                          <TouchableOpacity
                            style={[
                              styles.installedAppCard,
                              isSelected && styles.selectionCardActive,
                              isAlreadyLocked && styles.disabledCard,
                            ]}
                            onPress={() => toggleApp({ ...app, iconBase64: app.icon })}
                            activeOpacity={0.72}
                            disabled={isAlreadyLocked}
                          >
                            <Image source={{ uri: `data:image/png;base64,${app.icon}` }} style={styles.installedAppIcon} />
                            <View style={styles.appIdentity}>
                              <Text style={styles.installedAppName} numberOfLines={1}>{app.name}</Text>
                              {isAlreadyLocked && (
                                <Text style={styles.lockedLabel}>{t('mindfulLockSetup.alreadyLocked')}</Text>
                              )}
                            </View>
                            <View style={[
                              styles.checkCircle,
                              isSelected && styles.checkCircleActive,
                              isAlreadyLocked && styles.lockedCircle,
                            ]}>
                              {isSelected && !isAlreadyLocked && <Check color="#09090B" size={14} strokeWidth={2.4} />}
                              {isAlreadyLocked && <Lock color="#77777D" size={13} />}
                            </View>
                          </TouchableOpacity>

                          {isSelected && !isAlreadyLocked && (
                            <View style={styles.allowanceContainer}>
                              <Text style={styles.allowanceLabel}>{t('mindfulLockSetup.dailyLimitLabel')}</Text>
                              <TextInput
                                style={styles.allowanceInput}
                                keyboardType="number-pad"
                                value={selectedApp.dailyBudgetMinutes.toString()}
                                onChangeText={(value) => updateAppTime(app.name, value)}
                                selectTextOnFocus
                              />
                              <Text style={styles.allowanceLabel}>{t('mindfulLockSetup.minutesLabel')}</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )
              ) : (
                <>
                  <View style={styles.presetAppGrid}>
                    {filteredPresets.map((app) => {
                      const isAlreadyLocked = existingApps.some((item) => (
                        item.packageName === app.package || item.name === app.name
                      ));
                      const isSelected = selectedApps.some((item) => item.name === app.name);
                      return (
                        <TouchableOpacity
                          key={app.name}
                          style={[
                            styles.presetAppCard,
                            isSelected && styles.selectionCardActive,
                            isAlreadyLocked && styles.disabledCard,
                          ]}
                          onPress={() => toggleApp(app)}
                          activeOpacity={0.72}
                          disabled={isAlreadyLocked}
                        >
                          <Text style={styles.presetAppIcon}>{app.icon}</Text>
                          <Text style={styles.presetAppName} numberOfLines={2}>
                            {app.name} {isAlreadyLocked && t('mindfulLockSetup.lockedSuffix')}
                          </Text>
                          {isSelected && <Check color="#E4E4E7" size={15} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={styles.inputLabel}>{t('mindfulLockSetup.orAddCustomApp')}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder={t('mindfulLockSetup.appNamePlaceholder')}
                    placeholderTextColor="#5C5C62"
                    value={customAppName}
                    onChangeText={setCustomAppName}
                    maxLength={50}
                  />
                </>
              )}
            </Animated.View>
          )}
        </ScrollView>

        <View style={[styles.bottomBar, { width: contentWidth, paddingHorizontal: horizontalPadding }]}>
          {step > 0 || isAddingMore ? (
            <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.7}>
              <ArrowLeft color="#A1A1AA" size={19} strokeWidth={1.8} />
              <Text style={styles.backButtonText}>{t('mindfulLockSetup.backButton')}</Text>
            </TouchableOpacity>
          ) : <View style={styles.backPlaceholder} />}

          <TouchableOpacity
            style={[styles.nextButton, !canProceed() && styles.nextButtonDisabled]}
            onPress={handleNext}
            disabled={!canProceed()}
            activeOpacity={0.84}
          >
            <Text style={styles.nextButtonText} numberOfLines={1}>
              {isFinalStep ? finalButtonLabel : t('mindfulLockSetup.nextButton')}
            </Text>
            {isFinalStep
              ? <Check color="#09090B" size={18} strokeWidth={2.2} />
              : <ArrowRight color="#09090B" size={18} strokeWidth={1.9} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const PlusAppIcon = () => (
  <View style={staticStyles.plusAppIcon}>
    <View style={staticStyles.plusVertical} />
    <View style={staticStyles.plusHorizontal} />
  </View>
);

const staticStyles = StyleSheet.create({
  plusAppIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  plusVertical: { position: 'absolute', width: 1.5, height: 18, backgroundColor: '#E4E4E7', borderRadius: 1 },
  plusHorizontal: { position: 'absolute', width: 18, height: 1.5, backgroundColor: '#E4E4E7', borderRadius: 1 },
});

const createStyles = ({ isNarrow, isShort, goalCardWidth }) => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070708' },
  flex: { flex: 1 },
  progressHeader: { alignSelf: 'center', minHeight: isShort ? 66 : 76, paddingTop: 12, justifyContent: 'center' },
  progressTrack: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  progressItem: { flexDirection: 'row', alignItems: 'center' },
  progressNumber: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: '#39393E', backgroundColor: '#101012', alignItems: 'center', justifyContent: 'center' },
  progressNumberActive: { borderColor: '#E4E4E7' },
  progressNumberComplete: { borderColor: '#E4E4E7', backgroundColor: '#E4E4E7' },
  progressNumberText: { color: '#8A8A91', fontSize: 11, fontWeight: '600' },
  progressNumberTextActive: { color: '#F4F4F5' },
  progressLine: { width: isNarrow ? 28 : 44, height: 1, backgroundColor: '#303034' },
  progressLineComplete: { backgroundColor: '#A1A1AA' },
  progressCaption: { color: '#5F5F65', fontSize: 10, letterSpacing: 0.8, textAlign: 'center', marginTop: 7 },
  scrollContent: { alignSelf: 'center', paddingTop: isShort ? 4 : 12, paddingBottom: 30 },
  stepIcon: { width: 48, height: 48, borderRadius: 24, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#29292D', backgroundColor: '#111113', marginBottom: isShort ? 12 : 18 },
  heading: { color: '#F4F4F5', fontSize: isNarrow ? 23 : 27, fontWeight: '400', lineHeight: isNarrow ? 29 : 33, letterSpacing: -0.55, textAlign: 'center' },
  subheading: { color: '#7D7D83', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8, marginBottom: isShort ? 20 : 28, paddingHorizontal: isNarrow ? 4 : 18 },
  goalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  goalCard: { width: goalCardWidth, minHeight: isShort ? 86 : 98, borderRadius: 14, borderWidth: 1, borderColor: '#242428', backgroundColor: '#101012', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 12 },
  goalEmoji: { fontSize: isNarrow ? 23 : 26, marginBottom: 7 },
  goalLabel: { color: '#99999F', fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'center' },
  goalCheck: { position: 'absolute', top: 8, right: 8 },
  inputLabel: { color: '#8A8A91', fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center', marginBottom: 10 },
  input: { minHeight: 50, borderRadius: 13, borderWidth: 1, borderColor: '#29292D', backgroundColor: '#101012', color: '#F4F4F5', fontSize: 14, paddingHorizontal: 14, paddingVertical: 12 },
  selectionList: { gap: 10 },
  selectionCard: { minHeight: 108, borderRadius: 15, borderWidth: 1, borderColor: '#242428', backgroundColor: '#101012', padding: isNarrow ? 13 : 15 },
  modeCard: { minHeight: 116, borderRadius: 15, borderWidth: 1, borderColor: '#242428', backgroundColor: '#101012', padding: isNarrow ? 13 : 15 },
  selectionCardActive: { borderColor: '#B3B3B8', backgroundColor: '#151517' },
  strictModeCardActive: { borderColor: '#496B84', backgroundColor: '#101820' },
  selectionHeader: { minHeight: 36, flexDirection: 'row', alignItems: 'center' },
  emojiIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1F', marginRight: 11 },
  personaEmoji: { fontSize: 20 },
  modeIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1F', marginRight: 11 },
  strictModeIcon: { backgroundColor: '#172632' },
  selectionTitle: { flex: 1, color: '#E4E4E7', fontSize: 15, fontWeight: '500', letterSpacing: -0.15, paddingRight: 8 },
  selectionTextActive: { color: '#FAFAFA' },
  selectionDescription: { color: '#77777D', fontSize: 12, lineHeight: 18, marginTop: 10 },
  checkCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: '#39393E', alignItems: 'center', justifyContent: 'center' },
  checkCircleActive: { borderColor: '#E4E4E7', backgroundColor: '#E4E4E7' },
  strictCheckCircle: { borderColor: '#9DBCD3', backgroundColor: '#9DBCD3' },
  searchContainer: { minHeight: 50, flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: '#29292D', backgroundColor: '#101012', paddingHorizontal: 13, marginBottom: 12 },
  searchInput: { flex: 1, minHeight: 48, color: '#F4F4F5', fontSize: 14, marginLeft: 9, paddingVertical: 0 },
  loader: { marginTop: 36 },
  appList: { gap: 9 },
  appRow: { gap: 7 },
  installedAppCard: { minHeight: 62, flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#242428', backgroundColor: '#101012', paddingHorizontal: 12, paddingVertical: 9 },
  disabledCard: { opacity: 0.45 },
  installedAppIcon: { width: 36, height: 36, borderRadius: 8, marginRight: 11 },
  appIdentity: { flex: 1, minWidth: 0 },
  installedAppName: { color: '#E4E4E7', fontSize: 14, fontWeight: '500' },
  lockedLabel: { color: '#77777D', fontSize: 10, marginTop: 3 },
  lockedCircle: { backgroundColor: '#1D1D20', borderColor: '#343438' },
  allowanceContainer: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', borderRadius: 12, borderWidth: 1, borderColor: '#242428', backgroundColor: '#0D0D0F', paddingHorizontal: 11 },
  allowanceLabel: { color: '#85858B', fontSize: isNarrow ? 11 : 12 },
  allowanceInput: { minWidth: 56, minHeight: 38, marginHorizontal: 8, borderRadius: 9, borderWidth: 1, borderColor: '#343438', backgroundColor: '#151517', color: '#F4F4F5', fontSize: 14, fontWeight: '600', textAlign: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  presetAppGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 24 },
  presetAppCard: { width: goalCardWidth, minHeight: 62, borderRadius: 13, borderWidth: 1, borderColor: '#242428', backgroundColor: '#101012', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, paddingVertical: 9 },
  presetAppIcon: { fontSize: 19, marginRight: 8 },
  presetAppName: { flex: 1, color: '#A1A1AA', fontSize: 12, lineHeight: 15, fontWeight: '500' },
  bottomBar: { alignSelf: 'center', minHeight: isShort ? 68 : 76, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#242428', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#070708' },
  backButton: { minWidth: isNarrow ? 82 : 96, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: isNarrow ? 4 : 10 },
  backPlaceholder: { width: isNarrow ? 82 : 96 },
  backButtonText: { color: '#A1A1AA', fontSize: 13, fontWeight: '500' },
  nextButton: { minWidth: isNarrow ? 132 : 148, maxWidth: '62%', minHeight: 48, borderRadius: 13, paddingHorizontal: isNarrow ? 14 : 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#F4F4F5' },
  nextButtonDisabled: { opacity: 0.3 },
  nextButtonText: { flexShrink: 1, color: '#09090B', fontSize: 13, fontWeight: '600', textAlign: 'center' },
});