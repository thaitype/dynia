#!/bin/bash

# Docker installation script for Ubuntu 22.04
# This script installs Docker and Docker Compose on a fresh Ubuntu server

set -euo pipefail

echo "🐳 Installing Docker on Ubuntu..."

# Update package index
apt-get update

# Install prerequisites
apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Set up Docker repository
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update package index again
apt-get update

# Install Docker Engine, containerd, and Docker Compose
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker service
systemctl start docker
systemctl enable docker

# Create dynia directory structure
mkdir -p /opt/dynia/{caddy,placeholder,compose}

# Create edge network
docker network create edge || true

echo "✅ Docker installation completed successfully"
echo "   Docker version: $(docker --version)"
echo "   Docker Compose version: $(docker compose version)"