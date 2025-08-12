# Production Deployment and Integration Guide

## Overview

This guide provides comprehensive instructions for deploying the G-NAF Address Service to production, including monitoring stack deployment, alerting configuration, and operational procedures.

## Pre-deployment Checklist

### 1. Infrastructure Requirements

- **Kubernetes Cluster**: v1.25+ with sufficient resources
  - Minimum 4 nodes (2 CPU, 8GB RAM each)
  - Storage class configured for persistent volumes
  - Ingress controller installed (nginx recommended)
  
- **External Services**:
  - Container registry access (GitHub Container Registry configured)
  - DNS management for custom domain
  - SSL certificates (Let's Encrypt or custom CA)
  
- **Monitoring Infrastructure**:
  - Prometheus storage: 100GB+ persistent volume
  - Grafana storage: 20GB+ persistent volume
  - Log aggregation: ELK stack with 200GB+ storage

### 2. Security Configuration

- **Secrets Management**:
  ```bash
  # Update production secrets
  kubectl create secret generic gnaf-secrets \
    --from-literal=DATABASE_PASSWORD="STRONG_PROD_PASSWORD" \
    --from-literal=JWT_SECRET="SUPER_SECRET_32_CHAR_MIN_KEY" \
    --from-literal=API_KEY_SECRET="API_SECRET_KEY" \
    --namespace=gnaf-system
  
  kubectl create secret generic monitoring-secrets \
    --from-literal=GRAFANA_ADMIN_PASSWORD="STRONG_GRAFANA_PASSWORD" \
    --from-literal=ALERT_WEBHOOK_URL="https://hooks.slack.com/..." \
    --namespace=gnaf-monitoring
  ```

- **Network Policies**: Enable pod-to-pod communication restrictions
- **RBAC**: Configure minimal required permissions
- **Image Security**: Use signed container images

### 3. Configuration Validation

- **Environment Variables**: Review all ConfigMaps
- **Resource Limits**: Validate CPU/memory allocations
- **Health Checks**: Verify probe configurations
- **Persistent Volumes**: Ensure backup strategy

## Deployment Process

### Step 1: Deploy Infrastructure Components

```bash
# Create namespaces
kubectl apply -f k8s/namespace.yaml

# Deploy secrets (ensure they're updated with production values)
kubectl apply -f k8s/secrets.yaml

# Deploy configuration
kubectl apply -f k8s/configmap.yaml

# Deploy PostgreSQL database
kubectl apply -f k8s/postgres.yaml

# Wait for database to be ready
kubectl wait --for=condition=ready pod -l app=postgres -n gnaf-system --timeout=300s
```

### Step 2: Deploy Application Services

```bash
# Deploy Redis cache
kubectl apply -f k8s/redis.yaml

# Wait for Redis to be ready
kubectl wait --for=condition=ready pod -l app=redis -n gnaf-system --timeout=300s

# Deploy main application
kubectl apply -f k8s/gnaf-app.yaml

# Wait for application pods to be ready
kubectl wait --for=condition=ready pod -l app=gnaf-address-service -n gnaf-system --timeout=300s
```

### Step 3: Configure Network Access

```bash
# Deploy ingress configuration
kubectl apply -f k8s/ingress.yaml

# Verify ingress is configured
kubectl get ingress -n gnaf-system
kubectl describe ingress gnaf-ingress -n gnaf-system
```

### Step 4: Deploy Monitoring Stack

```bash
# Deploy Prometheus and Grafana
kubectl apply -f k8s/monitoring.yaml

# Wait for monitoring components
kubectl wait --for=condition=ready pod -l app=prometheus -n gnaf-monitoring --timeout=300s
kubectl wait --for=condition=ready pod -l app=grafana -n gnaf-monitoring --timeout=300s
```

### Step 5: Configure Alerting

1. **Prometheus Alerts**: Already configured in `k8s/monitoring.yaml`

2. **Grafana Notifications**:
   ```bash
   # Port forward to Grafana
   kubectl port-forward -n gnaf-monitoring svc/grafana-service 3000:3000
   
   # Access Grafana at http://localhost:3000
   # Username: admin
   # Password: [from monitoring-secrets]
   ```

3. **Configure Notification Channels**:
   - Slack: Use webhook URL from secrets
   - Email: Configure SMTP settings
   - PagerDuty: Set up service integration

### Step 6: SSL/TLS Configuration

#### Option A: Let's Encrypt with cert-manager

```bash
# Install cert-manager (if not already installed)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create ClusterIssuer
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@yourdomain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF

# Update ingress annotations
kubectl annotate ingress gnaf-ingress -n gnaf-system cert-manager.io/cluster-issuer=letsencrypt-prod
```

#### Option B: Custom SSL Certificates

```bash
# Create TLS secret with your certificates
kubectl create secret tls gnaf-tls-secret \
  --cert=path/to/cert.pem \
  --key=path/to/key.pem \
  --namespace=gnaf-system

# Update ingress to use TLS
kubectl patch ingress gnaf-ingress -n gnaf-system --patch '
spec:
  tls:
  - hosts:
    - api.yourdomain.com
    secretName: gnaf-tls-secret
'
```

## Post-Deployment Validation

### 1. Health Check Verification

```bash
# Check all pod status
kubectl get pods -n gnaf-system
kubectl get pods -n gnaf-monitoring

# Test health endpoints
curl -f https://api.yourdomain.com/api/v1/health/live
curl -f https://api.yourdomain.com/api/v1/health/ready
curl -f https://api.yourdomain.com/api/v1/health/detailed
```

### 2. Performance Validation

```bash
# Run smoke tests
export TEST_URL=https://api.yourdomain.com
npm run test:smoke

# Run load test
k6 run scripts/load-test.js
```

### 3. Monitoring Validation

```bash
# Check Prometheus targets
kubectl port-forward -n gnaf-monitoring svc/prometheus-service 9090:9090
# Visit http://localhost:9090/targets

# Check Grafana dashboards
kubectl port-forward -n gnaf-monitoring svc/grafana-service 3000:3000
# Visit http://localhost:3000
```

### 4. Logging Validation

```bash
# Start ELK stack
docker-compose -f docker/elk-stack.yml up -d

# Check log ingestion
kubectl logs -n gnaf-system deployment/gnaf-app-deployment -f
```

## Monitoring and Alerting Configuration

### Prometheus Alert Rules

The following critical alerts are configured:

1. **Service Availability**:
   - `GNAFServiceDown`: Service is not responding
   - `GNAFHighErrorRate`: Error rate > 5%

2. **Performance**:
   - `GNAFHighResponseTime`: 95th percentile > 1 second
   - `GNAFLowCacheHitRatio`: Cache hit ratio < 70%

3. **Infrastructure**:
   - `GNAFDatabaseConnectionsHigh`: DB connections > 90% of pool
   - `GNAFDatasetUnhealthy`: G-NAF dataset issues

### Grafana Dashboard URLs

After deployment, access dashboards at:
- System Overview: `https://grafana.yourdomain.com/d/gnaf-system-overview`
- Performance Monitoring: `https://grafana.yourdomain.com/d/gnaf-performance`
- Cache Performance: `https://grafana.yourdomain.com/d/gnaf-cache`
- Database Operations: `https://grafana.yourdomain.com/d/gnaf-database`

### Alert Notification Channels

Configure these channels in Grafana:

1. **Slack Notifications**:
   - Channel: `#gnaf-alerts`
   - Webhook URL: From `monitoring-secrets`
   - Alert frequency: Immediate for critical, 5min for warnings

2. **Email Notifications**:
   - Recipients: Operations team
   - Format: HTML with dashboard links
   - Escalation: 15 minutes for critical alerts

3. **PagerDuty Integration**:
   - Service: G-NAF Address Service
   - Escalation policy: On-call rotation
   - Auto-resolve: When alerts clear

## Operational Procedures

### Scaling Operations

```bash
# Scale application horizontally
kubectl scale deployment gnaf-app-deployment --replicas=5 -n gnaf-system

# Update HPA settings
kubectl patch hpa gnaf-app-hpa -n gnaf-system --patch '
spec:
  maxReplicas: 15
  minReplicas: 5
'
```

### Database Maintenance

```bash
# Create database backup
kubectl exec -n gnaf-system deployment/postgres-deployment -- \
  pg_dump -U gnaf_user gnaf_db > backup-$(date +%Y%m%d).sql

# Restore from backup
kubectl exec -i -n gnaf-system deployment/postgres-deployment -- \
  psql -U gnaf_user gnaf_db < backup-20231201.sql
```

### Log Management

```bash
# View application logs
kubectl logs -n gnaf-system deployment/gnaf-app-deployment -f

# Export logs for analysis
kubectl logs -n gnaf-system deployment/gnaf-app-deployment --since=24h > app-logs.txt

# Rotate log files (if using file-based logging)
docker-compose -f docker/elk-stack.yml exec elasticsearch \
  curator --config /etc/curator/config.yml /etc/curator/actions.yml
```

### Security Updates

```bash
# Update container images
docker pull ghcr.io/your-org/gnaf-address-service:latest
kubectl set image deployment/gnaf-app-deployment \
  gnaf-app=ghcr.io/your-org/gnaf-address-service:latest \
  -n gnaf-system

# Monitor rollout
kubectl rollout status deployment/gnaf-app-deployment -n gnaf-system
```

## Rollback Procedures

### Application Rollback

```bash
# View rollout history
kubectl rollout history deployment/gnaf-app-deployment -n gnaf-system

# Rollback to previous version
kubectl rollout undo deployment/gnaf-app-deployment -n gnaf-system

# Rollback to specific revision
kubectl rollout undo deployment/gnaf-app-deployment --to-revision=2 -n gnaf-system
```

### Database Rollback

```bash
# Stop application pods
kubectl scale deployment gnaf-app-deployment --replicas=0 -n gnaf-system

# Restore database from backup
kubectl exec -i -n gnaf-system deployment/postgres-deployment -- \
  psql -U gnaf_user gnaf_db < backup-before-deployment.sql

# Restart application
kubectl scale deployment gnaf-app-deployment --replicas=3 -n gnaf-system
```

## Disaster Recovery

### Backup Strategy

1. **Database Backups**:
   - Automated daily backups via CronJob
   - Retention: 30 days local, 90 days offsite
   - Testing: Monthly restore validation

2. **Configuration Backups**:
   ```bash
   # Backup all Kubernetes resources
   kubectl get all -o yaml -n gnaf-system > k8s-backup-$(date +%Y%m%d).yaml
   kubectl get configmaps,secrets -o yaml -n gnaf-system > config-backup-$(date +%Y%m%d).yaml
   ```

3. **Persistent Volume Backups**:
   - Use volume snapshots where available
   - Cloud provider backup services
   - Cross-region replication for critical data

### Recovery Procedures

1. **Complete Cluster Recovery**:
   ```bash
   # Restore from infrastructure-as-code
   ./scripts/deploy-k8s.sh deploy production

   # Restore configurations
   kubectl apply -f k8s-backup-20231201.yaml
   kubectl apply -f config-backup-20231201.yaml

   # Restore database
   kubectl exec -i -n gnaf-system deployment/postgres-deployment -- \
     psql -U gnaf_user gnaf_db < database-backup-20231201.sql
   ```

2. **Partial Service Recovery**:
   ```bash
   # Restart specific services
   kubectl delete pod -l app=gnaf-address-service -n gnaf-system
   kubectl delete pod -l app=postgres -n gnaf-system

   # Verify recovery
   ./scripts/smoke-test.js
   ```

## Performance Tuning

### Database Optimization

```sql
-- Run these queries to optimize PostgreSQL for G-NAF data
-- Connect to database as admin user

-- Analyze table statistics
ANALYZE;

-- Update shared_preload_libraries in postgresql.conf
-- shared_preload_libraries = 'pg_stat_statements'

-- Optimize for spatial queries
SET work_mem = '256MB';
SET random_page_cost = 1.1;
SET effective_cache_size = '4GB';
```

### Application Tuning

```bash
# Update resource limits
kubectl patch deployment gnaf-app-deployment -n gnaf-system --patch '
spec:
  template:
    spec:
      containers:
      - name: gnaf-app
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
'
```

### Cache Optimization

```bash
# Update Redis configuration
kubectl patch configmap redis-config -n gnaf-system --patch '
data:
  redis.conf: |
    maxmemory 1gb
    maxmemory-policy allkeys-lru
    save 900 1
    save 300 10
    save 60 10000
'

# Restart Redis
kubectl rollout restart deployment redis-deployment -n gnaf-system
```

## Compliance and Auditing

### Security Compliance

1. **Regular Security Scans**:
   ```bash
   # Run comprehensive security scan
   ./scripts/docker-security-scan.sh production
   
   # Generate compliance report
   kubectl get pods,services,ingress -n gnaf-system -o yaml > compliance-audit.yaml
   ```

2. **Access Logging**:
   - All API access logged
   - Authentication events tracked
   - Database access monitored
   - Administrative actions audited

3. **Data Protection**:
   - Encryption at rest (database, logs)
   - Encryption in transit (TLS 1.2+)
   - Secrets encrypted in Kubernetes
   - Regular backup testing

### Operational Audits

1. **Monthly Reviews**:
   - Performance metrics analysis
   - Security incident review
   - Capacity planning assessment
   - Backup restoration testing

2. **Quarterly Assessments**:
   - Disaster recovery testing
   - Security vulnerability assessment
   - Compliance audit
   - Architecture review

## Troubleshooting Guide

### Common Issues

1. **Service Not Responding**:
   ```bash
   # Check pod status
   kubectl get pods -n gnaf-system
   kubectl describe pod <pod-name> -n gnaf-system
   kubectl logs <pod-name> -n gnaf-system
   ```

2. **Database Connection Issues**:
   ```bash
   # Test database connectivity
   kubectl exec -it deployment/postgres-deployment -n gnaf-system -- \
     psql -U gnaf_user -d gnaf_db -c "SELECT version();"
   ```

3. **High Memory Usage**:
   ```bash
   # Check resource usage
   kubectl top pods -n gnaf-system
   kubectl describe hpa gnaf-app-hpa -n gnaf-system
   ```

4. **Certificate Issues**:
   ```bash
   # Check certificate status
   kubectl describe certificate gnaf-tls-secret -n gnaf-system
   kubectl get certificaterequests -n gnaf-system
   ```

### Emergency Contacts

- **Primary On-call**: [Phone/Slack]
- **Secondary On-call**: [Phone/Slack]
- **Infrastructure Team**: [Email/Slack channel]
- **Database Administrator**: [Contact info]
- **Security Team**: [Emergency contact]

### Escalation Matrix

| Severity | Response Time | Escalation |
|----------|---------------|------------|
| Critical | 15 minutes | Immediate PagerDuty |
| High | 1 hour | Team lead notification |
| Medium | 4 hours | Business hours response |
| Low | 24 hours | Next business day |

## Success Criteria

Deployment is considered successful when:

- ✅ All pods running and healthy
- ✅ Health endpoints responding (< 100ms)
- ✅ All monitoring alerts configured and tested
- ✅ Load balancer distributing traffic correctly
- ✅ SSL certificates valid and auto-renewing
- ✅ Database performance within SLA (< 500ms queries)
- ✅ Cache hit ratio > 80%
- ✅ Log aggregation functioning
- ✅ Backup and recovery procedures tested
- ✅ Security scans passing
- ✅ Smoke tests passing
- ✅ Load tests meeting performance targets

## Maintenance Schedule

- **Daily**: Automated backups, security updates
- **Weekly**: Performance review, log analysis
- **Monthly**: Dependency updates, capacity planning
- **Quarterly**: DR testing, security audit
- **Annually**: Architecture review, technology refresh

This deployment guide ensures a robust, secure, and maintainable production environment for the G-NAF Address Service.