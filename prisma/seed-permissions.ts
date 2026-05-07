import { ActionEnum, PrismaClient, SubjectEnum } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const hiddenSubjects: SubjectEnum[] = [SubjectEnum.all, SubjectEnum.User];
  const subjects = Object.values(SubjectEnum).filter(
    (subject) => !hiddenSubjects.includes(subject),
  );
  const actions = Object.values(ActionEnum);

  const existingPermissions = await prisma.permission.findMany({
    select: { action: true, subject: true },
  });

  const existingKeys = new Set(
    existingPermissions.map(
      (permission) => `${permission.subject}:${permission.action}`,
    ),
  );

  let createdCount = 0;

  for (const subject of subjects) {
    for (const action of actions) {
      const key = `${subject}:${action}`;
      if (existingKeys.has(key)) continue;

      await prisma.permission.create({
        data: { subject, action },
      });
      existingKeys.add(key);
      createdCount += 1;
    }
  }

  console.log(
    `[seed:permissions] complete. created=${createdCount} total=${existingKeys.size}`,
  );
}

main()
  .catch((error) => {
    console.error('[seed:permissions] failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
