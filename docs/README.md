# LifePilot Documentation

Welcome. This folder exists to answer one question:

> **"An AI built this app. What is it, how does it work, and how do I take it over?"**

You do not need to read this in order. But if you are starting from zero, this
is the order that will make sense.

---

## Start here (about 90 minutes)

| # | Read this | You will be able to |
|---|-----------|---------------------|
| 1 | [What is LifePilot](01-orientation/01-what-is-lifepilot.md) | Describe your own app to someone else |
| 2 | [The tech stack](01-orientation/02-tech-stack.md) | Say what every technology does and why it's there |
| 3 | [Glossary](01-orientation/03-glossary.md) | Stop being blocked by unfamiliar words |
| 4 | [Repository tour](02-codebase-map/01-repository-tour.md) | Open any file and know why it exists |

## Then: understand the machine

| Read this | Covers |
|-----------|--------|
| [Architecture](02-codebase-map/02-architecture.md) | The offline-first rule that governs the whole app |
| [How data flows](02-codebase-map/03-how-data-flows.md) | What actually happens when you tick a task |
| [Screens and navigation](02-codebase-map/04-screens-and-navigation.md) | Every screen, and how you move between them |
| [The AI system](02-codebase-map/05-the-ai-system.md) | Aura: context, memory, credits, the proxy |
| [The widgets](02-codebase-map/06-the-widgets.md) | The home-screen widgets and their hard limits |

## Alongside: learn the language

This is a 12-week plan that teaches JavaScript, React and React Native **using
your own code as the textbook**. Not generic tutorials — your files.

→ **[Start the learning plan](03-learn-the-language/00-learning-plan.md)**

## When you need to do something

| Task | Doc |
|------|-----|
| Build an APK, ship an update | [Build and release](04-operations/01-build-and-release.md) |
| Touch the database or backend | [Backend and database](04-operations/02-backend-and-database.md) |
| Check you didn't break anything | [Testing and verification](04-operations/03-testing-and-verification.md) |
| Look up a command | [Command cheat sheet](05-reference/01-command-cheatsheet.md) |
| Something is broken | [Troubleshooting](05-reference/02-troubleshooting.md) |

---

## How to read code you didn't write

A method that works, and costs less than trying to understand everything:

1. **Start from something you can see.** Pick a thing on screen — a button, a
   row of text. Search the codebase for its label. You will land in the file
   that draws it.
2. **Follow one thread, ignore everything else.** From that file, follow only
   the function you care about. You will be tempted to read the imports. Don't.
3. **Find the seam.** Every feature eventually calls into `src/lib/dataManager.js`
   (data) or `src/lib/AIEngine.js` (AI). Those two files are the spine.
4. **Change one number and rebuild.** Nothing teaches faster than making a
   visible change. Change a font size, see it move.

You do not need to understand all 180 source files. Roughly twelve files carry
most of the meaning, and they are listed in the
[repository tour](02-codebase-map/01-repository-tour.md#the-twelve-files-that-matter).

---

## A word on trust

This documentation was written by reading the actual code, not from memory.
Where a doc makes a claim about behaviour, it names the file and usually the
function so you can check it yourself. **Please do check it.** If a doc and the
code disagree, the code is right and the doc is stale — that is normal in every
codebase, and noticing it is a real skill.

`docs/archive/` holds ~60 older documents from previous AI sessions. They are
kept for history and are **not** maintained. Treat anything in there as a
snapshot of a moment, not as current truth.
