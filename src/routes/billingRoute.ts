import express from "express";
import {
  getBillingInformation,
  updateBillingInformation,
} from "../controllers/billingController";

const router = express.Router();

// Get billing information for the authenticated user
router.get("/",  getBillingInformation);

// Update or create billing information for the authenticated user
router.put("/",  updateBillingInformation);

export default router; 