#!/bin/bash

# Redis Cluster Setup Script for G-NAF Address Service
# Sets up a production-ready Redis cluster with high availability

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
REDIS_DIR="$PROJECT_ROOT/docker/redis"

echo "Setting up Redis cluster for G-NAF Address Service..."

# Create Redis configuration directory if it doesn't exist
mkdir -p "$REDIS_DIR"

# Function to generate Redis node configuration
generate_redis_config() {
    local node_number=$1
    local port=$((6378 + node_number))
    local config_file="$REDIS_DIR/redis-$node_number.conf"
    
    echo "# Redis Node $node_number Configuration" > "$config_file"
    echo "include /etc/redis/redis-base.conf" >> "$config_file"
    echo "" >> "$config_file"
    echo "port $port" >> "$config_file"
    echo "cluster-announce-port $port" >> "$config_file"
    echo "cluster-announce-bus-port $((16378 + node_number))" >> "$config_file"
    echo "cluster-announce-ip \${REDIS_ANNOUNCE_IP:-127.0.0.1}" >> "$config_file"
    echo "dbfilename dump-$node_number.rdb" >> "$config_file"
    echo "appendfilename appendonly-$node_number.aof" >> "$config_file"
    echo "cluster-config-file nodes-$port.conf" >> "$config_file"
    
    echo "Generated configuration for Redis node $node_number (port $port)"
}

# Function to generate Sentinel configuration
generate_sentinel_config() {
    local sentinel_number=$1
    local config_file="$REDIS_DIR/sentinel-$sentinel_number.conf"
    
    cp "$REDIS_DIR/sentinel-base.conf" "$config_file"
    echo "" >> "$config_file"
    echo "# Sentinel $sentinel_number specific settings" >> "$config_file"
    echo "sentinel myid $(openssl rand -hex 20)" >> "$config_file"
    
    echo "Generated configuration for Sentinel $sentinel_number"
}

# Generate Redis node configurations (6 nodes for 3 masters + 3 replicas)
for i in {1..6}; do
    generate_redis_config $i
done

# Generate Sentinel configurations (3 sentinels for HA)
for i in {1..3}; do
    generate_sentinel_config $i
done

# Create environment file for Docker Compose
cat > "$PROJECT_ROOT/.env.redis" << EOF
# Redis Cluster Environment Configuration
REDIS_PASSWORD=gnaf_cache_2024
REDIS_SENTINEL_PASSWORD=gnaf_sentinel_2024
REDIS_CLUSTER_MODE=true
REDIS_CLUSTER_NODES=redis-1:6379,redis-2:6380,redis-3:6381,redis-4:6382,redis-5:6383,redis-6:6384
REDIS_ANNOUNCE_IP=127.0.0.1
COMPOSE_PROJECT_NAME=gnaf-redis
EOF

echo "Created Redis environment configuration"

# Create cluster initialization script
cat > "$SCRIPT_DIR/init-redis-cluster.sh" << 'EOF'
#!/bin/bash
set -e

echo "Waiting for Redis nodes to be ready..."
sleep 15

echo "Creating Redis cluster..."
redis-cli --cluster create \
    redis-1:6379 \
    redis-2:6380 \
    redis-3:6381 \
    redis-4:6382 \
    redis-5:6383 \
    redis-6:6384 \
    --cluster-replicas 1 \
    --cluster-yes

echo "Verifying cluster status..."
redis-cli -h redis-1 -p 6379 cluster nodes
redis-cli -h redis-1 -p 6379 cluster info

echo "Redis cluster initialization completed successfully!"
EOF

chmod +x "$SCRIPT_DIR/init-redis-cluster.sh"

# Create monitoring script
cat > "$SCRIPT_DIR/monitor-redis-cluster.sh" << 'EOF'
#!/bin/bash

echo "Redis Cluster Status:"
echo "===================="

for port in 6379 6380 6381 6382 6383 6384; do
    echo "Node redis-1:$port:"
    redis-cli -h redis-1 -p $port ping 2>/dev/null || echo "  OFFLINE"
    redis-cli -h redis-1 -p $port info replication 2>/dev/null | grep role || true
done

echo ""
echo "Cluster Info:"
redis-cli -h redis-1 -p 6379 cluster info 2>/dev/null || echo "Cluster not available"

echo ""
echo "Sentinel Status:"
for port in 26379 26380 26381; do
    echo "Sentinel on port $port:"
    redis-cli -h redis-1 -p $port ping 2>/dev/null || echo "  OFFLINE"
done
EOF

chmod +x "$SCRIPT_DIR/monitor-redis-cluster.sh"

# Create backup script
cat > "$SCRIPT_DIR/backup-redis-cluster.sh" << 'EOF'
#!/bin/bash

BACKUP_DIR="/backups/redis"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR/$DATE"

echo "Creating Redis cluster backup..."

for i in {1..6}; do
    port=$((6378 + i))
    echo "Backing up redis-$i (port $port)..."
    
    # Create RDB backup
    redis-cli -h redis-$i -p $port BGSAVE
    
    # Wait for backup to complete
    while [ "$(redis-cli -h redis-$i -p $port LASTSAVE)" = "$(redis-cli -h redis-$i -p $port LASTSAVE)" ]; do
        sleep 1
    done
    
    # Copy backup files
    docker cp gnaf-redis-$i:/data/dump-$i.rdb "$BACKUP_DIR/$DATE/"
    docker cp gnaf-redis-$i:/data/appendonly-$i.aof "$BACKUP_DIR/$DATE/"
done

echo "Cluster configuration backup..."
for i in {1..6}; do
    port=$((6378 + i))
    docker cp gnaf-redis-$i:/data/nodes-$port.conf "$BACKUP_DIR/$DATE/"
done

echo "Backup completed: $BACKUP_DIR/$DATE"
EOF

chmod +x "$SCRIPT_DIR/backup-redis-cluster.sh"

# Create health check script
cat > "$SCRIPT_DIR/health-check-redis.sh" << 'EOF'
#!/bin/bash

check_redis_health() {
    local host=$1
    local port=$2
    local name=$3
    
    if redis-cli -h $host -p $port ping >/dev/null 2>&1; then
        echo "✓ $name is healthy"
        return 0
    else
        echo "✗ $name is unhealthy"
        return 1
    fi
}

echo "Redis Cluster Health Check"
echo "========================="

healthy_nodes=0
total_nodes=6

for i in {1..6}; do
    port=$((6378 + i))
    if check_redis_health "redis-$i" $port "Redis Node $i"; then
        ((healthy_nodes++))
    fi
done

echo ""
echo "Sentinel Health Check"
echo "===================="

healthy_sentinels=0
for i in {1..3}; do
    port=$((26378 + i))
    if check_redis_health "redis-sentinel-$i" $port "Sentinel $i"; then
        ((healthy_sentinels++))
    fi
done

echo ""
echo "Summary:"
echo "Redis Nodes: $healthy_nodes/$total_nodes healthy"
echo "Sentinels: $healthy_sentinels/3 healthy"

# Check cluster status
if [ $healthy_nodes -ge 4 ]; then
    echo "✓ Cluster has enough healthy nodes for operation"
    cluster_status=$(redis-cli -h redis-1 -p 6379 cluster info 2>/dev/null | grep cluster_state | cut -d: -f2 | tr -d '\r')
    echo "Cluster state: $cluster_status"
else
    echo "✗ Cluster may not have enough healthy nodes for reliable operation"
    exit 1
fi
EOF

chmod +x "$SCRIPT_DIR/health-check-redis.sh"

echo ""
echo "Redis cluster setup completed successfully!"
echo ""
echo "Next steps:"
echo "1. Start the Redis cluster: docker-compose -f docker/redis-cluster.yml up -d"
echo "2. Initialize the cluster: ./scripts/init-redis-cluster.sh"
echo "3. Monitor cluster status: ./scripts/monitor-redis-cluster.sh"
echo "4. Health check: ./scripts/health-check-redis.sh"
echo ""
echo "Environment variables have been set in .env.redis"
echo "Make sure to source this file or add it to your Docker Compose environment."