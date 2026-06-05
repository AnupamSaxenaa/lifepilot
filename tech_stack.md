# LifePilot Tech Stack

This document tracks the completely free and powerful technologies we are using to build the LifePilot application.

## Core Framework
- **React Native with Expo**: Allows us to build truly native iOS and Android applications simultaneously from a single codebase while having access to premium device features.

## User Interface & Design (Glassmorphism)
- **Styling**: React Native StyleSheet with custom theme tokens.
- **Glass Effects**: `expo-blur` for native, hardware-accelerated frosted glass (Apple UI style).
- **Gradients**: `expo-linear-gradient` for vibrant, iOS-style backgrounds.
- **Icons**: `lucide-react-native` for clean, professional, and modern Apple-like icons.

## State Management & Routing
- **Routing**: React Navigation (`@react-navigation/native-stack`) for smooth, native page transitions.
- **State Management**: `zustand` (a tiny, fast, and powerful state management library, much simpler than Redux).

## Backend & Collaboration
- **Backend as a Service**: **Supabase** (Open-source Firebase alternative). It has an incredibly generous free tier, uses a powerful PostgreSQL database, and provides real-time websockets (perfect for the live collaboration feature).
- **Local Storage**: `@react-native-async-storage/async-storage` for saving tasks locally and offline capabilities.

## Artificial Intelligence
- **AI Provider**: **Google Gemini API** (Free Tier). Extremely powerful and allows us to do complex text-to-task parsing and AI roadmap generation without paying a cent.
