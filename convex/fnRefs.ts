/**
 * Typed function references for internal and public API.
 *
 * Convex's generated FilterApi creates circular type dependencies when
 * action/mutation files import `internal` from `_generated/api` — since
 * `_generated/api.d.ts` imports types from those same files. TypeScript
 * can't resolve the cycle, so `internal` collapses to `{}`.
 *
 * This module re-exports `api` and `internal` with an explicit cast to
 * break the cycle. All convex files that need cross-module references
 * should import from here instead of `_generated/api`.
 *
 * The types are correct at runtime — this is purely a TS limitation.
 */
import { api as _api, internal as _internal } from "./_generated/api";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const api = _api as any;
export const internal = _internal as any;
