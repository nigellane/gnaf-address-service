import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../types/api';

export interface AuthenticatedRequest extends Request {
  apiKey?: string;
  clientId?: string;
}

const validApiKeys = new Set([
  process.env.API_KEY_1 || 'dev-key-1',
  process.env.API_KEY_2 || 'dev-key-2',
  process.env.MASTER_API_KEY || 'master-dev-key'
]);

export const authenticateApiKey = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey) {
    const error: ApiError = {
      error: {
        code: 'MISSING_API_KEY',
        message: 'API key is required. Please provide X-API-Key header.',
        requestId: generateRequestId()
      }
    };
    res.status(401).json(error);
    return;
  }
  
  if (!validApiKeys.has(apiKey)) {
    const error: ApiError = {
      error: {
        code: 'INVALID_API_KEY',
        message: 'Invalid API key provided.',
        requestId: generateRequestId()
      }
    };
    res.status(401).json(error);
    return;
  }
  
  req.apiKey = apiKey;
  req.clientId = generateClientId(apiKey);
  next();
};

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

function generateClientId(apiKey: string): string {
  return `client_${apiKey.substring(0, 8)}`;
}