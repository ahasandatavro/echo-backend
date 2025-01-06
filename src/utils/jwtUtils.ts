import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

export const authenticateJWT = (req: Request, res: Response, next: NextFunction) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) return res.status(401).send('Access denied');

  try {
    const verified = jwt.verify(token, `${process.env.JWT_SECRET}`);
      //@ts-ignore
    req.user = verified;
    next();
  } catch {
    res.status(400).send('Invalid token');
  }
};
