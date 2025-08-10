import { Router } from "express";
import { authenticateJWT } from '../middlewares/authMiddleware';
import { getUserAnalytics, getChatbotAnalytics, getChatbotNodeAnalytics, getBroadcastAnalytics, getTemplatePerformanceTrend } from "../controllers/analyticsController";

const router = Router();

router.get("/", authenticateJWT, getUserAnalytics);
router.get("/chatbot", authenticateJWT, getChatbotAnalytics);
router.get("/chatbot/:chatbotId/nodes", authenticateJWT, getChatbotNodeAnalytics);
router.get("/broadcast", authenticateJWT, getBroadcastAnalytics);
router.get("/performance-trend", authenticateJWT, getTemplatePerformanceTrend);

export default router;