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

// Authentication middleware without subscription check (for payment routes)
export const authenticateJWTWithoutSubscription = async (req: Request, res: Response, next: NextFunction) => {
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

// Authentication middleware with subscription check (for protected routes)
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
        
        // Check for active subscription
        const activeSubscription = await prisma.packageSubscription.findFirst({
          where: {
            userId: user.id,
            isActive: true,
            startDate: {
              lte: new Date() // Start date is in the past or today
            },
            endDate: {
              gte: new Date() // End date is in the future or today
            }
          }
        });

        if (!activeSubscription) {
          return res.status(403).json({ 
            error: 'No active subscription found',
            message: 'Your subscription has expired or is not active. Please renew your subscription to continue.',
            code: 'SUBSCRIPTION_EXPIRED'
          });
        }
        // @ts-ignore: We are adding a custom property `user` to the `Request` object
        req.user.activeSubscription = activeSubscription;
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
      
      // Get user from database to check email verification status
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId }
      });

      if (!user) {
        return res.status(401).send('Access denied. User not found.');
      }

      // @ts-ignore: We are adding a custom property `user` to the `Request` object
      req.user = decoded;
      
      // Check for active subscription
      const activeSubscription = await prisma.packageSubscription.findFirst({
        where: {
          userId: decoded.userId,
          isActive: true,
          startDate: {
            lte: new Date() // Start date is in the past or today
          },
          endDate: {
            gte: new Date() // End date is in the future or today
          }
        }
      });

      if (!activeSubscription) {
        return res.status(403).json({ 
          error: 'No active subscription found',
          message: 'Your subscription has expired or is not active. Please renew your subscription to continue.',
          code: 'SUBSCRIPTION_EXPIRED'
        });
      }
      // @ts-ignore: We are adding a custom property `user` to the `Request` object
      req.user.activeSubscription = activeSubscription;
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
      
      // Check for active subscription
      const activeSubscription = await prisma.packageSubscription.findFirst({
        where: {
          userId: user.id,
          isActive: true,
          startDate: {
            lte: new Date() // Start date is in the past or today
          },
          endDate: {
            gte: new Date() // End date is in the future or today
          }
        }
      });

      if (!activeSubscription) {
        return res.status(403).json({ 
          error: 'No active subscription found',
          message: 'Your subscription has expired or is not active. Please renew your subscription to continue.',
          code: 'SUBSCRIPTION_EXPIRED'
        });
      }
      // @ts-ignore: We are adding a custom property `user` to the `Request` object
      req.user.activeSubscription = activeSubscription;
      next();
    } catch (refreshError) {
      return res.status(401).send({message: 'Access denied. Invalid refresh token.', code: 'REFRESH_TOKEN_INVALID'});
    }
  }
};

export const checkSubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as { userId: number };
    
    if (!user || !user.userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Check for active subscription within current date range
    const activeSubscription = await prisma.packageSubscription.findFirst({
      where: {
        userId: user.userId,
        isActive: true,
        startDate: {
          lte: new Date() // Start date is in the past or today
        },
        endDate: {
          gte: new Date() // End date is in the future or today
        }
      }
    });

    if (!activeSubscription) {
      return res.status(403).json({ 
        error: 'No active subscription found',
        message: 'Your subscription has expired or is not active. Please renew your subscription to continue.',
        code: 'SUBSCRIPTION_EXPIRED'
      });
    }

    next();
  } catch (error) {
    console.error('Error checking subscription:', error);
    return res.status(500).json({ error: 'Internal server error while checking subscription' });
  }
};
