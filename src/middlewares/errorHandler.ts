import { Request, Response, NextFunction } from 'express';
import { ObjectSchema } from 'joi';

export const validateRequest = (schema: ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).send({
        message: error.details[0].message,
        field: error.details[0].path.join('.'),
        type: 'validation_error'
      });
    }
    next();
  };
};

export const validateQueryParams = (schema: ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.unknown().validate(req.query);
    if (error) {
      return res.status(400).send({
        message: error.details[0].message,
        field: error.details[0].path.join('.'),
        type: 'validation_error'
      });
    }
    next();
  };
};

export const validatePathParams = (schema: ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.unknown().validate(req.params);
    if (error) {
      return res.status(400).send({
        message: error.details[0].message,
        field: error.details[0].path.join('.'),
        type: 'validation_error'
      });
    }
    next();
  };
};
