import express from "express";
import {
  createBusinessPhoneNumber,
  getBusinessPhoneNumbers,
  getBusinessPhoneNumber,
  updateBusinessPhoneNumber,
  deleteBusinessPhoneNumber,
  updateFallbackSettings,
  getFallbackSettings,
} from "../controllers/businessPhoneNumberController";

const router = express.Router();

router.post("/", createBusinessPhoneNumber);
router.get("/", getBusinessPhoneNumbers);
router.get("/:id", getBusinessPhoneNumber);
router.put("/:id", updateBusinessPhoneNumber);
router.delete("/:id", deleteBusinessPhoneNumber);
router.post("/chatbot/settings/fallback", updateFallbackSettings);
router.get("/chatbot/settings/fallback", getFallbackSettings);

export default router; 