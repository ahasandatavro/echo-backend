import express from "express";
import {
  getBillingInformation,
  updateBillingInformation,
} from "../controllers/billingController";
import { authenticateJWT } from "../middlewares/authMiddleware";

const router = express.Router();

// Get billing information for the authenticated user
router.get("/", authenticateJWT, getBillingInformation);

// Update or create billing information for the authenticated user
router.put("/", authenticateJWT, updateBillingInformation);

export default router; 