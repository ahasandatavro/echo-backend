import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from 'bcrypt';
const prisma = new PrismaClient();
interface UserResponse {
  id: number;
  firstName?: string;
  lastName?: string;
  email: string;
  phoneNumber?: string;
  role: string;
  team: string; // Comma-separated team names
}
// Get all users with pagination
export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "5" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const users = await prisma.user.findMany({
      skip,
      take: parseInt(limit as string),
      include: {
        teams: {
          select: {
            name: true,
          },
        },
      },
    });
    const formattedUsers: UserResponse[] = users.map((user) => ({
        id: user.id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phoneNumber: user.phoneNumber|| "",
        role: user.role|| "USER",
        team: user.teams.map((team) => team.name).join(", "), // Convert teams to comma-separated string
      }));
  
      const totalRows = await prisma.user.count();
      res.json({ data: formattedUsers, totalRows });
  } catch (error) {
    res.status(500).json({ error: "Error fetching users" });
  }
};

// Get a single user by ID
export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(req.params.id) },
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Error fetching user" });
  }
};

// Create a new user
export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, role, firstName, lastName, phoneNumber } = req.body;

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ error: "Email already exists" });
      return;
    }
 const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: { email, password:hashedPassword, role, firstName, lastName, phoneNumber },
    });
    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ error: "Error creating user" });
  }
};

// Update user by ID
export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, phoneNumber, role } = req.body;
    const updatedUser = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { firstName, lastName, phoneNumber, role },
    });
    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: "Error updating user" });
  }
};

// Delete user
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.user.delete({
      where: { id: parseInt(req.params.id) },
    });
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error deleting user" });
  }
};



export const getContacts = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get the logged-in user's ID (set by your auth middleware)
    const userId = 1;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Retrieve the user's business account and its associated phone numbers
    const businessAccounts = await prisma.businessAccount.findMany({
      where: { userId },
      include: { phoneNumbers: true },
    });

    if (!businessAccounts|| businessAccounts.length === 0) {
      res.status(404).json({ error: "Business account not found" });
      return;
    }

    // Map the phone numbers to the expected UI format
    const groupedContacts = businessAccounts.map((account) => ({
      businessAccountId: account.metaWabaId,
      phoneNumbers: account.phoneNumbers.map((phone) => ({
        displayName: phone.displayName || "",
        phoneNumber: phone.phoneNumber || "",
        phoneNumberId: phone.metaPhoneNumberId,
        connectionStatus: phone.connectionStatus || "",
        subscription: phone.subscription || "",
      })),
    }));

    res.status(200).json(groupedContacts);
  } catch (error: any) {
    console.error("Error retrieving contacts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};


export const updateSelectedContact = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get the logged-in user's ID (assumed to be set by your authentication middleware)
    const user:any = req.user; // Replace with actual user id retrieval
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Get the selected phone number id and waba id from the request body
    const { selectedPhoneNumberId, selectedWabaId } = req.body;
    if (!selectedPhoneNumberId || !selectedWabaId) {
      res.status(400).json({ error: "Both selectedPhoneNumberId and selectedWabaId are required" });
      return;
    }

    // Update the user record
    const updatedUser = await prisma.user.update({
      where: { id: user.userId },
      data: {
        selectedPhoneNumberId,
        selectedWabaId,
      },
    });

    res.status(200).json(updatedUser.id);
  } catch (error: any) {
    console.error("Error updating selected contact:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};