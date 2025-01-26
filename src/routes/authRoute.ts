import express from 'express';
import { registerUser, loginUser, googleAuth, googleCallback } from '../controllers/authController';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/google', googleAuth);
router.get('/google-callback', googleCallback);
export default router;
