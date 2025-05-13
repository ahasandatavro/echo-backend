import express from "express";
import {
  createBusinessPhoneNumber,
  getBusinessPhoneNumbers,
  getBusinessPhoneNumber,
  updateBusinessPhoneNumber,
  deleteBusinessPhoneNumber,
  updateFallbackSettings,
} from "../controllers/businessPhoneNumberController";

const router = express.Router();

router.post("/", createBusinessPhoneNumber);
router.get("/", getBusinessPhoneNumbers);
router.get("/:id", getBusinessPhoneNumber);
router.put("/:id", updateBusinessPhoneNumber);
router.delete("/:id", deleteBusinessPhoneNumber);
router.post("/chatbot/settings/fallback", updateFallbackSettings);

export default router; 