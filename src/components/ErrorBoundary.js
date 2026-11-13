import { AlertTriangle } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import i18n from '../i18n';

/**
 * Error Boundary - Catches unhandled errors and prevents white screen crashes
 * Wraps the entire app to provide graceful error handling
 */
export class ErrorBoundary extends React.Component {
  state = { 
    hasError: false, 
    error: null,
    errorInfo: null
  };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Error info:', errorInfo);
    
    this.setState({
      error,
      errorInfo
    });
    
    // TODO: Send to crash reporting service (Sentry, Bugsnag, etc.)
    // Example:
    // Sentry.captureException(error, { extra: errorInfo });
  }

  handleReset = () => {
    this.setState({ 
      hasError: false, 
      error: null,
      errorInfo: null 
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.iconContainer}>
            <AlertTriangle color="#FB7185" size={60} />
          </View>
          
          <Text style={styles.title}>{i18n.t('errorBoundary.title')}</Text>
          <Text style={styles.subtitle}>
            {i18n.t('errorBoundary.subtitle')}
          </Text>
          
          {__DEV__ && this.state.error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>{i18n.t('errorBoundary.debugInfoLabel')}</Text>
              <Text style={styles.errorText} numberOfLines={5}>
                {this.state.error.toString()}
              </Text>
            </View>
          )}
          
          <TouchableOpacity 
            style={styles.button}
            onPress={this.handleReset}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>{i18n.t('errorBoundary.reloadButton')}</Text>
          </TouchableOpacity>
          
          <Text style={styles.footerText}>
            {i18n.t('errorBoundary.footerText')}
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  iconContainer: {
    marginBottom: 30,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    color: '#888',
    fontSize: 16,
    marginBottom: 30,
    textAlign: 'center',
    lineHeight: 24,
  },
  errorBox: {
    backgroundColor: 'rgba(161, 161, 170, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(161, 161, 170, 0.3)',
    borderRadius: 8,
    padding: 15,
    marginBottom: 30,
    maxWidth: '100%',
  },
  errorTitle: {
    color: '#FB7185',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  errorText: {
    color: '#FB7185',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  buttonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
  },
  footerText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
  },
});
