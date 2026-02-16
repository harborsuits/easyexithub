#!/bin/bash
# Deploy Easy Exit to Railway

echo "🚀 Deploying Easy Exit to Railway..."
echo ""

cd "$(dirname "$0")"

# Check if railway CLI is available
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install it first:"
    echo "   npm install -g @railway/cli"
    exit 1
fi

echo "📦 Checking git status..."
git status --short

echo ""
echo "🔗 Linking to Railway project..."
echo "   Select the correct project when prompted"
echo ""

railway link

echo ""
echo "🚀 Deploying..."
railway up

echo ""
echo "✅ Deployment complete!"
echo "🌐 Visit: https://easyexithub-production.up.railway.app"
