# Performance Optimization Operational Runbook

## Overview

This runbook provides operational procedures for managing the G-NAF Address Service performance optimization features, including caching, circuit breakers, load balancing, and graceful degradation.

## Architecture Components

### Multi-Tier Caching System
- **L1 Cache**: In-memory LRU cache (node-cache)
- **L2 Cache**: Redis cluster with 3 masters + 3 replicas
- **L3 Cache**: PostgreSQL query result caching
- **CDN Integration**: Geographic distribution capability

### Circuit Breakers
- **Database Circuit Breaker**: Protects against database failures
- **Redis Circuit Breaker**: Protects against cache failures
- **External API Circuit Breaker**: Configurable for external dependencies

### Request Management
- **Rate Limiting**: Per-IP request throttling
- **Priority Queuing**: High/Medium/Low priority request handling
- **Load Shedding**: Automatic request rejection during overload

### Graceful Degradation
- **Normal**: All features operational
- **Reduced**: Non-essential features disabled
- **Minimal**: Only essential features available
- **Emergency**: Critical-only operations

## Deployment Procedures

### 1. Redis Cluster Deployment

```bash
# Setup Redis cluster configuration
./scripts/setup-redis-cluster.sh

# Start Redis cluster
docker-compose -f docker/redis-cluster.yml up -d

# Initialize cluster
./scripts/init-redis-cluster.sh

# Verify cluster health
./scripts/health-check-redis.sh
```

### 2. Application Deployment with Performance Features

```bash
# Set environment variables
export REDIS_CLUSTER_MODE=true
export REDIS_CLUSTER_NODES=redis-1:6379,redis-2:6380,redis-3:6381,redis-4:6382,redis-5:6383,redis-6:6384
export GRACEFUL_DEGRADATION_ENABLED=true
export GRACEFUL_DEGRADATION_AUTO_MODE=true

# Start application
npm run start:production
```

### 3. Performance Monitoring Setup

```bash
# Check performance metrics endpoint
curl http://localhost:3000/api/v1/health/metrics

# Monitor circuit breaker status
curl http://localhost:3000/api/v1/health/detailed | jq '.checks.circuitBreakers'

# Check degradation status
curl http://localhost:3000/api/v1/health/detailed | jq '.checks.degradation'
```

## Monitoring and Alerting

### Key Performance Indicators (KPIs)

1. **Response Time Metrics**
   - Target: <300ms for address validation
   - Target: <500ms for address search
   - Target: <200ms for geocoding

2. **Cache Performance**
   - L1 Cache Hit Ratio: >80%
   - L2 Cache Hit Ratio: >70%
   - Cache Response Time: <10ms

3. **System Health**
   - Error Rate: <1% normal, <5% degraded
   - CPU Usage: <70% normal, <90% critical
   - Memory Usage: <75% normal, <90% critical

### Alert Thresholds

#### Critical Alerts
- Service down (health check failing)
- Error rate >20%
- Response time >5000ms
- Memory usage >95%
- All circuit breakers open

#### Warning Alerts
- Error rate >10%
- Response time >2000ms
- CPU usage >80%
- Memory usage >85%
- Any circuit breaker open

#### Info Alerts
- Degradation level changed
- Cache hit ratio <60%
- Queue size >50 requests

### Monitoring Commands

```bash
# Real-time performance monitoring
./scripts/monitor-redis-cluster.sh

# Application health check
curl -f http://localhost:3000/api/v1/health || echo "Service unhealthy"

# Detailed system status
curl http://localhost:3000/api/v1/health/detailed | jq '.'

# Performance metrics
curl http://localhost:3000/api/v1/health/metrics | jq '.metrics'
```

## Operational Procedures

### 1. Circuit Breaker Management

#### Check Circuit Breaker Status
```bash
curl http://localhost:3000/api/v1/health/detailed | jq '.checks.circuitBreakers'
```

#### Force Circuit Breaker Open (Emergency)
```javascript
// Use in Node.js REPL or admin interface
const { circuitBreakerService } = require('./src/services/circuitBreakerService');
const breaker = circuitBreakerService.getCircuitBreaker('database');
breaker.forceOpen(); // Force open for maintenance
```

#### Reset Circuit Breaker
```javascript
const breaker = circuitBreakerService.getCircuitBreaker('database');
breaker.reset(); // Reset to normal operation
```

### 2. Cache Management

#### Check Cache Status
```bash
# Redis cluster status
redis-cli -h redis-1 -p 6379 cluster info

# Cache hit ratios
curl http://localhost:3000/api/v1/health/metrics | jq '.metrics.performance'
```

#### Clear Cache (Emergency)
```bash
# Clear specific cache pattern
redis-cli -h redis-1 -p 6379 --scan --pattern "address:*" | xargs redis-cli -h redis-1 -p 6379 DEL

# Clear all application cache (DANGEROUS)
# Note: FLUSHDB is disabled in production config
```

#### Cache Warming
```javascript
// Warm cache with common queries
const { cachingService } = require('./src/services/cachingService');
await cachingService.warmCache();
```

### 3. Load Management

#### Check Current Load
```bash
curl http://localhost:3000/api/v1/health/metrics | jq '.metrics.throttling'
```

#### Adjust Rate Limits (Emergency)
```javascript
// Temporarily reduce rate limits
process.env.RATE_LIMIT_MAX_REQUESTS = '500'; // Reduce from 1000
// Restart required for permanent change
```

#### Check Request Queue
```bash
curl http://localhost:3000/api/v1/health/detailed | jq '.checks.throttling.details.currentQueueSize'
```

### 4. Graceful Degradation Management

#### Check Degradation Status
```bash
curl http://localhost:3000/api/v1/health/detailed | jq '.checks.degradation'
```

#### Manually Set Degradation Level
```javascript
const { gracefulDegradationService } = require('./src/services/gracefulDegradationService');

// Set to reduced functionality
gracefulDegradationService.setDegradationLevel('reduced', 'Manual intervention for maintenance');

// Return to normal
gracefulDegradationService.setDegradationLevel('normal', 'Maintenance completed');
```

#### Check Affected Features
```bash
curl http://localhost:3000/api/v1/health/detailed | jq '.checks.degradation.details.affectedFeatures'
```

## Troubleshooting Guide

### High Response Times

1. **Check System Resources**
   ```bash
   curl http://localhost:3000/api/v1/health/detailed | jq '.checks.system'
   ```

2. **Verify Cache Performance**
   ```bash
   # Check cache hit ratios
   curl http://localhost:3000/api/v1/health/metrics | jq '.metrics.performance'
   
   # Check Redis cluster health
   ./scripts/health-check-redis.sh
   ```

3. **Check Database Performance**
   ```bash
   # Look for slow queries
   curl http://localhost:3000/api/v1/health/metrics | jq '.metrics.performance.slowQueries'
   ```

### High Error Rates

1. **Check Circuit Breaker Status**
   ```bash
   curl http://localhost:3000/api/v1/health/detailed | jq '.checks.circuitBreakers'
   ```

2. **Verify Database Connectivity**
   ```bash
   curl http://localhost:3000/api/v1/health/detailed | jq '.checks.database'
   ```

3. **Check Application Logs**
   ```bash
   docker logs gnaf-address-service --tail=100 | grep ERROR
   ```

### Cache Issues

1. **Redis Cluster Problems**
   ```bash
   # Check cluster status
   redis-cli -h redis-1 -p 6379 cluster info
   
   # Check individual nodes
   ./scripts/monitor-redis-cluster.sh
   ```

2. **High Cache Miss Rate**
   - Verify cache TTL settings
   - Check memory usage
   - Consider cache warming

3. **Redis Connection Issues**
   ```bash
   # Test Redis connectivity
   redis-cli -h redis-1 -p 6379 ping
   
   # Check connection pool
   curl http://localhost:3000/api/v1/health/detailed | jq '.checks.cache'
   ```

### System Overload

1. **Enable Emergency Mode**
   ```javascript
   const { gracefulDegradationService } = require('./src/services/gracefulDegradationService');
   gracefulDegradationService.setDegradationLevel('emergency', 'System overload - emergency mode');
   ```

2. **Reduce Load**
   - Scale up infrastructure
   - Enable additional caching
   - Implement temporary rate limits

3. **Monitor Recovery**
   ```bash
   watch -n 5 'curl -s http://localhost:3000/api/v1/health/metrics | jq ".metrics.throttling.systemLoad"'
   ```

## Maintenance Procedures

### 1. Scheduled Maintenance

```bash
# 1. Enable reduced mode
curl -X POST http://localhost:3000/api/admin/degradation -d '{"level":"reduced","reason":"Scheduled maintenance"}'

# 2. Perform maintenance tasks
# - Database maintenance
# - Cache clearing
# - Application updates

# 3. Return to normal operation
curl -X POST http://localhost:3000/api/admin/degradation -d '{"level":"normal","reason":"Maintenance completed"}'
```

### 2. Cache Maintenance

```bash
# Backup Redis data
./scripts/backup-redis-cluster.sh

# Perform Redis maintenance
# - Restart nodes one by one
# - Update configurations
# - Verify cluster integrity

# Verify cache performance
./scripts/health-check-redis.sh
```

### 3. Performance Testing

```bash
# Run load tests
npm run test:load

# Monitor performance during tests
watch -n 2 'curl -s http://localhost:3000/api/v1/health/metrics | jq ".metrics.performance"'
```

## Recovery Procedures

### 1. Service Recovery

```bash
# Check service status
curl http://localhost:3000/api/v1/health

# If service is down, restart with graceful degradation
export GRACEFUL_DEGRADATION_ENABLED=true
npm run start:production

# Monitor recovery
watch -n 5 'curl -s http://localhost:3000/api/v1/health/detailed | jq ".status"'
```

### 2. Cache Recovery

```bash
# Restart Redis cluster
docker-compose -f docker/redis-cluster.yml restart

# Reinitialize if needed
./scripts/init-redis-cluster.sh

# Warm cache
curl -X POST http://localhost:3000/api/admin/cache/warm
```

### 3. Database Recovery

```bash
# Check database connectivity
curl http://localhost:3000/api/v1/health/detailed | jq '.checks.database'

# Reset database circuit breaker if needed
# (Use admin interface or Node.js REPL)

# Verify query performance
curl http://localhost:3000/api/v1/health/metrics | jq '.metrics.performance'
```

## Contact Information

- **On-Call Engineer**: See incident response runbook
- **Database Team**: database-team@company.com
- **Infrastructure Team**: infrastructure@company.com
- **Performance Team**: performance@company.com

## Related Documentation

- [API Performance Requirements](../api-contract.md)
- [Database Optimization Guide](../database/optimization.md)
- [Redis Cluster Configuration](../infrastructure/redis-setup.md)
- [Monitoring and Alerting](../monitoring/setup.md)