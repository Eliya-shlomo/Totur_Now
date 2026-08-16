import { v2 as cloudinary } from 'cloudinary';

import { env } from '#config/env.js';

/**
 * The one configured Cloudinary SDK in the process. PR 3.2, MVP.md §12.
 *
 * Same rule as `config/db.js` and as the video provider in `OWNERSHIP.md` §2.1:
 * exactly two files may import this one — `services/media.service.js`, which uploads,
 * and nothing else yet. A controller or a repository reaching for Cloudinary is a
 * failed review. The reason is not tidiness: the day this project moves to S3 or adds
 * a signed-delete job, the search for "everything that talks to the image host" has
 * to return one file.
 *
 * `cloudinary.config()` mutates a module-level singleton inside the SDK, so calling
 * it in two places is not "configuring twice", it is a race about which credentials
 * win. Done here, at import time, once.
 *
 * The three variables are `optional()` in `config/env.js` and `requiredInProduction`
 * — a developer without a Cloudinary account still boots the server and still runs
 * every test that does not upload. `isCloudinaryConfigured` below is what turns that
 * looseness into a clear answer instead of an SDK error about a missing `cloud_name`.
 *
 * `secure: true` is not a default. Without it the SDK returns `http://` URLs, which
 * a browser on an HTTPS page refuses to load as mixed content — a broken image in
 * production and a working one locally.
 */
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Whether this process can upload at all.
 *
 * Checked before the first byte is read rather than discovered inside the SDK: an
 * unconfigured upload throws `Must supply cloud_name`, which reaches the client as a
 * 500 about a variable name and tells a student nothing. With this, it is an
 * `EXTERNAL_SERVICE_ERROR` like every other way the image host can fail.
 */
export const isCloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);

export { cloudinary };
