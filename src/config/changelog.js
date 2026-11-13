// ─── Release changelog ────────────────────────────────────────────────────
// Powers the What's New screen and the one-time card shown after an update.
//
// WHY THIS IS LOCAL AND NOT SERVER-DRIVEN
// The roadmap (What's Coming) lives in Supabase because it changes between
// releases — plans move without the app shipping. A changelog is the opposite: it
// describes what is in the build the user is already running, so it belongs to the
// build. Keeping it local means it renders instantly, works fully offline, and can
// never disagree with the binary by describing features that are not there.
//
// HOW TO ADD A RELEASE
// Prepend an entry. `version` must match the `version` in app.json exactly — the
// post-update card looks itself up by that string, and a mismatch means the card
// silently never appears.
//
// Keep `highlights` to the few things a user would actually notice. Internal
// refactors, build plumbing, and dependency bumps do not belong here; if a line
// would not change what someone does with the app, leave it out.
//
// `kind` drives the icon and tint:
//   'feature'     something new they can use
//   'improvement' something existing that got better
//   'fix'         something that was broken and no longer is
// ──────────────────────────────────────────────────────────────────────────

export const CHANGELOG = [
  {
    version: '2.0.0',
    date: '2026-08-26',
    // A short line shown under the version. Optional.
    summary: 'Mindful Lock blocks reliably again, Aura stops hanging, and the app is far lighter.',
    highlights: [
      {
        kind: 'fix',
        title: 'Mindful Lock gives you the time you asked for',
        body: 'Adding an app now starts its allowance from zero, so a fresh limit is really fresh instead of already spent. The time bar counts up live while you use the app, and it keeps counting when you switch to LifePilot and back.',
      },
      {
        kind: 'fix',
        title: 'Strict mode respects your allowance',
        body: 'Strict used to block on sight and ignore your daily limit entirely. Now both modes spend the same allowance — the difference is that when it runs out, strict gives you no way to talk yourself into more.',
      },
      {
        kind: 'fix',
        title: 'Dismissing a block returns you to your day',
        body: 'Reopening LifePilot after a block used to drop you straight back on the block screen. It now lands on your dashboard.',
      },
      {
        kind: 'fix',
        title: 'The home screen widgets respond again',
        body: 'Tapping a circle ticks the task off, dragging scrolls the list instead of opening your app drawer, and your whole plan is there rather than hidden behind an "earlier" label.',
      },
      {
        kind: 'fix',
        title: 'Aura no longer hangs',
        body: 'When a provider stalls, Aura moves on instead of waiting indefinitely, so you get an answer or a clear error rather than an endless spinner.',
      },
      {
        kind: 'improvement',
        title: 'Less than half the size',
        body: 'The download is dramatically smaller and the app starts faster, with nothing removed.',
      },
      {
        kind: 'fix',
        title: 'One reminder, not ten',
        body: 'Nudges no longer pile up in your notification tray. You get a single reminder, and the next only arrives after you clear it.',
      },
      {
        kind: 'fix',
        title: 'The notification icon is the LifePilot mark',
        body: 'Notifications previously showed an old symbol that appeared nowhere else in the app.',
      },
      {
        kind: 'fix',
        title: 'Buttons you can actually read',
        body: 'On some themes a button label was white text on a white fill. Every button now picks a label colour that contrasts with what is behind it.',
      },
      {
        kind: 'improvement',
        title: 'More of the app speaks your language',
        body: 'More than a hundred labels that used to fall back to English are now translated in every supported language, and counts like "2 ads left today" no longer drop the plural.',
      },
      {
        kind: 'improvement',
        title: 'Shared lists are easier to read',
        body: 'Shared spaces no longer repeat their own name, and sync status sits where it belongs.',
      },
      {
        kind: 'fix',
        title: 'The daily promise closes on the first tap',
        body: 'Accepting your promise sometimes needed a second press before the screen would go away.',
      },
      {
        kind: 'improvement',
        title: 'Marketplace works offline',
        body: 'Equipping a theme or icon now applies straight away and syncs when you are back online.',
      },
    ],
  },
];

/** Newest release first, so [0] is always current. */
export const latestRelease = () => CHANGELOG[0] || null;

/** Look up a specific release, used by the post-update card. */
export const releaseFor = (version) => CHANGELOG.find((entry) => entry.version === version) || null;
