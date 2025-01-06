import Joi from 'joi';

export const nodeValidation = Joi.object({
  chatId: Joi.string().required(),
  nodeId: Joi.string().required(),
  data: Joi.object().required(),
});
