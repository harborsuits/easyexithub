#!/bin/bash
# Deploy Easy Exit to Railway NOW

cd "$(dirname "$0")"

echo "🚀 Deploying to Railway..."
echo ""

# Step 1: Link (interactive)
echo "Step 1: Linking to Railway project 'proud-patience'..."
railway link b9d313f8-492d-4a99-aabc-e10cf40b12c2

# Step 2: Deploy
echo ""
echo "Step 2: Deploying..."
railway up --service easyexithub

echo ""
echo "✅ Done!"
echo "🌐 Visit: https://easyexithub-production.up.railway.app"
