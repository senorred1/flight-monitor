#!/bin/bash
# Helper script to find your local IP address for iPad access

echo "Finding your local IP address..."
IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)

if [ -z "$IP" ]; then
  echo "Could not find local IP address"
  echo "Please check your network connection"
else
  echo ""
  echo "Your local IP address is: $IP"
  echo ""
  echo "To access from your iPad:"
  echo "  1. Make sure your iPad is on the same Wi-Fi network"
  echo "  2. Open Safari on your iPad and go to: http://$IP:3000"
  echo ""
  echo "To configure the API URL, create frontend/.env with:"
  echo "  VITE_API_URL=http://$IP:8787"
fi

