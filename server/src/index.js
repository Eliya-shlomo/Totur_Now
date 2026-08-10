import { SHARED_PACKAGE_READY } from '@tutor/shared';
import { SCAFFOLD_OK } from '#config/scaffold.js';

/**
 * Temporary boot stub. PR 0.4 replaces this with the Express app and a real
 * HTTP server, at which point the keep-alive below goes away.
 *
 * It exists to prove two things, which is exactly PR 0.1's job:
 *   1. the `#` subpath-import alias resolves   (see server/package.json "imports")
 *   2. the `@tutor/shared` workspace resolves
 */
console.log('┌─ TutorNow server — scaffold (PR 0.1)');
console.log(`│  node                  ${process.version}`);
console.log(`│  #config/* alias       ${SCAFFOLD_OK ? 'resolved' : 'FAILED'}`);
console.log(`│  @tutor/shared         ${SHARED_PACKAGE_READY ? 'resolved' : 'FAILED'}`);
console.log('└─ no Express yet — that is PR 0.4');

// Keep the process alive so `npm run dev` does not exit and take concurrently with it.
// Removed in PR 0.4 when a real server starts listening.
setInterval(() => {}, 1 << 30);
