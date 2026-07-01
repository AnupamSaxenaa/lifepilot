import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import Slider from '@react-native-community/slider';
import { Storage } from '../utils/storage';
import { updateAllWidgets } from '../utils/widgetUpdater';
import { COLORS } from '../theme/theme';

const { width } = Dimensions.get('window');

export const WidgetSettingsScreen = ({ navigation }) => {
  const [opacity, setOpacity] = useState(85); // Default to 85%
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      const savedOpacity = await Storage.get('widget_bg_opacity');
      if (savedOpacity) {
        setOpacity(parseInt(savedOpacity, 10));
      }
    };
    loadSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    await Storage.set('widget_bg_opacity', opacity.toString());
    await updateAllWidgets();
    setIsSaving(false);
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.replace('Dashboard');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <ArrowLeft color="#FAFAFA" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Widget Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        
        <View style={styles.card}>
          <Text style={styles.label}>Background Opacity</Text>
          <Text style={styles.description}>Adjust how transparent the widget background is on your home screen.</Text>
          
          <View style={styles.sliderContainer}>
            <Text style={styles.valueText}>{opacity}%</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={100}
              step={1}
              value={opacity}
              onValueChange={setOpacity}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor="#27272A"
              thumbTintColor="#FAFAFA"
            />
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabelText}>Transparent</Text>
              <Text style={styles.sliderLabelText}>Opaque</Text>
            </View>
          </View>
        </View>

        {/* Live Preview (Mock) */}
        <Text style={styles.sectionTitle}>Preview</Text>
        <View style={styles.previewContainer}>
          <View style={[
            styles.previewWidget, 
            { backgroundColor: `rgba(10, 10, 15, ${opacity / 100})` }
          ]}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>TODAY</Text>
              <Text style={styles.previewCount}>3</Text>
            </View>
            <View style={styles.previewTask}><Text style={styles.previewTaskText}>Buy Groceries</Text></View>
            <View style={styles.previewTask}><Text style={styles.previewTaskText}>Call Mom</Text></View>
          </View>
        </View>
      </View>

      {/* Save Button */}
      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.saveButton} 
          onPress={handleSave}
          disabled={isSaving}
        >
          <Text style={styles.saveButtonText}>
            {isSaving ? 'Applying...' : 'Apply & Update Widget'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1C1C1E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  sectionTitle: {
    color: '#FAFAFA',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
    marginTop: 8,
  },
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
  },
  label: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  description: {
    color: '#A1A1AA',
    fontSize: 14,
    marginBottom: 24,
    lineHeight: 20,
  },
  sliderContainer: {
    alignItems: 'center',
  },
  valueText: {
    color: COLORS.primary,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 4,
  },
  sliderLabelText: {
    color: '#71717A',
    fontSize: 12,
  },
  previewContainer: {
    alignItems: 'center',
    marginTop: 10,
  },
  previewWidget: {
    width: width * 0.8,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  previewTitle: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },
  previewCount: {
    color: '#FAFAFA',
    fontSize: 20,
    fontWeight: '700',
  },
  previewTask: {
    marginBottom: 16,
  },
  previewTaskText: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '500',
  },
  footer: {
    padding: 20,
    paddingBottom: 40,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '700',
  }
});
