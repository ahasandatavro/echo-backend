
import swaggerJsdoc from 'swagger-jsdoc';

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Express API',
            version: '1.0.0',
        },
    },
    apis: ['./src/routes/*.ts'], // Files containing annotations for the OpenAPI Specification
};

export const swaggerSpec = swaggerJsdoc(options);
