import { Pagination, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconUsersGroup } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { getPricing, getTopics } from '@/api/public.api';
import { getTeachers } from '@/api/teacher.public.api';
import EmptyState from '@/components/state/EmptyState';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';
import TeacherCard from '@/components/teacher/TeacherCard';
import TeacherFilters from '@/components/teacher/TeacherFilters';

/**
 * `/teachers` — the public teacher list. MVP.md §14.1, on the endpoints from 2.3.
 *
 * No authentication anywhere on this screen. It is the surface that has to convince
 * somebody to register, so asking them to register first would be backwards.
 *
 * **The filters live in the URL, not in state.** A filtered list is then a link
 * somebody can send, the back button steps through filter changes the way a user
 * expects, and a reload keeps the view. `useSearchParams` is the single source of
 * truth; nothing here holds a second copy.
 */

/**
 * Rows per page. A layout number, not a domain one: twelve fills the 3-column grid
 * evenly at `lg` and the 2-column grid at `sm`. The server has its own default and
 * its own cap (`constants/pagination.js`) and neither is this — it stays a ceiling
 * this screen is allowed to ask under.
 */
const PAGE_SIZE = 12;

/** The keys this screen puts in the query string. Anything else is not ours. */
const FILTER_KEYS = ['topicId', 'level', 'band', 'onlineOnly'];

export default function Teachers() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Topics and bands populate the filter controls and never change while the
  // screen is open, so they are fetched once and are not part of the reload path.
  // A failure here disables the filters rather than blanking the list: a visitor
  // who cannot filter can still browse, and that is the more important half.
  const [options, setOptions] = useState({ topics: [], bands: [] });

  /**
   * The filters as the URL currently has them — strings, because that is what a
   * query string holds. The conversion to numbers happens at the request.
   */
  const filters = useMemo(() => {
    const current = {};

    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);

      if (value !== null) current[key] = value;
    }

    return current;
  }, [searchParams]);

  const page = Number(searchParams.get('page') ?? 1);
  const hasFilters = FILTER_KEYS.some((key) => filters[key] !== undefined);

  useEffect(() => {
    let cancelled = false;

    Promise.all([getTopics(), getPricing()])
      .then(([topicData, pricingData]) => {
        if (!cancelled) setOptions({ topics: topicData.topics, bands: pricingData.bands });
      })
      .catch(() => {
        // Deliberately swallowed. The list below has its own error state, and two
        // error banners for one dead API is noise, not information.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    getTeachers({
      topicId: filters.topicId === undefined ? undefined : Number(filters.topicId),
      level: filters.level === undefined ? undefined : Number(filters.level),
      band: filters.band,
      onlineOnly: filters.onlineOnly === 'true' ? true : undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((err) => {
        // Everything from the api layer is an ApiError, so `err.message` is already
        // safe to show — see client/src/api/ApiError.js.
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters, page]);

  useEffect(load, [load]);

  /**
   * Merge a filter change into the URL.
   *
   * `page` is dropped on every change, not carried: a visitor on page 4 who narrows
   * the filter would otherwise land on page 4 of a two-page result and read it as
   * "no teachers match", which is the most common way a filtered list lies.
   *
   * `replace: false` on purpose — each filter change is a history entry, because
   * back is how people undo a filter.
   */
  const changeFilters = useCallback(
    (patch) => {
      const next = new URLSearchParams(searchParams);

      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }

      next.delete('page');
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const clearFilters = useCallback(() => setSearchParams(new URLSearchParams()), [setSearchParams]);

  const changePage = useCallback(
    (nextPage) => {
      const next = new URLSearchParams(searchParams);

      // Page 1 is the default, so it is left out of the URL rather than written in.
      // `/teachers` and `/teachers?page=1` should not be two different links to the
      // same thing.
      if (nextPage === 1) next.delete('page');
      else next.set('page', String(nextPage));

      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  return (
    <Stack gap="lg">
      <Stack gap="xs" maw={640}>
        <Title order={1}>Teachers</Title>
        <Text c="dimmed" size="lg">
          Every teacher sets their own price and declares the level they teach. The badge is earned
          here — it comes from sessions taught on this platform and the ratings those sessions got.
        </Text>
      </Stack>

      <TeacherFilters
        value={filters}
        onChange={changeFilters}
        onClear={clearFilters}
        topics={options.topics}
        bands={options.bands}
        hasFilters={hasFilters}
        disabled={options.topics.length === 0 && options.bands.length === 0}
      />

      <TeacherResults
        loading={loading}
        error={error}
        result={result}
        hasFilters={hasFilters}
        page={page}
        onRetry={load}
        onClear={clearFilters}
        onPageChange={changePage}
      />
    </Stack>
  );
}

/**
 * The three states of the list, in one place so the page above reads as a layout.
 *
 * Loading is checked before error and error before empty, which is the order the
 * states actually occur in. `result` is kept across a reload rather than cleared, so
 * changing a filter does not blank the grid before the next page arrives.
 */
function TeacherResults({
  loading,
  error,
  result,
  hasFilters,
  page,
  onRetry,
  onClear,
  onPageChange,
}) {
  if (loading && !result) return <LoadingState label="Finding teachers…" minHeight={320} />;

  if (error) {
    return (
      <ErrorState error={error} title="Could not load teachers" onRetry={onRetry} minHeight={320} />
    );
  }

  if (!result) return null;

  if (result.teachers.length === 0) {
    // An empty state without a way out is a dead end, and a filtered empty list is
    // the most common place to build one. When nothing is filtered there is nothing
    // to clear, so the action is omitted rather than shown doing nothing.
    return (
      <EmptyState
        icon={IconUsersGroup}
        title={hasFilters ? 'No teachers match those filters' : 'No teachers yet'}
        message={
          hasFilters
            ? 'Try a wider price ceiling, a lower level, or clear the filters.'
            : 'Nobody has finished setting up a teaching profile yet.'
        }
        actionLabel={hasFilters ? 'Clear filters' : undefined}
        onAction={hasFilters ? onClear : undefined}
        minHeight={320}
      />
    );
  }

  const pageCount = Math.ceil(result.total / PAGE_SIZE);

  return (
    <Stack gap="lg">
      <Text size="sm" c="dimmed">
        {result.total} {result.total === 1 ? 'teacher' : 'teachers'}
      </Text>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {result.teachers.map((teacher) => (
          <TeacherCard key={teacher.id} teacher={teacher} />
        ))}
      </SimpleGrid>

      {pageCount > 1 && (
        <Pagination value={page} total={pageCount} onChange={onPageChange} mt="sm" />
      )}
    </Stack>
  );
}
