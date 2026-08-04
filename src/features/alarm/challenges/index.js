/**
 * LifePilot — Challenge Index
 * ------------------------------------------------------------------
 * Importing this module registers every built-in challenge (each file calls
 * `register()` as a side effect on load). Import this once, early (e.g. from
 * the mission runner or the mission-builder UI), before calling
 * `getAvailable()` / `get()`.
 */
import './ColorMatchChallenge';
import './MathChallenge';
import './MemoryChallenge';
import './NfcChallenge';
import './PhotoChallenge';
import './PuzzleChallenge';
import './QrCodeChallenge';
import './ReactionChallenge';
import './SequenceChallenge';
import './ShakeChallenge';
import './SquatChallenge';
import './TypingChallenge';
import './VoiceChallenge';
import './WalkingChallenge';

export { get, getAll, getAvailable, getAvailableAsync, register } from './registry';
