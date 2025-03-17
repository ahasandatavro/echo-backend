import express from "express";
import {
  getDefaultActionSettings,
  createOrUpdateDefaultActionSettings,
  deleteDefaultActionSettings,
} from "../controllers/defaultActionSettingsController";

const router = express.Router();

// ✅ Get settings for a specific phone number
router.get("/:businessPhoneNumberId", getDefaultActionSettings);

// ✅ Create or update settings
router.post("/", createOrUpdateDefaultActionSettings);

// ✅ Delete settings
router.delete("/:businessPhoneNumberId", deleteDefaultActionSettings);

export default router;
