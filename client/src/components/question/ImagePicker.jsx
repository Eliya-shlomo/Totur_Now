import {
  ActionIcon,
  Box,
  Button,
  Group,
  Image,
  Loader,
  Stack,
  Text,
  useMantineTheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCamera, IconPhotoPlus, IconRefresh, IconX } from '@tabler/icons-react';
import { useRef } from 'react';

/**
 * The photo control — camera-first on a phone. PR 3.6, MVP.md §4.1, §14.4.
 *
 * Controlled and stateless, like `TopicPicker`: `Ask.jsx` owns the list because the
 * list is what gets submitted, and it owns the uploads because a picker that fired
 * its own requests would hold ids the form could not see. This file decides what a
 * thumbnail looks like and what the input element is; nothing else.
 *
 * **`capture="environment"` only below the `sm` breakpoint.** On a phone that
 * attribute opens the rear camera directly, which is the point — §4.1's student is
 * standing over a printed exercise. On a desktop the same attribute makes browsers
 * offer a webcam instead of the file browser, which is the wrong control for a
 * scanned PDF page or a screenshot, so it is left off there. `theme.breakpoints.sm`
 * is the same 48em the layout switches shells at.
 *
 * **Nothing is validated here.** The `accept` attribute filters the picker's own
 * dialog and a student can still choose "All files"; the size cap and the MIME
 * allowlist are enforced by `middlewares/upload.js` server-side, and its
 * `VALIDATION_ERROR` arrives with a message written for a person. Re-checking here
 * would put a second copy of the allowlist in the client and would replace the
 * server's message with one that has to be kept in step with it. The client-side
 * filter is a convenience; the server's is the rule (epic README → Risks).
 */

/**
 * `ALLOWED_IMAGE_MIME_TYPES` — `server/src/config/constants/question.js`.
 *
 * Mirrored rather than imported: `@tutor/shared` carries types and `ERROR_CODES`
 * only, and the client cannot reach the server's constants folder. The pair is
 * greppable, the same arrangement `components/auth/authRules.js` documents.
 */
const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * @param {Array<{key: string, previewUrl: string, name: string,
 *   status: 'uploading'|'ready'|'failed', error?: string}>} items  one per picked file
 * @param {number} max          mirrors `MAX_ATTACHMENTS` — passed in, not read here
 * @param {(files: File[]) => void} onPick
 * @param {(key: string) => void} onRemove
 * @param {(key: string) => void} onRetry
 * @param {boolean} [disabled]  while the question itself is being submitted
 */
export default function ImagePicker({ items, max, onPick, onRemove, onRetry, disabled = false }) {
  const inputRef = useRef(null);
  const theme = useMantineTheme();

  // Below `sm` the file input opens the camera — §14.4's phone row. Read off the theme
  // rather than written as a literal: `theme.js` is frozen precisely so the five widths
  // have one home, and this was the last hardcoded breakpoint in the client (PR 10.5).
  // The idiom is `AppLayout`'s.
  const isPhone = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const remaining = max - items.length;
  const isFull = remaining <= 0;

  /**
   * The input is cleared after every pick, and that is load-bearing rather than
   * tidiness: `change` does not fire when the same file is chosen twice in a row, so
   * a student who removed a failed photo and picked it again would get no event at
   * all.
   */
  function handleChange(event) {
    const files = Array.from(event.target.files ?? []).slice(0, remaining);

    event.target.value = '';

    if (files.length > 0) onPick(files);
  }

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        Add a photo{' '}
        <Text span c="dimmed" fw={400}>
          (optional)
        </Text>
      </Text>

      {items.length > 0 && (
        <Group gap="sm" wrap="wrap">
          {items.map((item) => (
            <Thumbnail
              key={item.key}
              item={item}
              disabled={disabled}
              onRemove={() => onRemove(item.key)}
            />
          ))}
        </Group>
      )}

      {/*
        The failures, full width and under the row rather than under their own
        thumbnail. A 96px column turns the server's sentence — "Images only, and only
        these: image/jpeg, image/png, image/webp." — into four clipped lines, and a
        message the student cannot finish reading is a message that did not arrive.
      */}
      {items
        .filter((item) => item.status === 'failed')
        .map((item) => (
          <Group key={item.key} gap="xs" wrap="nowrap" align="flex-start">
            <Text size="xs" c="red" style={{ flex: 1 }}>
              <Text span size="xs" fw={500} c="red">
                {item.name}:
              </Text>{' '}
              {item.error}
            </Text>

            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<IconRefresh size={12} />}
              onClick={() => onRetry(item.key)}
              disabled={disabled}
            >
              Try again
            </Button>
          </Group>
        ))}

      <Group gap="xs" wrap="wrap">
        <Button
          variant="default"
          size="sm"
          leftSection={isPhone ? <IconCamera size={16} /> : <IconPhotoPlus size={16} />}
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isFull}
        >
          {isPhone ? 'Take a photo' : 'Choose an image'}
        </Button>

        <Text size="xs" c="dimmed">
          {isFull ? `That is the limit of ${max}.` : `Up to ${max} photos.`}
        </Text>
      </Group>

      {/*
        A real file input, hidden, driven by the button above. Mantine's FileButton
        would do the same job, but the two attributes this screen actually needs —
        `capture` on small screens and `multiple` up to the remaining count — are
        plain DOM attributes, and going through a wrapper to set them would hide the
        one thing about this control worth reading.
      */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        {...(isPhone ? { capture: 'environment' } : {})}
        multiple={remaining > 1}
        hidden
        onChange={handleChange}
        // Not `aria-hidden`: the button owns the interaction, but a screen reader
        // that reaches the input should still be told what it takes.
        aria-label="Add a photo of the exercise"
      />
    </Stack>
  );
}

/** The square every thumbnail occupies, whatever state it is in. */
const THUMBNAIL_SIZE = 96;

/**
 * One picked file: the preview, its upload state, and the way out of both.
 *
 * The preview is an object URL of the local file rather than the stored Cloudinary
 * URL, so it appears the instant the photo is chosen instead of after the round trip
 * — and it is what makes the upload feel like it happens while the student types.
 * `Ask.jsx` revokes it.
 *
 * **A file the browser cannot render still gets a square.** A PDF picked through the
 * dialog's "All files" escape hatch has an object URL that no `<img>` can draw, and a
 * broken-image glyph beside a filename reads as a bug in the app rather than as the
 * server's answer. `fallbackSrc` keeps the tile a tile; the reason it failed is a
 * sentence underneath, in `ImagePicker`.
 *
 * A failed upload stays on screen rather than disappearing with a toast: the file is
 * still in hand, nothing the student did was lost, and "try again" is one tap that
 * does not touch the text they have written.
 */
function Thumbnail({ item, disabled, onRemove }) {
  const isUploading = item.status === 'uploading';
  const hasFailed = item.status === 'failed';

  return (
    <Box pos="relative" w={THUMBNAIL_SIZE} h={THUMBNAIL_SIZE}>
      <Image
        src={item.previewUrl}
        alt={item.name}
        w={THUMBNAIL_SIZE}
        h={THUMBNAIL_SIZE}
        radius="md"
        fit="cover"
        fallbackSrc={PLACEHOLDER_TILE}
        // A failed upload reads as absent at a glance, before any text is read.
        opacity={hasFailed ? 0.45 : 1}
        // A photographed exercise is mostly white paper, and the card behind it is
        // white too — without an edge the tile is invisible and only its remove
        // button looks like anything.
        style={{ border: '1px solid var(--mantine-color-gray-3)' }}
      />

      {isUploading && (
        <Box pos="absolute" inset={0} display="grid" style={{ placeItems: 'center' }}>
          <Loader size="sm" color="white" />
        </Box>
      )}

      <ActionIcon
        variant="filled"
        color="dark"
        radius="xl"
        size="sm"
        pos="absolute"
        top={-6}
        right={-6}
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${item.name}`}
      >
        <IconX size={14} />
      </ActionIcon>
    </Box>
  );
}

/**
 * A flat grey square, inline.
 *
 * A data URI rather than a file in `public/`: it is 130 bytes, it is only ever seen
 * by a student who picked something that is not an image, and a second request for a
 * placeholder that says "this did not work" would be its own small joke.
 */
const PLACEHOLDER_TILE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#e9ecef"/></svg>',
  );
