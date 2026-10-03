// Viewer-owned accounts, profiles, library and viewing-progress endpoints.
import crypto from 'node:crypto';
import { HttpError, bad, wrap } from '../http.js';

export function registerAccountRoutes(api, { db, publicUser, features, exists, maxProfiles = 5, palette = 8 }) {
  const MAX_PROFILES = maxProfiles, PALETTE = palette;
  // Loads a profile only if it belongs to the signed-in user (prevents reading someone else's data).
  const ownProfile = async (req) => {
    const p = await db.profiles.get(req.params.pid, req.user.id);
    if (!p) throw new HttpError(404, 'not_found', 'Profile not found.');
    return p;
  };

  // ---- Account ----
  api.get('/me', wrap(async (req, res) => res.json({ user: publicUser(req.user), hasPassword: !!req.user.passwordHash, hasPin: !!req.user.hasPin, providers: await db.identities.providersOf(req.user.id), profiles: await db.profiles.list(req.user.id), subscription: await db.subscriptions.get(req.user.id) })));
  api.patch('/me', wrap(async (req, res) => {
    const n = req.body?.name; if (typeof n !== 'string' || !n.trim() || n.length > 60) throw bad('Please enter your name.');
    await db.users.rename(req.user.id, n.trim()); res.json({ user: publicUser({ ...req.user, name: n.trim() }) });
  }));
  // Self-service account deletion.
  api.delete('/me', wrap(async (req, res) => {           // required by Apple App Store guideline 5.1.1(v) & Google Play policy
    await db.users.remove(req.user.id);                   // FK cascades remove profiles, library and subscription
    res.sendStatus(204);
  }));

  /* profiles */
  // Validates profile input; with `partial` only supplied fields are checked (used by PATCH).
  const cleanProfile = (b, partial = false) => {
    const out = {};
    if (!partial || b.name !== undefined) { if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 24) throw bad('Profile name must be 1–24 characters.'); out.name = b.name.trim(); }
    if (b.kids !== undefined) { if (typeof b.kids !== 'boolean') throw bad('kids must be true or false.'); out.kids = b.kids; }
    if (b.color !== undefined) { if (!Number.isInteger(b.color) || b.color < 0 || b.color >= PALETTE) throw bad('Invalid colour.'); out.color = b.color; }
    return out;
  };
  api.get('/profiles', wrap(async (req, res) => res.json({ profiles: await db.profiles.list(req.user.id) })));
  // Adding, editing or deleting a profile asks for the parental PIN if one is set.
  api.post('/profiles', wrap(async (req, res) => {
    await features.requirePin(req);
    const { name, kids } = cleanProfile(req.body || {});
    const profile = await db.profiles.create(req.user.id, { id: crypto.randomUUID(), name, kids }, MAX_PROFILES, PALETTE);
    if (!profile) throw new HttpError(409, 'profile_limit', `You can have up to ${MAX_PROFILES} profiles.`);
    res.status(201).json({ profile });
  }));
  api.patch('/profiles/:pid', wrap(async (req, res) => {
    await features.requirePin(req);
    const p = await ownProfile(req); res.json({ profile: await db.profiles.update(p.id, cleanProfile(req.body || {}, true)) });
  }));
  api.delete('/profiles/:pid', wrap(async (req, res) => {
    await features.requirePin(req);
    const p = await ownProfile(req);
    if (!(await db.profiles.remove(p.id, req.user.id))) throw new HttpError(409, 'last_profile', 'At least one profile is required.');
    res.sendStatus(204);
  }));

  /* library: My List, progress, reminders */
  api.get('/profiles/:pid/library', wrap(async (req, res) => { const p = await ownProfile(req); res.json(await db.library.get(p.id)); }));
  // My List. Adding validates the title exists; PUT/DELETE are idempotent.
  api.put('/profiles/:pid/list/:type/:id', wrap(async (req, res) => {
    const p = await ownProfile(req); const { type, id } = req.params;
    if (!(await exists(type, id))) throw new HttpError(404, 'not_found', 'Unknown title.');
    await db.library.addListItem(p.id, type, id); res.sendStatus(204);
  }));
  api.delete('/profiles/:pid/list/:type/:id', wrap(async (req, res) => {
    const p = await ownProfile(req); await db.library.removeListItem(p.id, req.params.type, req.params.id); res.sendStatus(204);
  }));
  // Continue-watching position, saved every few seconds by the player.
  api.put('/profiles/:pid/progress/:videoId', wrap(async (req, res) => {
    const p = await ownProfile(req); const { position, duration } = req.body || {};
    if (!(await exists('video', req.params.videoId))) throw new HttpError(404, 'not_found', 'Unknown video.');
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration ?? 0) || (duration ?? 0) < 0) throw bad('position and duration must be non-negative numbers.');
    await db.library.saveProgress(p.id, req.params.videoId, Math.min(Math.floor(position), 4_294_967_295), Math.min(Math.floor(duration || 0), 4_294_967_295));
    res.sendStatus(204);
  }));
  api.delete('/profiles/:pid/progress/:videoId', wrap(async (req, res) => { const p = await ownProfile(req); await db.library.removeProgress(p.id, req.params.videoId); res.sendStatus(204); }));
  // "Remind me" for upcoming releases.
  api.put('/profiles/:pid/reminders/:id', wrap(async (req, res) => {
    const p = await ownProfile(req); if (!(await exists('upcoming', req.params.id))) throw new HttpError(404, 'not_found', 'Unknown title.');
    await db.library.addReminder(p.id, req.params.id); res.sendStatus(204);
  }));
  api.delete('/profiles/:pid/reminders/:id', wrap(async (req, res) => { const p = await ownProfile(req); await db.library.removeReminder(p.id, req.params.id); res.sendStatus(204); }));

}
