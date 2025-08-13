import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import addressRoutes from './routes/addresses';
import spatialRoutes from './routes/spatial';
import healthRoutes from './routes/healthRoutes';
import { requestTrackingMiddleware, metricsRecordingMiddleware, prometheusMetricsHandler } from './middleware/prometheusMiddleware';
import { 
  initializeRequestContext,
  logIncomingRequest,
  logOutgoingResponse,
  errorLoggingMiddleware,
  securityLoggingMiddleware,
  businessMetricsMiddleware
} from './middleware/loggingMiddleware';
import { ApiError } from './types/api';
import Logger from './utils/logger';

const logger = Logger.createServiceLogger('App');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: false,
  optionsSuccessStatus: 200
}));

app.use(compression({
  threshold: 1024,
  level: 6,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Enhanced logging middleware (before other middleware for proper context)
app.use(initializeRequestContext);
app.use(logIncomingRequest);
app.use(logOutgoingResponse);
app.use(securityLoggingMiddleware);
app.use(businessMetricsMiddleware);

const morganFormat = process.env.NODE_ENV === 'production' 
  ? 'combined' 
  : ':method :url :status :res[content-length] - :response-time ms';

app.use(morgan(morganFormat, {
  stream: {
    write: (message: string) => {
      logger.info(message.trim());
    }
  }
}));

// Prometheus metrics middleware
app.use(requestTrackingMiddleware);
app.use(metricsRecordingMiddleware);

// Prometheus metrics endpoint (before other routes for better labeling)
app.get('/metrics', prometheusMetricsHandler);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Root route serves the dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use('/api/v1/addresses', addressRoutes);
app.use('/api/v1/spatial', spatialRoutes);
app.use('/api/v1', healthRoutes);

app.use('*', (req, res) => {
  const error: ApiError = {
    error: {
      code: 'ENDPOINT_NOT_FOUND',
      message: `The endpoint ${req.method} ${req.originalUrl} was not found.`,
      requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
    }
  };
  res.status(404).json(error);
});

// Enhanced error logging middleware
app.use(errorLoggingMiddleware);

app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  
  logger.error('Unhandled error', {
    requestId,
    error: error.message,
    stack: error.stack,
    method: req.method,
    url: req.url,
    body: req.body
  });
  
  const apiError: ApiError = {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: process.env.NODE_ENV === 'production' 
        ? 'An internal server error occurred.' 
        : error.message,
      requestId
    }
  };
  
  res.status(500).json(apiError);
});

declare global {
  namespace Express {
    interface Request {
      startTime?: number;
      requestId?: string;
      userId?: string;
      sessionId?: string;
      correlationId?: string;
    }
  }
}

export default app;