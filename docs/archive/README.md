# Archive — historical notes

⚠️ **Nothing in this folder is maintained.** These are snapshots written during
earlier AI sessions. Some describe bugs that are long fixed; some describe designs
that were later replaced.

**If an archive doc and the code disagree, the code is right.**

Kept because they're the only record of *why* certain decisions were made, and
because deleting them would lose that history permanently (most were never
committed to git).

For current, maintained documentation start at [`../README.md`](../README.md).

---

## What's in here

| Folder | Contents |
|--------|----------|
| `widgets/` | ~19 docs on widget design iterations, UI previews and fixes |
| `sync-and-data/` | Offline sync implementation notes, data-loss investigations, task lifecycle analysis |
| `ai/` | Earlier AI system notes, credit design, agent handoff docs, testing guides |
| `bug-fixes/` | Per-bug write-ups: avatars, calendar, permissions, drag-and-drop, daily promise |
| `audits/` | Code audits, XP system audits, performance work, safety reviews, session summaries |
| `misc/` | Old docs index, an earlier tech-stack doc, architecture diagrams, force-update setup |
| `superseded-code/` | `.backup.js` files that were sitting in `src/`: `SettingsScreen`, `AlarmListScreen`, `GlassSidebar` |
| `scratch/` | Stray files from the project root: `test.jpg`, `image.png`, `eslint-full.log` |

---

## Reading these usefully

They're most valuable for **why**, not **what**. The current code tells you what it
does; these sometimes tell you what was tried first and why it didn't work.

A few are still genuinely interesting:

- `sync-and-data/` — the data-loss investigations explain why the sync queue has a
  dead-letter list rather than infinite retry.
- `ai/` — shows how the credit system evolved before it moved server-side.
- `widgets/` — many rounds of design iteration; useful if you want to change the
  widget look and wonder what's been tried.

Everything they cover that is still true has been folded into the maintained docs,
usually in more accurate form (the current docs were written by reading the code,
not from memory).

---

## Can I delete this folder?

Yes, with one caveat: most of these files were **never committed to git**, so
deleting them is permanent. If you want the disk space back it's only a few hundred
kilobytes — not worth it. If you want a tidier repo, consider committing them first
so the history survives.
