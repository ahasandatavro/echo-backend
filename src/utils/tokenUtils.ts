import jwt, { SignOptions } from 'jsonwebtoken';
import { Response } from 'express';

// Helper function to convert time string to milliseconds
const timeToMs = (timeStr: string): number => {
  const unit = timeStr.slice(-1);
  const value = parseInt(timeStr.slice(0, -1));

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 15 * 60 * 1000; // Default to 15 minutes
  }
};

export const generateTokens = (userId: number, role: string, rememberMe: boolean = false) => {
  const jwtOptions: SignOptions = {
    expiresIn: parseInt(process.env.ACCESS_TOKEN_EXPIRY || '300000') // 5 minutes in milliseconds
  };
  const refreshOptions: SignOptions = {
    expiresIn: rememberMe
      ? parseInt(process.env.REMEMBER_ME_REFRESH_TOKEN_EXPIRY || '2592000000') // 30 days in milliseconds
      : parseInt(process.env.REFRESH_TOKEN_EXPIRY || '1500000') // 7 days in milliseconds
  };

  const accessToken = jwt.sign(
    { userId, role },
    process.env.JWT_SECRET || 'default-secret',
    jwtOptions
  );

  const refreshToken = jwt.sign(
    { userId, role, rememberMe },
    process.env.REFRESH_TOKEN_SECRET || 'default-refresh-secret',
    refreshOptions
  );

  return { accessToken, refreshToken };
};

export const setTokenCookies = (res: Response, accessToken: string, refreshToken: string, rememberMe: boolean = false) => {
  const isLocalhost = process.env.NODE_ENV !== 'production';

  const cookieOptions = {
    httpOnly: true,
    secure: false, // Set to false for localhost
    sameSite: 'none' as const,
    path: '/',
    domain: isLocalhost ? undefined : process.env.COOKIE_DOMAIN || '.ondigitalocean.app', // Use env variable with fallback
    maxAge: undefined // Remove maxAge from base options
  };

  // Set access token cookie
  res.cookie('accessToken', accessToken, {
    ...cookieOptions,
    maxAge: parseInt(process.env.ACCESS_TOKEN_EXPIRY || '900000') // 15 minutes in milliseconds
  });

  // Set refresh token cookie
  res.cookie('refreshToken', refreshToken, {
    ...cookieOptions,
    maxAge: rememberMe
      ? parseInt(process.env.REMEMBER_ME_REFRESH_TOKEN_EXPIRY || '2592000000') // 30 days in milliseconds
      : parseInt(process.env.REFRESH_TOKEN_EXPIRY || '1500000') // 25 min in milliseconds
  });
};
