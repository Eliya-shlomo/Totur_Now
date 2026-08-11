import { prisma } from './helpers.js';

/**
 * The topic taxonomy. MVP.md §7 — two levels, parent topic → subtopic.
 *
 * This is **production data**, not demo data: E11's production seed runs this half
 * and skips the rest. Every id is assigned by the database (CONVENTIONS.md §
 * Database), so nothing here may reference a topic by number — the stable key is
 * the slug, and the classifier, the seed and every later query all go through it.
 *
 * Slugs are globally unique, which is why "Circle" appears twice under different
 * slugs: it is a subtopic of both analytic and Euclidean geometry, and the two are
 * not the same thing to a teacher who specializes in one of them.
 */

/** The LLM's fallback when it cannot classify. MVP.md §7, §8.1. */
export const UNCLASSIFIED = {
  id: 0,
  slug: 'general-unclassified',
  nameEn: 'General / Unclassified',
  nameHe: 'כללי / לא מסווג',
};

export const TAXONOMY = [
  {
    slug: 'algebra',
    nameEn: 'Algebra',
    nameHe: 'אלגברה',
    children: [
      { slug: 'quadratic-equations', nameEn: 'Quadratic equations', nameHe: 'משוואות ריבועיות' },
      { slug: 'systems-of-equations', nameEn: 'Systems', nameHe: 'מערכות משוואות' },
      { slug: 'inequalities', nameEn: 'Inequalities', nameHe: 'אי-שוויונות' },
      { slug: 'parameters', nameEn: 'Parameters', nameHe: 'פרמטרים' },
      { slug: 'absolute-value', nameEn: 'Absolute value', nameHe: 'ערך מוחלט' },
    ],
  },
  {
    slug: 'word-problems',
    nameEn: 'Word problems',
    nameHe: 'בעיות מילוליות',
    children: [
      { slug: 'motion-problems', nameEn: 'Motion', nameHe: 'בעיות תנועה' },
      { slug: 'work-rate-problems', nameEn: 'Work rate', nameHe: 'בעיות הספק' },
      { slug: 'buy-sell-problems', nameEn: 'Buy/sell', nameHe: 'בעיות קנייה ומכירה' },
      { slug: 'mixture-problems', nameEn: 'Mixtures', nameHe: 'בעיות תערובת' },
    ],
  },
  {
    slug: 'sequences',
    nameEn: 'Sequences',
    nameHe: 'סדרות',
    children: [
      { slug: 'arithmetic-sequences', nameEn: 'Arithmetic', nameHe: 'סדרה חשבונית' },
      { slug: 'geometric-sequences', nameEn: 'Geometric', nameHe: 'סדרה הנדסית' },
      { slug: 'infinite-series', nameEn: 'Infinite series', nameHe: 'טור אינסופי' },
    ],
  },
  {
    slug: 'analytic-geometry',
    nameEn: 'Analytic geometry',
    nameHe: 'גיאומטריה אנליטית',
    children: [
      { slug: 'analytic-line', nameEn: 'Line', nameHe: 'הישר' },
      { slug: 'analytic-circle', nameEn: 'Circle', nameHe: 'המעגל' },
      { slug: 'distances-and-slopes', nameEn: 'Distances and slopes', nameHe: 'מרחקים ושיפועים' },
    ],
  },
  {
    slug: 'euclidean-geometry',
    nameEn: 'Euclidean geometry',
    nameHe: 'גיאומטריה אוקלידית',
    children: [
      { slug: 'triangles', nameEn: 'Triangles', nameHe: 'משולשים' },
      { slug: 'quadrilaterals', nameEn: 'Quadrilaterals', nameHe: 'מרובעים' },
      { slug: 'euclidean-circle', nameEn: 'Circle', nameHe: 'מעגל' },
      { slug: 'similarity', nameEn: 'Similarity', nameHe: 'דמיון משולשים' },
    ],
  },
  {
    slug: 'trigonometry',
    nameEn: 'Trigonometry',
    nameHe: 'טריגונומטריה',
    children: [
      { slug: 'plane-trigonometry', nameEn: 'Plane', nameHe: 'טריגונומטריה במישור' },
      { slug: 'trig-identities', nameEn: 'Identities', nameHe: 'זהויות טריגונומטריות' },
      { slug: 'trig-equations', nameEn: 'Trig equations', nameHe: 'משוואות טריגונומטריות' },
      { slug: 'trigonometry-3d', nameEn: '3D', nameHe: 'טריגונומטריה במרחב' },
    ],
  },
  {
    slug: 'calculus-functions',
    nameEn: 'Calculus — Functions',
    nameHe: 'חדו"א — פונקציות',
    children: [
      { slug: 'polynomial-functions', nameEn: 'Polynomial', nameHe: 'פונקציות פולינום' },
      { slug: 'rational-functions', nameEn: 'Rational', nameHe: 'פונקציות רציונליות' },
      { slug: 'radical-functions', nameEn: 'Radical', nameHe: 'פונקציות שורש' },
      { slug: 'trig-functions', nameEn: 'Trig', nameHe: 'פונקציות טריגונומטריות' },
      { slug: 'exponential-functions', nameEn: 'Exponential', nameHe: 'פונקציות מעריכיות' },
      { slug: 'logarithmic-functions', nameEn: 'Logarithmic', nameHe: 'פונקציות לוגריתמיות' },
    ],
  },
  {
    slug: 'calculus-derivatives',
    nameEn: 'Calculus — Derivatives',
    nameHe: 'חדו"א — נגזרות',
    children: [
      { slug: 'differentiation-rules', nameEn: 'Differentiation rules', nameHe: 'כללי גזירה' },
      { slug: 'curve-sketching', nameEn: 'Curve sketching', nameHe: 'חקירת פונקציה' },
      { slug: 'optimization', nameEn: 'Optimization', nameHe: 'בעיות קיצון' },
    ],
  },
  {
    slug: 'calculus-integrals',
    nameEn: 'Calculus — Integrals',
    nameHe: 'חדו"א — אינטגרלים',
    children: [
      { slug: 'indefinite-integrals', nameEn: 'Indefinite', nameHe: 'אינטגרל לא מסוים' },
      { slug: 'definite-integrals', nameEn: 'Definite', nameHe: 'אינטגרל מסוים' },
      { slug: 'areas-under-curves', nameEn: 'Areas', nameHe: 'חישוב שטחים' },
      { slug: 'integration-by-parts', nameEn: 'Integration by parts', nameHe: 'אינטגרציה בחלקים' },
    ],
  },
  {
    slug: 'probability-statistics',
    nameEn: 'Probability & Statistics',
    nameHe: 'הסתברות וסטטיסטיקה',
    children: [
      { slug: 'basic-probability', nameEn: 'Basic probability', nameHe: 'הסתברות בסיסית' },
      { slug: 'conditional-probability', nameEn: 'Conditional', nameHe: 'הסתברות מותנית' },
      { slug: 'normal-distribution', nameEn: 'Normal distribution', nameHe: 'התפלגות נורמלית' },
      { slug: 'statistics', nameEn: 'Statistics', nameHe: 'סטטיסטיקה' },
    ],
  },
  {
    slug: 'vectors-and-3d',
    nameEn: 'Vectors & 3D',
    nameHe: 'וקטורים ומרחב',
    children: [
      { slug: 'plane-vectors', nameEn: 'Plane vectors', nameHe: 'וקטורים במישור' },
      { slug: 'space-vectors', nameEn: '3D vectors', nameHe: 'וקטורים במרחב' },
      {
        slug: 'analytic-geometry-3d',
        nameEn: '3D analytic geometry',
        nameHe: 'גיאומטריה אנליטית במרחב',
      },
    ],
  },
];

/**
 * Upserts the whole tree and returns `{ slug: id }` for everything in it.
 *
 * Parents go in first because a child needs its parent's generated id. Both passes
 * upsert on `slug`, so a second run updates names in place and creates nothing.
 *
 * @returns {Promise<Record<string, number>>}
 */
export async function seedTopics() {
  const idBySlug = {};

  // The one place in the codebase that writes an id, and it writes zero. The LLM
  // classifier falls back to this topic when confidence is low (MVP.md §8.1), so
  // the value is part of a contract rather than a convenience.
  const unclassified = await prisma.topic.upsert({
    where: { slug: UNCLASSIFIED.slug },
    update: { nameEn: UNCLASSIFIED.nameEn, nameHe: UNCLASSIFIED.nameHe },
    create: {
      id: UNCLASSIFIED.id,
      slug: UNCLASSIFIED.slug,
      nameEn: UNCLASSIFIED.nameEn,
      nameHe: UNCLASSIFIED.nameHe,
    },
  });
  idBySlug[unclassified.slug] = unclassified.id;

  for (const parent of TAXONOMY) {
    const row = await prisma.topic.upsert({
      where: { slug: parent.slug },
      update: { nameEn: parent.nameEn, nameHe: parent.nameHe, parentId: null },
      create: { slug: parent.slug, nameEn: parent.nameEn, nameHe: parent.nameHe },
    });
    idBySlug[row.slug] = row.id;

    for (const child of parent.children) {
      const childRow = await prisma.topic.upsert({
        where: { slug: child.slug },
        update: { nameEn: child.nameEn, nameHe: child.nameHe, parentId: row.id },
        create: {
          slug: child.slug,
          nameEn: child.nameEn,
          nameHe: child.nameHe,
          parentId: row.id,
        },
      });
      idBySlug[childRow.slug] = childRow.id;
    }
  }

  return idBySlug;
}

/** `{ childSlug: parentSlug }` for every subtopic — the seed propagates stats with it. */
export const PARENT_OF = Object.fromEntries(
  TAXONOMY.flatMap((parent) => parent.children.map((child) => [child.slug, parent.slug])),
);
