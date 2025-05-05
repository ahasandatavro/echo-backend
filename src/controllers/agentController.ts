import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";
import bcrypt from 'bcrypt';
import { sendWelcomeEmail, generateVerificationToken } from "../services/emailService";
import crypto from 'crypto';
const prisma = new PrismaClient();

// Create Agent
export const createAgent = async (req: Request, res: Response) => {
    try {
        const { email, firstName, lastName, contactEmail, phoneNumber } = req.body;
        const reqUser:any=req.user;
        const userId = reqUser.userId; // Assuming middleware extracts logged-in user's ID

        // Get the creator (User creating the Agent)
        const creator = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                businessAccount: true,
                selectedPhoneNumberId: true,
                selectedWabaId: true,
            },
        });

        if (!creator) {
            return res.status(404).json({ error: "Creator user not found" });
        }

        const verificationToken = generateVerificationToken();

        // Create the agent and assign inherited fields
        const agent = await prisma.user.create({
            data: {
                email,
                password: "", // Set empty password
                firstName,
                lastName,
                contactEmail,
                phoneNumber,
                agent: true, // Mark as an agent
                createdById: userId, // Link to creator
                businessAccount: { connect: creator.businessAccount.map(ba => ({ id: ba.id })) },
                selectedPhoneNumberId: creator.selectedPhoneNumberId,
                selectedWabaId: creator.selectedWabaId,
                emailVerified: false,
                verificationToken,
            },
        });

        // Send welcome email with verification link
        try {
            await sendWelcomeEmail(email, firstName, verificationToken);
        } catch (emailError) {
            console.error('Failed to send welcome email:', emailError);
            // Don't fail the agent creation if email fails
        }

        res.status(201).json(agent);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// Update Agent
export const updateAgent = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { firstName, lastName, contactEmail, phoneNumber, email } = req.body;

        const agent = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { firstName, lastName, contactEmail, phoneNumber, email },
        });

        res.status(200).json(agent);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// Delete Agent
export const deleteAgent = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        await prisma.user.delete({ where: { id: parseInt(id) } });

        res.status(200).json({ message: "Agent deleted successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};
