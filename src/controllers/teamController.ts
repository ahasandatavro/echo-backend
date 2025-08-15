import { Request, Response } from "express";
import { prisma } from "../models/prismaClient";

// Get all teams
export const getTeams = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "5", search = "" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    // Build where object for search
    const where: any = {};
    if (search) {
      where.name = { contains: search as string, mode: "insensitive" };
    }

    const teams = await prisma.team.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      select: {
        id: true,
        name: true,
        defaultTeam: true,
        size: true,
        users: { select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true, role: true } }
      }
    });

    const totalRows = await prisma.team.count({ where });

    res.json({ data: teams, totalRows });
  } catch (error) {
    res.status(500).json({ error: "Error fetching teams" });
  }
};

// Get a single team by ID
export const getTeamById = async (req: Request, res: Response): Promise<void> => {
  try {
    const team = await prisma.team.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { users: true },
    });
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    res.json(team);
  } catch (error) {
    res.status(500).json({ error: "Error fetching team" });
  }
};

// Create a new team
export const createTeam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, defaultTeam,userIds = [] } = req.body;
    const existingTeam = await prisma.team.findUnique({
      where: { name },
    });

    if (existingTeam) {
      res.status(400).json({ error: "Team name already exists" });
      return;
    }
    const team = await prisma.team.create({
      data: {
        name,
        defaultTeam,
        size: userIds.length, // Set team size based on the number of users
        users: {
          connect: userIds.map((id: number) => ({ id })), // Connect users if provided
        },
      },
      include: { users: true }, // Include users in the response
    });

    res.status(201).json(team);
  } catch (error) {
    res.status(500).json({ error: "Error creating team" });
  }
};

// Update a team
export const updateTeam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, defaultTeam, size, userIds } = req.body;

    // Ensure userIds is an array
    if (!Array.isArray(userIds)) {
       res.status(400).json({ error: "userIds must be an array" });
    }

    const updatedTeam = await prisma.team.update({
      where: { id: parseInt(req.params.id) },
      data: {
        name,
        defaultTeam,
        size,
        users: {
          set: userIds.map((id: number) => ({ id })), // Updates the user associations
        },
      },
      include: { users: true }, // Return updated users with the team
    });

    res.json(updatedTeam);
  } catch (error) {
    console.error("Error updating team:", error);
    res.status(500).json({ error: "Error updating team" });
  }
};


// Delete a team
export const deleteTeam = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.team.delete({
      where: { id: parseInt(req.params.id) },
    });
    res.json({ message: "Team deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error deleting team" });
  }
};

// Add users to a team
export const addUsersToTeam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userIds } = req.body;
    const teamId = parseInt(req.params.id);

    const updatedTeam = await prisma.team.update({
      where: { id: teamId },
      data: {
        users: { connect: userIds.map((id: number) => ({ id })) },
      },
      include: { users: true },
    });

    res.json(updatedTeam);
  } catch (error) {
    res.status(500).json({ error: "Error adding users to team" });
  }
};

// Remove users from a team
export const removeUsersFromTeam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userIds } = req.body;
    const teamId = parseInt(req.params.id);

    const updatedTeam = await prisma.team.update({
      where: { id: teamId },
      data: {
        users: { disconnect: userIds.map((id: number) => ({ id })) },
      },
      include: { users: true },
    });

    res.json(updatedTeam);
  } catch (error) {
    res.status(500).json({ error: "Error removing users from team" });
  }
};
