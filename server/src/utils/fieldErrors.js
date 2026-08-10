/**
 * Zod issues → `{ fieldName: 'message' }`, which is what the client renders inline
 * under the offending input.
 *
 * Lives in `utils/` rather than beside the error handler because it has three
 * callers with nothing else in common: `validate()`, the error handler's Zod
 * branch, and any service that runs `.safeParse()` on something it did not author
 * — the E3 classifier validating the LLM's JSON, for instance. A middleware is the
 * wrong place for a pure function that services need.
 */
export function fieldErrors(zodError) {
  const out = {};
  for (const issue of zodError.issues) {
    // Drop the leading source segment ('body' | 'params' | 'query') so the client
    // sees the field name the form actually uses. Schemas that are not wrapped in
    // a source key (a service parsing a bare object) keep their full path.
    const path = issue.path.slice(1).join('.') || issue.path.join('.');
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}
