/* global __dirname */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const manager = read('src/lib/collaborationManager.js');
const queue = read('src/lib/syncQueue.js');
const migration = read('supabase/migrations/0016_collaboration_core.sql');
const comments = read('src/components/collaboration/CommentThread.js');
const shareSheet = read('src/components/collaboration/ShareListSheet.js');
const env = read('src/config/env.js');
const appConfig = read('app.config.js');
const inviteLanding = read('supabase/functions/invite/index.ts');

const checks = [
  ['client shared-task patch keeps notes', manager.includes("'assigned_to', 'notes', 'subtasks'")],
  ['client shared-task patch keeps completion time', manager.includes("'title', 'is_completed', 'completed_at'")],
  ['durable RPC enqueue starts a background drain', manager.includes('SyncQueue.enqueueRpc') && manager.includes('SyncQueue.drainSyncQueue')],
  ['validation errors become visible conflicts', queue.includes("normalized.__conflict = 'validation_conflict'")],
  ['migration adds rich task columns', /add column if not exists notes text[\s\S]*add column if not exists subtasks jsonb/.test(migration)],
  ['task RPC persists rich fields', /notes=case when p_patch\?'notes'[\s\S]*subtasks=case when p_patch\?'subtasks'/.test(migration)],
  ['subtasks receive server-side shape validation', migration.includes('each subtask requires an id, title, and optional boolean is_completed')],
  ['mentions persist resolved member IDs', migration.includes('create table if not exists public.task_comment_mentions')],
  ['mentions require active space members', migration.includes('mentions must reference active space member usernames')],
  ['mentions create targeted inbox entries', migration.includes("'comment.mentioned'")],
  ['viewers cannot call comment mutations', migration.includes("editor role required to comment") && migration.includes("editor role required to edit comments")],
  ['shared list reads have a restrictive membership guard', migration.includes('collab_lists_shared_read_guard')],
  ['comment UI validates and highlights member handles', comments.includes('unknownMentions') && comments.includes('styles.mention')],
  ['invite sharing uses centralized HTTPS fragment links', shareSheet.includes('buildInviteShareUrl') && !shareSheet.includes('`lifepilot://invite/${inviteToken}`') && env.includes('#token=${encodeURIComponent(token)}') && env.includes("base.startsWith('https://')")],
  ['invite landing consumes only the URL fragment', inviteLanding.includes('window.location.hash') && !inviteLanding.includes('location.search') && inviteLanding.includes("'lifepilot://invite/'")],
  ['invite landing disables caching and referrers', inviteLanding.includes('"Cache-Control": "no-store, max-age=0"') && inviteLanding.includes('"Referrer-Policy": "no-referrer"')],
  ['all app variants retain the LifePilot deep-link scheme', appConfig.includes("const withLifePilotSchemes") && (appConfig.match(/scheme: withLifePilotSchemes/g) || []).length === 3],
  ['owners can load and revoke pending invitations', shareSheet.includes('loadSpaceInvites') && shareSheet.includes('revokeSpaceInvite')],
  ['invitation cache strips secrets before persistence', manager.includes('updateSpaceInviteCache') && manager.includes('Storage.set(key, stripSensitive(latest))')],
  ['invite listing projection excludes secret material', /get_space_invites[\s\S]*jsonb_build_object\([\s\S]*'created_at',i\.created_at[\s\S]*where i\.space_id=p_space_id/.test(migration) && !/get_space_invites[\s\S]*jsonb_build_object\([\s\S]*'token_hash'/.test(migration)],
];

const failed = checks.filter(([, passed]) => !passed);
checks.forEach(([name, passed]) => console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`));
if (failed.length) {
  console.error(`Collaboration contract failed: ${failed.map(([name]) => name).join(', ')}`);
  process.exit(1);
}
console.log(`Collaboration contract passed (${checks.length} checks).`);
