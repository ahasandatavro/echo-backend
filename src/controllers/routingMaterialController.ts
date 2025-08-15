import { Request, Response } from "express";
import { prisma } from "../models/prismaClient";
import { checkFeatureAccess } from "../utils/packageUtils";


// ✅ Create Routing Material
export const createRoutingMaterial = async (req: Request, res: Response): Promise<void> => {
    try {
        // ✅ Check if user is authenticated
        if (!req.user || !(req.user as any).userId) {
            res.status(401).json({ error: "Unauthorized. User not found." });
            return;
        }

        // ✅ Check package access - only Pro and Business packages can create routing materials
        const accessCheck = await checkFeatureAccess((req.user as any).userId, 'routingMaterials');
        if (!accessCheck.allowed) {
            res.status(403).json({ 
                error: "Package access denied",
                message: accessCheck.message,
                packageName: accessCheck.packageName
            });
            return;
        }

        const { type, materialName, assignedUserId, teamId, userIds } = req.body;

        const newRoutingMaterial = await prisma.routingMaterial.create({
            data: {
                type,
                materialName,
                assignedUserId: assignedUserId ? parseInt(assignedUserId) : null,
                teamId: teamId ? parseInt(teamId) : null,
                users: {
                    connect: userIds?.map((id: number) => ({ id: parseInt(id.toString()) })) || [],
                }
            },
            include: {
                users: true,
                assignedUser: true,
                team: true,
            }
        });

        res.status(201).json(newRoutingMaterial);
    } catch (error) {
        console.error("Error creating routing material:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// ✅ Get All Routing Materials
export const getAllRoutingMaterials = async (req: Request, res: Response): Promise<void> => {
    try {
        const routingMaterials = await prisma.routingMaterial.findMany({
            include: {
                users: true,
                assignedUser: true,
                team: true,
            }
        });

        res.status(200).json(routingMaterials);
    } catch (error) {
        console.error("Error fetching routing materials:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// ✅ Get Routing Material by ID
export const getRoutingMaterialById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        const routingMaterial = await prisma.routingMaterial.findUnique({
            where: { id: parseInt(id) },
            include: {
                users: true,
                assignedUser: true,
                team: true,
            }
        });

        if (!routingMaterial) {
            res.status(404).json({ error: "Routing Material not found" });
            return;
        }

        res.status(200).json(routingMaterial);
    } catch (error) {
        console.error("Error fetching routing material:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// ✅ Update Routing Material
export const updateRoutingMaterial = async (req: Request, res: Response): Promise<void> => {
    try {
        // ✅ Check if user is authenticated
        if (!req.user || !(req.user as any).userId) {
            res.status(401).json({ error: "Unauthorized. User not found." });
            return;
        }

        // ✅ Check package access - only Pro and Business packages can update routing materials
        const accessCheck = await checkFeatureAccess((req.user as any).userId, 'routingMaterials');
        if (!accessCheck.allowed) {
            res.status(403).json({ 
                error: "Package access denied",
                message: accessCheck.message,
                packageName: accessCheck.packageName
            });
            return;
        }

        const { id } = req.params;
        const { type, materialName, assignedUserId, teamId, userIds } = req.body;

        const updatedRoutingMaterial = await prisma.routingMaterial.update({
            where: { id: parseInt(id) },
            data: {
                type,
                materialName,
                assignedUserId: assignedUserId ? parseInt(assignedUserId) : null,
                teamId: teamId ? parseInt(teamId) : null,
                users: {
                    set: userIds?.map((id: number) => ({ id: parseInt(id.toString()) })) || [],
                }
            },
            include: {
                users: true,
                assignedUser: true,
                team: true,
            }
        });

        res.status(200).json(updatedRoutingMaterial);
    } catch (error) {
        console.error("Error updating routing material:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// ✅ Delete Routing Material
export const deleteRoutingMaterial = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        await prisma.routingMaterial.delete({
            where: { id: parseInt(id) },
        });

        res.status(200).json({ message: "Routing Material deleted successfully" });
    } catch (error) {
        console.error("Error deleting routing material:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};
