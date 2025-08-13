import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { AsyncLocalStorage } from 'async_hooks';

interface LogContext {
  requestId?: string;
  userId?: string;
  sessionId?: string;
  operationId?: string;
  traceId?: string;
  endpoint?: string;
  method?: string;
  ip?: string;
}

interface PerformanceLogData {
  operation: string;
  duration: number;
  status: 'success' | 'error' | 'warning';
  details?: Record<string, any>;
}

// AsyncLocalStorage for request context
export const requestContext = new AsyncLocalStorage<LogContext>();

class Logger {
  private static instance: winston.Logger;
  private static logLevel = process.env.LOG_LEVEL || 'warn';
  private static isProduction = process.env.NODE_ENV === 'production';

  public static getInstance(): winston.Logger {
    if (!Logger.instance) {
      Logger.instance = winston.createLogger({
        level: Logger.logLevel,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          winston.format.errors({ stack: true }),
          Logger.isProduction 
            ? winston.format.json() 
            : winston.format.combine(
                winston.format.colorize({ all: true }),
                winston.format.printf(Logger.formatDevLog)
              )
        ),
        transports: Logger.createTransports(),
        defaultMeta: {
          service: 'gnaf-address-service',
          version: process.env.npm_package_version || '1.0.0',
          environment: process.env.NODE_ENV || 'development',
          hostname: process.env.HOSTNAME || require('os').hostname(),
          pid: process.pid
        },
        exceptionHandlers: [
          new winston.transports.File({ filename: 'logs/exceptions.log' })
        ],
        rejectionHandlers: [
          new winston.transports.File({ filename: 'logs/rejections.log' })
        ]
      });

      // Add request context to all log entries
      Logger.instance.format = winston.format.combine(
        Logger.instance.format,
        winston.format((info) => {
          const context = requestContext.getStore();
          if (context) {
            return { ...info, ...context };
          }
          return info;
        })()
      );
    }

    return Logger.instance;
  }

  private static createTransports(): winston.transport[] {
    const transports: winston.transport[] = [
      new winston.transports.Console({
        level: Logger.logLevel,
        handleExceptions: true,
        handleRejections: true
      })
    ];

    // Add file transports in production or when LOG_TO_FILE is enabled
    if (Logger.isProduction || process.env.LOG_TO_FILE === 'true') {
      // Create logs directory if it doesn't exist
      const fs = require('fs');
      if (!fs.existsSync('logs')) {
        fs.mkdirSync('logs');
      }

      transports.push(
        // Application logs
        new winston.transports.File({
          filename: 'logs/application.log',
          level: 'info',
          maxsize: 50 * 1024 * 1024, // 50MB
          maxFiles: 5,
          tailable: true
        }),
        // Error logs
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          maxsize: 50 * 1024 * 1024, // 50MB
          maxFiles: 5,
          tailable: true
        }),
        // Performance logs
        new winston.transports.File({
          filename: 'logs/performance.log',
          level: 'info',
          maxsize: 50 * 1024 * 1024, // 50MB
          maxFiles: 3,
          tailable: true
        })
      );
    }

    return transports;
  }

  private static formatDevLog(info: winston.Logform.TransformableInfo): string {
    const { timestamp, level, message, service, requestId, duration, operation, ...meta } = info;
    
    // Build the log line
    let logLine = `${timestamp} [${level}]`;
    
    if (service && service !== 'gnaf-address-service') {
      logLine += ` [${service}]`;
    }
    
    if (requestId && typeof requestId === 'string') {
      logLine += ` [${requestId.substring(0, 8)}...]`;
    }

    if (operation && duration !== undefined) {
      logLine += ` [${operation}:${duration}ms]`;
    }
    
    logLine += ` ${message}`;
    
    // Add metadata if present
    const metaKeys = Object.keys(meta);
    if (metaKeys.length > 0) {
      const cleanMeta = metaKeys.reduce((acc, key) => {
        if (!['timestamp', 'level', 'message', 'service', 'version', 'environment', 'hostname', 'pid'].includes(key)) {
          acc[key] = meta[key];
        }
        return acc;
      }, {} as Record<string, any>);
      
      if (Object.keys(cleanMeta).length > 0) {
        logLine += ` ${JSON.stringify(cleanMeta)}`;
      }
    }
    
    return logLine;
  }

  public static createServiceLogger(serviceName: string): winston.Logger {
    return Logger.getInstance().child({ 
      service: serviceName,
      serviceContext: serviceName 
    });
  }

  public static createRequestLogger(context: LogContext): winston.Logger {
    return Logger.getInstance().child(context);
  }

  public static generateRequestId(): string {
    return uuidv4();
  }

  public static generateTraceId(): string {
    return uuidv4();
  }

  public static generateOperationId(): string {
    return uuidv4();
  }

  // Method to run code within a request context
  public static withContext<T>(context: LogContext, fn: () => T): T {
    return requestContext.run(context, fn);
  }

  // Method to run async code within a request context
  public static async withContextAsync<T>(context: LogContext, fn: () => Promise<T>): Promise<T> {
    return requestContext.run(context, fn);
  }

  // Performance logging helper
  public static logPerformance(data: PerformanceLogData): void {
    const logger = Logger.getInstance();
    const level = data.status === 'error' ? 'error' : 
                 data.status === 'warning' ? 'warn' : 'info';
    
    logger.log(level, `Performance: ${data.operation}`, {
      operation: data.operation,
      duration: data.duration,
      status: data.status,
      performanceLog: true,
      ...data.details
    });
  }

  // Structured error logging
  public static logError(error: Error, context?: Record<string, any>): void {
    const logger = Logger.getInstance();
    logger.error('Application error', {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      errorLog: true,
      ...context
    });
  }

  // Security event logging
  public static logSecurityEvent(event: string, details?: Record<string, any>): void {
    const logger = Logger.getInstance();
    logger.warn(`Security event: ${event}`, {
      securityEvent: event,
      securityLog: true,
      timestamp: new Date().toISOString(),
      ...details
    });
  }

  // Business metrics logging
  public static logBusinessMetric(metric: string, value: number, unit?: string, tags?: Record<string, string>): void {
    const logger = Logger.getInstance();
    logger.info(`Business metric: ${metric}`, {
      metricName: metric,
      metricValue: value,
      metricUnit: unit,
      metricTags: tags,
      businessMetric: true,
      metricLog: true
    });
  }

  // Database query logging
  public static logSlowQuery(query: string, duration: number, params?: any[]): void {
    const logger = Logger.getInstance();
    logger.warn('Slow database query detected', {
      queryType: 'slow',
      query: Logger.sanitizeQuery(query),
      duration,
      paramCount: params?.length || 0,
      slowQueryLog: true
    });
  }

  // Cache miss logging for performance analysis
  public static logCacheMiss(cacheKey: string, operation: string, duration?: number): void {
    const logger = Logger.getInstance();
    logger.debug('Cache miss', {
      cacheKey: Logger.sanitizeCacheKey(cacheKey),
      operation,
      duration,
      cacheMissLog: true
    });
  }

  // Sanitize query for logging (remove sensitive data)
  private static sanitizeQuery(query: string): string {
    // Remove potential sensitive data patterns
    return query
      .replace(/(['"])[^'"]*\1/g, '$1***$1') // Replace quoted strings
      .replace(/\b\d{4,}\b/g, '***') // Replace long numbers (potential IDs)
      .substring(0, 500); // Limit length
  }

  // Sanitize cache keys for logging
  private static sanitizeCacheKey(key: string): string {
    // Remove potential sensitive data from cache keys
    return key
      .replace(/user:\d+/g, 'user:***')
      .replace(/session:[a-f0-9-]+/g, 'session:***')
      .replace(/email:[^:]+/g, 'email:***')
      .substring(0, 200); // Limit length
  }

  // Set dynamic log level
  public static setLogLevel(level: string): void {
    const validLevels = ['error', 'warn', 'info', 'debug'];
    if (validLevels.includes(level)) {
      Logger.logLevel = level;
      Logger.getInstance().level = level;
    }
  }

  // Get current context
  public static getCurrentContext(): LogContext | undefined {
    return requestContext.getStore();
  }

  // Add context to current request
  public static addContext(context: Partial<LogContext>): void {
    const current = requestContext.getStore() || {};
    const merged = { ...current, ...context };
    // Note: We can't modify the current context directly, but we can log with additional context
  }
}

export default Logger;