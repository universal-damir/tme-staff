/**
 * Server-side AI check verdicts for onboarding documents (STAFF-001).
 *
 * Before this module the browser decided whether a document had passed the
 * AI check: it sent `validated: true` / `needsReview: true` in the documents
 * map, and the submit gates trusted those flags. The AI routes also checked
 * whatever base64 the browser sent, not the stored file. So a person could
 * show the AI a real passport, upload a forged one, and mark it validated.
 *
 * Now:
 *  - An AI route that is given the stored `path` downloads that file itself,
 *    checks those bytes, and records the verdict in
 *    `documents.server_checks[path]` (see `applyCheckRecord`). The browser
 *    never writes `server_checks`.
 *  - The documents route (`finalizeDocumentsPatch`) derives `validated` /
 *    `needsReview` of the checked slots from that record. A new path with no
 *    passing record is stored with `validated: false`.
 *  - Every NEW path must lie in the row's own storage folder.
 *  - The submit gates call `isServerAccepted`.
 *
 * `needsReview: true` (the 2-strike "send it to our team to check by hand"
 * option) stays available to the person: it never claims an AI pass, it
 * sends the document to a human on the portal side. The server honours it
 * only once the AI ran at least once on a stored file of that kind (any
 * record: failed, passed and replaced, or not able to run;
 * `handCheckAllowed`). Some strikes the form counts never reach the server
 * (the browser's own pre-checks, a file too large to shrink, a dropped
 * connection), so when there is no record yet the documents route first runs
 * the server check on the stored file itself (`pendingHandChecks`) and then
 * honours the request whatever the verdict: a human looks at it anyway.
 * Once set for a path it cannot be removed from the browser.
 *
 * Pure functions only (no Supabase) so the gates and tests can import it.
 */

import type { StaffDocumentReferences } from '@/types';

export type ServerCheckKind =
  | 'photo'
  | 'passport:COVER'
  | 'passport:INSIDE_PAGES'
  | 'passport:ADDITIONAL_PAGE'
  | 'eid:front'
  | 'eid:back';

export interface ServerCheckRecord {
  kind: ServerCheckKind;
  /** Absent while only the photo comparison has answered. */
  verdict?: 'pass' | 'fail';
  /**
   * true = the AI looked at the STORED file. false = the stored file could
   * not be sent to the AI (too large / unsupported format), so the browser's
   * smaller copy was checked; a pass then still goes to a human
   * (needsReview), because that copy is not bound to the stored bytes.
   */
  bound: boolean;
  sha256: string;
  /** Photo only: the comparison judged it the same photo as the one on file. */
  samePhoto?: boolean;
  /**
   * The AI check of this stored file could not run (service down / error).
   * Counts toward the hand-check option like a failed check.
   */
  infra?: boolean;
  at: string;
}

export type ServerChecks = Record<string, ServerCheckRecord>;

/** Key inside the `documents` jsonb. Written only by the server. */
export const SERVER_CHECKS_KEY = 'server_checks';

/** Records for paths no longer on any slot that are kept (newest first). */
const MAX_UNREFERENCED_CHECKS = 20;

const DOCUMENT_REQUEST_TYPES: ReadonlySet<string> = new Set([
  'document_request',
  'dependent_document_request',
]);

type SlotLoc = readonly [string] | readonly [string, string];

interface CheckedSlot {
  loc: SlotLoc;
  kind: ServerCheckKind;
  /** Only on document-request rows (the staff form stores EIDs unchecked on purpose). */
  documentRequestOnly?: boolean;
}

/**
 * The slots whose `validated` / `needsReview` the server owns. These are the
 * slots the submit gates and the portal sync read the flags of. The Emirates
 * ID is gated only on a document request; in the staff form a PDF EID or a
 * failed check is stored without a verdict on purpose, so there the flag
 * stays as the browser sets it (nothing trusts it).
 */
const CHECKED_SLOTS: readonly CheckedSlot[] = [
  { loc: ['photo'], kind: 'photo' },
  { loc: ['passportPages', 'cover'], kind: 'passport:COVER' },
  { loc: ['passportPages', 'insidePages'], kind: 'passport:INSIDE_PAGES' },
  { loc: ['passportPages', 'additionalPage'], kind: 'passport:ADDITIONAL_PAGE' },
  { loc: ['eid_front'], kind: 'eid:front', documentRequestOnly: true },
  { loc: ['eid_back'], kind: 'eid:back', documentRequestOnly: true },
];

function checkedSlotsFor(onboardingType: string | null | undefined): CheckedSlot[] {
  const docRequest = DOCUMENT_REQUEST_TYPES.has(onboardingType ?? '');
  return CHECKED_SLOTS.filter((s) => !s.documentRequestOnly || docRequest);
}

/** Storage folder (under the row) each check kind reads from. */
const KIND_FOLDER: Record<ServerCheckKind, string> = {
  photo: 'photo/',
  'passport:COVER': 'passport/cover/',
  'passport:INSIDE_PAGES': 'passport/insidePages/',
  'passport:ADDITIONAL_PAGE': 'passport/additionalPage/',
  'eid:front': 'eid_front/',
  'eid:back': 'eid_back/',
};

const PASSPORT_KINDS: Record<string, ServerCheckKind> = {
  COVER: 'passport:COVER',
  INSIDE_PAGES: 'passport:INSIDE_PAGES',
  ADDITIONAL_PAGE: 'passport:ADDITIONAL_PAGE',
};

export function passportCheckKind(expectedType: unknown): ServerCheckKind | null {
  return typeof expectedType === 'string' ? PASSPORT_KINDS[expectedType] ?? null : null;
}

export function eidCheckKind(side: unknown): ServerCheckKind {
  return side === 'back' ? 'eid:back' : 'eid:front';
}

const MAX_PATH_LENGTH = 512;

/** A storage path inside this row's own folder (no climbing out). */
export function isPathInRow(rowId: string, path: unknown): path is string {
  if (typeof path !== 'string' || !rowId) return false;
  if (path.length > MAX_PATH_LENGTH) return false;
  if (!path.startsWith(`${rowId}/`)) return false;
  if (path.includes('..') || path.includes('\\') || path.includes('//')) return false;
  return true;
}

/** A path the AI route of `kind` may read: the row's folder for that document. */
export function isPathForKind(rowId: string, kind: ServerCheckKind, path: unknown): path is string {
  return isPathInRow(rowId, path) && path.startsWith(`${rowId}/${KIND_FOLDER[kind]}`);
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function getAt(docs: unknown, loc: SlotLoc): unknown {
  if (!isObj(docs)) return undefined;
  const first = docs[loc[0]];
  if (loc.length === 1) return first;
  return isObj(first) ? first[loc[1]] : undefined;
}

function setAt(docs: Obj, loc: SlotLoc, value: unknown): void {
  if (loc.length === 1) {
    docs[loc[0]] = value;
    return;
  }
  const parent = isObj(docs[loc[0]]) ? { ...(docs[loc[0]] as Obj) } : {};
  parent[loc[1]] = value;
  docs[loc[0]] = parent;
}

function readChecks(docs: unknown): ServerChecks {
  const raw = isObj(docs) ? docs[SERVER_CHECKS_KEY] : undefined;
  if (!isObj(raw)) return {};
  const out: ServerChecks = {};
  for (const [path, rec] of Object.entries(raw)) {
    if (isObj(rec) && typeof rec.kind === 'string') out[path] = rec as unknown as ServerCheckRecord;
  }
  return out;
}

/** A record that, on its own, makes the document accepted for `kind`. */
export function recordAccepts(rec: ServerCheckRecord | undefined, kind: ServerCheckKind): boolean {
  return (
    !!rec &&
    rec.kind === kind &&
    rec.verdict === 'pass' &&
    rec.bound === true &&
    rec.samePhoto !== true
  );
}

/**
 * May the person send a document of `kind` for a hand check? Only once the
 * AI ran at least once on a stored file of that kind: any record counts (a
 * failed check, a passed file that was replaced, a check that could not
 * run). Records of earlier files stay in `server_checks` (see
 * MAX_UNREFERENCED_CHECKS), so the checks of replaced files count. With no
 * record yet the documents route runs the check first (`pendingHandChecks`).
 */
export function handCheckAllowed(checks: ServerChecks, kind: ServerCheckKind): boolean {
  return Object.values(checks).some((rec) => rec.kind === kind);
}

export interface PendingHandCheck {
  kind: ServerCheckKind;
  path: string;
}

/**
 * Hand-check requests in `incoming` the server cannot honour yet because the
 * AI never ran on a stored file of that kind. The documents route runs the
 * server check on each of these stored files first (one per kind), so the
 * request is honoured afterwards. A path outside the row's folder for that
 * kind is never checked (finalize refuses or ignores it).
 */
export function pendingHandChecks(input: {
  rowId: string;
  incoming: unknown;
  stored: unknown;
  onboardingType: string | null | undefined;
}): PendingHandCheck[] {
  const { rowId, incoming, stored, onboardingType } = input;
  if (!isObj(incoming)) return [];
  const checks = readChecks(stored);
  const out: PendingHandCheck[] = [];
  for (const slot of checkedSlotsFor(onboardingType)) {
    const ref = getAt(incoming, slot.loc);
    if (!isObj(ref) || ref.needsReview !== true) continue;
    if (!isPathForKind(rowId, slot.kind, ref.path)) continue;
    if (handCheckAllowed(checks, slot.kind)) continue;
    if (out.some((p) => p.kind === slot.kind)) continue;
    out.push({ kind: slot.kind, path: ref.path });
  }
  return out;
}

/**
 * Server-side flags for one checked slot.
 * `storedRef` is what the row holds at the same slot right now.
 */
function deriveRef(
  ref: Obj,
  storedRef: unknown,
  rec: ServerCheckRecord | undefined,
  kind: ServerCheckKind,
  handCheckOk: boolean
): Obj {
  const samePath = isObj(storedRef) && storedRef.path === ref.path;
  const recForKind = rec && rec.kind === kind ? rec : undefined;
  const unboundPass =
    !!recForKind && recForKind.verdict === 'pass' && recForKind.bound === false && recForKind.samePhoto !== true;

  // needsReview: the person asked for a hand check once the AI ran on a
  // stored file of this kind (it only adds a human), it was already set for
  // this same file, or the AI passed a copy that is not bound to the stored
  // file. A request while the AI never ran is ignored.
  const needsReview =
    (ref.needsReview === true && handCheckOk) ||
    (samePath && (storedRef as Obj).needsReview === true) ||
    unboundPass;

  // validated: a bound pass for THIS path, or a hand check. A file that is
  // unchanged and has no record at all keeps its stored flag: that can only
  // be data from before server checks existed, because this function never
  // stores validated=true for a path without a record or a hand check.
  const validated =
    needsReview ||
    recordAccepts(recForKind, kind) ||
    (samePath && !rec && (storedRef as Obj).validated === true);

  const out: Obj = { ...ref };
  delete out.serverCheck;
  out.validated = validated;
  if (needsReview) out.needsReview = true;
  else delete out.needsReview;
  if (kind === 'photo' && recForKind?.samePhoto === true) out.samePhotoSuspected = true;
  return out;
}

/** Every `path` on a ref in the map (top level and one level down). */
function collectPaths(docs: Obj): Array<{ loc: SlotLoc; path: unknown }> {
  const out: Array<{ loc: SlotLoc; path: unknown }> = [];
  for (const [k, v] of Object.entries(docs)) {
    if (k === SERVER_CHECKS_KEY || !isObj(v)) continue;
    if ('path' in v) {
      out.push({ loc: [k], path: v.path });
      continue;
    }
    for (const [k2, v2] of Object.entries(v)) {
      if (isObj(v2) && 'path' in v2) out.push({ loc: [k, k2], path: v2.path });
    }
  }
  return out;
}

type Trail = ReadonlyArray<string | number>;

/** A key that names a storage path: `path` or anything ending in `_path`. */
function isPathKey(key: string): boolean {
  return key === 'path' || key.endsWith('_path');
}

/** Deeper than any real documents map; stops a crafted body from recursing far. */
const MAX_WALK_DEPTH = 12;

/**
 * Every path-named string field in the map, at any depth and inside arrays
 * (STAFF-001: a path one level deeper than the slots must not dodge the row
 * folder rule). `ok: false` = a path field that is not a string, or a map
 * nested deeper than MAX_WALK_DEPTH.
 */
function walkPaths(docs: Obj): { ok: true; paths: Array<{ trail: Trail; path: string }> } | { ok: false } {
  const paths: Array<{ trail: Trail; path: string }> = [];
  let bad = false;
  const visit = (node: unknown, trail: Array<string | number>, depth: number): void => {
    if (bad) return;
    if (depth > MAX_WALK_DEPTH) {
      bad = true;
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => visit(v, [...trail, i], depth + 1));
      return;
    }
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (depth === 0 && k === SERVER_CHECKS_KEY) continue;
      if (isPathKey(k)) {
        if (typeof v === 'string') paths.push({ trail: [...trail, k], path: v });
        // `path` itself must be a string; an empty `*_path` may be null.
        else if (k === 'path' || v !== null) bad = true;
        continue;
      }
      visit(v, [...trail, k], depth + 1);
    }
  };
  visit(docs, [], 0);
  return bad ? { ok: false } : { ok: true, paths };
}

function getAtTrail(node: unknown, trail: Trail): unknown {
  let cur: unknown = node;
  for (const step of trail) {
    if (typeof step === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[step];
    } else {
      if (!isObj(cur)) return undefined;
      cur = cur[step];
    }
  }
  return cur;
}

function pruneChecks(checks: ServerChecks, docs: Obj): ServerChecks {
  const walked = walkPaths(docs);
  const referenced = new Set(
    walked.ok
      ? walked.paths.map((p) => p.path)
      : collectPaths(docs)
          .map((p) => p.path)
          .filter((p): p is string => typeof p === 'string')
  );
  const kept: ServerChecks = {};
  const others: Array<[string, ServerCheckRecord]> = [];
  for (const [path, rec] of Object.entries(checks)) {
    if (referenced.has(path)) kept[path] = rec;
    else others.push([path, rec]);
  }
  others
    .sort((a, b) => String(b[1].at ?? '').localeCompare(String(a[1].at ?? '')))
    .slice(0, MAX_UNREFERENCED_CHECKS)
    .forEach(([path, rec]) => {
      kept[path] = rec;
    });
  return kept;
}

function stripRefMarkers(docs: Obj): void {
  for (const { loc } of collectPaths(docs)) {
    const ref = getAt(docs, loc);
    if (isObj(ref) && 'serverCheck' in ref) {
      const copy = { ...ref };
      delete copy.serverCheck;
      setAt(docs, loc, copy);
    }
  }
}

export type FinalizeResult =
  | { ok: true; documents: Obj }
  | { ok: false; error: string };

/**
 * Turn the documents map the browser sent into what is stored:
 *  - `server_checks` comes from the stored row, never from the browser;
 *  - every NEW path must be in this row's folder (an unchanged path at the
 *    same slot is kept, so rows from before this rule keep saving);
 *  - checked slots get their `validated` / `needsReview` from the server.
 */
export function finalizeDocumentsPatch(input: {
  rowId: string;
  incoming: unknown;
  stored: unknown;
  onboardingType: string | null | undefined;
}): FinalizeResult {
  const { rowId, incoming, stored, onboardingType } = input;
  if (!isObj(incoming)) return { ok: false, error: 'documents must be an object' };

  const next: Obj = { ...incoming };
  delete next[SERVER_CHECKS_KEY];

  // Every path-named field at any depth: in this row's folder, or the same
  // value the row already holds at the same place (legacy rows).
  const walked = walkPaths(next);
  if (!walked.ok) return { ok: false, error: 'Invalid document path' };
  for (const { trail, path } of walked.paths) {
    if (isPathInRow(rowId, path)) continue;
    if (getAtTrail(stored, trail) === path) continue;
    return { ok: false, error: 'Invalid document path' };
  }

  stripRefMarkers(next);

  const checks = readChecks(stored);
  for (const slot of checkedSlotsFor(onboardingType)) {
    const ref = getAt(next, slot.loc);
    if (!isObj(ref) || typeof ref.path !== 'string') continue;
    setAt(
      next,
      slot.loc,
      deriveRef(ref, getAt(stored, slot.loc), checks[ref.path], slot.kind, handCheckAllowed(checks, slot.kind))
    );
  }

  const pruned = pruneChecks(checks, next);
  if (Object.keys(pruned).length > 0) next[SERVER_CHECKS_KEY] = pruned;
  return { ok: true, documents: next };
}

/**
 * One write into a record. The photo comparison leaves out `verdict` and
 * `bound` (those belong to the photo check, which may have read a different
 * copy of the file); a record is never bound until the check itself says so.
 */
export type CheckUpdate = Omit<ServerCheckRecord, 'at' | 'bound'> & { bound?: boolean };

/**
 * Store one AI verdict (or the photo comparison) for `path` and re-derive the
 * flags of any checked slot that already points at it (the browser may have
 * saved the path before the check answered).
 */
export function applyCheckRecord(
  documents: unknown,
  path: string,
  update: CheckUpdate,
  onboardingType: string | null | undefined,
  now: string = new Date().toISOString()
): Obj {
  const base: Obj = isObj(documents) ? { ...documents } : {};
  const checks = readChecks(base);
  const prev = checks[path];
  const defined = Object.fromEntries(
    Object.entries(update).filter(([, v]) => v !== undefined)
  ) as CheckUpdate;
  const merged: ServerCheckRecord =
    prev && prev.kind === update.kind
      ? { ...prev, ...defined, at: now }
      : { bound: false, ...defined, at: now };
  checks[path] = merged;

  for (const slot of checkedSlotsFor(onboardingType)) {
    const ref = getAt(base, slot.loc);
    if (!isObj(ref) || ref.path !== path) continue;
    setAt(base, slot.loc, deriveRef(ref, ref, merged, slot.kind, handCheckAllowed(checks, slot.kind)));
  }

  base[SERVER_CHECKS_KEY] = pruneChecks(checks, base);
  return base;
}

/**
 * Submit gates: is this stored document accepted for `kind`?
 *  - sent for a hand check (`needsReview`: only `finalizeDocumentsPatch`
 *    stores it, once the AI ran on a stored file of that kind), or
 *  - a passing server check of THIS path, or
 *  - legacy: no record for the path and `validated` stored before server
 *    checks existed (see `deriveRef`: the server never stores
 *    validated=true for a path without a record or a hand check).
 */
export function isServerAccepted(
  docs: StaffDocumentReferences | null | undefined,
  ref: { path?: string; validated?: boolean; needsReview?: boolean } | null | undefined,
  kind: ServerCheckKind
): boolean {
  if (!ref?.path) return false;
  if (ref.needsReview === true) return true;
  const rec = readChecks(docs)[ref.path];
  if (rec) return recordAccepts(rec, kind);
  return ref.validated === true;
}
