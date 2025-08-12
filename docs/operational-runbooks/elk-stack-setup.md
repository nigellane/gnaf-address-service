# ELK Stack Setup for G-NAF Address Service

## Overview

This document describes the setup and configuration of the ELK (Elasticsearch, Logstash, Kibana) stack with Filebeat for centralized logging and log analysis for the G-NAF Address Service.

## Architecture

```
G-NAF Service → Log Files → Filebeat → Logstash → Elasticsearch → Kibana
                                                      ↓
                                              Elasticsearch Watcher
                                              (Alerting Rules)
```

## Components

### Elasticsearch 8.11.0
- **Purpose**: Log storage and search engine
- **Port**: 9200 (HTTP), 9300 (Transport)
- **Memory**: 1GB heap (configurable)
- **Storage**: Docker volume `elasticsearch_data`

### Logstash 8.11.0
- **Purpose**: Log parsing and enrichment
- **Port**: 5044 (Beats input), 9600 (API)
- **Memory**: 512MB heap
- **Configuration**: `/docker/logstash/`

### Kibana 8.11.0
- **Purpose**: Log visualization and dashboards
- **Port**: 5601 (Web UI)
- **Features**: Log analysis, pattern detection, dashboard creation

### Filebeat 8.11.0
- **Purpose**: Log shipping from files to Logstash
- **Source**: `/logs` directory (G-NAF service logs)
- **Output**: Logstash (port 5044)

## Quick Start

### 1. Start the ELK Stack

```bash
# Navigate to project directory
cd /path/to/gnaf-address-service

# Start ELK stack with Docker Compose
docker-compose -f docker/elk-stack.yml up -d

# Check service status
docker-compose -f docker/elk-stack.yml ps
```

### 2. Verify Services

```bash
# Check Elasticsearch
curl http://localhost:9200/_cluster/health

# Check Logstash
curl http://localhost:9600

# Check Kibana (wait for startup)
curl http://localhost:5601/api/status
```

### 3. Access Kibana Dashboard

1. Open browser to http://localhost:5601
2. Wait for Kibana to initialize (1-2 minutes)
3. Configure index patterns for `gnaf-logs-*` and `gnaf-alerts-*`

## Log Processing Pipeline

### Log Types and Processing

#### Application Logs (`application.log`)
- **Source**: Winston structured JSON logs
- **Processing**: 
  - JSON parsing
  - Timestamp extraction
  - Correlation ID mapping
  - Request context enrichment

#### Error Logs (`error.log`)
- **Source**: Error-level logs
- **Processing**:
  - Error categorization
  - Stack trace analysis
  - Alert prioritization (HIGH)

#### Performance Logs (`performance.log`)
- **Source**: Performance metrics and slow queries
- **Processing**:
  - Duration metrics
  - Performance categorization
  - Threshold-based alerting

### Log Enrichment

Logstash enriches logs with:
- Service identification (`gnaf-address-service`)
- Log categorization (error, warning, info, performance, security)
- Alert priority levels (low, medium, high, critical)
- Geolocation for IP addresses
- Container metadata (if applicable)

## Index Structure

### Primary Index: `gnaf-logs-YYYY.MM.dd`
- **Purpose**: All application logs
- **Retention**: 30 days (configurable)
- **Fields**:
  - `@timestamp`: Log timestamp
  - `level`: Log level (error, warn, info, debug)
  - `message`: Log message
  - `requestId`: Request correlation ID
  - `service_name`: Always "gnaf-address-service"
  - `log_category`: Categorized log type

### Alert Index: `gnaf-alerts-YYYY.MM.dd`
- **Purpose**: High and critical priority logs
- **Retention**: 90 days
- **Use**: Rapid alerting and incident response

## Alerting Rules

### 1. Error Pattern Alerts
- **Trigger**: >5 errors in 5 minutes
- **Action**: Log alert + Slack notification
- **File**: `/docker/elasticsearch/watcher/error-pattern-alerts.json`

### 2. Slow Query Alerts
- **Trigger**: >3 queries >1s in 10 minutes
- **Action**: Performance alert + Slack notification
- **File**: `/docker/elasticsearch/watcher/slow-query-alerts.json`

### 3. Security Event Alerts
- **Trigger**: Any security event
- **Action**: Immediate critical alert
- **File**: `/docker/elasticsearch/watcher/security-event-alerts.json`

### 4. Anomaly Detection
- **Trigger**: Traffic spikes/drops (3x normal or 70% drop)
- **Action**: Traffic anomaly notification
- **File**: `/docker/elasticsearch/watcher/anomaly-detection-alerts.json`

## Kibana Dashboards

### Index Pattern Setup
```
Index pattern: gnaf-logs-*
Time field: @timestamp
```

### Recommended Visualizations

1. **Log Level Distribution** (Pie chart)
   - Field: `level`
   - Time range: Last 24 hours

2. **Request Volume Over Time** (Line chart)
   - Field: Count
   - X-axis: `@timestamp` (histogram)
   - Y-axis: Count

3. **Top Error Types** (Data table)
   - Field: `errorName.keyword`
   - Metric: Count
   - Filter: `level:error`

4. **Response Time Distribution** (Histogram)
   - Field: `duration`
   - Filter: `log_type:performance`

5. **Security Events** (Data table)
   - Field: `securityEvent.keyword`
   - Time range: Last 7 days

## Configuration Files

### Filebeat Configuration
- **Location**: `/docker/filebeat/config/filebeat.yml`
- **Log Sources**:
  - Application logs: `/var/log/gnaf/application.log`
  - Error logs: `/var/log/gnaf/error.log`
  - Performance logs: `/var/log/gnaf/performance.log`

### Logstash Pipeline
- **Location**: `/docker/logstash/pipeline/gnaf-logs.conf`
- **Features**:
  - JSON log parsing
  - Field enrichment
  - Conditional processing
  - Output routing

### Elasticsearch Watcher
- **Location**: `/docker/elasticsearch/watcher/`
- **Files**: 4 alert configuration files
- **Setup**: Import via Kibana Dev Tools or REST API

## Maintenance

### Log Rotation
```bash
# Clean old indices (older than 30 days)
curl -X DELETE "localhost:9200/gnaf-logs-*" -H "Content-Type: application/json" -d '
{
  "query": {
    "range": {
      "@timestamp": {
        "lt": "now-30d"
      }
    }
  }
}
'
```

### Performance Tuning

#### Elasticsearch
```yaml
# Adjust heap size based on available memory
ES_JAVA_OPTS: "-Xms2g -Xmx2g"  # For production with 4GB+ RAM
```

#### Logstash
```yaml
# Adjust workers and batch size for higher throughput
pipeline.workers: 4
pipeline.batch.size: 2000
pipeline.batch.delay: 25
```

### Backup and Recovery

#### Index Snapshots
```bash
# Create snapshot repository
curl -X PUT "localhost:9200/_snapshot/gnaf_logs_backup" -H "Content-Type: application/json" -d '
{
  "type": "fs",
  "settings": {
    "location": "/usr/share/elasticsearch/snapshots"
  }
}
'

# Create snapshot
curl -X PUT "localhost:9200/_snapshot/gnaf_logs_backup/snapshot_$(date +%Y%m%d)"
```

## Troubleshooting

### Common Issues

1. **Elasticsearch won't start**
   ```bash
   # Check disk space
   df -h
   
   # Check memory
   free -m
   
   # View logs
   docker logs gnaf-elasticsearch
   ```

2. **Filebeat not shipping logs**
   ```bash
   # Check file permissions
   ls -la logs/
   
   # Check Filebeat logs
   docker logs gnaf-filebeat
   
   # Test Logstash connection
   telnet localhost 5044
   ```

3. **Logstash processing errors**
   ```bash
   # Check Logstash logs
   docker logs gnaf-logstash
   
   # Validate pipeline configuration
   docker exec gnaf-logstash /usr/share/logstash/bin/logstash --config.test_and_exit
   ```

4. **Kibana dashboard not loading**
   ```bash
   # Clear browser cache
   # Check Elasticsearch connectivity from Kibana
   docker exec gnaf-kibana curl -f http://elasticsearch:9200/_cluster/health
   ```

### Log Level Debugging

Enable debug logging for troubleshooting:
```bash
# Set LOG_LEVEL environment variable
export LOG_LEVEL=debug

# Or update logger configuration in application
Logger.setLogLevel('debug');
```

## Security Considerations

1. **Network Security**: Use Docker networks for service isolation
2. **Access Control**: Implement authentication for production deployments
3. **Data Encryption**: Enable encryption at rest and in transit for sensitive data
4. **Log Sanitization**: Sensitive data is automatically redacted in logs
5. **Retention Policies**: Implement appropriate log retention based on compliance requirements

## Monitoring the ELK Stack

### Health Checks
```bash
# Elasticsearch cluster health
curl "localhost:9200/_cluster/health?pretty"

# Logstash node stats
curl "localhost:9600/_node/stats?pretty"

# Kibana status
curl "localhost:5601/api/status"
```

### Performance Metrics
- Monitor Elasticsearch JVM heap usage
- Track Logstash pipeline throughput
- Monitor disk space for log indices
- Track Filebeat shipping rates

## Integration with G-NAF Service

The ELK stack integrates with the G-NAF service through:

1. **Enhanced Logger**: Winston-based structured logging
2. **Request Correlation**: AsyncLocalStorage for request tracing
3. **Middleware Integration**: Automatic logging of requests/responses
4. **Performance Monitoring**: Integration with existing performance metrics
5. **Security Logging**: Automatic detection and logging of security events

For more details on the logging implementation, see:
- `src/utils/logger.ts` - Enhanced logging system
- `src/middleware/loggingMiddleware.ts` - Request/response logging
- `docs/operational-runbooks/performance-optimization.md` - Performance monitoring