import Joi from 'joi';

export const nodeValidation = Joi.object({
  chatId: Joi.string().required(),
  nodeId: Joi.string().required(),
  data: Joi.object().required(),
});

export const billingInformationValidation = Joi.object({
  email: Joi.string().email().required(),
  firstName: Joi.string().min(1).max(100).required(),
  lastName: Joi.string().min(1).max(100).required(),
  company: Joi.string().max(200).optional(),
  countryCode: Joi.string().min(1).max(10).required(),
  mobileNumber: Joi.string().min(5).max(20).required(),
});
