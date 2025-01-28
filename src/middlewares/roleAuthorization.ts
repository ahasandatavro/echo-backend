import { Request, Response, NextFunction } from 'express';
import { User } from '../interphases';
export const authorizeRole = (roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
  //@ts-ignore
  const userRole = req.user?.role;
  // if ((userRole)!=="SUPERADMIN") {
  //   return res.status(403).send('Access denied');
  // }
  next();
};
