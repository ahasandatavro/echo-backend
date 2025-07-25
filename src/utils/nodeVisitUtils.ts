import { prisma } from '../models/prismaClient';

// Find contactId by phone number
export async function getContactIdByPhoneNumber(phoneNumber: string): Promise<number | null> {
  const contact = await prisma.contact.findFirst({ where: { phoneNumber } });
  return contact?.id ?? null;
}

// Close previous node visit (set leftAt)
export async function closePreviousNodeVisit(conversationId: number, contactId: number | null) {
  await prisma.nodeVisit.updateMany({
    where: {
      conversationId,
      contactId,
      leftAt: null,
    },
    data: { leftAt: new Date() },
  });
}

// Create a new node visit
export async function createNodeVisit(conversationId: number, nodeId: number, contactId: number | null) {
  await prisma.nodeVisit.create({
    data: {
      conversationId,
      nodeId,
      contactId,
      enteredAt: new Date(),
      leftAt: null,
    },
  });
} 