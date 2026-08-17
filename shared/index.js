/**
 * Contracts shared by client and server.
 *
 * Imported by name in both workspaces: `import { ... } from '@tutor/shared'`.
 * No path alias involved — npm workspaces symlinks this package into node_modules.
 *
 * This file is a barrel: one re-export line per module, append-only, alphabetical.
 */

export { ERROR_CODES, ERROR_STATUS } from './errorCodes.js';
export { SOCKET_EVENTS } from './socketEvents.js';
