/**
 * Paging defaults for every list endpoint. MVP.md §12.
 *
 * `GET /teachers` (E2) is the first paged endpoint in the project, and the
 * numbers below are not its numbers — they belong to the next list as much as to
 * this one, which is why they live in the constants folder rather than in a
 * teacher validator (CONVENTIONS.md → "No magic numbers").
 *
 * The cap is a server-side ceiling, not a rejection: a client asking for 1000
 * rows gets `MAX_PAGE_SIZE` of them. A 400 would turn one over-eager query
 * parameter into a broken screen, and the client cannot know our ceiling before
 * it asks.
 */

/** Rows per page when the caller says nothing. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * The most rows one request may return, whatever it asks for.
 *
 * Sized against the free Neon instance rather than against a screen: every row
 * carries its topics, so a page is a join, and an uncapped `pageSize` is a way
 * for an anonymous caller to ask for the whole table on every request.
 */
export const MAX_PAGE_SIZE = 50;

/** Pages are 1-based in the query string — `?page=1` is the first page. */
export const FIRST_PAGE = 1;
