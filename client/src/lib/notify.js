import { notifications } from '@mantine/notifications';

/**
 * The only way this app raises a toast.
 *
 * Mantine's `notifications.show` takes colour, title, icon and timing per call,
 * which is how twenty screens end up with twenty slightly different error toasts.
 * Wrapping it once means an error looks the same everywhere and the decision of
 * what red means lives in one file.
 *
 * Colours are Mantine palette names resolved against the theme — never hex.
 */

/** Errors stay until dismissed; the user may need to read a field-level reason. */
const ERROR_AUTO_CLOSE = false;
const DEFAULT_AUTO_CLOSE = 4000;

export const notify = {
  success(message, title = null) {
    notifications.show({ color: 'teal', title, message, autoClose: DEFAULT_AUTO_CLOSE });
  },

  info(message, title = null) {
    notifications.show({ color: 'blue', title, message, autoClose: DEFAULT_AUTO_CLOSE });
  },

  error(message, title = 'Something went wrong') {
    notifications.show({ color: 'red', title, message, autoClose: ERROR_AUTO_CLOSE });
  },

  /**
   * The toast for a rejected API call. Takes the `ApiError` itself so call sites
   * are `catch (err) { notify.apiError(err); }` rather than digging into fields.
   *
   * `message` is always safe to show: the server's error handler replaces the
   * message of anything unexpected before it leaves the process (MVP.md §15.3),
   * and `client.js` supplies a readable one when there was no response at all.
   *
   * Field-level `details` are not rendered here — those belong under the field
   * that caused them, which is the form's job, not a toast's.
   */
  apiError(error, title = 'Something went wrong') {
    notify.error(error?.message ?? 'Something went wrong. Please try again.', title);
  },
};
