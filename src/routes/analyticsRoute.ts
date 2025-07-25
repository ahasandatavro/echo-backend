import { Router } from "express";
import { authenticateJWT } from '../middlewares/authMiddleware';
import { getUserAnalytics, getChatbotAnalytics, getChatbotNodeAnalytics } from "../controllers/analyticsController";

const router = Router();

router.get("/", authenticateJWT, getUserAnalytics);
router.get("/chatbot", authenticateJWT, getChatbotAnalytics);
router.get("/chatbot/:chatbotId/nodes", authenticateJWT, getChatbotNodeAnalytics);

export default router;