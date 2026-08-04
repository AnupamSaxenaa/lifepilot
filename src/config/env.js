/**
 * AI API Keys Configuration
 * 
 * Replace these placeholder strings with your actual free-tier API keys 
 * before publishing to the app store.
 * 
 * The AIEngine will automatically cascade through these keys if any of them fail.
 */

export const AI_CONFIG = {
  // AI providers are proxy-only. Provider secrets belong in Supabase Function
  // secrets and are never referenced by Metro, even when local .env is sourced.
  AI_PROXY_URL: process.env.EXPO_PUBLIC_AI_PROXY_URL || '',
  REQUIRE_AI_PROXY:
    process.env.EXPO_PUBLIC_REQUIRE_AI_PROXY === 'true'
    || process.env.EXPO_PUBLIC_REQUIRE_AI_PROXY === '1',
};

/**
 * Calendar OAuth Configuration
 * Replace these with your actual Client IDs from Google Cloud and Microsoft Entra
 */
export const CALENDAR_CONFIG = {
  // Google OAuth client IDs. Native builds should use platform-specific IDs.
  GOOGLE_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '753694130355-8bhkicmdd6qqu9esu09qo5c9dv8ab3vi.apps.googleusercontent.com',
  GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '753694130355-8bhkicmdd6qqu9esu09qo5c9dv8ab3vi.apps.googleusercontent.com',
  GOOGLE_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '753694130355-8bhkicmdd6qqu9esu09qo5c9dv8ab3vi.apps.googleusercontent.com',
  GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '753694130355-8bhkicmdd6qqu9esu09qo5c9dv8ab3vi.apps.googleusercontent.com',
  
  // Microsoft Application (Client) ID
  MICROSOFT_CLIENT_ID: process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID || '0d2b6582-ad00-4c9d-ba75-4512fe6cdfe1',
};
