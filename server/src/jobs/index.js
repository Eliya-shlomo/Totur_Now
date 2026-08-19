import cron from 'node-cron';

import { CRON_TICK_SECONDS } from '#config/constants/index.js';
import { logger } from '#utils/logger.js';

import { runOfferExpiry } from './offer.expiry.job.js';
import { runAutoAway } from './presence.autoAway.job.js';
import { runAutoEnd } from './session.autoEnd.job.js';
import { runBlockWarning } from './session.blockWarning.job.js';

/**
 * The scheduler. **One `node-cron` registration in the whole server**, started from
 * `index.js` once the HTTP server is listening and stopped in the `SIGTERM` handler.
 * PR 5.5, MVP.md §13.
 *
 * **All four of §13's jobs, since 6.5.** E5 shipped two and left the other two out on the
 * grounds that Block Warning and Session Auto-End both read `ends_at` as a live billing
 * deadline, and nothing in E5 charged a block or moved that value after the accept. 6.5
 * is the PR that made the clock tick: the opening block is charged inside the activation
 * transaction and `POST /sessions/:id/extend` moves the deadline.
 *
 * The order in the tick is the order of the money. Expiry settles offers that were never
 * answered, the warning asks whether a running block should become two, the auto-end
 * closes the ones nobody answered, and the presence sweep is about teachers rather than
 * sessions and goes last.
 *
 * ## Stopped before Prisma disconnects, and that ordering is the point
 *
 * A job still running when the pool closes throws `Cannot use PrismaClient after
 * $disconnect` — on every single deploy, in the shutdown log, where it is
 * indistinguishable from a real failure. `stopJobs` is therefore the first thing
 * `shutdown` does, ahead of the sockets and the listener.
 *
 * Stopping a task prevents the *next* invocation; it does not abort one that is
 * mid-flight. `stopJobs` awaits the in-flight tick as well, which is what makes the
 * ordering claim true rather than approximately true.
 *
 * ## One registration, every job, and no overlap
 *
 * A single schedule rather than one per job, because four registrations would be four
 * places to stop and the one forgotten is the error above. The jobs are awaited in
 * sequence inside it; `Promise.all` would be the wrong tool, because they contend for the
 * same connection pool and none is urgent to the millisecond.
 *
 * **Overlap prevention is `noOverlap`, the library's own.** Ten seconds is plenty for
 * four sweeps against 22 teachers, but an instance waking from Render's sleep has a
 * backlog and a slow first tick. Without the guard the ticks stack, each holding
 * transactions the previous one is still using. With it, a tick arriving while the
 * last is still going is skipped — which costs nothing, because the work is a sweep of
 * whatever is due and the next tick sweeps it instead.
 *
 * ## This scheduler is not the source of truth and cannot be
 *
 * Render's free plan spins the instance down after ~15 minutes without a request and
 * `node-cron` runs in-process, so **on a sleeping server none of this runs**. 5.4
 * evaluates expiry lazily on every read for exactly that reason. The split is
 * deliberate: correctness on the read, timeliness on the tick.
 */

/**
 * The six-field cron form, whose leading field is seconds — every
 * `CRON_TICK_SECONDS` seconds, on the second.
 *
 * Built from the constant rather than typed, which is the rule this codebase keeps
 * everywhere and matters more than usual here: the interval is §13's number, and an
 * expression that disagreed with the constant would be a schedule nothing in the
 * repository documents.
 */
const TICK_EXPRESSION = `*/${CRON_TICK_SECONDS} * * * * *`;

/** The registration, or `null` when the scheduler is not running. */
let task = null;

/** The tick in flight, or `null`. Awaited by `stopJobs`. */
let inFlight = null;

/**
 * Starts the tick. Called from `index.js` after `app.listen`.
 *
 * After listening rather than before, because a job is not what the platform is
 * waiting for: Render's health check hits the listener, and a boot that ran a sweep
 * first would delay it for no reason anybody can see.
 *
 * Idempotent — a second call while a task exists is a no-op rather than a second
 * schedule, which would double every sweep and halve nothing.
 *
 * @returns {void}
 */
export function startJobs() {
  if (task) return;

  task = cron.schedule(TICK_EXPRESSION, tick, { name: 'session-sweeps', noOverlap: true });

  logger.info('Background jobs started', { tick: TICK_EXPRESSION });
}

/**
 * Stops the tick and waits for the tick in flight. **Called first in `shutdown`,
 * before the sockets, the listener and `prisma.$disconnect()`.**
 *
 * Awaiting `inFlight` is the half that matters. Destroying the task alone would return
 * while a sweep was still mid-transaction, and the disconnect that follows would abort
 * it — an error on every deploy, and an offer left half-settled on the unlucky one.
 *
 * `tick` never rejects, so this cannot throw into the shutdown path it is the first
 * step of.
 *
 * Idempotent, like the shutdown handler that calls it.
 *
 * @returns {Promise<void>}
 */
export async function stopJobs() {
  if (!task) return;

  // `destroy` rather than `stop`: it also releases the daemon's timer, so nothing this
  // module owns is a reason the process stays alive after the listener has closed.
  await task.destroy();
  task = null;

  await inFlight;

  logger.info('Background jobs stopped');
}

/**
 * One tick: both jobs, in sequence, never throwing.
 *
 * Nothing is logged here. Each of the four logs its own count when it did something and
 * stays silent when it did not — see either file for the arithmetic on why an empty tick has
 * to be silent at this interval.
 *
 * The promise is published to `inFlight` for `stopJobs` to await. **`runTick` swallows
 * rather than `tick` catching it**, so the published promise is one that cannot
 * reject: a shutdown awaiting a rejected promise would throw out of the first step of
 * the shutdown path, which is the one place in the process with nothing above it to
 * catch.
 */
async function tick() {
  inFlight = runTick();

  await inFlight;

  inFlight = null;
}

/** Every job, in order, and never a rejection. */
async function runTick() {
  try {
    // None of these needs a `catch` of its own: all four handle their failures by
    // contract and resolve to a count. This one is for what none of them anticipated — a
    // programming error in the job itself — so that a bad tick is one quiet sweep rather
    // than a scheduler in an unknown state.
    await runOfferExpiry();
    await runBlockWarning();
    await runAutoEnd();
    await runAutoAway();
  } catch (error) {
    logger.error('Background tick failed', { message: error?.message, stack: error?.stack });
  }
}
