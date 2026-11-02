curl -X POST http://localhost:8080/api/v1/event/checkin-hook \
    -H "Content-Type: application/json" \
    -d '{
      "eventSlug": "london-2025",
      "attendeePubkey": "HkYm6kH1r93P7hB2rX6v9sA2b3c4d5e6f7g8h9j1k2m",
      "attendeeEmail": "builder@solana.org",
      "txSignature": "5wK1yR9c..."
    }'