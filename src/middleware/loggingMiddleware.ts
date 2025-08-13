/**
 * Enhanced Logging Middleware with Correlation IDs
 * Integrates with AsyncLocalStorage for distributed tracing
 */

import { Request, Response, NextFunction } from 'express';
import Logger, { requestContext } from '../utils/logger';

interface LoggedRequest extends Request {
  startTime?: number;
  requestId?: string;
  userId?: string;
  sessionId?: string;
  correlationId?: string;
}

interface LoggedResponse extends Response {
  responseSize?: number;
}

/**
 * Middleware to initialize request context and correlation IDs
 */
export const initializeRequestContext = (
  req: LoggedRequest,
  res: LoggedResponse,
  next: NextFunction
): void => {
  // Generate request identifiers
  req.requestId = Logger.generateRequestId();
  req.startTime = Date.now();
  
  // Extract user context if available
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      // In a real implementation, you'd decode the JWT token
      // For now, we'll use a placeholder
      req.userId = 'authenticated-user';
    } catch (error) {
      // Invalid token, continue without user ID
    }
  }
  
  // Extract session information
  req.sessionId = req.headers['x-session-id'] as string || undefined;
  req.correlationId = req.headers['x-correlation-id'] as string || req.requestId;
  
  // Set up request context for AsyncLocalStorage
  const context = {
    requestId: req.requestId,
    userId: req.userId,
    sessionId: req.sessionId,
    traceId: Logger.generateTraceId(),
    endpoint: req.path,
    method: req.method,
    ip: req.ip || req.connection.remoteAddress
  };
  
  // Add correlation ID to response headers for client tracking
  res.setHeader('X-Correlation-ID', req.correlationId);
  res.setHeader('X-Request-ID', req.requestId);
  
  // Run the rest of the request within the context
  requestContext.run(context, () => {
    next();
  });
};

/**
 * Middleware to log incoming requests
 */
export const logIncomingRequest = (
  req: LoggedRequest,
  res: LoggedResponse,
  next: NextFunction
): void => {
  const logger = Logger.getInstance();
  
  // Log the incoming request
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    query: req.query,
    userAgent: req.headers['user-agent'],
    contentLength: req.headers['content-length'],
    contentType: req.headers['content-type'],
    referer: req.headers.referer,
    requestStart: new Date().toISOString()
  });
  
  // Log body for non-GET requests (with sanitization)
  if (req.method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
    const sanitizedBody = sanitizeRequestBody(req.body);
    logger.debug('Request body', { body: sanitizedBody });
  }
  
  next();
};

/**
 * Middleware to log outgoing responses
 */
export const logOutgoingResponse = (
  req: LoggedRequest,
  res: LoggedResponse,
  next: NextFunction
): void => {
  const logger = Logger.getInstance();
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Override res.send to capture response size
  res.send = function(body?: any) {
    res.responseSize = Buffer.byteLength(body || '', 'utf8');
    return originalSend.call(this, body);
  };
  
  // Override res.json to capture response size
  res.json = function(body?: any) {
    const jsonBody = JSON.stringify(body);
    res.responseSize = Buffer.byteLength(jsonBody, 'utf8');
    return originalJson.call(this, body);
  };
  
  // Log response when the response finishes
  res.on('finish', () => {
    const duration = req.startTime ? Date.now() - req.startTime : 0;
    const isError = res.statusCode >= 400;
    const isSlowResponse = duration > 1000; // 1 second threshold
    
    const logLevel = isError ? 'error' : isSlowResponse ? 'warn' : 'info';
    const logMessage = `${req.method} ${req.path} - ${res.statusCode}`;
    
    const responseData = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      responseSize: res.responseSize,
      requestEnd: new Date().toISOString(),
      responseType: res.getHeader('content-type')
    };
    
    logger.log(logLevel, logMessage, responseData);
    
    // Log performance metrics for slow responses
    if (isSlowResponse) {
      Logger.logPerformance({
        operation: `${req.method} ${req.path}`,
        duration,
        status: isError ? 'error' : 'warning',
        details: {
          statusCode: res.statusCode,
          responseSize: res.responseSize,
          endpoint: req.path
        }
      });
    }
    
    // Log error details for error responses
    if (isError) {
      logger.error('Request resulted in error', {
        statusCode: res.statusCode,
        path: req.path,
        method: req.method,
        duration,
        errorResponse: true
      });
    }
  });
  
  next();
};

/**
 * Middleware to handle uncaught errors in request processing
 */
export const errorLoggingMiddleware = (
  error: Error,
  req: LoggedRequest,
  res: LoggedResponse,
  next: NextFunction
): void => {
  const duration = req.startTime ? Date.now() - req.startTime : 0;
  
  // Log the error with full context
  Logger.logError(error, {
    path: req.path,
    method: req.method,
    query: req.query,
    body: sanitizeRequestBody(req.body),
    userAgent: req.headers['user-agent'],
    duration,
    uncaughtError: true,
    errorInMiddleware: true
  });
  
  // Log performance data for failed requests
  Logger.logPerformance({
    operation: `${req.method} ${req.path}`,
    duration,
    status: 'error',
    details: {
      errorName: error.name,
      errorMessage: error.message,
      endpoint: req.path
    }
  });
  
  next(error);
};

/**
 * Middleware for security event logging
 */
export const securityLoggingMiddleware = (
  req: LoggedRequest,
  res: LoggedResponse,
  next: NextFunction
): void => {
  // Check for potential security issues
  const suspiciousPatterns = [
    /\b(union|select|insert|update|delete|drop|exec|script)\b/i,
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/i,
    /vbscript:/i,
    /on\w+\s*=/i
  ];
  
  const checkForSuspiciousContent = (data: any): boolean => {
    if (!data) return false;
    
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    return suspiciousPatterns.some(pattern => pattern.test(dataStr));
  };
  
  // Check query parameters
  if (checkForSuspiciousContent(req.query)) {
    Logger.logSecurityEvent('suspicious_query_params', {
      path: req.path,
      query: req.query,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
  }
  
  // Check request body
  if (req.body && checkForSuspiciousContent(req.body)) {
    Logger.logSecurityEvent('suspicious_request_body', {
      path: req.path,
      bodyKeys: Object.keys(req.body),
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
  }
  
  // Check for suspicious headers
  const suspiciousHeaders = ['x-forwarded-for', 'x-real-ip', 'x-originating-ip'];
  suspiciousHeaders.forEach(header => {
    const value = req.headers[header];
    if (value && typeof value === 'string' && value.includes('..')) {
      Logger.logSecurityEvent('suspicious_header', {
        header,
        value,
        ip: req.ip,
        path: req.path
      });
    }
  });
  
  next();
};

/**
 * Sanitize request body for logging (remove sensitive information)
 */
function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }
  
  const sensitiveFields = [
    'password', 'passwd', 'pwd', 'secret', 'token', 'key', 'auth',
    'authorization', 'credential', 'api_key', 'apikey', 'access_token',
    'refresh_token', 'jwt', 'session', 'cookie'
  ];
  
  const sanitized = { ...body };
  
  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '***REDACTED***';
    }
  }
  
  // Also check nested objects
  for (const key in sanitized) {
    if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeRequestBody(sanitized[key]);
    }
  }
  
  return sanitized;
}

/**
 * Business metrics logging middleware
 */
export const businessMetricsMiddleware = (
  req: LoggedRequest,
  res: LoggedResponse,
  next: NextFunction
): void => {
  res.on('finish', () => {
    // Log business metrics based on endpoint
    const endpoint = req.path;
    const statusCode = res.statusCode;
    const isSuccess = statusCode < 400;
    
    // Address validation metrics
    if (endpoint.includes('/validate') && isSuccess) {
      Logger.logBusinessMetric('address_validation_success', 1, 'count', {
        endpoint,
        method: req.method
      });
    } else if (endpoint.includes('/validate') && !isSuccess) {
      Logger.logBusinessMetric('address_validation_failure', 1, 'count', {
        endpoint,
        method: req.method,
        statusCode: statusCode.toString()
      });
    }
    
    // Geocoding metrics
    if (endpoint.includes('/geocode') && isSuccess) {
      Logger.logBusinessMetric('geocoding_success', 1, 'count', {
        endpoint,
        method: req.method
      });
    } else if (endpoint.includes('/geocode') && !isSuccess) {
      Logger.logBusinessMetric('geocoding_failure', 1, 'count', {
        endpoint,
        method: req.method,
        statusCode: statusCode.toString()
      });
    }
    
    // Search metrics
    if (endpoint.includes('/search') && isSuccess) {
      Logger.logBusinessMetric('address_search_success', 1, 'count', {
        endpoint,
        method: req.method
      });
    }
    
    // API usage metrics
    Logger.logBusinessMetric('api_request_total', 1, 'count', {
      endpoint,
      method: req.method,
      statusCode: statusCode.toString()
    });
  });
  
  next();
};

export default {
  initializeRequestContext,
  logIncomingRequest,
  logOutgoingResponse,
  errorLoggingMiddleware,
  securityLoggingMiddleware,
  businessMetricsMiddleware
};