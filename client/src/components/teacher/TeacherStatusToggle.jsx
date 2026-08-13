import { Button, Group, Menu, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconPlayerPause, IconWorld } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { getTeacherMe, updateTeacherMe } from '@/api/teacher.api';
import { notify } from '@/lib/notify';
import { useAuthStore } from '@/stores/authStore';

/**
 * Online / offline, in the app header. MVP.md §6.3 — a teacher decides when they are
 * reachable.
 *
 * **Why this is in the header and not on a screen.** Going offline is the one action
 * a teacher needs from wherever they happen to be: the reason to stop taking requests
 * — the bus arriving, the shift ending, a student in the room — never coincides with
 * being on a particular page. A control you have to navigate to is a control that
 * gets used late, and a teacher who is listed as available while they are not is the
 * worst state this platform can put a student in. PR 2.4 shipped "go online" as the
 * last step of onboarding and left no way back off; this is that missing half.
 *
 * **Why it is rendered from `UserMenu` rather than from `AppLayout`.** The header is
 * built in `layouts/AppLayout.jsx`, which is DEV-A's file and is shared by all three
 * role layouts (docs/OWNERSHIP.md §2). `UserMenu` is the header's account cluster and
 * is DEV-B's, so hanging a teacher-only control off it puts this in the header at
 * every width without editing a file another developer owns or changing what a
 * student and an admin see.
 *
 * **A menu rather than a switch.** Two labelled choices, each saying what it does to
 * the student side — a switch in a header is one stray thumb away from going offline
 * without noticing, and "Online" as a bare label does not tell a new teacher that it
 * means students can reach them right now.
 */
export default function TeacherStatusToggle() {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  const [record, setRecord] = useState(null);
  const [pending, setPending] = useState(false);

  const isTeacher = user?.role === 'teacher';

  /**
   * Read the authoritative record rather than `user.teacherProfile.status`.
   *
   * `/auth/me` does carry the status, but it is a snapshot taken when the session
   * started: the onboarding stepper's own "go online", or this control in a second
   * tab, both move the row underneath it. `GET /teachers/me` is the endpoint that
   * owns this value, and it also answers `onboardingComplete`, which decides whether
   * going online is offered at all.
   *
   * Re-read on navigation, which is what keeps this in step with the stepper: a
   * teacher who finishes onboarding lands on `/teach` and the header is already
   * correct. It is one small request per navigation for teachers only, and no state
   * shared between two components that could disagree.
   */
  useEffect(() => {
    if (!isTeacher) return undefined;

    let cancelled = false;

    getTeacherMe()
      .then((teacher) => {
        if (!cancelled) setRecord(teacher);
      })
      .catch(() => {
        // Deliberately silent. This is chrome, not content: a header that grows an
        // error banner because a background read failed is worse than a header that
        // is briefly missing one control, and every screen underneath has its own
        // error state for the same outage.
      });

    return () => {
      cancelled = true;
    };
  }, [isTeacher, location.pathname]);

  const setStatus = useCallback(async (status) => {
    setPending(true);

    try {
      const updated = await updateTeacherMe({ status });

      setRecord(updated);

      // A toast rather than a silent change, and phrased as what a student can now
      // do. The consequence is the thing the teacher is deciding about; "status
      // updated" would tell them nothing they did not just click.
      notify.success(
        status === 'ONLINE'
          ? 'You are online — students can send you questions.'
          : 'You are offline — you will not receive new requests.',
      );
    } catch (err) {
      // The header has no room for an inline error and the teacher stays on whatever
      // screen they were on, so this is the toast case `lib/notify.js` describes.
      // `record` is untouched, so the control still shows the status the server last
      // confirmed rather than the one that failed to take.
      notify.apiError(err);
    } finally {
      setPending(false);
    }
  }, []);

  // Students and admins never see this, and neither does the frame between a reload
  // and the first read answering — an empty header is better than one that flickers a
  // wrong status into place.
  if (!isTeacher || !record) return null;

  /**
   * A teacher with no topics is not ready to be found, so the control offers the way
   * to finish rather than a way to go online with an empty profile. `onboardingComplete`
   * is the server's answer (`utils/teacherView.js`), never recomputed here.
   */
  if (!record.onboardingComplete) {
    return (
      <Button
        component={Link}
        to="/teach/onboarding"
        size="compact-sm"
        variant="light"
        color="teal"
      >
        Finish setup
      </Button>
    );
  }

  const isOnline = record.status === 'ONLINE';

  /**
   * `OFFER_LOCKED` and `IN_SESSION` belong to the matching engine (E4) and are not
   * settable by hand — the server's schema accepts `OFFLINE` and `ONLINE` only. The
   * state is still shown, because a teacher whose control has gone quiet deserves to
   * know why rather than to find it unresponsive.
   */
  const isEngineHeld = record.status === 'OFFER_LOCKED' || record.status === 'IN_SESSION';

  return (
    <Menu position="bottom-end" shadow="md" width={260} withinPortal={false}>
      <Menu.Target>
        <UnstyledButton aria-label="Availability" px="xs" py={4} disabled={pending}>
          <Group gap={6} wrap="nowrap">
            <StatusDot isOnline={isOnline} />

            <Text size="sm" fw={500} c={isOnline ? 'teal' : 'dimmed'}>
              {statusLabel(record.status)}
            </Text>

            <IconChevronDown size={14} stroke={1.5} />
          </Group>
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>Availability</Menu.Label>

        <Menu.Item
          leftSection={<IconWorld size={16} stroke={1.5} />}
          onClick={() => setStatus('ONLINE')}
          disabled={isOnline || isEngineHeld || pending}
        >
          <Text size="sm">Go online</Text>
          <Text size="xs" c="dimmed">
            Start receiving students
          </Text>
        </Menu.Item>

        <Menu.Item
          leftSection={<IconPlayerPause size={16} stroke={1.5} />}
          onClick={() => setStatus('OFFLINE')}
          disabled={(!isOnline && !isEngineHeld) || isEngineHeld || pending}
        >
          <Text size="sm">Go offline</Text>
          <Text size="xs" c="dimmed">
            Stop receiving requests
          </Text>
        </Menu.Item>

        {isEngineHeld && (
          <>
            <Menu.Divider />
            <Menu.Label>
              {record.status === 'IN_SESSION'
                ? 'You are in a session. This unlocks when it ends.'
                : 'You have an offer waiting. This unlocks when you answer it.'}
            </Menu.Label>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * What the four statuses are called in the header.
 *
 * The engine's two are named for what they mean to the teacher rather than by their
 * enum value: `OFFER_LOCKED` is a question waiting for an answer, and nobody reading
 * a header should have to know the matching engine's vocabulary to parse their own
 * availability.
 */
function statusLabel(status) {
  if (status === 'ONLINE') return 'Online';
  if (status === 'IN_SESSION') return 'In session';
  if (status === 'OFFER_LOCKED') return 'Offer pending';

  return 'Offline';
}

/**
 * The dot beside the word. `aria-hidden` because the word says the same thing — and
 * the word is why this is not a dot on its own: colour is the only signal a dot
 * carries, and red/green is the pair a colour-blind reader is least likely to
 * separate. Same call `TeacherCard` makes for the public list.
 */
function StatusDot({ isOnline }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: isOnline ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-gray-5)',
      }}
    />
  );
}
