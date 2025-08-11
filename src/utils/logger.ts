import winston from 'winston';

class Logger {
  private static instance: winston.Logger;

  public static getInstance(): winston.Logger {
    if (!Logger.instance) {
      Logger.instance = winston.createLogger({
        level: process.env.LOG_LEVEL || 'info',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
            const serviceName = service ? `${service}: ` : '';
            const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level.toUpperCase()}] ${serviceName}${message}${metaString}`;
          })
        ),
        transports: [new winston.transports.Console()],
        defaultMeta: { service: 'gnaf-service' }
      });
    }

    return Logger.instance;
  }

  public static createServiceLogger(serviceName: string): winston.Logger {
    return Logger.getInstance().child({ service: serviceName });
  }
}

export default Logger;