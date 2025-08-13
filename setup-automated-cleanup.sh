#!/bin/bash

# Complete automated monitoring and cleanup setup

SCRIPT_DIR="/home/nigel/Developer/gnaf-address-service"

echo "🔧 Setting up automated monitoring and cleanup..."

# 1. Create log directories
sudo mkdir -p /var/log/gnaf-monitoring
sudo chown $USER:$USER /var/log/gnaf-monitoring

# 2. Setup comprehensive cron jobs
echo "Adding cron jobs..."

# Remove any existing GNAF monitoring cron jobs
crontab -l 2>/dev/null | grep -v "# GNAF" | grep -v "monitor-container-logs" | grep -v "elasticsearch-cleanup" | grep -v "log-rotation-cleanup" | crontab -

# Add new comprehensive monitoring
(crontab -l 2>/dev/null; cat << EOF

# GNAF Monitoring and Cleanup Automation
# Container log monitoring every 6 hours
0 */6 * * * $SCRIPT_DIR/monitor-container-logs.sh >> /var/log/gnaf-monitoring/docker-monitor.log 2>&1

# Elasticsearch cleanup daily at 2 AM
0 2 * * * $SCRIPT_DIR/elasticsearch-cleanup.sh >> /var/log/gnaf-monitoring/elasticsearch-cleanup.log 2>&1

# Comprehensive log rotation and cleanup daily at 3 AM
0 3 * * * $SCRIPT_DIR/log-rotation-cleanup.sh >> /var/log/gnaf-monitoring/log-rotation.log 2>&1

# Weekly disk usage report on Sundays at 8 AM
0 8 * * 0 df -h && du -sh /var/lib/docker/* | sort -hr | head -10 >> /var/log/gnaf-monitoring/weekly-disk-report.log 2>&1

EOF
) | crontab -

echo "✅ Automated monitoring setup complete!"
echo ""
echo "📅 Scheduled Tasks:"
echo "   • Container monitoring: Every 6 hours"
echo "   • Elasticsearch cleanup: Daily 2 AM"
echo "   • Log rotation cleanup: Daily 3 AM"
echo "   • Weekly disk report: Sundays 8 AM"
echo ""
echo "📁 Log files location: /var/log/gnaf-monitoring/"
echo ""
echo "🔍 Monitor logs with:"
echo "   tail -f /var/log/gnaf-monitoring/docker-monitor.log"
echo "   tail -f /var/log/gnaf-monitoring/elasticsearch-cleanup.log"
echo "   tail -f /var/log/gnaf-monitoring/log-rotation.log"
echo ""
echo "📋 View all cron jobs: crontab -l"
echo "🧪 Test scripts manually:"
echo "   $SCRIPT_DIR/monitor-container-logs.sh"
echo "   $SCRIPT_DIR/elasticsearch-cleanup.sh"
echo "   $SCRIPT_DIR/log-rotation-cleanup.sh"