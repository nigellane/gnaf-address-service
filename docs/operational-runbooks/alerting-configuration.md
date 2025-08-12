# Alerting Configuration Guide

## Overview

This document provides comprehensive configuration for monitoring alerts across the G-NAF Address Service stack, including Prometheus alert rules, Grafana notifications, and integration with external alerting systems.

## Alert Hierarchy and Severity Levels

### Severity Classification

| Level | Response Time | Escalation | Examples |
|-------|---------------|------------|----------|
| **Critical** | Immediate (< 5 min) | PagerDuty, Phone | Service down, data corruption |
| **Warning** | 15 minutes | Slack, Email | High response time, low cache hit |
| **Info** | 1 hour | Email only | Deployment notifications |

### Alert Categories

1. **Service Availability**: Core service functionality
2. **Performance**: Response times and throughput
3. **Infrastructure**: System resources and dependencies
4. **Security**: Security events and anomalies
5. **Business**: Business logic and data quality

## Prometheus Alert Rules

### Core Service Alerts

```yaml
# File: prometheus-rules/gnaf-service-alerts.yml
groups:
  - name: gnaf-service-critical
    interval: 30s
    rules:
      - alert: GNAFServiceDown
        expr: up{job="gnaf-address-service"} == 0
        for: 1m
        labels:
          severity: critical
          service: gnaf-address-service
          category: availability
        annotations:
          summary: "G-NAF Address Service is down"
          description: "G-NAF Address Service has been down for more than 1 minute. Current status: {{ $value }}"
          runbook_url: "https://runbooks.company.com/gnaf/service-down"
          dashboard_url: "https://grafana.company.com/d/gnaf-system-overview"

      - alert: GNAFServiceHighErrorRate
        expr: |
          (
            rate(gnaf_http_requests_total{status_code=~"5.."}[5m]) / 
            rate(gnaf_http_requests_total[5m])
          ) * 100 > 5
        for: 2m
        labels:
          severity: critical
          service: gnaf-address-service
          category: performance
        annotations:
          summary: "High error rate detected in G-NAF service"
          description: "Error rate is {{ $value | humanizePercentage }} over the last 5 minutes"
          runbook_url: "https://runbooks.company.com/gnaf/high-error-rate"

      - alert: GNAFDatabaseConnectionFailure
        expr: gnaf_db_connections_failed_total > gnaf_db_connections_failed_total offset 5m
        for: 1m
        labels:
          severity: critical
          service: gnaf-address-service
          category: infrastructure
        annotations:
          summary: "Database connection failures detected"
          description: "Database connection failures have increased. Current failures: {{ $value }}"
```

### Performance Alerts

```yaml
  - name: gnaf-service-performance
    interval: 30s
    rules:
      - alert: GNAFHighResponseTime
        expr: |
          histogram_quantile(0.95, 
            rate(gnaf_http_request_duration_seconds_bucket[5m])
          ) > 1.0
        for: 3m
        labels:
          severity: warning
          service: gnaf-address-service
          category: performance
        annotations:
          summary: "High response time detected"
          description: "95th percentile response time is {{ $value }}s, exceeding 1 second threshold"
          runbook_url: "https://runbooks.company.com/gnaf/high-response-time"

      - alert: GNAFLowThroughput
        expr: |
          rate(gnaf_http_requests_total[5m]) < 10
        for: 5m
        labels:
          severity: warning
          service: gnaf-address-service
          category: performance
        annotations:
          summary: "Low request throughput detected"
          description: "Request rate is {{ $value }} requests/sec, which is unusually low"

      - alert: GNAFLowCacheHitRatio
        expr: gnaf_cache_hit_ratio{cache_layer="overall"} < 0.70
        for: 5m
        labels:
          severity: warning
          service: gnaf-address-service
          category: performance
        annotations:
          summary: "Low cache hit ratio"
          description: "Overall cache hit ratio is {{ $value | humanizePercentage }}, below 70% threshold"
          runbook_url: "https://runbooks.company.com/gnaf/low-cache-performance"
```

### Infrastructure Alerts

```yaml
  - name: gnaf-infrastructure
    interval: 60s
    rules:
      - alert: GNAFHighMemoryUsage
        expr: |
          (
            container_memory_usage_bytes{pod=~"gnaf-app-.*"} / 
            container_spec_memory_limit_bytes{pod=~"gnaf-app-.*"}
          ) * 100 > 85
        for: 5m
        labels:
          severity: warning
          service: gnaf-address-service
          category: infrastructure
        annotations:
          summary: "High memory usage detected"
          description: "Memory usage is {{ $value | humanizePercentage }} of limit"

      - alert: GNAFHighCPUUsage
        expr: |
          rate(container_cpu_usage_seconds_total{pod=~"gnaf-app-.*"}[5m]) * 100 > 80
        for: 5m
        labels:
          severity: warning
          service: gnaf-address-service
          category: infrastructure
        annotations:
          summary: "High CPU usage detected"
          description: "CPU usage is {{ $value }}% of available resources"

      - alert: GNAFDatabaseConnectionsHigh
        expr: |
          (gnaf_db_connections_active + gnaf_db_connections_idle) / 
          gnaf_db_connections_max * 100 > 85
        for: 3m
        labels:
          severity: warning
          service: gnaf-address-service
          category: infrastructure
        annotations:
          summary: "Database connection pool nearly exhausted"
          description: "Using {{ $value | humanizePercentage }} of available database connections"

      - alert: GNAFRedisConnectionFailure
        expr: gnaf_redis_connections_failed_total > gnaf_redis_connections_failed_total offset 5m
        for: 1m
        labels:
          severity: warning
          service: gnaf-address-service
          category: infrastructure
        annotations:
          summary: "Redis connection issues detected"
          description: "Redis connection failures have increased"
```

### Business Logic Alerts

```yaml
  - name: gnaf-business-logic
    interval: 60s
    rules:
      - alert: GNAFDatasetUnhealthy
        expr: gnaf_dataset_health < 1
        for: 2m
        labels:
          severity: critical
          service: gnaf-address-service
          category: business
        annotations:
          summary: "G-NAF dataset is unhealthy"
          description: "G-NAF dataset health status is {{ $value }}, indicating data issues"
          runbook_url: "https://runbooks.company.com/gnaf/dataset-unhealthy"

      - alert: GNAFLowValidationSuccessRate
        expr: |
          (
            rate(gnaf_address_validations_successful_total[10m]) /
            rate(gnaf_address_validations_total[10m])
          ) * 100 < 90
        for: 5m
        labels:
          severity: warning
          service: gnaf-address-service
          category: business
        annotations:
          summary: "Low address validation success rate"
          description: "Address validation success rate is {{ $value | humanizePercentage }}, below 90%"

      - alert: GNAFUnusualTrafficPattern
        expr: |
          abs(
            rate(gnaf_http_requests_total[5m]) - 
            rate(gnaf_http_requests_total[5m] offset 1d)
          ) / rate(gnaf_http_requests_total[5m] offset 1d) > 0.5
        for: 10m
        labels:
          severity: info
          service: gnaf-address-service
          category: business
        annotations:
          summary: "Unusual traffic pattern detected"
          description: "Traffic volume differs significantly from same time yesterday"
```

### Security Alerts

```yaml
  - name: gnaf-security
    interval: 30s
    rules:
      - alert: GNAFSecurityEventDetected
        expr: increase(gnaf_security_events_total[5m]) > 0
        for: 0s
        labels:
          severity: critical
          service: gnaf-address-service
          category: security
        annotations:
          summary: "Security event detected"
          description: "{{ $value }} security events detected in the last 5 minutes"
          runbook_url: "https://runbooks.company.com/gnaf/security-incident"

      - alert: GNAFSuspiciousTraffic
        expr: |
          rate(gnaf_http_requests_total{status_code="403"}[5m]) > 5
        for: 2m
        labels:
          severity: warning
          service: gnaf-address-service
          category: security
        annotations:
          summary: "High rate of forbidden requests"
          description: "{{ $value }} forbidden requests per second, possible attack"

      - alert: GNAFRateLimitExceeded
        expr: increase(gnaf_rate_limit_exceeded_total[5m]) > 100
        for: 1m
        labels:
          severity: warning
          service: gnaf-address-service
          category: security
        annotations:
          summary: "Rate limit frequently exceeded"
          description: "Rate limit exceeded {{ $value }} times in 5 minutes"
```

## Grafana Alert Manager Configuration

### Notification Channels

#### Slack Integration

```json
{
  "name": "gnaf-alerts-slack",
  "type": "slack",
  "settings": {
    "url": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
    "channel": "#gnaf-alerts",
    "username": "Grafana-G-NAF",
    "iconEmoji": ":warning:",
    "title": "G-NAF Alert: {{ .CommonLabels.alertname }}",
    "text": "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}",
    "fields": [
      {
        "title": "Severity",
        "value": "{{ .CommonLabels.severity }}",
        "short": true
      },
      {
        "title": "Service",
        "value": "{{ .CommonLabels.service }}",
        "short": true
      }
    ]
  }
}
```

#### Email Notifications

```json
{
  "name": "gnaf-email-operations",
  "type": "email",
  "settings": {
    "addresses": [
      "operations@company.com",
      "gnaf-team@company.com"
    ],
    "subject": "G-NAF Alert: {{ .CommonLabels.alertname }} - {{ .CommonLabels.severity }}",
    "body": "Alert Details:\n\nService: {{ .CommonLabels.service }}\nSeverity: {{ .CommonLabels.severity }}\nCategory: {{ .CommonLabels.category }}\n\n{{ range .Alerts }}Summary: {{ .Annotations.summary }}\nDescription: {{ .Annotations.description }}\nRunbook: {{ .Annotations.runbook_url }}\nDashboard: {{ .Annotations.dashboard_url }}\n\n{{ end }}"
  }
}
```

#### PagerDuty Integration

```json
{
  "name": "gnaf-pagerduty-critical",
  "type": "pagerduty",
  "settings": {
    "integrationKey": "YOUR_PAGERDUTY_INTEGRATION_KEY",
    "severity": "{{ .CommonLabels.severity }}",
    "customDetails": {
      "service": "{{ .CommonLabels.service }}",
      "category": "{{ .CommonLabels.category }}",
      "runbook": "{{ .Annotations.runbook_url }}",
      "dashboard": "{{ .Annotations.dashboard_url }}"
    }
  }
}
```

### Alert Rule Groups

#### Critical Alerts (Immediate Response)

```json
{
  "name": "G-NAF Critical Alerts",
  "conditions": [
    {
      "query": "A",
      "reducer": "last",
      "type": "query"
    }
  ],
  "frequency": "30s",
  "handler": 1,
  "noDataState": "alerting",
  "executionErrorState": "alerting",
  "notifications": [
    {
      "id": 1
    },
    {
      "id": 2
    },
    {
      "id": 3
    }
  ],
  "message": "Critical G-NAF service issue requiring immediate attention",
  "tags": {
    "severity": "critical",
    "team": "operations"
  }
}
```

#### Warning Alerts (Standard Response)

```json
{
  "name": "G-NAF Warning Alerts",
  "conditions": [
    {
      "query": "A",
      "reducer": "last",
      "type": "query"
    }
  ],
  "frequency": "1m",
  "handler": 1,
  "noDataState": "no_data",
  "executionErrorState": "alerting",
  "notifications": [
    {
      "id": 1
    },
    {
      "id": 2
    }
  ],
  "message": "G-NAF service warning - investigation recommended",
  "tags": {
    "severity": "warning",
    "team": "operations"
  }
}
```

## External System Integrations

### Opsgenie Configuration

```yaml
# opsgenie-config.yml
responders:
  - name: "G-NAF Operations Team"
    type: "team"
    id: "gnaf-ops-team-id"

routing_rules:
  - criteria:
      - field: "tags"
        operation: "contains"
        expected_value: "severity:critical"
    actions:
      - type: "add-responder"
        responder:
          name: "G-NAF On-Call"
          type: "schedule"

notification_rules:
  - criteria:
      - field: "priority"
        operation: "equals"
        expected_value: "P1"
    actions:
      - type: "send-notification"
        method: "sms"
      - type: "send-notification"
        method: "voice"
```

### Microsoft Teams Integration

```json
{
  "name": "gnaf-teams-alerts",
  "type": "teams",
  "settings": {
    "url": "https://outlook.office.com/webhook/YOUR-WEBHOOK-URL",
    "title": "G-NAF Service Alert",
    "sectiontitle": "Alert Details",
    "message": "{{ range .Alerts }}**{{ .Annotations.summary }}**\n\n{{ .Annotations.description }}\n\n**Severity:** {{ .Labels.severity }}\n**Service:** {{ .Labels.service }}{{ end }}"
  }
}
```

## Alert Routing and Escalation

### Routing Tree

```yaml
# alertmanager.yml
route:
  group_by: ['alertname', 'service']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'default-receiver'
  routes:
  # Critical alerts - immediate escalation
  - match:
      severity: critical
    receiver: 'critical-alerts'
    routes:
    - match:
        service: gnaf-address-service
      receiver: 'gnaf-critical'
      group_wait: 0s
      repeat_interval: 5m

  # Warning alerts - standard escalation
  - match:
      severity: warning
    receiver: 'warning-alerts'
    routes:
    - match:
        service: gnaf-address-service
      receiver: 'gnaf-warnings'
      group_interval: 5m
      repeat_interval: 30m

  # Info alerts - email only
  - match:
      severity: info
    receiver: 'info-alerts'
    group_interval: 30m
    repeat_interval: 12h

receivers:
- name: 'gnaf-critical'
  slack_configs:
  - api_url: 'SLACK_WEBHOOK_URL'
    channel: '#gnaf-critical'
    title: 'CRITICAL: G-NAF Service Alert'
    text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
  email_configs:
  - to: 'oncall@company.com'
    subject: 'CRITICAL: G-NAF Alert - {{ .CommonLabels.alertname }}'
    body: |
      Critical alert for G-NAF Address Service:
      
      {{ range .Alerts }}
      Alert: {{ .Annotations.summary }}
      Description: {{ .Annotations.description }}
      Runbook: {{ .Annotations.runbook_url }}
      Dashboard: {{ .Annotations.dashboard_url }}
      {{ end }}
  pagerduty_configs:
  - routing_key: 'PAGERDUTY_INTEGRATION_KEY'
    description: '{{ .CommonLabels.alertname }}'
```

### Escalation Policies

#### Level 1: Immediate Response (0-5 minutes)
- **Channels**: Slack alert, PagerDuty page
- **Recipients**: Primary on-call engineer
- **Actions**: 
  - Acknowledge alert within 5 minutes
  - Begin initial investigation
  - Update incident status

#### Level 2: Management Escalation (5-15 minutes)
- **Channels**: Email, phone call
- **Recipients**: Team lead, secondary on-call
- **Actions**:
  - Escalate if no acknowledgment from Level 1
  - Coordinate response efforts
  - Notify stakeholders

#### Level 3: Executive Escalation (15-30 minutes)
- **Channels**: Direct communication
- **Recipients**: Engineering manager, product owner
- **Actions**:
  - Business impact assessment
  - External communication coordination
  - Resource allocation decisions

## Alert Suppression and Maintenance

### Maintenance Windows

```yaml
# Suppress alerts during planned maintenance
inhibit_rules:
- source_match:
    alertname: 'MaintenanceMode'
  target_match:
    service: 'gnaf-address-service'
  equal: ['service']
```

### Alert Suppression Rules

```yaml
# Suppress low-priority alerts when critical alerts are active
inhibit_rules:
- source_match:
    severity: 'critical'
  target_match:
    severity: 'warning'
  equal: ['service', 'instance']

- source_match:
    alertname: 'GNAFServiceDown'
  target_match:
    service: 'gnaf-address-service'
  equal: ['service']
```

### Scheduled Suppressions

```bash
# Script to create maintenance window
#!/bin/bash
create_maintenance_window() {
  local start_time=$1
  local end_time=$2
  local reason=$3
  
  cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: maintenance-window
  namespace: gnaf-monitoring
data:
  start_time: "$start_time"
  end_time: "$end_time"
  reason: "$reason"
  status: "active"
EOF
}

# Usage: create_maintenance_window "2023-12-01T02:00:00Z" "2023-12-01T04:00:00Z" "Database maintenance"
```

## Testing and Validation

### Alert Testing Procedures

```bash
# Test alert firing
curl -X POST http://localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "service": "gnaf-address-service",
      "severity": "warning"
    },
    "annotations": {
      "summary": "Test alert for validation",
      "description": "This is a test alert to validate notification channels"
    },
    "startsAt": "'$(date -Iseconds)'",
    "endsAt": "'$(date -d '+1 hour' -Iseconds)'"
  }]'
```

### Runbook Validation

1. **Monthly Alert Drills**:
   - Fire test alerts for each severity level
   - Validate notification delivery
   - Time response procedures
   - Update runbooks based on findings

2. **Quarterly Escalation Testing**:
   - Test full escalation chain
   - Validate external integrations
   - Review and update contact information
   - Practice incident coordination

### Performance Impact Assessment

Monitor alerting system performance:

```promql
# Alert manager performance metrics
rate(alertmanager_http_requests_total[5m])
histogram_quantile(0.95, rate(alertmanager_http_request_duration_seconds_bucket[5m]))
alertmanager_alerts_active
```

## Documentation and Training

### Runbook Creation

Each alert should have:
1. **Symptom Description**: What the alert indicates
2. **Impact Assessment**: Business and technical impact
3. **Investigation Steps**: How to diagnose the issue
4. **Resolution Procedures**: Step-by-step fix instructions
5. **Escalation Criteria**: When to escalate to next level
6. **Prevention Measures**: How to prevent recurrence

### Team Training Requirements

1. **Alert Response Training**: Monthly sessions
2. **Escalation Procedures**: Quarterly reviews
3. **Tool Familiarity**: Hands-on workshops
4. **Incident Post-mortems**: Continuous learning

### Knowledge Base

Maintain comprehensive documentation:
- Alert definitions and thresholds
- Escalation procedures and contacts
- Historical incident patterns
- Resolution time metrics
- Common false positives and suppressions

This alerting configuration ensures comprehensive monitoring coverage while minimizing alert fatigue and ensuring appropriate response to real issues.