/**
 * The "admin" Role has permissionIds: [] / permissions: [] in production -
 * confirmed via the logged-in user's own session payload. That's why every
 * permission-gated UI section (Settings > Users, Settings > Role and
 * Permissions, and anything else checking role.permissions) is hidden for
 * this account: the frontend's canAccessUserManagement / canManageEverything
 * checks correctly find nothing to match against, because there's nothing
 * there. This isn't a frontend bug - the gating logic (added back in
 * commit 253ac30) is working exactly as designed on empty data.
 *
 * prisma/seed.ts has a commented-out "Seed Admin Role" block that shows the
 * intended setup: an "admin" role with a single manage:all permission. That
 * seed step apparently never ran (or ran before being commented out and the
 * role was later recreated without it) - this script does exactly what that
 * commented-out block does, safely and idempotently, against the role that
 * already exists rather than creating a new one.
 *
 * Usage:
 *   npx ts-node scripts/fix-admin-role-permissions.ts            # dry run (default)
 *   npx ts-node scripts/fix-admin-role-permissions.ts --apply    # actually writes
 *
 * Safe to re-run: does nothing if the role already has manage:all.
 */
import { PrismaClient, ActionEnum, SubjectEnum } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(APPLY ? 'RUNNING LIVE (--apply passed) - this will write to the database.' : 'DRY RUN (pass --apply to write) - no changes will be made.');
  console.log('');

  const role = await prisma.role.findUnique({
    where: { role: 'admin' },
    include: { permissions: true },
  });

  if (!role) {
    console.log('No role named "admin" found - nothing to do.');
    return;
  }

  console.log(`Found role "admin" (id=${role.id}), currently has ${role.permissions.length} permission(s) attached.`);

  const hasManageAll = role.permissions.some(
    (p) => p.action === ActionEnum.manage && p.subject === SubjectEnum.all,
  );
  if (hasManageAll) {
    console.log('Already has manage:all - nothing to do.');
    return;
  }

  let permission = await prisma.permission.findFirst({
    where: { action: ActionEnum.manage, subject: SubjectEnum.all },
  });

  if (permission) {
    console.log(`Found existing manage:all Permission (id=${permission.id}).`);
  } else {
    console.log('No manage:all Permission record exists yet.');
    if (APPLY) {
      permission = await prisma.permission.create({
        data: { action: ActionEnum.manage, subject: SubjectEnum.all },
      });
      console.log(`  -> created Permission ${permission.id}.`);
    } else {
      console.log('  -> would create one.');
    }
  }

  console.log(`\nWould attach manage:all to role "admin" (${role.id}).`);
  if (APPLY && permission) {
    await prisma.role.update({
      where: { id: role.id },
      data: { permissions: { connect: { id: permission.id } } },
    });
    console.log('Done - role "admin" now has manage:all.');
    console.log('Anyone with this role needs to log out and back in for their session to pick up the change.');
  }

  if (!APPLY) {
    console.log('\nThis was a dry run - nothing was written. Re-run with --apply to commit.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
