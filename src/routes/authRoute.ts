import express from 'express';
import {
  registerUser,
  loginUser,
  googleAuth,
  googleCallback,
  getAccessToken,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  refreshToken,
  resendVerificationEmail,
  logout,
  googleCallbackSheets,
  getGoogleToken
} from '../controllers/authController';
import { authenticateJWT, authenticateJWTWithoutSubscription } from '../middlewares/authMiddleware';
const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/refresh-token', refreshToken);
router.post('/logout', logout);
router.get('/google', googleAuth);
router.get('/google-callback', googleCallback);
router.get('/google-token',authenticateJWT,getGoogleToken);
router.get('/google-callback-sheets',authenticateJWTWithoutSubscription, googleCallbackSheets);
router.post("/get-access-token", authenticateJWT, getAccessToken);//for whatsapp embedded signUp
router.post("/verify-email", verifyEmail);
router.post('/resend-verification-email', resendVerificationEmail);
router.post('/request-password-reset', requestPasswordReset);
router.post('/reset-password', resetPassword);
export default router;
