import { ActionEnum, PrismaClient, SubjectEnum } from '@prisma/client';
// import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

async function main() {
  // await prisma.contract.createMany({
  //   data: Array.from({ length: 10 }).map(() => ({
  //     initialAmountPaid: faker.number.float({ min: 0, max: 100000 }),

  //     nextOfKinFullName: faker.person.fullName(),
  //     nextOfKinRelationship: faker.helpers.arrayElement([
  //       'Father',
  //       'Mother',
  //       'Brother',
  //       'Sister',
  //     ]),
  //     nextOfKinPhoneNumber: faker.phone.number(),
  //     nextOfKinHomeAddress: faker.location.streetAddress(),
  //     nextOfKinEmail: faker.internet.email(),
  //     nextOfKinDateOfBirth: faker.date.past(),
  //     nextOfKinNationality: faker.location.country(),

  //     guarantorFullName: faker.person.fullName(),
  //     guarantorPhoneNumber: faker.phone.number(),
  //     guarantorHomeAddress: faker.location.streetAddress(),
  //     guarantorEmail: faker.internet.email(),
  //     guarantorIdType: faker.helpers.arrayElement([
  //       'Nin',
  //       'Passport',
  //       'Driver_License',
  //       'Voter_ID',
  //     ]),
  //     guarantorIdNumber: faker.string.uuid(),
  //     guarantorIdIssuingCountry: faker.location.country(),
  //     guarantorIdIssueDate: faker.date.past(),
  //     guarantorIdExpirationDate: faker.date.future(),
  //     guarantorNationality: faker.location.country(),
  //     guarantorDateOfBirth: faker.date.past(),

  //     idType: faker.helpers.arrayElement([
  //       'Nin',
  //       'Passport',
  //       'Driver_License',
  //       'Voter_ID',
  //     ]),
  //     idNumber: faker.string.uuid(),
  //     issuingCountry: faker.location.country(),
  //     issueDate: faker.date.past(),
  //     expirationDate: faker.date.future(),
  //     fullNameAsOnID: faker.person.fullName(),
  //     addressAsOnID: faker.location.streetAddress(),

  //     signedContractUrl: faker.internet.url(),
  //     signedAt: faker.date.recent(),
  //   })),
  // });

  // // Retrieve inserted contracts
  // const contracts = await prisma.contract.findMany();
  // const contractIds = contracts.map((contract) => contract.id);

  // const customers = await prisma.customer.findMany();
  // const customerIds = customers.map((customer) => customer.id);

  // const users = await prisma.user.findMany();
  // const userIds = users.map((user) => user.id);

  // // Seed Sales
  // await prisma.sales.createMany({
  //   data: Array.from({ length: 10 }).map(() => ({
  //     category: faker.helpers.arrayElement(['INVENTORY', 'PRODUCT']),
  //     status: faker.helpers.arrayElement([
  //       'IN_INSTALLMENT',
  //       'COMPLETED',
  //       'UNPAID',
  //     ]),
  //     customerId: faker.helpers.arrayElement(customerIds), // Use existing user/customer IDs
  //     creatorId: faker.helpers.arrayElement(userIds),
  //     totalPrice: faker.number.float({ min: 1000, max: 50000 }),
  //     totalPaid: faker.number.float({ min: 0, max: 50000 }),
  //     installmentAccountDetailsId: null,
  //     deliveredAccountDetails: faker.datatype.boolean(),
  //     contractId: faker.helpers.arrayElement(contractIds),
  //   })),
  // });

  // // Retrieve inserted sales
  // const sales = await prisma.sales.findMany();
  // const salesIds = sales.map((sale) => sale.id);

  // // Seed Installment Account Details
  // await prisma.installmentAccountDetails.createMany({
  //   data: salesIds.map(() => ({
  //     flw_ref: faker.string.uuid(),
  //     order_ref: faker.string.uuid(),
  //     account_number: faker.finance.accountNumber(),
  //     account_status: 'ACTIVE',
  //     frequency: faker.number.int({ min: 1, max: 12 }),
  //     bank_name: faker.company.name(),
  //     expiry_date: faker.date.future().toISOString(),
  //     note: faker.lorem.sentence(),
  //     amount: faker.finance.amount(),
  //   })),
  // });

  // // Seed Sale Items
  // const productIds = await prisma.product.findMany();
  // const productIdsList = productIds.map((product) => product.id);

  // await prisma.saleItem.createMany({
  //   data: Array.from({ length: 20 }).map(() => ({
  //     productId: faker.helpers.arrayElement(productIdsList),
  //     quantity: faker.number.int({ min: 1, max: 5 }),
  //     saleId: faker.helpers.arrayElement(salesIds),
  //     discount: faker.number.float({ min: 0, max: 50 }),
  //     totalPrice: faker.number.float({ min: 100, max: 1000 }),
  //     paymentMode: faker.helpers.arrayElement(['ONE_OFF', 'INSTALLMENT']),
  //   })),
  // });

  // // Seed Sale Recipients
  // await prisma.saleRecipient.createMany({
  //   data: Array.from({ length: 10 }).map(() => ({
  //     firstname: faker.person.firstName(),
  //     lastname: faker.person.lastName(),
  //     address: faker.location.streetAddress(),
  //     phone: faker.phone.number(),
  //     email: faker.internet.email(),
  //   })),
  // });

  // await prisma.financialSettings.deleteMany();
  // await prisma.financialSettings.createMany({
  //   data: Array.from({ length: 1 }).map(() => ({
  //     outrightMargin: 0.2, // 20%
  //     loanMargin: 0.15, // 15%
  //     monthlyInterest: 0.04, // 4%
  //   })),
  // });

  // await prisma.product.deleteMany();
  // await prisma.inventory.deleteMany();
  // await prisma.category.updateMany({
  //   data: {
  //     parentId: null, // Unlink them from the parent
  //   },
  // });
  // await prisma.category.deleteMany();
  // await prisma.productInventory.deleteMany();
  // await prisma.inventoryBatch.deleteMany(); // Clear the existing batches
  // await prisma.category.createMany({
  //   data: Array.from({ length: 10 }).map(() => ({
  //     name: faker.commerce.department(),
  //     type: faker.helpers.arrayElement(['INVENTORY', 'PRODUCT']),
  //   })),
  // });

  // const insertedInventoryCategories = await prisma.category.findMany();
  // const inventoryCategoryIds = insertedInventoryCategories.map(
  //   (category) => category.id,
  // );

  // // Seed Inventories
  // await prisma.inventory.createMany({
  //   data: Array.from({ length: 10 }).map(() => ({
  //     name: faker.commerce.productName(),
  //     manufacturerName: faker.person.fullName(),
  //     sku: faker.lorem.word(10),
  //     image: faker.image.url(),
  //     status: faker.helpers.arrayElement([
  //       'IN_STOCK',
  //       'OUT_OF_STOCK',
  //       'DISCONTINUED',
  //     ]), // Random inventory status
  //     class: faker.helpers.arrayElement(['REGULAR', 'RETURNED', 'REFURBISHED']), // Random inventory class
  //     inventoryCategoryId: faker.helpers.arrayElement(inventoryCategoryIds),
  //     inventorySubCategoryId: faker.helpers.arrayElement(inventoryCategoryIds),
  //     createdAt: new Date(),
  //     updatedAt: new Date(),
  //     deletedAt: null, // If not deleted, set as null
  //   })),
  // });

  // // Retrieve inserted inventories to get their ids
  // const insertedInventories = await prisma.inventory.findMany();
  // const inventoryIds = insertedInventories.map((inventory) => inventory.id);

  // const insertedCategories = await prisma.category.findMany();
  // const categoryIds = insertedCategories.map((category) => category.id);

  // await prisma.product.createMany({
  //   data: Array.from({ length: 10 }).map(() => ({
  //     name: faker.commerce.productName(),
  //     description: faker.commerce.productDescription(),
  //     image: faker.image.url(),
  //     currency: 'NGN',
  //     paymentModes: faker.helpers.arrayElement(['CASH', 'CARD', 'PAYPAL']),
  //     categoryId: faker.helpers.arrayElement(categoryIds),
  //     createdAt: new Date(),
  //     updatedAt: new Date(),
  //   })),
  // });

  // // Query inserted products to get their ids
  // const productIds = await prisma.product.findMany();
  // const productIdsList = productIds.map((product) => product.id);

  // // Seed ProductInventory (linking Products to Inventories)
  // await prisma.productInventory.createMany({
  //   data: Array.from({ length: 10 }).map(() => ({
  //     productId: faker.helpers.arrayElement(productIdsList),
  //     inventoryId: faker.helpers.arrayElement(inventoryIds),
  //     quantity: 10,
  //   })),
  // });

  // // Seed InventoryBatches
  // await prisma.inventoryBatch.createMany({
  //   data: Array.from({ length: 10 }).map(() => ({
  //     batchNumber: Math.floor(Math.random() * 10000), // Generate a random batch number
  //     costOfItem: parseFloat(faker.commerce.price()), // Random cost of item
  //     price: parseFloat(faker.commerce.price()), // Random price
  //     numberOfStock: faker.number.int({ min: 1, max: 100 }), // Random stock number
  //     remainingQuantity: faker.number.int({ min: 1, max: 100 }), // Random remaining quantity
  //     inventoryId: faker.helpers.arrayElement(inventoryIds), // Set the inventory ID
  //   })),
  // });

  // // Seed Admin Role
  // const adminRole = await prisma.role.upsert({
  //   where: { role: 'admin' },
  //   update: {},
  //   create: {
  //     role: 'admin',
  //     permissions: {
  //       create: [
  //         {
  //           action: ActionEnum.manage,
  //           subject: SubjectEnum.all,
  //         },
  //       ],
  //     },
  //   },
  // });

  // await prisma.agent.deleteMany();

  // // Seed Users
  // await prisma.user.createMany({
  //   data: Array.from({ length: 10 }).map(() => ({
  //     firstname: faker.person.firstName(),
  //     lastname: faker.person.lastName(),
  //     username: faker.internet.username(),
  //     password: faker.internet.password(),
  //     email: faker.internet.email(),
  //     phone: faker.phone.number(),
  //     location: faker.location.city(),
  //     roleId: adminRole.id,
  //   })),
  // });

  // // Retrieve inserted users
  // const users = await prisma.user.findMany();
  // const userIds = users.map((user) => user.id);

  // // Seed Agents
  // await prisma.agent.createMany({
  //   data: Array.from({ length: 10 }).map(() => ({
  //     userId: faker.helpers.arrayElement(userIds),
  //     agentId: Math.floor(Math.random() * 900000) + 100000,
  //   })),
  // });

  // // Retrieve inserted agents
  // const agents = await prisma.agent.findMany();
  // const agentIds = agents.map((agent) => agent.id);

  // Seed Customers
  // await prisma.customer.deleteMany();
  // await prisma.customer.createMany({
  //   data: Array.from({ length: 10 }).map(() => ({
  //     firstname: faker.person.firstName(),
  //     lastname: faker.person.lastName(),
  //     email: faker.internet.email(),
  //     phone: faker.phone.number(),
  //     location: faker.location.city(),
  //     addressType: 'HOME',
  //     creatorId: faker.helpers.arrayElement(userIds),
  //     agentId: faker.helpers.arrayElement(agentIds),
  //     type: 'lead',
  //   })),
  // });
  const hiddenSubjects: SubjectEnum[] = [SubjectEnum.all, SubjectEnum.User];
  const subjects = Object.values(SubjectEnum).filter(
    (subject) => !hiddenSubjects.includes(subject),
  );
  const actions = Object.values(ActionEnum);

  const existingPermissions = await prisma.permission.findMany({
    select: { action: true, subject: true },
  });
  const existingPermissionKeys = new Set(
    existingPermissions.map(
      (permission) => `${permission.subject}:${permission.action}`,
    ),
  );

  let createdPermissionCount = 0;
  for (const subject of subjects) {
    for (const action of actions) {
      const key = `${subject}:${action}`;
      if (existingPermissionKeys.has(key)) continue;

      await prisma.permission.create({
        data: { subject, action },
      });
      existingPermissionKeys.add(key);
      createdPermissionCount += 1;
    }
  }

  await prisma.$runCommandRaw({
  update: 'InstallmentAccountDetails',
  updates: [
    {
      q: { createdAt: { $type: 'string' } }, // Find where 'createdAt' is a string
      u: [
        { $set: { createdAt: { $toDate: '$createdAt' } } }, // Convert to Date
      ],
      multi: true,
    },
  ],
  });
  console.log(
    `[seed] permissions ensured. created=${createdPermissionCount} total=${existingPermissionKeys.size}`,
  );
  console.log('Seeding completed successfully!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
