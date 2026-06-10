/**
 * AI API Keys Configuration
 * 
 * Replace these placeholder strings with your actual free-tier API keys 
 * before publishing to the app store.
 * 
 * The AIEngine will automatically cascade through these keys if any of them fail.
 */

export const AI_CONFIG = {
  // Production recommendation: set this to a secure backend/edge-function URL
  // and keep provider API keys off the mobile client.
  AI_PROXY_URL: process.env.EXPO_PUBLIC_AI_PROXY_URL || '',

  // Primary Engine (Generous free tier, highly intelligent)
  GEMINI_API_KEY: process.env.EXPO_PUBLIC_GEMINI_API_KEY,
  
  // Fallback 1 (Completely free, blazing fast Llama-3-70B)
  GROQ_API_KEY: process.env.EXPO_PUBLIC_GROQ_API_KEY,
  
  // Fallback 2 (Generous free tier)
  MISTRAL_API_KEY: process.env.EXPO_PUBLIC_MISTRAL_API_KEY,
  
  // Fallback 3 (Generous free tier)
  COHERE_API_KEY: process.env.EXPO_PUBLIC_COHERE_API_KEY,
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
