#!/bin/bash

# Test script for aggressive buffer tuning diagnostic
# Usage: ./test-throughput.sh [build|start]

set -e

echo "================================================"
echo "🧪 WebRTC Throughput Diagnostic Test"
echo "================================================"
echo ""

# Check if on correct branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "test/aggressive-buffer-tuning" ]; then
    echo "⚠️  Warning: Not on test/aggressive-buffer-tuning branch"
    echo "   Current branch: $CURRENT_BRANCH"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "📋 Test Configuration:"
echo "   - Chunk size: 1 MB (was 256 KB)"
echo "   - Max buffer: 15 MB (was 14 MB)"
echo "   - Low water mark: 12 MB (was 4 MB)"
echo ""
echo "📊 Diagnostic logging enabled:"
echo "   - Worker vs Network throughput (every 2s)"
echo "   - Backpressure events (>100ms)"
echo "   - Final summary with stats"
echo ""
echo "📖 See TEST_AGGRESSIVE_BUFFER.md for complete guide"
echo ""

# Check command
CMD=${1:-start}

if [ "$CMD" == "build" ]; then
    echo "🔨 Building production bundle..."
    npm run build
    echo ""
    echo "✅ Build complete!"
    echo ""
    echo "Next steps:"
    echo "1. Deploy or serve the build"
    echo "2. Transfer a 300-500MB file"
    echo "3. Check browser console for 🧪 [DIAGNOSTIC] logs"
    echo "4. Share results for analysis"
elif [ "$CMD" == "start" ]; then
    echo "🚀 Starting dev server..."
    echo ""
    echo "After server starts:"
    echo "1. Open https://10.0.0.6:4200 in TWO browsers/tabs"
    echo "2. Upload a 300-500MB file from one tab"
    echo "3. Download from the other tab"
    echo "4. Watch console for 🧪 [DIAGNOSTIC] logs"
    echo ""
    echo "Press Ctrl+C to stop server"
    echo ""
    npm start
else
    echo "❌ Unknown command: $CMD"
    echo ""
    echo "Usage: ./test-throughput.sh [build|start]"
    exit 1
fi
