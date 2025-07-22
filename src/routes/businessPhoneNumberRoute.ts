import express from "express";
import {
  createBusinessPhoneNumber,
  getBusinessPhoneNumbers,
  getBusinessPhoneNumber,
  updateBusinessPhoneNumber,
  deleteBusinessPhoneNumber,
  updateFallbackSettings,
  getFallbackSettings,
  getBusinessPhoneNumberDetails,
  updateTimeoutSettings,
  getTimeoutSettings,
} from "../controllers/businessPhoneNumberController";

const router = express.Router();

router.post("/", createBusinessPhoneNumber);
router.get("/", getBusinessPhoneNumbers);
router.get("/details", getBusinessPhoneNumberDetails);
router.get("/:id", getBusinessPhoneNumber);
router.put("/:id", updateBusinessPhoneNumber);
router.delete("/:id", deleteBusinessPhoneNumber);
router.post("/chatbot/settings/fallback", updateFallbackSettings);
router.get("/chatbot/settings/fallback", getFallbackSettings);
router.post("/chatbot/settings/timeout", updateTimeoutSettings);
router.get("/chatbot/settings/timeout", getTimeoutSettings);

export default router; 