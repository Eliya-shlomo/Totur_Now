import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ALLOWED_IMAGE_MIME_TYPES } from '#config/constants/index.js';
import { detectImageMimeType } from '#utils/imageType.js';

/**
 * The check that stands between a renamed file and a Vision model. PR 3.2.
 *
 * Worth a test rather than a manual pass because the whole function is bytes at
 * offsets: a wrong constant produces an upload endpoint that rejects every real photo
 * or accepts every fake one, and neither shows up until somebody uploads something.
 */

/** Just the signature, padded — the detector reads a prefix and nothing else. */
function fileStartingWith(...bytes) {
  return Buffer.concat([Buffer.from(bytes), Buffer.alloc(32)]);
}

const JPEG = fileStartingWith(0xff, 0xd8, 0xff, 0xe0);
const PNG = fileStartingWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = Buffer.concat([
  Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF
  Buffer.from([0x24, 0x00, 0x00, 0x00]), // length, which says nothing about format
  Buffer.from([0x57, 0x45, 0x42, 0x50]), // WEBP
  Buffer.alloc(32),
]);

describe('detectImageMimeType', () => {
  it('identifies every type the allowlist permits', () => {
    assert.equal(detectImageMimeType(JPEG), 'image/jpeg');
    assert.equal(detectImageMimeType(PNG), 'image/png');
    assert.equal(detectImageMimeType(WEBP), 'image/webp');
  });

  it('answers with a type that is actually on the allowlist', () => {
    for (const buffer of [JPEG, PNG, WEBP]) {
      assert.ok(ALLOWED_IMAGE_MIME_TYPES.includes(detectImageMimeType(buffer)));
    }
  });

  it('rejects a text file whatever it is called or announced as', () => {
    assert.equal(detectImageMimeType(Buffer.from('not an image, despite the .jpg')), null);
  });

  it('rejects a PDF', () => {
    assert.equal(detectImageMimeType(fileStartingWith(0x25, 0x50, 0x44, 0x46)), null);
  });

  it('rejects a RIFF container that is not WebP — a WAV starts the same way', () => {
    const wav = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from([0x57, 0x41, 0x56, 0x45]), // WAVE, not WEBP
      Buffer.alloc(32),
    ]);

    assert.equal(detectImageMimeType(wav), null);
  });

  it('rejects a truncated signature rather than reading past the end', () => {
    assert.equal(detectImageMimeType(Buffer.from([0xff, 0xd8])), null);
    assert.equal(detectImageMimeType(Buffer.alloc(0)), null);
  });

  it('rejects anything that is not a buffer', () => {
    assert.equal(detectImageMimeType(undefined), null);
    assert.equal(detectImageMimeType('\xff\xd8\xff'), null);
  });
});
