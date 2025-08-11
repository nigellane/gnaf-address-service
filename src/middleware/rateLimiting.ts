import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { ApiError } from '../types/api';

interface RateLimitEntry {
  requests: number;
  resetTime: number;
}

// Configuration constants
const RATE_LIMIT_CONFIG = {
  MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000'),
  WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  CLEANUP_INTERVAL_MS: parseInt(process.env.RATE_LIMIT_CLEANUP_INTERVAL || '300000') // 5 minutes
} as const;

class RateLimiter {
  private clients = new Map<string, RateLimitEntry>();
  private readonly maxRequests = RATE_LIMIT_CONFIG.MAX_REQUESTS;
  private readonly windowMs = RATE_LIMIT_CONFIG.WINDOW_MS;
  private readonly cleanupInterval = RATE_LIMIT_CONFIG.CLEANUP_INTERVAL_MS;
  
  constructor() {
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }
  
  private cleanup(): void {
    const now = Date.now();
    for (const [clientId, entry] of this.clients.entries()) {
      if (entry.resetTime < now) {
        this.clients.delete(clientId);
      }
    }
  }
  
  check(clientId: string): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const entry = this.clients.get(clientId);
    
    if (!entry || entry.resetTime < now) {
      const newEntry: RateLimitEntry = {
        requests: 1,
        resetTime: now + this.windowMs
      };
      this.clients.set(clientId, newEntry);
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetTime: newEntry.resetTime
      };
    }
    
    if (entry.requests >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime
      };
    }
    
    entry.requests++;
    return {
      allowed: true,
      remaining: this.maxRequests - entry.requests,
      resetTime: entry.resetTime
    };
  }
}

const rateLimiter = new RateLimiter();

export const rateLimit = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const clientId = req.clientId || 'unknown';
  const result = rateLimiter.check(clientId);
  
  res.set({
    'X-RateLimit-Limit': RATE_LIMIT_CONFIG.MAX_REQUESTS.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000).toString()
  });
  
  if (!result.allowed) {
    const error: ApiError = {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Maximum ${RATE_LIMIT_CONFIG.MAX_REQUESTS} requests per ${RATE_LIMIT_CONFIG.WINDOW_MS / 60000} minutes.`,
        details: {
          limit: RATE_LIMIT_CONFIG.MAX_REQUESTS,
          remaining: 0,
          resetTime: new Date(result.resetTime).toISOString()
        },
        requestId: generateRequestId()
      }
    };
    res.status(429).json(error);
    return;
  }
  
  next();
};

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}