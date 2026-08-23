import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * The four-state contract, asserted rather than reviewed — PR 10.2.
 *
 * `docs/CONVENTIONS.md` → Client says it in one line: *"Every list has an empty state.
 * Every async view has a loading state and an error state. This is a review item, not a
 * polish item."* It has been true since E1 and nothing has ever checked it. A review item
 * a machine can check should be checked by the machine; E10 is the epic that noticed.
 *
 * **Source-reading assertions, and that is deliberate.** The idiom is
 * `wallet.service.test.js`'s and `wallet.topup.test.js`'s on the server side: some
 * properties are about where code lives rather than what it returns, and a call cannot
 * demonstrate them. Nothing here renders a component — the client has no test renderer,
 * adding one is a dependency and a decision, and none of the three rules below needs it.
 *
 * **The exemptions are lists with reasons, never loosened regexes.** A pattern that
 * excludes `pages/**\/Rate*.jsx` excludes a file nobody has written yet. If this suite
 * goes red, the fix is a screen or a named entry with a sentence — "the suite went red and
 * I relaxed the assertion" is how a rule becomes a bug.
 */

const CLIENT_SRC = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * Screens that talk to `@/api/` and render neither `LoadingState` nor `ErrorState`.
 *
 * One entry, and it is a form that posts.
 */
const NO_ASYNC_VIEW = {
  'pages/student/RateSession.jsx':
    'Writes a review and reads nothing. There is no fetch to be loading, and a failed ' +
    'submit is `notify.apiError` plus a form that keeps what the student typed (6.6).',
};

/**
 * Files allowed to import Mantine's `Loader` besides `LoadingState` itself.
 *
 * The rule is about the loading half of an *async view*, not about every spinner: a busy
 * indicator inside a control is a different thing and `EmptyState`'s sibling components
 * have nothing to say about it.
 */
const LOADER_EXCEPTIONS = {
  'components/question/ImagePicker.jsx':
    'Renders a `Loader` over the image thumbnail while the upload runs. It is a busy ' +
    'indicator on a control, not a view state — the view around it is already rendered.',
};

/**
 * `ErrorState` call sites that carry no `onRetry`, keyed by the `title` they render.
 *
 * The rule this list is the boundary of: **an `ErrorState` that stands in place of the
 * content needs a retry, because it is the only control on screen.** One that is rendered
 * *beside* content which already carries the action does not, and a second button there
 * would be two controls for one decision.
 *
 * This entry was found by the assertion below on its first run, having been missed by the
 * grep audit that preceded it — which is the whole argument for the file existing.
 */
const ERROR_STATE_WITHOUT_RETRY = [
  {
    file: 'pages/student/Ask.jsx',
    title: 'Could not send your question',
    reason:
      'Rendered under the form, not in place of it — everything typed is still on screen ' +
      'and the Send button directly below it is the retry. `minHeight={0}` is 3.6 saying ' +
      'the same thing in layout.',
  },
];

/** Every `.js`/`.jsx` under `client/src`, as repo-relative-ish paths from `src/`. */
async function clientFiles() {
  const found = [];

  async function walk(dir) {
    for (const entry of await readdir(path.join(CLIENT_SRC, dir), { withFileTypes: true })) {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) await walk(relative);
      else if (/\.jsx?$/.test(entry.name)) found.push(relative);
    }
  }

  await walk('');

  return found.sort();
}

const files = await clientFiles();
const sources = new Map(
  await Promise.all(
    files.map(async (file) => [file, await readFile(path.join(CLIENT_SRC, file), 'utf8')]),
  ),
);

describe('the four-state contract', () => {
  it('finds the client to read — a passing suite that read nothing is not a passing suite', () => {
    assert.ok(files.length > 80, `only ${files.length} client files found`);
    assert.ok(sources.has('components/state/LoadingState.jsx'));
  });

  it('gives every page that calls the API a loading state and an error state', () => {
    const offenders = [];

    for (const [file, source] of sources) {
      if (!file.startsWith('pages/')) continue;
      if (!source.includes("from '@/api/")) continue;
      if (file in NO_ASYNC_VIEW) continue;

      const missing = ['LoadingState', 'ErrorState'].filter((name) => !source.includes(name));

      if (missing.length > 0) offenders.push(`${file} — missing ${missing.join(' and ')}`);
    }

    assert.deepEqual(offenders, []);
  });

  it('keeps the exemption list honest — every entry still exists and still qualifies', () => {
    for (const [file, reason] of Object.entries(NO_ASYNC_VIEW)) {
      assert.ok(sources.has(file), `${file} is exempted and does not exist`);
      assert.ok(reason.length > 40, `${file}'s exemption needs a reason, not a label`);

      const source = sources.get(file);

      assert.ok(
        !source.includes('LoadingState') && !source.includes('ErrorState'),
        `${file} renders a state component now — remove it from NO_ASYNC_VIEW`,
      );
    }
  });

  it('renders spinners through LoadingState and nowhere else', () => {
    const offenders = [];

    for (const [file, source] of sources) {
      if (file === 'components/state/LoadingState.jsx') continue;
      if (file in LOADER_EXCEPTIONS) continue;

      // The import is the tell. A component that never imports `Loader` cannot render one,
      // and matching on `<Loader` alone would miss a renamed import.
      if (/^import\s\{[^}]*\bLoader\b[^}]*\}\sfrom\s'@mantine\/core'/m.test(source)) {
        offenders.push(file);
      }
    }

    assert.deepEqual(offenders, []);
  });

  it('keeps the Loader exception list honest', () => {
    for (const [file, reason] of Object.entries(LOADER_EXCEPTIONS)) {
      assert.ok(sources.has(file), `${file} is excepted and does not exist`);
      assert.ok(reason.length > 40, `${file}'s exception needs a reason, not a label`);
      assert.ok(
        sources.get(file).includes('Loader'),
        `${file} no longer imports Loader — remove it from LOADER_EXCEPTIONS`,
      );
    }
  });

  it('keeps the retry exemption list honest', () => {
    for (const { file, title, reason } of ERROR_STATE_WITHOUT_RETRY) {
      assert.ok(sources.has(file), `${file} is excepted and does not exist`);
      assert.ok(reason.length > 40, `${file}'s exception needs a reason, not a label`);
      assert.ok(
        sources.get(file).includes(title),
        `${file} no longer renders "${title}" — remove it from ERROR_STATE_WITHOUT_RETRY`,
      );
    }
  });

  it('gives every ErrorState a way out', () => {
    // An `ErrorState` with no `onRetry` is a dead end with a nicer icon. Every failure a
    // screen renders this for was a GET, and a GET can always be tried again.
    const offenders = [];

    for (const [file, source] of sources) {
      if (file === 'components/state/ErrorState.jsx') continue;

      for (const element of jsxElements(source, 'ErrorState')) {
        if (element.includes('onRetry')) continue;
        if (isAllowedWithoutRetry(file, element)) continue;

        offenders.push(`${file} — ${oneLine(element)}`);
      }
    }

    assert.deepEqual(offenders, []);
  });
});

/** @see ERROR_STATE_WITHOUT_RETRY */
function isAllowedWithoutRetry(file, element) {
  return ERROR_STATE_WITHOUT_RETRY.some(
    (entry) => entry.file === file && element.includes(entry.title),
  );
}

/**
 * Every `<Name … />` in a source, as raw strings.
 *
 * Self-closing only, which every call site of these three components is. A non-self-closing
 * one would be invisible to this and that is the honest limit: `EmptyState`, `ErrorState`
 * and `LoadingState` all render their own children and take none.
 */
function jsxElements(source, name) {
  const elements = [];
  let from = 0;

  for (;;) {
    const start = source.indexOf(`<${name}`, from);

    if (start === -1) return elements;

    const end = source.indexOf('/>', start);

    if (end === -1) return elements;

    elements.push(source.slice(start, end + 2));
    from = end + 2;
  }
}

/** A multi-line JSX element, squashed so an assertion message stays readable. */
function oneLine(element) {
  return element.replace(/\s+/g, ' ').slice(0, 90);
}
