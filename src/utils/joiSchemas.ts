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
const whatsappNumberPattern = /^[0-9]\d{11,14}$/;
const templateNamePattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

// 1. Chatbot Start Validation
export const chatbotStartValidation = Joi.object({
  whatsappNumber: Joi.string().pattern(whatsappNumberPattern).required()
    .messages({
      'string.pattern.base': 'WhatsApp number must be in international format without + or 00 and must be 12-15 digits including country code'
    }),
  chatbotId: Joi.alternatives().try(
    Joi.string().min(1),
    Joi.number().integer().positive()
  ).required()
    .messages({
      'alternatives.match': 'Chatbot ID must be either a string (name) or positive integer (ID)'
    })
});

// 2. Send Session Message Validation (Query Parameters)
export const sendSessionMessageValidation = Joi.object({
  message: Joi.string().min(1).max(4096).required()
    .messages({
      'string.min': 'Message text cannot be empty',
      'string.max': 'Message text cannot exceed 4096 characters'
    }),
  replyContextId: Joi.string().optional()
    .messages({
      'string.base': 'Reply context ID must be a string'
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
      is: 'text',
      then: Joi.forbidden().messages({
        'any.unknown': 'Media object is not allowed when type is "text". Please remove the media object.'
      }),
      otherwise: Joi.when('type', {
        is: Joi.string().valid('image', 'video', 'document'),
        then: Joi.object({
          url: Joi.string().uri().required().messages({
            'string.uri': 'Media URL must be a valid URI',
            'any.required': 'Media URL is required when type is image, video, or document'
          })
        }).required().messages({
          'any.required': 'Media object with URL is required when type is image, video, or document'
        }),
        otherwise: Joi.forbidden()
      })
    }),
    fileName: Joi.when('type', {
      is: 'document',
      then: Joi.string().optional(),
      otherwise: Joi.forbidden()
    })
  }).unknown().optional(),
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
  whatsappNumber: Joi.string().pattern(whatsappNumberPattern).required().messages({
    'string.pattern.base': 'WhatsApp number must be in international format without + or 00 and must be 12-15 digits including country code'
  }),
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
      'string.pattern.base': 'WhatsApp number must be in international format without + or 00 and must be 12-15 digits including country code'
    })
});

export const whatsappNumberQueryValidation = Joi.object({
  whatsappNumber: Joi.string().pattern(whatsappNumberPattern).required()
    .messages({
      'string.pattern.base': 'WhatsApp number must be in international format without + or 00 and must be 12-15 digits including country code',
      'any.required': 'WhatsApp number is required as a query parameter'
    })
});

// GET API Validations

// 1. Get Contacts Query Parameters Validation
export const getContactsQueryValidation = Joi.object({
  pageSize: Joi.number().integer().min(1).max(100).default(20).optional()
    .messages({
      'number.min': 'Page size must be at least 1',
      'number.max': 'Page size cannot exceed 100'
    }),
  pageNumber: Joi.number().integer().min(1).default(1).optional()
    .messages({
      'number.min': 'Page number must be at least 1'
    }),
  name: Joi.string().trim().min(1).max(255).optional()
    .messages({
      'string.min': 'Name filter cannot be empty',
      'string.max': 'Name filter cannot exceed 255 characters'
    }),
  attribute: Joi.string().custom((value, helpers) => {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        return helpers.error('any.invalid');
      }
      // Validate each filter object
      for (const filter of parsed) {
        if (!filter.operator || !filter.name || !filter.value) {
          return helpers.error('any.invalid');
        }
        if (!['contain', 'equals', 'starts_with', 'ends_with'].includes(filter.operator)) {
          return helpers.error('any.invalid');
        }
      }
      return value;
    } catch (error) {
      return helpers.error('any.invalid');
    }
  }).optional()
    .messages({
      'any.invalid': 'Attribute filter must be valid JSON array with objects containing operator, name, and value fields'
    }),
  createdDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$|^\d{2}-\d{2}-\d{4}$/).optional()
    .messages({
      'string.pattern.base': 'Created date must be in YYYY-MM-DD or MM-DD-YYYY format'
    })
});

// 2. Get Chatbots Query Parameters Validation
export const getChatbotsQueryValidation = Joi.object({
  phoneNumberId: Joi.string().min(1).required()
    .messages({
      'string.min': 'Phone Number ID cannot be empty'
    }),
  page: Joi.number().integer().min(1).default(1).optional()
    .messages({
      'number.min': 'Page number must be at least 1'
    }),
  limit: Joi.number().integer().min(1).max(100).default(10).optional()
    .messages({
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit cannot exceed 100'
    }),
  search: Joi.string().trim().min(1).max(255).optional()
    .messages({
      'string.min': 'Search term cannot be empty',
      'string.max': 'Search term cannot exceed 255 characters'
    })
});

// 3. Get Media Query Parameters Validation
export const getMediaQueryValidation = Joi.object({
  fileName: Joi.string().min(1).max(255).required()
    .messages({
      'string.min': 'File name cannot be empty',
      'string.max': 'File name cannot exceed 255 characters'
    })
});

// Additional GET API validations for other endpoints

// Get Messages Query Parameters Validation (for completeness)
export const getMessagesQueryValidation = Joi.object({
  page: Joi.number().integer().min(1).default(1).optional(),
  limit: Joi.number().integer().min(1).max(100).default(20).optional(),
  search: Joi.string().trim().min(1).max(255).optional(),
  messageType: Joi.string().valid('text', 'image', 'audio', 'video', 'document', 'template', 'interactive').optional(),
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().min(Joi.ref('startDate')).optional()
    .messages({
      'date.min': 'End date must be after start date'
    })
});

// Get Message Templates Query Parameters Validation
export const getMessageTemplatesQueryValidation = Joi.object({
  page: Joi.number().integer().min(1).default(1).optional(),
  limit: Joi.number().integer().min(1).max(100).default(20).optional(),
  search: Joi.string().trim().min(1).max(255).optional(),
  category: Joi.string().valid('MARKETING', 'UTILITY', 'AUTHENTICATION').optional(),
  status: Joi.string().valid('APPROVED', 'PENDING', 'REJECTED').optional(),
  language: Joi.string().pattern(/^[a-z]{2}_[A-Z]{2}$/).optional()
    .messages({
      'string.pattern.base': 'Language must be in ISO format (e.g., en_US, es_ES)'
    })
});

// Add Contact Body Validation
export const addContactValidation = Joi.object({
  name: Joi.string().min(1).max(255).optional()
    .messages({
      'string.min': 'Name cannot be empty',
      'string.max': 'Name cannot exceed 255 characters'
    }),
  source: Joi.string().max(100).optional()
    .messages({
      'string.max': 'Source cannot exceed 100 characters'
    }),
  tags: Joi.array().items(Joi.string()).optional()
    .messages({
      'array.base': 'Tags must be an array of strings'
    }),
  attributes: Joi.alternatives().try(
    Joi.string().custom((value, helpers) => {
      try {
        JSON.parse(value);
        return value;
      } catch (error) {
        return helpers.error('any.invalid');
      }
    }),
    Joi.object().pattern(Joi.string(), Joi.any())
  ).optional()
    .messages({
      'any.invalid': 'Attributes must be valid JSON string or object',
      'object.base': 'Attributes must be an object with key-value pairs'
    }),
  allowBroadcast: Joi.boolean().optional()
    .messages({
      'boolean.base': 'allowBroadcast must be a boolean value'
    }),
  allowSMS: Joi.boolean().optional()
    .messages({
      'boolean.base': 'allowSMS must be a boolean value'
    })
});