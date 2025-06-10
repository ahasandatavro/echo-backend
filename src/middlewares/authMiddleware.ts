import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { User } from '../interphases';
import { generateTokens, setTokenCookies } from '../utils/tokenUtils';
import { prisma } from '../models/prismaClient';

interface TokenPayload {
  rememberMe?: boolean;
  userId: number;
  role: string;
}

export const authenticateJWT = async (req: Request, res: Response, next: NextFunction) => {
  // First check for API key in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const apiKey = authHeader.split(' ')[1];
    
    try {
      // Verify API key and get user
      const user = await prisma.user.findFirst({
        where: { apiKey }
      });

      if (user) {
        // @ts-ignore: We are adding a custom property `user` to the `Request` object
        req.user = { userId: user.id, role: user.role };
        return next();
      }
    } catch (error) {
      // If API key verification fails, continue to JWT authentication
    }
  }

  // Fall back to JWT cookie authentication
  const accessToken = req.cookies.accessToken;
  const refreshToken = req.cookies.refreshToken;

  if (!accessToken && !refreshToken) {
    return res.status(401).send({message: 'Access denied. Invalid refresh token.', code: 'REFRESH_TOKEN_INVALID'});
  }

  try {
    // Try to verify access token
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET!) as TokenPayload;
    // @ts-ignore: We are adding a custom property `user` to the `Request` object
    req.user = decoded;
    next();
  } catch (error) {
    // Access token is invalid or expired
    if (!refreshToken) {
      return res.status(401).send({message: 'Access denied. Invalid refresh token.', code: 'REFRESH_TOKEN_INVALID'});
    }

    try {
      // Try to verify refresh token
      const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET!) as TokenPayload;

      // Get user from database
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId }
      });

      if (!user) {
        return res.status(401).send('Access denied. User not found.');
      }

      // Generate new tokens
      const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user.id, user.role, decoded.rememberMe);

      // Set new tokens in cookies
      setTokenCookies(res, newAccessToken, newRefreshToken, decoded.rememberMe);

      // @ts-ignore: We are adding a custom property `user` to the `Request` object
      req.user = { userId: user.id, role: user.role };
      next();
    } catch (refreshError) {
      return res.status(401).send({message: 'Access denied. Invalid refresh token.', code: 'REFRESH_TOKEN_INVALID'});
    }
  }
};
