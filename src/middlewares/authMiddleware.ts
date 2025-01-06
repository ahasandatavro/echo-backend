import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { User } from '../interphases';

export const authenticateJWT = (req: Request, res: Response, next: NextFunction) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) return res.status(401).send('Access denied');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as User;
    // @ts-ignore: We are adding a custom property `user` to the `Request` object
    req.user = decoded; // Attach the decoded user to req.user
    next();
  } catch (error) {
    res.status(400).send('Invalid token');
  }
};
