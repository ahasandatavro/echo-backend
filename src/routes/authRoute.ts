import express from 'express';
import { registerUser, loginUser, googleSignIn, googleAuth, googleCallback } from '../controllers/authController';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/google-signin', googleSignIn);
router.get('/google', googleAuth);
router.get('/google-callback', googleCallback);
export default router;
