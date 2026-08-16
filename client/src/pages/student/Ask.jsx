import { Button, Card, Group, Select, Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconSend } from '@tabler/icons-react';
import { ERROR_CODES } from '@tutor/shared';
import { zodResolver } from 'mantine-form-zod-resolver';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { createQuestion, uploadAttachment } from '@/api/question.api';
import ImagePicker from '@/components/question/ImagePicker';
import QuestionTextField from '@/components/question/QuestionTextField';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';

/**
 * `/app/ask` — "I'm stuck". MVP.md §4.1, §14.1. PR 3.6.
 *
 * Three fields: what you are stuck on, a photo, and which level you study. Two of
 * them are optional and the screen says so, because §4.1's student is standing over
 * an exercise with a phone and every extra required answer is a reason to give up.
 *
 * **Images upload on pick; the question posts on submit.** Each photo goes to
 * `POST /questions/attachments` the moment it is chosen and only its id is held here,
 * so the upload happens while the student is still typing and a failed upload is one
 * retryable thumbnail rather than a failed submit.
 *
 * **The wait lives on this screen.** `POST /questions` classifies inside the request
 * (§8.1), so the id in `/app/ask/:id/matching` does not exist until it answers —
 * navigating first would need a route with no id or a client-minted one, and
 * CONVENTIONS.md is explicit that ids come from the database. So the request is
 * awaited here, behind the analyzing state, and the result is handed to 3.7's screen
 * by URL. **This screen owns the request; DEV-B's screen owns the result** — which is
 * why nothing here renders a topic, a level or a confidence.
 *
 * No authentication logic: `ProtectedRoute role="student"` wraps the whole `/app`
 * subtree in `routes.student.jsx`, so a teacher who reaches this URL is sent away
 * before this component renders. Confirmed, not reimplemented.
 */

/**
 * The bounds, mirrored from `server/src/config/constants/question.js`.
 *
 * `@tutor/shared` exports types and `ERROR_CODES` only, and the client cannot reach
 * the server's constants folder, so these are duplicated with the server file named
 * beside them — the arrangement `components/auth/authRules.js` documents and the same
 * greppable pair. **Nothing below adds a rule the server does not enforce**: a rule
 * that exists only here is a rule that is not enforced, since anything can post to
 * the API directly. They are here to fail on the phone rather than after a round trip.
 */
const RAW_TEXT_MIN_LENGTH = 2;
const RAW_TEXT_MAX_LENGTH = 2000;
const MAX_ATTACHMENTS = 3;

/** `MATH_LEVELS` — `server/src/config/constants/user.js`, the Bagrut units. */
const MATH_LEVELS = [3, 4, 5];

const LEVEL_DATA = MATH_LEVELS.map((level) => ({ value: String(level), label: `${level} units` }));

/**
 * The client half of `createQuestionSchema`.
 *
 * `declaredLevel` is a string here because Mantine's `Select` speaks strings and
 * hands back `null` when cleared; the conversion to the contract's number happens in
 * {@link toPayload}, once, at the boundary.
 */
const askSchema = z.object({
  rawText: z
    .string()
    .trim()
    .min(RAW_TEXT_MIN_LENGTH, 'Write something about the question.')
    .max(RAW_TEXT_MAX_LENGTH, `Keep it under ${RAW_TEXT_MAX_LENGTH} characters.`),
  declaredLevel: z.string().nullable(),
});

/** Form values → `CreateQuestionRequest`. Absent keys, never nulls: the schema is `.strict()`. */
function toPayload(values, attachmentIds) {
  return {
    rawText: values.rawText.trim(),
    ...(values.declaredLevel ? { declaredLevel: Number(values.declaredLevel) } : {}),
    ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
  };
}

/**
 * What a rejected upload should say under its thumbnail.
 *
 * The server names the field on a `VALIDATION_ERROR` — `middlewares/upload.js` writes
 * `details.image` for an oversized file and for a type outside the allowlist — and
 * that message is the specific one worth reading. Anything else (Cloudinary down, a
 * timeout, a 500) falls back to the error's own message, which `ApiError` guarantees
 * is safe to show.
 */
function uploadMessage(error) {
  const detail = error?.is?.(ERROR_CODES.VALIDATION_ERROR) ? error.details?.image : null;

  return detail ?? error?.message ?? 'That image could not be uploaded.';
}

/** Distinct per pick, and stable across re-renders — the identity a thumbnail is keyed by. */
let nextKey = 0;

export default function Ask() {
  const navigate = useNavigate();

  /**
   * One entry per picked file: the local preview, the upload's state, and the id the
   * server gave it. The page owns this rather than `ImagePicker` because the ids are
   * what gets submitted, and a picker holding them would be state the form cannot see.
   */
  const [items, setItems] = useState([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  /**
   * The in-flight guard, a ref rather than `submitting`.
   *
   * `submitting` drives the button and the analyzing state, but a state update is not
   * visible until the next render, and a held Enter key fires submit several times
   * before that render happens — the reasoning `components/auth/useAuthSubmit.js`
   * writes down for the auth forms. Disabling the button alone closes the mouse path
   * and leaves the keyboard one open, and this is the one request in the app that
   * spends money per call.
   */
  const inFlight = useRef(false);

  const form = useForm({
    initialValues: { rawText: '', declaredLevel: '' },
    validate: zodResolver(askSchema),
    validateInputOnBlur: true,
  });

  /**
   * Send one file and record what came back.
   *
   * Written by key rather than by index: uploads finish out of order, and a student
   * can remove a thumbnail while its request is still out. A `setItems` that cannot
   * find the key drops the answer on the floor, which is exactly right — the photo it
   * belonged to is gone.
   */
  const upload = useCallback(async (key, file) => {
    setItems((current) =>
      current.map((item) =>
        item.key === key ? { ...item, status: 'uploading', error: null } : item,
      ),
    );

    try {
      const attachment = await uploadAttachment(file);

      setItems((current) =>
        current.map((item) =>
          item.key === key ? { ...item, status: 'ready', id: attachment.id } : item,
        ),
      );
    } catch (error) {
      // Inline under the thumbnail, no toast: the message lands within a few pixels of
      // the control that produced it, and a second copy of one failure is noise —
      // the call `Onboarding.jsx` makes about its two error surfaces.
      setItems((current) =>
        current.map((item) =>
          item.key === key ? { ...item, status: 'failed', error: uploadMessage(error) } : item,
        ),
      );
    }
  }, []);

  const handlePick = useCallback(
    (files) => {
      const picked = files.map((file) => ({
        key: `image-${nextKey++}`,
        file,
        // Revoked in `handleRemove` and on unmount. An object URL is a document-scoped
        // reference to the file's bytes; leaving it behind keeps the whole photo alive
        // for as long as the tab is open.
        previewUrl: URL.createObjectURL(file),
        name: file.name,
        status: 'uploading',
        id: null,
        error: null,
      }));

      setItems((current) => [...current, ...picked]);
      picked.forEach((item) => upload(item.key, item.file));
    },
    [upload],
  );

  const handleRemove = useCallback((key) => {
    setItems((current) => {
      const going = current.find((item) => item.key === key);

      if (going) URL.revokeObjectURL(going.previewUrl);

      return current.filter((item) => item.key !== key);
    });
  }, []);

  const handleRetry = useCallback(
    (key) => {
      const item = items.find((candidate) => candidate.key === key);

      if (item) upload(key, item.file);
    },
    [items, upload],
  );

  // The list is only ever appended to and filtered, so this runs on unmount alone —
  // an empty dependency array with a body that reads `items` would revoke the wrong
  // set, so the ref-free version keeps the current list in a ref-like closure.
  const itemsRef = useRef(items);

  itemsRef.current = items;

  useEffect(
    () => () => itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)),
    [],
  );

  const uploading = items.some((item) => item.status === 'uploading');

  /**
   * Post the question, then hand the id to 3.7.
   *
   * Only `ready` ids are sent. A failed thumbnail is visibly failed and a student who
   * submits anyway has decided to go without that photo; sending an id the server
   * never issued would be a `VALIDATION_ERROR` on the whole question instead.
   */
  const submit = useCallback(
    async (values) => {
      if (inFlight.current) return;

      inFlight.current = true;
      setSubmitting(true);
      setSubmitError(null);

      const attachmentIds = items.filter((item) => item.id).map((item) => item.id);

      try {
        const question = await createQuestion(toPayload(values, attachmentIds));

        navigate(`/app/ask/${question.id}/matching`);
      } catch (error) {
        // The server names a field on a `VALIDATION_ERROR` — `rawText` too long,
        // `attachmentIds` not this student's — and those belong under the control that
        // caused them rather than in a block at the bottom of the screen.
        if (error?.is?.(ERROR_CODES.VALIDATION_ERROR) && error.details?.rawText) {
          form.setErrors({ rawText: error.details.rawText });
        } else {
          setSubmitError(error);
        }
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    },
    [form, items, navigate],
  );

  if (submitting) {
    return (
      <Stack gap="lg" maw={640}>
        <LoadingState label="Analyzing your question…" minHeight={320} />
        <Text size="sm" c="dimmed" ta="center">
          This usually takes a few seconds. Keep this screen open.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="lg" maw={640}>
      <Stack gap="xs">
        <Title order={1}>Ask a question</Title>
        <Text c="dimmed">
          Tell us what you are stuck on. We will read it, work out the topic, and find a teacher who
          can help.
        </Text>
      </Stack>

      <Card withBorder radius="md" padding="lg">
        <form onSubmit={form.onSubmit(submit)} noValidate>
          <Stack gap="lg">
            <QuestionTextField
              {...form.getInputProps('rawText')}
              maxLength={RAW_TEXT_MAX_LENGTH}
              disabled={submitting}
            />

            <ImagePicker
              items={items}
              max={MAX_ATTACHMENTS}
              onPick={handlePick}
              onRemove={handleRemove}
              onRetry={handleRetry}
              disabled={submitting}
            />

            <Select
              {...form.getInputProps('declaredLevel')}
              label="Which level do you study?"
              description="Optional — it helps us pitch the explanation."
              placeholder="Not sure"
              data={LEVEL_DATA}
              clearable
              size="md"
            />

            {submitError && (
              // Under the form rather than in place of it: everything typed is still
              // on screen, so "Try again" is the same submit with nothing retyped.
              <ErrorState error={submitError} title="Could not send your question" minHeight={0} />
            )}

            <Group justify="flex-end">
              <Button
                type="submit"
                size="md"
                leftSection={<IconSend size={16} />}
                loading={submitting}
                // A photo still on its way is a photo the classifier would not see.
                // Waiting is a few hundred milliseconds and it is the difference
                // between a Vision call and a text-only one.
                disabled={uploading}
              >
                {uploading ? 'Uploading photo…' : 'Send question'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
