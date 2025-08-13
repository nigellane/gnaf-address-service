#!/bin/bash

# Monitor Docker container log sizes
# Alerts when any container log exceeds 200MB

ALERT_THRESHOLD_MB=200
EMAIL_ALERT="admin@example.com"  # Update this

echo "=== Container Log Size Monitor - $(date) ==="

# Check all running containers
docker ps --format "table {{.Names}}\t{{.ID}}" | tail -n +2 | while read name id; do
    if [ -f "/var/lib/docker/containers/${id}/${id}-json.log" ]; then
        size_bytes=$(stat -c%s "/var/lib/docker/containers/${id}/${id}-json.log" 2>/dev/null || echo 0)
        size_mb=$((size_bytes / 1024 / 1024))
        
        echo "Container: $name - Log size: ${size_mb}MB"
        
        if [ $size_mb -gt $ALERT_THRESHOLD_MB ]; then
            echo "⚠️  WARNING: Container $name log file is ${size_mb}MB (exceeds ${ALERT_THRESHOLD_MB}MB threshold)"
            
            # Optionally send email alert (uncomment if you have mail configured)
            # echo "Container $name log size is ${size_mb}MB" | mail -s "Docker Log Alert" $EMAIL_ALERT
        fi
    fi
done

echo ""
echo "=== Docker System Overview ==="
docker system df

echo ""
echo "=== Largest Docker Directories ==="
du -sh /var/lib/docker/containers/* 2>/dev/null | sort -hr | head -5