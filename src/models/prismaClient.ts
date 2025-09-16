import { PrismaClient } from "@prisma/client";

// Re-export all Prisma types and enums for use throughout the application
export * from "@prisma/client";

// Create a singleton Prisma client to prevent multiple instances
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Only store the client in global scope in development to prevent multiple instances
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Only connect if not in build process and not already connected
if (process.env.NODE_ENV !== 'build') {
  prisma.$connect()
    .then(() => console.log('Connected to the database'))
    .catch((error) => {
      console.error('Failed to connect to the database:', error);
      // Only exit if not in build process
      if (process.env.NODE_ENV !== 'build') {
        process.exit(1);
      }
    });
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
