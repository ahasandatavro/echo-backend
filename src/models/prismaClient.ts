import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

prisma.$connect()
  .then(() => console.log('Connected to the database'))
  //@ts-ignore
  .catch((error) => {
    console.error('Failed to connect to the database:', error);
    process.exit(1);
  });
