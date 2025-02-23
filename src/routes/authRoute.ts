import express from 'express';
import { registerUser, loginUser, googleAuth, googleCallback, getAccessToken } from '../controllers/authController';
import { authenticateJWT } from '../middlewares/authMiddleware';
const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/google', googleAuth);
router.get('/google-callback', googleCallback);
router.post("/get-access-token", authenticateJWT,getAccessToken);
export default router;
