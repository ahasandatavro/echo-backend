import express from "express";
import { getNotificationSettings, saveNotificationSettings } from "../controllers/notificatonSettingsController";

const router = express.Router();

router.get("/", getNotificationSettings);
router.post("/", saveNotificationSettings);

export default router;
