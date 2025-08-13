# 🚨 Troubleshooting Guide

This comprehensive guide helps you diagnose and resolve common issues with Dynia deployments. Issues are organized by category with step-by-step solutions.

## 🔍 Diagnostic Commands

Before diving into specific issues, these commands help identify problems:

### Quick Health Check

```bash
# Overall cluster health
pnpm dynia cluster repair-ha CLUSTER_NAME --check-only

# Individual node status  
pnpm dynia cluster node list --name CLUSTER_NAME

# Certificate status
pnpm dynia cluster certificate status --name CLUSTER_NAME

# Reserved IP assignments
pnpm dynia cluster reserved-ip list

# Infrastructure inspection
pnpm dynia cluster config inspect --name CLUSTER_NAME
```

### Detailed Diagnostics

```bash
# SSH into a node for detailed inspection
ssh -i ~/.ssh/dynia root@NODE_IP

# Check all services on the node
docker ps -a
systemctl status keepalived
systemctl status haproxy  # if running as system service

# Check logs
docker logs dynia-haproxy
docker logs dynia-caddy
journalctl -u keepalived -f
```

## 🔒 SSL Certificate Issues

### Problem: 526 Invalid SSL Certificate

**Symptoms:**
- `HTTP 526` error when accessing your domain
- "Invalid SSL Certificate" in browser
- Cloudflare shows "Origin Certificate error"

**Diagnosis:**
```bash
# Check certificate status
pnpm dynia cluster certificate status --name CLUSTER_NAME

# Verify certificate files exist on node
ssh -i ~/.ssh/dynia root@NODE_IP "ls -la /etc/haproxy/certs/"

# Test direct connection to node
curl -I https://NODE_IP/ --insecure
```

**Solutions:**

1. **Regenerate Origin Certificates:**
```bash
# Force certificate regeneration
pnpm dynia cluster certificate provision --name CLUSTER_NAME --force --verbose

# Check if certificates are properly installed
ssh -i ~/.ssh/dynia root@NODE_IP "cat /etc/haproxy/certs/DOMAIN.pem | head -5"
```

2. **Verify Environment Variables:**
```bash
# Check your .env file has correct Cloudflare credentials
cat .env | grep DYNIA_CF
```

3. **Manual Certificate Verification:**
```bash
# SSH to node and check certificate validity
ssh -i ~/.ssh/dynia root@NODE_IP
openssl x509 -in /etc/haproxy/certs/DOMAIN.crt -text -noout
```

**Common Causes:**
- Missing `DYNIA_CF_API_KEY` (User Service Key)
- Wrong Cloudflare API permissions
- JSON parsing errors in certificate request
- HAProxy configuration pointing to wrong certificate paths

### Problem: Certificate Expiration

**Symptoms:**
- Certificates work initially but fail after some time
- Browser shows certificate expired warnings

**Solutions:**

1. **Check Certificate Expiry:**
```bash
# Check when certificates expire
ssh -i ~/.ssh/dynia root@NODE_IP "openssl x509 -in /etc/haproxy/certs/DOMAIN.crt -dates -noout"
```

2. **Renew Certificates:**
```bash
# Renew all certificates
pnpm dynia cluster certificate renew --name CLUSTER_NAME --force
```

## 🌐 Network and Connectivity Issues

### Problem: Cannot Access Service (502 Bad Gateway)

**Symptoms:**
- `HTTP 502 Bad Gateway` error
- HAProxy can't reach backend services
- Service appears unreachable

**Diagnosis:**
```bash
# Check if Caddy is responding
ssh -i ~/.ssh/dynia root@NODE_IP "curl -I http://127.0.0.1:8080/dynia-health"

# Check if your service container is running
ssh -i ~/.ssh/dynia root@NODE_IP "docker ps | grep SERVICE_NAME"

# Check service logs
ssh -i ~/.ssh/dynia root@NODE_IP "docker logs SERVICE_NAME"
```

**Solutions:**

1. **Verify Service is Running:**
```bash
# Check container status
ssh -i ~/.ssh/dynia root@NODE_IP "docker ps -a"

# Restart service if stopped
ssh -i ~/.ssh/dynia root@NODE_IP "docker restart SERVICE_NAME"
```

2. **Check Port Configuration:**
```bash
# Verify service is listening on correct port
ssh -i ~/.ssh/dynia root@NODE_IP "docker exec SERVICE_NAME netstat -tlnp"

# Common issue: Service listening on port 80 but Caddy expects 8081+
```

3. **Fix Caddy Configuration:**
```bash
# Check Caddy configuration
ssh -i ~/.ssh/dynia root@NODE_IP "docker exec dynia-caddy cat /etc/caddy/Caddyfile"

# Update backend port if needed (requires container recreation)
```

4. **Network Connectivity Test:**
```bash
# Test if Caddy can reach service
ssh -i ~/.ssh/dynia root@NODE_IP "docker exec dynia-caddy curl -I http://SERVICE_NAME:PORT/"
```

### Problem: DNS Resolution Issues

**Symptoms:**
- Domain doesn't resolve to Reserved IP
- DNS propagation seems slow or stuck
- nslookup returns wrong IP

**Diagnosis:**
```bash
# Check DNS resolution
dig DOMAIN.COM
nslookup DOMAIN.COM

# Check Cloudflare DNS records
pnpm dynia cluster reserved-ip list
```

**Solutions:**

1. **Verify DNS Records in Cloudflare:**
   - Log into Cloudflare dashboard
   - Check A record points to correct Reserved IP
   - Ensure "Proxied" (orange cloud) is enabled

2. **Force DNS Update:**
```bash
# Delete and recreate cluster (last resort)
pnpm dynia cluster destroy CLUSTER_NAME --confirm
pnpm dynia cluster create-ha --name CLUSTER_NAME --base-domain DOMAIN.COM
```

3. **Check DNS Propagation:**
```bash
# Test from different DNS servers
dig @8.8.8.8 DOMAIN.COM
dig @1.1.1.1 DOMAIN.COM
```

## ⚡ High Availability Issues

### Problem: Failover Not Working

**Symptoms:**
- Reserved IP doesn't move during node failures
- Backup nodes don't take over when master fails
- Manual activation doesn't work

**Diagnosis:**
```bash
# Check keepalived status on all nodes
pnpm dynia cluster node list --name CLUSTER_NAME

# SSH to each node and check keepalived
ssh -i ~/.ssh/dynia root@NODE_IP "systemctl status keepalived"
ssh -i ~/.ssh/dynia root@NODE_IP "journalctl -u keepalived --since '5 minutes ago'"
```

**Solutions:**

1. **Restart keepalived Service:**
```bash
# On each node
ssh -i ~/.ssh/dynia root@NODE_IP "systemctl restart keepalived"
```

2. **Check keepalived Configuration:**
```bash
# Verify configuration is correct
ssh -i ~/.ssh/dynia root@NODE_IP "cat /etc/keepalived/keepalived.conf"

# Ensure different priorities (100, 90, 80...)
# Ensure same virtual_router_id and auth_pass
```

3. **Manual Failover Test:**
```bash
# Force failover to different node
pnpm dynia cluster node activate --name CLUSTER_NAME --node OTHER_NODE

# Verify Reserved IP moved
pnpm dynia cluster reserved-ip list
```

4. **Check Network Configuration:**
```bash
# Ensure VRRP traffic is not blocked
ssh -i ~/.ssh/dynia root@NODE_IP "ufw status"

# VRRP requires multicast - check if blocked by cloud provider
```

### Problem: Split-Brain Scenario

**Symptoms:**
- Multiple nodes think they are master
- Reserved IP assignments conflict
- Inconsistent service behavior

**Solutions:**

1. **Force Single Master:**
```bash
# Stop keepalived on all nodes
for node in NODE1_IP NODE2_IP NODE3_IP; do
    ssh -i ~/.ssh/dynia root@$node "systemctl stop keepalived"
done

# Start keepalived on preferred master first
ssh -i ~/.ssh/dynia root@MASTER_IP "systemctl start keepalived"

# Wait 10 seconds, then start others
sleep 10
for node in BACKUP1_IP BACKUP2_IP; do
    ssh -i ~/.ssh/dynia root@$node "systemctl start keepalived"
done
```

2. **Verify Network Connectivity:**
```bash
# Test inter-node communication
ssh -i ~/.ssh/dynia root@NODE1_IP "ping -c 3 NODE2_IP"
```

## 🐳 Docker and Container Issues

### Problem: Containers Won't Start

**Symptoms:**
- `docker ps` shows containers as "Exited"
- Services fail health checks immediately
- Containers restart in loops

**Diagnosis:**
```bash
# Check container logs
ssh -i ~/.ssh/dynia root@NODE_IP "docker logs CONTAINER_NAME"

# Check container configuration
ssh -i ~/.ssh/dynia root@NODE_IP "docker inspect CONTAINER_NAME"

# Check Docker daemon
ssh -i ~/.ssh/dynia root@NODE_IP "systemctl status docker"
```

**Solutions:**

1. **Fix Resource Constraints:**
```bash
# Check available resources
ssh -i ~/.ssh/dynia root@NODE_IP "free -h && df -h"

# Remove resource limits if needed
ssh -i ~/.ssh/dynia root@NODE_IP "docker run --rm CONTAINER_NAME --memory=unlimited"
```

2. **Fix Port Conflicts:**
```bash
# Check what's using conflicting ports
ssh -i ~/.ssh/dynia root@NODE_IP "ss -tlnp | grep :PORT"

# Kill conflicting processes or change ports
```

3. **Fix Volume Mount Issues:**
```bash
# Check if mounted directories exist and have correct permissions
ssh -i ~/.ssh/dynia root@NODE_IP "ls -la /etc/caddy/ /etc/haproxy/"
```

### Problem: Docker Network Issues

**Symptoms:**
- Containers can't communicate with each other
- Service discovery not working
- Network timeouts

**Solutions:**

1. **Recreate Docker Networks:**
```bash
# Remove and recreate networks
ssh -i ~/.ssh/dynia root@NODE_IP "
docker network rm edge 2>/dev/null || true
docker network create edge --driver bridge --subnet 172.20.0.0/16
"
```

2. **Restart Docker Service:**
```bash
ssh -i ~/.ssh/dynia root@NODE_IP "systemctl restart docker"
```

## 🔧 CLI and State Management Issues

### Problem: CLI Commands Fail

**Symptoms:**
- Commands hang or timeout
- "State file corrupted" errors
- Permission denied errors

**Solutions:**

1. **Fix State File Issues:**
```bash
# Check state file
cat .dynia/state.json | jq .

# Backup and reset state (last resort)
mv .dynia/state.json .dynia/state.json.backup
```

2. **Fix SSH Key Issues:**
```bash
# Verify SSH key exists and has correct permissions
ls -la ~/.ssh/dynia
chmod 600 ~/.ssh/dynia

# Test SSH connection
ssh -i ~/.ssh/dynia root@NODE_IP "echo 'SSH working'"
```

3. **Fix Environment Variables:**
```bash
# Verify all required environment variables are set
env | grep DYNIA_
```

### Problem: Permission Denied Errors

**Symptoms:**
- "Permission denied" when SSH-ing to nodes
- Cannot write to state file
- Docker commands fail

**Solutions:**

1. **Fix SSH Key Permissions:**
```bash
chmod 600 ~/.ssh/dynia*
chmod 700 ~/.ssh/
```

2. **Fix State Directory Permissions:**
```bash
chmod 755 .dynia/
chmod 644 .dynia/state.json
```

3. **Verify SSH Key is in DigitalOcean:**
```bash
# List SSH keys in your account
pnpm dynia ssh list

# Re-upload if missing
pnpm dynia ssh create --force
```

## 🌍 Cloud Provider Issues

### Problem: DigitalOcean API Errors

**Symptoms:**
- "Authentication failed" errors
- "Rate limit exceeded"
- "Resource not found" errors

**Solutions:**

1. **Verify API Token:**
```bash
# Test DigitalOcean API token
curl -X GET -H "Authorization: Bearer $DYNIA_DO_TOKEN" \
  "https://api.digitalocean.com/v2/account"
```

2. **Check Token Permissions:**
   - Ensure token has "Read" and "Write" permissions
   - Token should not be expired

3. **Verify Region Availability:**
```bash
# Check if region supports your requirements
curl -X GET -H "Authorization: Bearer $DYNIA_DO_TOKEN" \
  "https://api.digitalocean.com/v2/regions"
```

### Problem: Cloudflare API Errors

**Symptoms:**
- DNS records not created
- Certificate generation fails
- "Invalid API token" errors

**Solutions:**

1. **Verify API Tokens:**
```bash
# Test Zone API token
curl -X GET "https://api.cloudflare.com/client/v4/zones/$DYNIA_CF_ZONE_ID" \
  -H "Authorization: Bearer $DYNIA_CF_TOKEN"

# Test User Service Key
curl -X GET "https://api.cloudflare.com/client/v4/certificates" \
  -H "X-Auth-User-Service-Key: $DYNIA_CF_API_KEY"
```

2. **Check Token Permissions:**
   - Zone API token needs `Zone:Edit` permissions
   - User Service Key needs Origin CA permissions

3. **Verify Zone ID:**
   - Get Zone ID from Cloudflare dashboard
   - Must match the domain you're using

## 📊 Performance Issues

### Problem: Slow Response Times

**Symptoms:**
- High latency to services
- Timeouts during peak traffic
- Poor user experience

**Diagnosis:**
```bash
# Test response times
curl -w "@-" -o /dev/null -s "https://DOMAIN.COM/" << 'EOF'
     time_namelookup:  %{time_namelookup}\n
        time_connect:  %{time_connect}\n
     time_appconnect:  %{time_appconnect}\n
    time_pretransfer:  %{time_pretransfer}\n
       time_redirect:  %{time_redirect}\n
  time_starttransfer:  %{time_starttransfer}\n
                     ----------\n
          time_total:  %{time_total}\n
EOF

# Check system resources
ssh -i ~/.ssh/dynia root@NODE_IP "top -n1 -b | head -20"
```

**Solutions:**

1. **Scale Up Resources:**
```bash
# Upgrade to larger droplet size
# This requires manual intervention in DigitalOcean dashboard
# Or destroy and recreate with larger size
```

2. **Optimize HAProxy Configuration:**
```bash
# Increase connection limits in HAProxy config
# Edit /etc/haproxy/haproxy.cfg on nodes
# maxconn 4096 -> maxconn 8192
```

3. **Add More Nodes:**
```bash
# Scale horizontally
pnpm dynia cluster node add --name CLUSTER_NAME --count 2
pnpm dynia cluster prepare CLUSTER_NAME
```

## 🔍 Advanced Debugging

### Enable Debug Logging

```bash
# Run commands with verbose output
pnpm dynia cluster create-ha --name debug-test --base-domain example.com --verbose

# Enable dry-run mode to test without changes
pnpm dynia cluster node add --name CLUSTER_NAME --dry-run --verbose
```

### Manual Service Testing

```bash
# Test each layer independently
ssh -i ~/.ssh/dynia root@NODE_IP

# 1. Test application directly
curl -I http://localhost:8081/

# 2. Test through Caddy  
curl -I http://localhost:8080/ -H "Host: DOMAIN.COM"

# 3. Test through HAProxy
curl -I https://localhost:443/ -H "Host: DOMAIN.COM" --insecure

# 4. Test external access
curl -I https://DOMAIN.COM/
```

### Log Analysis

```bash
# Analyze logs for patterns
ssh -i ~/.ssh/dynia root@NODE_IP "
# HAProxy logs
tail -100 /var/log/haproxy.log | grep -E 'error|fail|timeout'

# Caddy logs  
docker logs dynia-caddy 2>&1 | grep -E 'error|fail|panic'

# keepalived logs
journalctl -u keepalived --since '1 hour ago' | grep -E 'error|fail|transition'
"
```

## 🚨 Emergency Procedures

### Complete Service Recovery

```bash
# 1. Stop all services
ssh -i ~/.ssh/dynia root@NODE_IP "
systemctl stop keepalived
docker stop \$(docker ps -q)
"

# 2. Clean up and restart
ssh -i ~/.ssh/dynia root@NODE_IP "
docker system prune -f
systemctl restart docker
"

# 3. Redeploy infrastructure  
pnpm dynia cluster prepare CLUSTER_NAME --force

# 4. Restart services
ssh -i ~/.ssh/dynia root@NODE_IP "systemctl start keepalived"
```

### Cluster Recreation (Last Resort)

```bash
# Backup current state
cp .dynia/state.json .dynia/state.json.emergency-backup

# Destroy and recreate cluster
pnpm dynia cluster destroy CLUSTER_NAME --confirm
pnpm dynia cluster create-ha --name CLUSTER_NAME --base-domain DOMAIN.COM
pnpm dynia cluster prepare CLUSTER_NAME
```

## 📞 Getting Additional Help

### Community Resources

- **GitHub Issues**: [Report bugs](https://github.com/thaitype/dynia/issues)
- **Documentation**: Check other guides in `docs/` folder
- **Command Help**: `pnpm dynia --help` or `pnpm dynia COMMAND --help`

### Diagnostic Information to Provide

When seeking help, include:

```bash
# System information
uname -a
docker --version
node --version

# Dynia version and configuration
pnpm dynia --version
cat .env | grep -v TOKEN | grep -v KEY  # Hide sensitive values

# Current state
pnpm dynia cluster list
pnpm dynia cluster node list --name CLUSTER_NAME

# Recent logs
pnpm dynia cluster repair-ha CLUSTER_NAME --check-only --verbose
```

### Creating Effective Bug Reports

1. **Clear description** of the problem
2. **Steps to reproduce** the issue  
3. **Expected vs actual behavior**
4. **Environment details** (OS, Node version, etc.)
5. **Error messages** (full text, not screenshots)
6. **Configuration** (sanitized, no secrets)

This troubleshooting guide should help you resolve most common issues with Dynia deployments. Remember to always test changes in a development environment before applying them to production systems.

---

**Next**: [Documentation Index](README.md) - Navigate to other documentation sections.