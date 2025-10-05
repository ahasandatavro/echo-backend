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

// WhatsApp number pattern validation
const whatsappNumberPattern = /^[1-9]\d{1,14}$/;
const templateNamePattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

// 1. Chatbot Start Validation
export const chatbotStartValidation = Joi.object({
  whatsappNumber: Joi.string().pattern(whatsappNumberPattern).required()
    .messages({
      'string.pattern.base': 'WhatsApp number must be in international format without + or 00'
    }),
  chatbotId: Joi.alternatives().try(
    Joi.string().min(1),
    Joi.number().integer().positive()
  ).required()
    .messages({
      'alternatives.match': 'Chatbot ID must be either a string (name) or positive integer (ID)'
    })
});

// 2. Send Session Message Validation
export const sendSessionMessageValidation = Joi.object({
  text: Joi.string().min(1).max(4096).required()
    .messages({
      'string.min': 'Message text cannot be empty',
      'string.max': 'Message text cannot exceed 4096 characters'
    }),
  fileUrl: Joi.string().uri().optional()
    .messages({
      'string.uri': 'File URL must be a valid URI'
    })
});

// 3. Send Template Message Validation
export const sendTemplateMessageValidation = Joi.object({
  template_name: Joi.string().pattern(templateNamePattern).min(1).max(512).required()
    .messages({
      'string.pattern.base': 'Template name must start with a letter and contain only alphanumeric characters, underscores, and hyphens',
      'string.max': 'Template name cannot exceed 512 characters'
    }),
  broadcast_name: Joi.string().max(255).optional(),
  templateParameters: Joi.object().pattern(Joi.string(), Joi.string()).optional()
    .messages({
      'object.pattern.match': 'Template parameters must be key-value pairs of strings'
    }),
  fileUrl: Joi.string().uri().optional()
});

// 4. Send Template Messages Validation
export const sendTemplateMessagesValidation = Joi.object({
  template_name: Joi.string().pattern(templateNamePattern).min(1).max(512).required(),
  broadcast_name: Joi.string().max(255).optional(),
  contacts: Joi.array().min(1).items(
    Joi.alternatives().try(
      Joi.string().pattern(whatsappNumberPattern),
      Joi.object({
        whatsappNumber: Joi.string().pattern(whatsappNumberPattern).required(),
        customParams: Joi.array().items(Joi.object()).optional()
      })
    )
  ).required()
    .messages({
      'array.min': 'At least one contact is required',
      'alternatives.match': 'Each contact must be either a WhatsApp number string or an object with whatsappNumber'
    }),
  fileUrl: Joi.string().uri().optional()
});

// 5. Interactive Button Message Validation
export const sendInteractiveButtonMessageValidation = Joi.object({
  header: Joi.object({
    type: Joi.string().valid('text', 'image', 'video', 'document').required(),
    text: Joi.when('type', {
      is: 'text',
      then: Joi.string().max(60).required(),
      otherwise: Joi.forbidden()
    }),
    media: Joi.when('type', {
      is: Joi.string().valid('image', 'video', 'document'),
      then: Joi.object({
        url: Joi.string().uri().required()
      }).required(),
      otherwise: Joi.forbidden()
    }),
    fileName: Joi.when('type', {
      is: 'document',
      then: Joi.string().optional(),
      otherwise: Joi.forbidden()
    })
  }).optional(),
  body: Joi.string().min(1).max(1024).required()
    .messages({
      'string.min': 'Body text cannot be empty',
      'string.max': 'Body text cannot exceed 1024 characters'
    }),
  footer: Joi.string().max(60).optional()
    .messages({
      'string.max': 'Footer cannot exceed 60 characters'
    }),
  buttons: Joi.array().min(1).max(3).items(
    Joi.object({
      text: Joi.string().min(1).max(20).required()
        .messages({
          'string.min': 'Button text cannot be empty',
          'string.max': 'Button text cannot exceed 20 characters'
        })
    })
  ).required()
    .messages({
      'array.min': 'At least 1 button is required',
      'array.max': 'Maximum 3 buttons are allowed'
    })
});

// 6. Interactive List Message Validation
export const sendInteractiveListMessageValidation = Joi.object({
  header: Joi.string().max(60).optional()
    .messages({
      'string.max': 'Header cannot exceed 60 characters'
    }),
  body: Joi.string().min(1).max(1024).required()
    .messages({
      'string.min': 'Body text cannot be empty',
      'string.max': 'Body text cannot exceed 1024 characters'
    }),
  footer: Joi.string().max(60).optional()
    .messages({
      'string.max': 'Footer cannot exceed 60 characters'
    }),
  buttonText: Joi.string().min(1).max(20).required()
    .messages({
      'string.min': 'Button text cannot be empty',
      'string.max': 'Button text cannot exceed 20 characters'
    }),
  sections: Joi.array().min(1).max(10).items(
    Joi.object({
      title: Joi.string().min(1).max(24).required()
        .messages({
          'string.min': 'Section title cannot be empty',
          'string.max': 'Section title cannot exceed 24 characters'
        }),
      rows: Joi.array().min(1).max(10).items(
        Joi.object({
          id: Joi.string().min(1).max(200).required()
            .messages({
              'string.min': 'Row ID cannot be empty',
              'string.max': 'Row ID cannot exceed 200 characters'
            }),
          title: Joi.string().min(1).max(24).required()
            .messages({
              'string.min': 'Row title cannot be empty',
              'string.max': 'Row title cannot exceed 24 characters'
            }),
          description: Joi.string().max(72).optional()
            .messages({
              'string.max': 'Row description cannot exceed 72 characters'
            })
        })
      ).required()
        .messages({
          'array.min': 'At least 1 row is required per section',
          'array.max': 'Maximum 10 rows are allowed per section'
        })
    })
  ).required()
    .messages({
      'array.min': 'At least 1 section is required',
      'array.max': 'Maximum 10 sections are allowed'
    })
});

// 7. Assign Operator Validation (query parameters)
export const assignOperatorValidation = Joi.object({
  whatsappNumber: Joi.string().pattern(whatsappNumberPattern).required()
    .messages({
      'string.pattern.base': 'WhatsApp number must be in international format without + or 00'
    }),
  email: Joi.string().email().optional()
    .messages({
      'string.email': 'Email must be a valid email address'
    })
});

// 8. Assign Team Validation (query parameters)
export const assignTeamValidation = Joi.object({
  whatsappNumber: Joi.string().pattern(whatsappNumberPattern).required(),
  teams: Joi.alternatives().try(
    Joi.string().min(1),
    Joi.array().items(Joi.string().min(1)).min(1)
  ).required()
    .messages({
      'alternatives.match': 'Teams must be either a string or array of strings',
      'array.min': 'At least one team is required'
    })
});

// 9. Create Order Validation
export const createOrderValidation = Joi.object({
  amount: Joi.number().positive().required()
    .messages({
      'number.positive': 'Amount must be a positive number'
    }),
  currency: Joi.string().valid('INR', 'USD').default('INR').optional(),
  packageName: Joi.string().min(1).required()
    .messages({
      'string.min': 'Package name cannot be empty'
    }),
  packageDuration: Joi.string().valid('monthly', 'yearly').required()
    .messages({
      'any.only': 'Package duration must be either monthly or yearly'
    })
});

// 10. Verify Payment Validation
export const verifyPaymentValidation = Joi.object({
  paymentId: Joi.string().min(1).required()
    .messages({
      'string.min': 'Payment ID cannot be empty'
    }),
  orderId: Joi.string().min(1).required()
    .messages({
      'string.min': 'Order ID cannot be empty'
    }),
  signature: Joi.string().min(1).required()
    .messages({
      'string.min': 'Signature cannot be empty'
    })
});

// Path parameter validations
export const phoneNumberIdValidation = Joi.object({
  phoneNumberId: Joi.string().min(1).required()
    .messages({
      'string.min': 'Phone Number ID cannot be empty'
    })
});

export const whatsappNumberPathValidation = Joi.object({
  whatsappNumber: Joi.string().pattern(whatsappNumberPattern).required()
    .messages({
      'string.pattern.base': 'WhatsApp number must be in international format without + or 00'
    })
});
