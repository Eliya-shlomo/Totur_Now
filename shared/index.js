/**
 * Contracts shared by client and server.
 *
 * Imported by name in both workspaces: `import { ... } from '@tutor/shared'`.
 * No path alias involved — npm workspaces symlinks this package into node_modules.
 *
 * This file is a barrel: one re-export line per module, append-only, alphabetical.
 * PR 0.3 adds `errorCodes.js`. PR 1.1 adds the E1 section of `api.d.ts`.
 */

export const SHARED_PACKAGE_READY = true;
