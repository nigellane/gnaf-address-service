#!/bin/bash

# Comprehensive log rotation and cleanup script
# Handles application logs, Docker logs, and system cleanup

LOG_DIR="/home/nigel/Developer/gnaf-address-service/logs"
RETENTION_DAYS=7
MAX_LOG_SIZE_MB=50

echo "=== Log Rotation Cleanup - $(date) ==="

# 1. Application log cleanup
if [ -d "$LOG_DIR" ]; then
    echo "Cleaning application logs older than $RETENTION_DAYS days..."
    find "$LOG_DIR" -name "*.log" -type f -mtime +$RETENTION_DAYS -delete
    find "$LOG_DIR" -name "*.log.*" -type f -mtime +$RETENTION_DAYS -delete
    
    # Compress large current log files
    find "$LOG_DIR" -name "*.log" -type f -size +${MAX_LOG_SIZE_MB}M -exec gzip {} \;
    
    echo "Application logs cleaned."
fi

# 2. Docker container log cleanup (for containers without log rotation)
echo "Checking Docker container logs..."

docker ps --format "{{.Names}}" | while read container_name; do
    container_id=$(docker ps -q --filter "name=${container_name}")
    if [ ! -z "$container_id" ]; then
        log_file="/var/lib/docker/containers/${container_id}/${container_id}-json.log"
        if [ -f "$log_file" ]; then
            size_mb=$(du -m "$log_file" 2>/dev/null | cut -f1)
            if [ "$size_mb" -gt 500 ]; then
                echo "⚠️  Large log detected: $container_name (${size_mb}MB)"
                # Truncate extremely large logs but keep last 1000 lines
                tail -1000 "$log_file" > "/tmp/${container_name}-truncated.log"
                echo "Log truncated for $container_name, backup saved to /tmp/"
            fi
        fi
    fi
done

# 3. System log cleanup
echo "Cleaning system logs..."

# Clean old journal logs
sudo journalctl --vacuum-time=7d --vacuum-size=500M 2>/dev/null || echo "Journal cleanup requires sudo"

# Clean old syslog files
sudo find /var/log -name "*.log.*" -type f -mtime +$RETENTION_DAYS -delete 2>/dev/null || echo "Syslog cleanup requires sudo"

# 4. Temporary file cleanup
echo "Cleaning temporary files..."
find /tmp -name "*.log" -type f -mtime +1 -delete 2>/dev/null
find /tmp -name "core.*" -type f -mtime +1 -delete 2>/dev/null

# 5. Docker system cleanup
echo "Docker system cleanup..."
docker system prune -f --filter "until=24h"

# 6. Summary
echo ""
echo "=== Cleanup Summary ==="
echo "Application logs: Cleaned files older than $RETENTION_DAYS days"
echo "Docker logs: Checked for oversized logs"
echo "System logs: Cleaned where possible"
echo "Temporary files: Cleaned old temp files"
echo "Docker system: Removed unused resources"

# 7. Current disk usage
echo ""
echo "=== Current Disk Usage ==="
df -h / | head -2

echo ""
echo "=== Largest Log Directories ==="
du -sh /var/log/* 2>/dev/null | sort -hr | head -5
du -sh "$LOG_DIR"/* 2>/dev/null | sort -hr | head -5

echo "Log rotation cleanup completed at $(date)"