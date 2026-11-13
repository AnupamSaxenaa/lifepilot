import { Check, Globe, Search, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, useColorScheme, View } from 'react-native';
import { useTheme as useAppTheme } from '../context/ThemeContext';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';
import { COLORS } from '../theme/theme';

// Bottom-sheet language picker, styled to match TermsModal/other glass modals.
// `currentCode` is the active i18n language; `onSelect(code)` fires when the
// user taps a row — the caller (SettingsScreen) owns actually calling
// setAppLanguage() and handling the RTL-reload prompt.
export const LanguagePickerModal = ({ isVisible, onClose, currentCode, onSelect, forceDark = false }) => {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = forceDark || colorScheme === 'dark';
  const theme = isDark ? COLORS.dark : COLORS.light;
  const appTheme = useAppTheme().theme;
  const accent = forceDark ? COLORS.dark.accent : appTheme.accent;
  const [query, setQuery] = useState('');

  const filteredLanguages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SUPPORTED_LANGUAGES;
    return SUPPORTED_LANGUAGES.filter((l) =>
      l.label.toLowerCase().includes(q) ||
      l.nativeLabel.toLowerCase().includes(q) ||
      l.code.toLowerCase().includes(q)
    );
  }, [query]);

  // Reset the search box each time the sheet closes so it doesn't reopen
  // with a stale filter still applied.
  const handleClose = () => {
    setQuery('');
    onClose();
  };

  const handleSelect = (code) => {
    setQuery('');
    onSelect(code);
  };

  return (
    <Modal visible={isVisible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <View style={[
          styles.container,
          {
            backgroundColor: isDark ? '#0B0B0D' : '#FFFFFF',
            borderColor: theme.border,
          }
        ]}>
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.headerTitleRow}>
              <View style={[styles.iconBox, { backgroundColor: accent + '26' }]}>
                <Globe color={accent} size={22} />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>{t('settings.selectLanguage')}</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={[styles.closeBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <X color={theme.text} size={20} />
            </TouchableOpacity>
          </View>

          <View style={[styles.searchWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Search color={theme.textMuted} size={18} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('settings.searchLanguagePlaceholder')}
              placeholderTextColor={theme.textMuted}
              style={[styles.searchInput, { color: theme.text }]}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <X color={theme.textMuted} size={16} />
              </TouchableOpacity>
            )}
          </View>

          {filteredLanguages.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyStateText, { color: theme.textMuted }]}>{t('settings.noLanguagesFound')}</Text>
            </View>
          ) : (
            <FlatList
              data={filteredLanguages}
              keyExtractor={(item) => item.code}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = item.code === currentCode;
                return (
                  <TouchableOpacity
                    style={[styles.row, { borderColor: theme.border }]}
                    activeOpacity={0.7}
                    onPress={() => handleSelect(item.code)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: theme.text }]}>{item.nativeLabel}</Text>
                      <Text style={[styles.rowSubLabel, { color: theme.textMuted }]}>{item.label}</Text>
                    </View>
                    {isSelected && <Check color={accent} size={20} />}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    justifyContent: 'flex-end',
  },
  container: {
    width: '100%',
    height: '78%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyStateText: {
    fontSize: 14,
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  rowSubLabel: {
    fontSize: 13,
    marginTop: 2,
  },
});
