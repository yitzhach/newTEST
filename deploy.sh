#!/bin/bash

# Deployment script for GitHub Pages
# Run this after creating your GitHub repository

echo "🚀 Starting deployment setup..."

# Initialize git if not already done
if [ ! -d ".git" ]; then
    echo "📦 Initializing git repository..."
    git init
fi

# Add all files
echo "📝 Staging files..."
git add .

# Check if there are changes to commit
if git diff --staged --quiet; then
    echo "ℹ️  No changes to commit."
else
    echo "💾 Committing changes..."
    git commit -m "Initial commit - React portfolio site ready for GitHub Pages"
fi

# Check if remote exists
if git remote get-url origin &>/dev/null; then
    echo "✅ Remote 'origin' already configured"
    echo "📍 Current remote: $(git remote get-url origin)"
else
    echo ""
    echo "⚠️  No remote repository configured yet."
    echo ""
    echo "Next steps:"
    echo "1. Create a repository on GitHub named 'newTEST'"
    echo "2. Then run:"
    echo "   git remote add origin https://github.com/YOUR_USERNAME/newTEST.git"
    echo "   git branch -M main"
    echo "   git push -u origin main"
    echo ""
    exit 0
fi

# Push to GitHub
echo "🚀 Pushing to GitHub..."
git branch -M main
git push -u origin main

echo ""
echo "✅ Code pushed successfully!"
echo ""
echo "📋 Final step: Enable GitHub Pages"
echo "1. Go to your repository on GitHub"
echo "2. Settings → Pages"
echo "3. Under 'Source', select 'GitHub Actions'"
echo "4. Your site will deploy automatically!"
echo ""
echo "🌐 Your site will be available at:"
echo "   https://YOUR_USERNAME.github.io/newTEST/"

