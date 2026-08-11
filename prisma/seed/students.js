import { prisma, upsertUser, setWallet, log } from './helpers.js';

/**
 * Demo students and one admin.
 *
 * Balances are chosen against the price range (MVP.md §5.2) so the demo can show
 * all three states without editing data mid-presentation:
 *
 *   · Avi   — comfortable: affords the opening block at any price on the platform
 *   · Noya  — tight: affords band A and B, filtered out of the expensive teachers
 *             by the "can afford two blocks" hard filter (§9.1)
 *   · Ido   — empty: sees the top-up flow, which is the other half of §5.4
 */
const STUDENTS = [
  {
    email: 'avi.student@demo.tutornow.il',
    fullName: 'Avi Levi',
    grade: 12,
    mathLevel: 5,
    school: 'Herzliya Gymnasium',
    balance: 120,
  },
  {
    email: 'noya.student@demo.tutornow.il',
    fullName: 'Noya Cohen',
    grade: 11,
    mathLevel: 4,
    school: 'Ironi Alef Tel Aviv',
    balance: 24,
  },
  {
    email: 'ido.student@demo.tutornow.il',
    fullName: 'Ido Mizrahi',
    grade: 10,
    mathLevel: 3,
    school: 'Rogozin Ashdod',
    balance: 0,
  },
];

const ADMIN = { email: 'admin@demo.tutornow.il', fullName: 'Platform Admin' };

export async function seedStudents() {
  for (const student of STUDENTS) {
    const user = await upsertUser({
      email: student.email,
      fullName: student.fullName,
      role: 'student',
    });

    const profile = {
      grade: student.grade,
      mathLevel: student.mathLevel,
      school: student.school,
    };

    await prisma.studentProfile.upsert({
      where: { userId: user.id },
      update: profile,
      create: { userId: user.id, ...profile },
    });

    await setWallet(user.id, student.balance, 'Demo starting balance');
  }

  const admin = await upsertUser({ ...ADMIN, role: 'admin' });
  // Admins carry a wallet like everyone else — E1.6 creates one per user, and a
  // missing row is exactly the kind of gap that breaks a query three epics later.
  await setWallet(admin.id, 0);

  log(`${STUDENTS.length} students, 1 admin`);
}

export { STUDENTS, ADMIN };
