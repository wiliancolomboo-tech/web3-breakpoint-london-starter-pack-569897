curl -X POST -H "Content-Type: application/json" -d '{
     "jsonrpc": "2.0",
     "id": 1,
     "method": "getAccountInfo",
     "params": [
       "<EVENT_CONFIG_PDA>",
       { "encoding": "base64" }
     ]
   }' https://api.devnet.solana.com