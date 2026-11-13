/**
 * LifePilot — Mission Runner
 * ------------------------------------------------------------------
 * Renders the current challenge in a mission (sequential array of
 * `{ id, difficulty, config }`) and calls `onStepComplete(challengeId)` when
 * the active challenge reports completion. The alarmController (not this
 * component) owns advancing the mission index / gating dismissal — this is
 * purely presentational + wiring.
 *
 * If a challenge id isn't registered/available (e.g. a native-dependent one
 * whose module failed to load), it's skipped automatically so the user is
 * never stuck on a mission step with no valid UI.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { get, getAvailableAsync } from './index';

export const MissionRunner = ({ challenge, onStepComplete }) => {
  const descriptor = challenge ? get(challenge.id) : null;
  const [availability, setAvailability] = useState({ challengeId: null, available: null });
  const available = availability.challengeId === challenge?.id
    ? availability.available
    : null;

  // Re-check asynchronous native/permission capability for every step. A
  // challenge configured earlier is skipped if the capability later becomes
  // unavailable, so a ringing alarm can never trap the user.
  useEffect(() => {
    let mounted = true;
    if (!challenge) return () => { mounted = false; };

    if (!descriptor) {
      Promise.resolve().then(() => {
        if (!mounted) return;
        setAvailability({ challengeId: challenge.id, available: false });
        onStepComplete(challenge.id);
      });
      return () => { mounted = false; };
    }

    getAvailableAsync()
      .then((descriptors) => {
        if (!mounted) return;
        const isAvailable = descriptors.some((item) => item.id === challenge.id);
        setAvailability({ challengeId: challenge.id, available: isAvailable });
        if (!isAvailable) onStepComplete(challenge.id);
      })
      .catch(() => {
        if (!mounted) return;
        setAvailability({ challengeId: challenge.id, available: false });
        onStepComplete(challenge.id);
      });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, descriptor]);

  if (!challenge || !descriptor || available !== true) return null;

  const Component = descriptor.component;
  return (
    <View style={styles.wrap}>
      <Component
        difficulty={challenge.difficulty || descriptor.defaultDifficulty}
        config={challenge.config || {}}
        onComplete={() => onStepComplete(challenge.id)}
        onUnavailable={() => onStepComplete(challenge.id)}
        onAbandon={() => {}}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { width: '100%', alignItems: 'center' },
});
