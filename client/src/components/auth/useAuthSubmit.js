import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { notify } from '@/lib/notify';
import { postLoginPath } from '@/stores/authStore';

/**
 * What login and register do identically: run one auth action, land the user
 * somewhere sensible, and make a second submit impossible while the first is out.
 *
 * Lives beside the auth components rather than in a `hooks/` folder because
 * `client/src/components/auth/**` is what PR 1.3 owns.
 *
 * **The in-flight guard is a ref, not the `pending` state.** `pending` drives the
 * button's `disabled` and spinner, but a state update is not visible until the next
 * render, and a held Enter key fires `submit` several times before that render
 * happens. The ref is written synchronously, so the second call returns immediately.
 * Disabling the button alone closes the mouse path and leaves the keyboard one open.
 *
 * On success, where the user lands is `postLoginPath`'s decision, not this hook's:
 * `?from=/app/wallet` if they were bounced out of a protected screen by 1.5's
 * `ProtectedRoute`, otherwise the role's home — `/app` for a student, `/teach` for a
 * teacher. `replace`, so the back button does not return to a form the user has
 * already submitted.
 *
 * @param {(payload: object) => Promise<import('@tutor/shared').MeResponse>} action
 *   `authStore`'s `login` or `register`
 * @param {(error: import('@/api/ApiError').ApiError) => void} [onError]
 *   screen-specific failure handling — mapping `details` onto fields, clearing a
 *   password. The toast is raised here either way, after this runs.
 */
export function useAuthSubmit(action, onError) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();

  async function submit(payload) {
    if (inFlight.current) return;

    inFlight.current = true;
    setPending(true);

    try {
      const user = await action(payload);

      navigate(postLoginPath(location.search, user.role), { replace: true });
    } catch (error) {
      onError?.(error);

      // Always a toast, even when the same failure also rendered under a field: a
      // server error that only appears inline is invisible on a phone whose keyboard
      // covers the field that carries it.
      notify.apiError(error);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { pending, submit };
}
